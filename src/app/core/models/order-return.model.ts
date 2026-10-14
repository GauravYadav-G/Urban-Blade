export type ReturnStatus = 'requested' | 'approved' | 'rejected' | 'received';
export type ReturnReviewStatus = Exclude<ReturnStatus, 'requested'>;

export interface OrderReturnDetails {
  currency?: string;
  payment_status?: string;
  payment_method?: string;
  payment_reconciliation_error?: string | null;
  return_status?: ReturnStatus | null;
  return_reason?: string | null;
  return_review_note?: string | null;
  return_requested_at?: string | null;
  return_requested_by?: string | null;
  return_reviewed_at?: string | null;
  return_reviewed_by?: string | null;
  return_received_at?: string | null;
  return_restock?: boolean | null;
  refund_status?: 'pending' | 'processed' | 'failed' | null;
  refund_amount?: number;
  refund_id?: string | null;
  refund_failure_reason?: string | null;
  refunded_at?: string | null;
}

export interface ReturnEvent {
  id: string;
  status: ReturnStatus;
  previous_status: ReturnStatus | null;
  actor_id?: string | null;
  actor_name?: string | null;
  source: string;
  note: string;
  restock?: boolean | null;
  created_at: string;
}

export const RETURN_STATUS_LABELS: Record<ReturnStatus, string> = {
  requested: 'Awaiting review',
  approved: 'Approved · awaiting parcel',
  rejected: 'Return declined',
  received: 'Received & inspected',
};

export function canRequestOrderReturn(order: {
  status: string;
  payment_status: string;
  payment_method: string;
  return_status?: string | null;
  refund_status?: string | null;
  refund_amount?: number;
  payment_reconciliation_error?: string | null;
}): boolean {
  return order.status === 'delivered' && !order.return_status && !order.refund_status &&
    !order.payment_reconciliation_error && Number(order.refund_amount || 0) <= 0 &&
    (['paid', 'captured'].includes((order.payment_status || '').toLowerCase().trim()) || isUncollectedCodOrder(order));
}

export function isUncollectedCodOrder(order: Pick<OrderReturnDetails, 'payment_method' | 'payment_status'>): boolean {
  return ['cash on delivery', 'cash_on_delivery'].includes((order.payment_method || '').toLowerCase().trim()) &&
    (order.payment_status || '').toLowerCase().trim() === 'pending';
}

export function canRefundOrderReturn(order: OrderReturnDetails): boolean {
  return order.return_status === 'received' && order.refund_status !== 'processed' &&
    (['paid', 'captured'].includes((order.payment_status || '').toLowerCase().trim()) ||
      (order.payment_method === 'Razorpay' && ['pending', 'failed'].includes(order.refund_status || '')));
}
