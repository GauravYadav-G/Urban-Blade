import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { forkJoin } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FinanceAuditService, FinanceAudit } from '@core/services/finance-audit.service';
interface Overview {
  asOf: string; days: number;
  counts: { orders:number; bookings_today:number; unassigned:number; low_stock:number; active_stylists:number };
  bookings: Array<{id:string; customer_name:string; booking_date:string; time_slot:string; visit_type:string; status:string; total_price:number}>;
  activity: Array<{date:string; orders:number; collected:number}>;
  payments: Array<{status:string; count:number}>;
}
@Component({selector:'app-admin-dashboard',standalone:true,imports:[CommonModule,RouterLink],templateUrl:'./admin-dashboard.html',styleUrl:'./admin-dashboard.scss'})
export class AdminDashboard {
  private readonly http=inject(HttpClient);
  private readonly finance=inject(FinanceAuditService);
  private readonly destroyRef=inject(DestroyRef);
  readonly data=signal<{overview:Overview;finance:FinanceAudit}|null>(null);
  readonly loading=signal(false);
  readonly error=signal('');
  readonly days=signal(30);
  readonly chartMetric=signal<'orders'|'collected'>('orders');
  readonly selectedDay=signal<string|null>(null);
  readonly showChartData=signal(false);
  readonly paymentTotal=computed(()=>this.data()?.overview.payments.reduce((sum,row)=>sum+row.count,0) || 0);
  readonly chartMax=computed(()=>Math.max(1,...(this.data()?.overview.activity.map(row=>row[this.chartMetric()]) || [])));
  readonly activityTotal=computed(()=>this.data()?.overview.activity.reduce((sum,row)=>sum+row[this.chartMetric()],0) || 0);
  readonly activeDay=computed(()=>this.data()?.overview.activity.find(row=>row.date===this.selectedDay()) || null);
  readonly paymentSlices=computed(()=>{
    let offset=0;
    const colors:Record<string,string>={captured:'#0b0f19',refunded:'#94a3b8',pending:'#f59e0b',failed:'#b45309',paid:'#334155'};
    return (this.data()?.overview.payments || []).map(row=>{
      const percent=this.paymentTotal()?row.count/this.paymentTotal()*100:0;
      const slice={...row,percent,offset,color:colors[row.status] || '#cbd5e1'};
      offset+=percent;return slice;
    });
  });
  constructor(){this.refresh();}
  setRange(days:number):void {if(this.loading()||days===this.days())return;this.days.set(days);this.refresh();}
  refresh():void {
    if(this.loading())return;
    this.loading.set(true);this.error.set('');
    forkJoin({overview:this.http.get<Overview>('/api/admin/overview',{params:{days:this.days()}}),finance:this.finance.load(this.days(),0,'')}).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next:data=>{this.data.set(data);this.selectedDay.set(null);this.loading.set(false);},
      error:()=>{this.error.set('Refresh failed. Any snapshot shown below is from the previous successful load. Please retry.');this.loading.set(false);}
    });
  }
}
