import { z } from 'zod';
import { query, withTransaction } from '../../db/pool.js';
import { getCarrierConnection, getCarrierToken, type BookingSettings } from './carrier-connection.service.js';

const addressSchema = z.object({
  fullName: z.string().trim().min(2), phone: z.string().trim().regex(/^(?:\+91)?[6-9]\d{9}$/),
  street: z.string().trim().min(5), city: z.string().trim().min(2), state: z.string().trim().min(2),
  postalCode: z.string().trim().regex(/^\d{6}$/),
});
interface BookingOrder {
  id: string; status: string; tracking_number: string | null; carrier: string | null;
  payment_method: string; payment_status: string; payment_reconciliation_error: string | null;
  refund_status: string | null; return_status: string | null;
  total_amount: string; shipping_address: Record<string, unknown>;
}

export function buildShipmentPayload(order: BookingOrder, settings: BookingSettings, quantity: number) {
  const raw = order.shipping_address || {};
  const parsed = addressSchema.safeParse({ ...raw, postalCode: raw.postalCode || raw.pinCode || raw.pincode });
  if (!parsed.success) throw new Error('SHIPMENT_ADDRESS_INCOMPLETE');
  const cod = ['Cash on Delivery', 'cash_on_delivery'].includes(order.payment_method) && order.payment_status !== 'captured';
  if (!cod && order.payment_status !== 'captured') throw new Error('SHIPMENT_PAYMENT_NOT_READY');
  if (order.refund_status || order.return_status || order.payment_reconciliation_error) throw new Error('SHIPMENT_REVIEW_REQUIRED');
  const total = Number(order.total_amount);
  // Higher-value shipments require additional e-waybill details not captured here.
  if (!Number.isFinite(total) || total <= 0 || total > 50000) throw new Error('SHIPMENT_VALUE_REVIEW_REQUIRED');
  const address = parsed.data;
  return {
    pickup_location: { name: settings.pickupLocation },
    shipments: [{
      name: address.fullName, add: address.street, city: address.city, state: address.state,
      pin: address.postalCode, phone: address.phone, country: 'India', order: order.id,
      payment_mode: cod ? 'COD' : 'Prepaid', cod_amount: cod ? total : 0, total_amount: total,
      client: settings.clientName, seller_gst_tin: settings.sellerGstTin, hsn_code: settings.hsnCode,
      invoice_reference: order.id, quantity: String(quantity), products_desc: 'Grooming products',
      weight: String(settings.weightGrams), shipment_length: String(settings.lengthCm),
      shipment_width: String(settings.widthCm), shipment_height: String(settings.heightCm),
      shipping_mode: 'Surface',
    }],
  };
}

async function saveAssignedAwb(orderId: string, awb: string) {
  await withTransaction(async client => {
    const order = (await client.query('SELECT status,tracking_number,carrier FROM orders WHERE id=$1 FOR UPDATE', [orderId])).rows[0];
    if (!order || (order.tracking_number && order.tracking_number !== awb)) throw new Error('SHIPMENT_ASSIGNMENT_CONFLICT');
    const duplicate = await client.query('SELECT id FROM orders WHERE tracking_number=$1 AND id<>$2 LIMIT 1', [awb, orderId]);
    if (duplicate.rows.length) throw new Error('SHIPMENT_ASSIGNMENT_CONFLICT');
    await client.query(`UPDATE orders SET tracking_number=$2,carrier='Delhivery Express',
      shipment_booking_state='created',shipment_booking_error=NULL,updated_at=NOW(),version=version+1 WHERE id=$1`, [orderId, awb]);
    await client.query(`INSERT INTO order_fulfilment_events(order_id,source,previous_status,resulting_status,details)
      VALUES($1,'carrier_api',$2,$2,$3::jsonb)`, [orderId, order.status, JSON.stringify({ action: 'shipment_created', awb, carrier: 'Delhivery Express' })]);
  });
}

async function reconcileBooking(orderId: string, token: string): Promise<void> {
  const response = await fetch(`https://track.delhivery.com/api/v1/packages/json/?ref_ids=${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Token ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('SHIPMENT_RECONCILIATION_PENDING');
  const parsed = z.object({ ShipmentData: z.array(z.object({ Shipment: z.object({ AWB: z.string().min(1), ReferenceNo: z.string() }) })) }).safeParse(await response.json());
  if (!parsed.success) throw new Error('SHIPMENT_RECONCILIATION_PENDING');
  const matches = parsed.data.ShipmentData.filter(row => row.Shipment.ReferenceNo === orderId);
  if (matches.length !== 1) throw new Error('SHIPMENT_RECONCILIATION_PENDING');
  await saveAssignedAwb(orderId, matches[0].Shipment.AWB);
}

export async function bookDueShipments(): Promise<number> {
  const connection = await getCarrierConnection();
  if (!connection.enabled || !connection.configured || !connection.autoAssign || !connection.bookingSettings) return 0;
  const token = await getCarrierToken();
  if (!token) return 0;
  // Recover ambiguous outcomes by order reference only. Never repeat a booking POST
  // after a timeout/crash: the courier may already have accepted it.
  const pending = await query<{ id: string }>(`WITH due AS (
    SELECT id FROM orders WHERE shipment_booking_state IN ('creating','uncertain')
      AND shipment_booking_started_at < NOW()-INTERVAL '5 minutes'
    ORDER BY shipment_booking_started_at FOR UPDATE SKIP LOCKED LIMIT 1
  ) UPDATE orders o SET shipment_booking_started_at=NOW() FROM due WHERE o.id=due.id RETURNING o.id`);
  for (const row of pending.rows) {
    try { await reconcileBooking(row.id, token); }
    catch { await query("UPDATE orders SET shipment_booking_state='uncertain',shipment_booking_error='SHIPMENT_RECONCILIATION_PENDING' WHERE id=$1", [row.id]); }
  }
  const claimed = await query<{ id: string }>(`WITH due AS (
    SELECT id FROM orders WHERE status='processing' AND NULLIF(TRIM(tracking_number),'') IS NULL
      AND shipment_booking_state IS NULL AND (NULLIF(TRIM(carrier),'') IS NULL OR carrier ILIKE '%delhivery%')
      AND (payment_status='captured' OR payment_method IN ('Cash on Delivery','cash_on_delivery'))
      AND payment_reconciliation_error IS NULL AND refund_status IS NULL AND return_status IS NULL
    ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
  ) UPDATE orders o SET shipment_booking_state='creating',shipment_booking_started_at=NOW()
    FROM due WHERE o.id=due.id RETURNING o.id`);
  for (const job of claimed.rows) {
    let sent = false;
    try {
      await withTransaction(async client => {
        const order = (await client.query<BookingOrder>('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [job.id])).rows[0];
        if (!order || order.status !== 'processing' || order.tracking_number) throw new Error('SHIPMENT_ORDER_CHANGED');
        const items = await client.query<{ quantity: number }>('SELECT quantity FROM order_items WHERE order_id=$1', [job.id]);
        if (!items.rows.length) throw new Error('SHIPMENT_ITEMS_REQUIRED');
        const body = buildShipmentPayload(order, connection.bookingSettings!, items.rows.reduce((sum, item) => sum + item.quantity, 0));
        sent = true;
        const response = await fetch('https://track.delhivery.com/api/cmu/create.json', {
          method: 'POST', headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: new URLSearchParams({ format: 'json', data: JSON.stringify(body) }).toString(), signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) throw new Error('SHIPMENT_RECONCILIATION_PENDING');
        const parsed = z.object({ success: z.boolean(), packages: z.array(z.object({ status: z.string(), waybill: z.string().optional(), refnum: z.string().optional() })) }).safeParse(await response.json());
        if (!parsed.success || !parsed.data.success || parsed.data.packages.length !== 1) throw new Error('SHIPMENT_RECONCILIATION_PENDING');
        const pkg = parsed.data.packages[0];
        if (pkg.status.toLowerCase() !== 'success' || !pkg.waybill || pkg.refnum !== order.id) throw new Error('SHIPMENT_RECONCILIATION_PENDING');
        const duplicate = await client.query('SELECT id FROM orders WHERE tracking_number=$1 AND id<>$2 LIMIT 1', [pkg.waybill, order.id]);
        if (duplicate.rows.length) throw new Error('SHIPMENT_ASSIGNMENT_CONFLICT');
        await client.query(`UPDATE orders SET tracking_number=$2,carrier='Delhivery Express',shipment_booking_state='created',
          shipment_booking_error=NULL,updated_at=NOW(),version=version+1 WHERE id=$1`, [order.id,pkg.waybill]);
        await client.query(`INSERT INTO order_fulfilment_events(order_id,source,previous_status,resulting_status,details)
          VALUES($1,'carrier_api',$2,$2,$3::jsonb)`, [order.id, order.status, JSON.stringify({ action: 'shipment_created', awb: pkg.waybill })]);
      });
    } catch (error) {
      const code = !sent && error instanceof Error && /^SHIPMENT_[A-Z_]+$/.test(error.message) ? error.message : 'SHIPMENT_RECONCILIATION_PENDING';
      await query('UPDATE orders SET shipment_booking_state=$2,shipment_booking_error=$3 WHERE id=$1', [job.id, sent ? 'uncertain' : 'blocked', code]);
    }
  }
  return claimed.rows.length + pending.rows.length;
}
