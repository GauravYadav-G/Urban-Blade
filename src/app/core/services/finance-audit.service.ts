import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';

export interface AuditOrder {
  id:string; created_at:string; status:string; payment_method:string; payment_status:string;
  total_amount:number; refund_status:string|null; refund_amount:number|null;
  payment_reconciliation_error:string|null; payment_checked_at:string|null;
  razorpay_payment_id:string|null; gateway_order_id:string|null; transaction_id:string|null;
  gateway_status:string|null; gateway_amount:number|null; gateway_refunded:number|null;
  gateway_fee:number|null; gateway_fee_tax:number|null; gateway_checked_at:string|null;
}
export interface GatewayAttempt {
  id:string; gateway_order_id:string|null; status:string; amount_paise:number; refunded_paise:number;
  fee_paise:number|null; tax_paise:number|null; provider_created_at:string; checked_at:string; matched:boolean;
}
export interface VendorBalance { id:string; name:string; gross_sales:number; platform_cut:number; paid_amount:number; payable_amount:number; commission_rate:number; }
export interface FinanceAudit {
  ok:boolean; asOf:string; days:number; offset:number; total:number;
  local:{captured:number;refunded:number;net:number;awaiting:number;inventoryReview:number;orders:number};
  gateway:{captured:number;refunded:number;fees:number;feeTax:number;netAfterFees:number;feesUnknown:number;attempts:number;unmatched:number;lastChecked:string|null};
  orders:AuditOrder[]; attempts:GatewayAttempt[];
  inventory:Array<{id:string;name:string;stock_quantity:number;stock_reserved:number;ledger_reserved:number}>;
  vendorSettlements:VendorBalance[];
}
@Injectable({providedIn:'root'})
export class FinanceAuditService {
  private readonly http=inject(HttpClient);
  load(days:number,offset:number,search:string){return this.http.get<FinanceAudit>('/api/admin/finance/audit',{params:new HttpParams().set('days',days).set('offset',offset).set('search',search)});}
  sync(from:number,to:number,offset:number){return this.http.post<{ok:boolean;imported:number;nextOffset:number|null;issues:Array<{paymentId:string;error:string}>}>('/api/admin/finance/sync-gateway',{from,to,offset});}
  reconcile(id:string){return this.http.post<{message:string}>(`/api/admin/orders/${id}/reconcile-payment`,{});}
  repair(id:string){return this.http.post(`/api/admin/orders/${id}/repair-inventory`,{});}
  recordPayout(vendorId:string,amount:number,reference:string){return this.http.post('/api/admin/finance/process-payout',{vendorId,amount,reference});}
}
