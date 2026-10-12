import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin, requireStaff } from '../../core/auth.middleware.js';
import { query, withTransaction } from '../../db/pool.js';
import { vendorBalances } from './vendor-finance.service.js';

const stylistSchema = z.object({ name: z.string().trim().min(2).max(255), role: z.string().trim().min(2).max(100), is_active: z.boolean().default(true) }).strict();

export async function stylistsRoutes(app: FastifyInstance) {
  app.get('/admin/stylists', { preHandler: [requireAdmin] }, async () => ({
    data: (await query(`
      SELECT DISTINCT ON (LOWER(TRIM(name))) id, name, role, is_active
      FROM stylists
      ORDER BY LOWER(TRIM(name)), is_active DESC, name ASC
    `)).rows
  }));

  app.post('/admin/stylists', { preHandler: [requireAdmin] }, async (request, reply) => {
    const parsed = stylistSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_STYLIST' });
    const { name, role, is_active } = parsed.data;
    const existing = await query('SELECT id, is_active FROM stylists WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))', [name]);
    if (existing.rows.length > 0) {
      if (!existing.rows[0].is_active && is_active) {
        const updated = await query('UPDATE stylists SET is_active=true, role=$2 WHERE id=$1 RETURNING id,name,role,is_active', [existing.rows[0].id, role]);
        return reply.code(200).send(updated.rows[0]);
      }
      return reply.code(409).send({ error: 'STYLIST_ALREADY_EXISTS', message: 'A stylist with this name already exists in the roster.' });
    }
    const result = await query("INSERT INTO stylists(name,role,avatar_url,rating,is_active) VALUES($1,$2,'',NULL,$3) RETURNING id,name,role,is_active", [name, role, is_active]);
    return reply.code(201).send(result.rows[0]);
  });

  app.put<{ Params: { id: string } }>('/admin/stylists/:id', { preHandler: [requireAdmin] }, async (request, reply) => {
    const parsed = stylistSchema.safeParse(request.body);
    if (!z.string().uuid().safeParse(request.params.id).success || !parsed.success) return reply.code(400).send({ error: 'INVALID_STYLIST' });
    const { name, role, is_active } = parsed.data;
    const duplicate = await query('SELECT id FROM stylists WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) AND id <> $2', [name, request.params.id]);
    if (duplicate.rows.length > 0) {
      return reply.code(409).send({ error: 'STYLIST_NAME_TAKEN', message: 'Another stylist already has this name.' });
    }
    const result = await query('UPDATE stylists SET name=$2,role=$3,is_active=$4 WHERE id=$1 RETURNING id,name,role,is_active', [request.params.id, name, role, is_active]);
    return result.rowCount ? result.rows[0] : reply.code(404).send({ error: 'STYLIST_NOT_FOUND' });
  });

  app.delete<{ Params: { id: string } }>('/admin/stylists/:id', { preHandler: [requireAdmin] }, async (request, reply) => {
    if (!z.string().uuid().safeParse(request.params.id).success) return reply.code(400).send({ error: 'INVALID_STYLIST' });
    // Archive rather than erase the assignment history of completed visits.
    const result = await query('UPDATE stylists SET is_active=false WHERE id=$1 RETURNING id', [request.params.id]);
    return result.rowCount ? { ok: true, archived: true } : reply.code(404).send({ error: 'STYLIST_NOT_FOUND' });
  });

  app.get('/admin/overview', { preHandler: [requireStaff] }, async (request, reply) => {
    const parsed = z.object({ days: z.coerce.number().int().min(1).max(90).default(30) }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_RANGE' });
    const days = parsed.data.days;

    const isVendor = request.user?.role === 'vendor';
    let vendorName: string | null = null;
    if (isVendor) {
      vendorName = request.user?.vendorName || null;
      if (!vendorName && request.user?.email) {
        const vRes = await query('SELECT name FROM vendors WHERE LOWER(email) = LOWER($1)', [request.user.email]);
        vendorName = vRes.rows[0]?.name || null;
      }
    }

    return withTransaction(async client => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');

      if (isVendor && vendorName) {
        const counts = (await client.query(`SELECT
          (SELECT COUNT(DISTINCT o.id)::int FROM orders o JOIN order_items oi ON oi.order_id = o.id JOIN products pr ON pr.id = oi.product_id WHERE LOWER(pr.vendor) = LOWER($1)) AS orders,
          0::int AS bookings_today,
          0::int AS unassigned,
          (SELECT COUNT(*)::int FROM products WHERE LOWER(vendor) = LOWER($1) AND stock_quantity - stock_reserved <= 15) AS low_stock,
          0::int AS active_stylists`, [vendorName])).rows[0];

        const bookings: any[] = [];

        const activity = (await client.query(`WITH days AS (
          SELECT generate_series((NOW() AT TIME ZONE 'Asia/Kolkata')::date - $1::int,
            (NOW() AT TIME ZONE 'Asia/Kolkata')::date, INTERVAL '1 day')::date AS day
        ) SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
          COUNT(DISTINCT o.id)::int AS orders,
          COUNT(DISTINCT o.id) FILTER (WHERE o.payment_status IN ('captured', 'refunded'))::int AS collected
          FROM days d
          LEFT JOIN (
            SELECT DISTINCT o.id, o.created_at, o.payment_status
            FROM orders o
            JOIN order_items oi ON oi.order_id = o.id
            JOIN products pr ON pr.id = oi.product_id
            WHERE LOWER(pr.vendor) = LOWER($2)
              AND o.created_at >= NOW() - ($1 * INTERVAL '1 day')
          ) o ON (o.created_at AT TIME ZONE 'Asia/Kolkata')::date = d.day
          GROUP BY d.day ORDER BY d.day`, [days, vendorName])).rows;

        const payments = (await client.query(`
          SELECT COALESCE(o.payment_status, 'unknown') AS status, COUNT(DISTINCT o.id)::int AS count
          FROM orders o
          JOIN order_items oi ON oi.order_id = o.id
          JOIN products pr ON pr.id = oi.product_id
          WHERE LOWER(pr.vendor) = LOWER($2)
            AND o.created_at >= NOW() - ($1 * INTERVAL '1 day')
          GROUP BY o.payment_status
          ORDER BY count DESC, status`, [days, vendorName])).rows;

        const allVendors = await vendorBalances(client);
        const vendorSettlement = allVendors.rows.find((v: any) => v.name.toLowerCase() === vendorName!.toLowerCase()) || null;

        const vendorOrders = (await client.query(`
          SELECT DISTINCT ON (o.id, o.created_at)
            o.id, o.created_at, o.status, o.payment_method, o.payment_status, o.total_amount
          FROM orders o
          JOIN order_items oi ON oi.order_id = o.id
          JOIN products pr ON pr.id = oi.product_id
          WHERE LOWER(pr.vendor) = LOWER($1)
          ORDER BY o.created_at DESC, o.id LIMIT 10`, [vendorName])).rows;

        return { asOf: new Date().toISOString(), days, counts, bookings, activity, payments, vendorSettlement, vendorOrders };
      }

      const counts = (await client.query(`SELECT
      (SELECT COUNT(*)::int FROM orders) AS orders,
      (SELECT COUNT(*)::int FROM bookings WHERE booking_date=(NOW() AT TIME ZONE 'Asia/Kolkata')::date AND status<>'cancelled') AS bookings_today,
      (SELECT COUNT(*)::int FROM bookings WHERE stylist_id IS NULL AND status IN ('pending','confirmed')) AS unassigned,
      (SELECT COUNT(*)::int FROM products WHERE stock_quantity-stock_reserved<=15) AS low_stock,
      (SELECT COUNT(*)::int FROM stylists WHERE is_active=true) AS active_stylists`)).rows[0];
      const bookings = (await client.query("SELECT id,customer_name,booking_date,time_slot,visit_type,status,total_price FROM bookings ORDER BY created_at DESC LIMIT 10")).rows;
      const activity = (await client.query(`WITH days AS (
      SELECT generate_series((NOW() AT TIME ZONE 'Asia/Kolkata')::date-$1::int,
        (NOW() AT TIME ZONE 'Asia/Kolkata')::date,INTERVAL '1 day')::date AS day
    ) SELECT to_char(d.day,'YYYY-MM-DD') AS date,COUNT(o.id)::int AS orders,
      COUNT(o.id) FILTER(WHERE o.payment_status IN ('captured','refunded'))::int AS collected
      FROM days d LEFT JOIN orders o ON (o.created_at AT TIME ZONE 'Asia/Kolkata')::date=d.day
        AND o.created_at>=NOW()-($1 * INTERVAL '1 day')
      GROUP BY d.day ORDER BY d.day`, [days])).rows;
      const payments = (await client.query(`SELECT COALESCE(payment_status,'unknown') AS status,COUNT(*)::int AS count
      FROM orders WHERE created_at>=NOW()-($1 * INTERVAL '1 day') GROUP BY payment_status ORDER BY count DESC,payment_status`, [days])).rows;
      return { asOf: new Date().toISOString(), days, counts, bookings, activity, payments };
    });
  });
}
