import { query } from '../../db/pool.js';
export async function orderReceipt(order: any) {
  const items = await query('SELECT id, product_name, unit_price, quantity, image_url FROM order_items WHERE order_id = $1 ORDER BY id', [order.id]);
  return {
    success: true, orderId: order.id, status: order.status,
    receiptNumber: `RCPT-UB-${order.id.slice(0, 8).toUpperCase()}`,
    paymentId: order.razorpay_payment_id || '', transactionId: order.razorpay_payment_id || '',
    paymentStatus: order.payment_status, currency: order.currency,
    subtotal: Number(order.subtotal), discountAmount: Number(order.discount_amount || 0),
    couponCode: order.coupon_code, shippingFee: Number(order.shipping_fee),
    taxAmount: Number(order.tax_amount), taxInclusive: order.tax_inclusive, taxRatePercent: Number(order.tax_rate_percent),
    totalAmount: Number(order.total_amount), confirmedAt: order.updated_at || order.created_at,
    shippingAddress: typeof order.shipping_address === 'string' ? JSON.parse(order.shipping_address) : order.shipping_address,
    items: items.rows.map(i => ({ ...i, unit_price: Number(i.unit_price) })),
    paymentDetails: { method: order.payment_method, razorpayOrderId: order.payment_method === 'Razorpay' ? order.idempotency_key : undefined },
  };
}
