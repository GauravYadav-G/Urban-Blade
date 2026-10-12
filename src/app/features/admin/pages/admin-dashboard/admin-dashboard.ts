import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { forkJoin, map } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FinanceAuditService, FinanceAudit, VendorBalance } from '@core/services/finance-audit.service';
import { AccountService } from '@core/services/account.service';

interface Overview {
  asOf: string; days: number;
  counts: { orders:number; bookings_today:number; unassigned:number; low_stock:number; active_stylists:number };
  bookings: Array<{id:string; customer_name:string; booking_date:string; time_slot:string; visit_type:string; status:string; total_price:number}>;
  activity: Array<{date:string; orders:number; collected:number}>;
  payments: Array<{status:string; count:number}>;
  vendorSettlement?: VendorBalance | null;
  vendorOrders?: Array<{id:string; created_at:string; status:string; payment_method:string; payment_status:string; total_amount:number}>;
}

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './admin-dashboard.html',
  styleUrl: './admin-dashboard.scss'
})
export class AdminDashboard {
  private readonly http = inject(HttpClient);
  private readonly finance = inject(FinanceAuditService);
  private readonly destroyRef = inject(DestroyRef);
  readonly account = inject(AccountService);

  readonly isVendor = computed(() => this.account.isVendor());
  readonly vendorName = computed(() => this.account.activeVendorName() || 'Vendor Partner');

  readonly data = signal<{overview:Overview;finance:FinanceAudit}|null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly days = signal(30);
  readonly chartMetric = signal<'orders'|'collected'>('orders');
  readonly selectedDay = signal<string|null>(null);
  readonly showChartData = signal(false);

  readonly vendorSettlement = computed(() => this.data()?.overview.vendorSettlement || this.data()?.finance.vendorSettlements?.[0] || null);
  readonly vendorOrders = computed(() => this.data()?.overview.vendorOrders || []);

  readonly paymentTotal = computed(() => this.data()?.overview.payments.reduce((sum,row)=>sum+row.count,0) || 0);
  readonly chartMax = computed(() => Math.max(1,...(this.data()?.overview.activity.map(row=>row[this.chartMetric()]) || [])));
  readonly activityTotal = computed(() => this.data()?.overview.activity.reduce((sum,row)=>sum+row[this.chartMetric()],0) || 0);
  readonly activeDay = computed(() => this.data()?.overview.activity.find(row=>row.date===this.selectedDay()) || null);
  readonly paymentSlices = computed(() => {
    let offset = 0;
    const colors: Record<string,string> = { captured:'#0b0f19', refunded:'#94a3b8', pending:'#f59e0b', failed:'#b45309', paid:'#334155' };
    return (this.data()?.overview.payments || []).map(row => {
      const percent = this.paymentTotal() ? row.count / this.paymentTotal() * 100 : 0;
      const slice = { ...row, percent, offset, color: colors[row.status] || '#cbd5e1' };
      offset += percent;
      return slice;
    });
  });

  constructor() {
    this.refresh();
  }

  setRange(days: number): void {
    if (this.loading() || days === this.days()) return;
    this.days.set(days);
    this.refresh();
  }

  refresh(): void {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set('');

    const overview$ = this.http.get<Overview>('/api/admin/overview', { params: { days: this.days() } });

    const req$ = this.isVendor()
      ? overview$.pipe(
          map(overview => ({
            overview,
            finance: {
              ok: true,
              asOf: overview.asOf,
              days: overview.days,
              offset: 0,
              total: overview.counts.orders,
              local: {
                captured: Number(overview.vendorSettlement?.gross_sales || 0),
                refunded: 0,
                net: Number(overview.vendorSettlement?.payable_amount || 0),
                awaiting: 0,
                inventoryReview: 0,
                orders: overview.counts.orders
              },
              gateway: {
                captured: 0, refunded: 0, fees: 0, feeTax: 0,
                netAfterFees: 0, feesUnknown: 0, attempts: 0, unmatched: 0, lastChecked: null
              },
              orders: [],
              attempts: [],
              inventory: [],
              vendorSettlements: overview.vendorSettlement ? [overview.vendorSettlement] : []
            } as FinanceAudit
          }))
        )
      : forkJoin({
          overview: overview$,
          finance: this.finance.load(this.days(), 0, '')
        });

    req$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: data => {
        this.data.set(data);
        this.selectedDay.set(null);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Refresh failed. Any snapshot shown below is from the previous successful load. Please retry.');
        this.loading.set(false);
      }
    });
  }
}
