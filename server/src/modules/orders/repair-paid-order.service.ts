import { query, withTransaction } from '../../db/pool.js';
import { paymentGateway } from './payment-settlement.service.js';
import { commitStockReservation } from './stock-reservation.service.js';
import { invalidateCatalog } from '../../redis/cache.service.js';

/** Explicit repair only. Verifies already captured money; never captures or refunds money. */
export async function repairPaidOrderInventory(orderId:string, gateway=paymentGateway()) {
  const order=(await query('SELECT * FROM orders WHERE id=$1',[orderId])).rows[0];
  if(!order || order.payment_method!=='Razorpay') throw new Error('ORDER_NOT_FOUND');
  const attempts=await gateway.orders.fetchPayments(order.idempotency_key);
  const captured=attempts.items.filter(p=>p.status==='captured' && Number(p.amount_refunded||0)===0);
  if(captured.length!==1) throw new Error('CAPTURE_REQUIRES_MANUAL_REVIEW');
  const payment=await gateway.payments.fetch(captured[0].id);
  if(payment.status!=='captured'||Number(payment.amount_refunded||0)!==0||payment.order_id!==order.idempotency_key||Number(payment.amount)!==Math.round(Number(order.total_amount)*100)||payment.currency!==order.currency) throw new Error('PAYMENT_MISMATCH');
  const result=await withTransaction(async client=>{
    const current=(await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[orderId])).rows[0];
    if(current.refund_status || current.payment_status==='refunded' || !['accepted','confirmed'].includes(current.status)) throw new Error('ORDER_NOT_REPAIRABLE');
    const holds=(await client.query('SELECT product_id,quantity,status FROM stock_reservations WHERE order_id=$1 ORDER BY product_id FOR UPDATE',[orderId])).rows;
    if(!holds.length) throw new Error('RESERVATIONS_MISSING');
    if(holds.every(h=>h.status==='committed') && current.razorpay_payment_id===payment.id) return {orderId,paymentId:payment.id,repaired:false};
    if(holds.some(h=>h.status!=='active')) throw new Error('RESERVATIONS_NOT_ACTIVE');
    for(const hold of holds){
      const product=(await client.query('SELECT stock_quantity,stock_reserved FROM products WHERE id=$1 FOR UPDATE',[hold.product_id])).rows[0];
      const total=Number((await client.query("SELECT SUM(quantity) AS quantity FROM stock_reservations WHERE product_id=$1 AND status='active'",[hold.product_id])).rows[0].quantity);
      if(!product||total>product.stock_quantity||total<hold.quantity) throw new Error('INSUFFICIENT_STOCK_FOR_REPAIR');
      await client.query('UPDATE products SET stock_reserved=$2,version=version+1,updated_at=NOW() WHERE id=$1',[hold.product_id,total]);
    }
    await commitStockReservation(client,orderId);
    await client.query(`UPDATE orders SET status='confirmed',payment_status='captured',razorpay_payment_id=$2,transaction_id=$2,
      notes=COALESCE(notes,'') || $3,version=version+1,updated_at=NOW()
      ${'payment_reconciliation_error' in current ? ', payment_reconciliation_error=NULL, payment_checked_at=NOW()' : ''} WHERE id=$1`,[orderId,payment.id,`\nInventory repair: verified captured payment ${payment.id}; rebuilt active reservation totals and committed this order once.`]);
    return {orderId,paymentId:payment.id,repaired:true};
  });
  await invalidateCatalog().catch(()=>{});
  return result;
}
