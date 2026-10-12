import { Component, OnInit, OnDestroy, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom, Subject, takeUntil } from 'rxjs';
import { FinanceAuditService, FinanceAudit, AuditOrder, VendorBalance } from '@core/services/finance-audit.service';
import { ToastService } from '@core/services/toast.service';

@Component({selector:'app-admin-finance',standalone:true,imports:[CommonModule,FormsModule,RouterLink],templateUrl:'./admin-finance.html',styleUrls:['./admin-finance.scss'],changeDetection:ChangeDetectionStrategy.OnPush})
export class AdminFinance implements OnInit,OnDestroy {
  private readonly api=inject(FinanceAuditService);
  private readonly toast=inject(ToastService);
  private readonly destroyed=new Subject<void>();
  private timer:ReturnType<typeof setInterval>|undefined;
  private alive=true;
  private requestVersion=0;
  readonly data=signal<FinanceAudit|null>(null);
  readonly days=signal(30);
  readonly offset=signal(0);
  readonly search=signal('');
  readonly tab=signal<'orders'|'gateway'|'inventory'|'vendors'>('orders');
  readonly loading=signal(false);
  readonly syncing=signal(false);
  readonly syncMessage=signal('');
  readonly error=signal('');
  readonly checking=signal<string|null>(null);
  readonly payout=signal<VendorBalance|null>(null);
  readonly payoutAmount=signal(0);
  readonly payoutReference=signal('');
  readonly saving=signal(false);
  readonly selectedOrder=signal<AuditOrder|null>(null);

  ngOnInit(){void this.refresh();this.timer=setInterval(()=>{if(!this.syncing()&&!this.loading()&&!document.hidden) void this.refresh();},30000);}
  ngOnDestroy(){this.alive=false;this.destroyed.next();this.destroyed.complete();if(this.timer)clearInterval(this.timer);}
  async refresh(){
    const version=++this.requestVersion;this.loading.set(true);this.error.set('');
    try{const result=await firstValueFrom(this.api.load(this.days(),this.offset(),this.search()).pipe(takeUntil(this.destroyed)));if(this.alive&&version===this.requestVersion)this.data.set(result);}
    catch(error){if(this.alive&&version===this.requestVersion)this.error.set(this.message(error,'Financial data is unavailable. Displayed values may be stale.'));}
    finally{if(this.alive&&version===this.requestVersion)this.loading.set(false);}
  }
  filter(){this.offset.set(0);void this.refresh();}
  page(delta:number){this.offset.set(Math.max(0,this.offset()+delta));void this.refresh();}
  async syncGateway(){
    if(this.syncing())return;this.syncing.set(true);this.syncMessage.set('Reading Razorpay payment records…');
    const to=Math.floor(Date.now()/1000),from=to-this.days()*86400;
    let offset:number|null=0,imported=0,issues=0;
    try{
      while(offset!==null&&this.alive){
        const result: {ok:boolean;imported:number;nextOffset:number|null;issues:Array<{paymentId:string;error:string}>}=await firstValueFrom(this.api.sync(from,to,offset).pipe(takeUntil(this.destroyed)));
        imported+=result.imported;issues+=result.issues.length;offset=result.nextOffset;
        this.syncMessage.set(`Checked ${imported} payment attempts. ${issues} require review.`);
        if(offset!==null&&offset>=10000){this.syncMessage.set(`Imported ${imported} attempts; range is too large. Select a shorter period to complete the sync.`);break;}
      }
      if(this.alive){await this.refresh();if(offset===null)this.syncMessage.set(`Sync complete: ${imported} attempts checked; ${issues} require review.`);}
    }catch(error){if(this.alive)this.syncMessage.set(this.message(error,'Sync incomplete. Previously imported records are retained. Retry to finish.'));}
    finally{if(this.alive)this.syncing.set(false);}
  }
  async reconcile(order:AuditOrder){
    if(this.checking())return;this.checking.set(order.id);
    try{const result=await firstValueFrom(this.api.reconcile(order.id).pipe(takeUntil(this.destroyed)));this.toast.info(result.message);await this.refresh();}
    catch(error){if(this.alive)this.toast.error(this.message(error,'Payment could not be checked.'));}
    finally{if(this.alive)this.checking.set(null);}
  }
  async repair(order:AuditOrder){
    if(this.checking() || !window.confirm('Verify the captured payment, rebuild active reservation totals, and commit this order once? This will not charge the customer.'))return;
    this.checking.set(order.id);
    try{await firstValueFrom(this.api.repair(order.id).pipe(takeUntil(this.destroyed)));this.toast.success('Paid inventory repaired.');await this.refresh();}
    catch(error){if(this.alive)this.toast.error(this.message(error,'Inventory repair was rejected.'));}
    finally{if(this.alive)this.checking.set(null);}
  }
  openPayout(vendor:VendorBalance){this.payout.set(vendor);this.payoutAmount.set(Number(vendor.payable_amount));this.payoutReference.set('');}
  openOrderDetails(order:AuditOrder){this.selectedOrder.set(order);}
  closeOrderDetails(){this.selectedOrder.set(null);}
  async savePayout(){
    const vendor=this.payout();if(!vendor||this.saving())return;
    if(!Number.isFinite(this.payoutAmount())||this.payoutAmount()<=0||this.payoutReference().trim().length<3){this.toast.error('Enter the paid amount and completed bank transfer reference.');return;}
    this.saving.set(true);
    try{await firstValueFrom(this.api.recordPayout(vendor.id,this.payoutAmount(),this.payoutReference().trim()).pipe(takeUntil(this.destroyed)));this.payout.set(null);this.toast.success('RazorpayX payout created.');await this.refresh();}
    catch(error){if(this.alive)this.toast.error(this.message(error,'Payout record could not be saved.'));}
    finally{if(this.alive)this.saving.set(false);}
  }
  discrepancy(order:AuditOrder):string{
    if(order.payment_reconciliation_error)return 'Inventory review required';
    if(order.payment_method!=='Razorpay')return 'External payment';
    if(!order.gateway_status)return 'Gateway not checked';
    if(['captured','refunded'].includes(order.gateway_status)&&!['captured','refunded'].includes(order.payment_status))return 'Payment mismatch';
    if(order.gateway_amount!==null&&Number(order.gateway_amount)!==Number(order.total_amount))return 'Amount mismatch';
    if(Number(order.gateway_refunded||0)!==Number(order.refund_amount||0))return 'Refund mismatch';
    return order.payment_status==='pending'?'Awaiting successful payment':'Matched';
  }
  exportPage(){
    const rows=this.data()?.orders||[];
    const cell=(value:unknown)=>'"'+String(value??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';
    const fields=['Order ID','Gateway order','Payment ID','Local status','Gateway status','Order amount INR','Gateway amount INR','Refunded INR','Gateway fee INR (includes GST)','Fee GST INR','Checked at'];
    const lines=rows.map(o=>[o.id,o.gateway_order_id,o.razorpay_payment_id,o.payment_status,o.gateway_status,o.total_amount,o.gateway_amount,o.gateway_refunded,o.gateway_fee,o.gateway_fee_tax,o.gateway_checked_at]);
    const url=URL.createObjectURL(new Blob([[fields,...lines].map(row=>row.map(cell).join(',')).join('\n')],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download='financial-audit-current-page.csv';a.click();URL.revokeObjectURL(url);
  }
  private message(error:unknown,fallback:string){return (error as {error?:{message?:string}})?.error?.message||fallback;}
}
