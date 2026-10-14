/** A requested refund is not settled money. Only terminal success or the gateway ledger proves repayment. */
export const orderMoneyCte = `order_money AS (
  SELECT o.*, LEAST(o.total_amount, GREATEST(
    CASE WHEN o.payment_status = 'refunded' OR o.refund_status = 'processed'
      THEN COALESCE(o.refund_amount, o.total_amount) ELSE 0 END,
    COALESCE(g.refunded_paise / 100.0, 0)
  )) AS confirmed_refund_amount
  FROM orders o LEFT JOIN gateway_payments g ON g.id = o.razorpay_payment_id
)`;
