import { CommonModule } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { finalize, type Observable } from 'rxjs';
import { canRefundOrderReturn, canRequestOrderReturn, isUncollectedCodOrder, RETURN_STATUS_LABELS, type ReturnEvent, type ReturnStatus } from '@core/models/order-return.model';
import { AdminService, type AdminOrder } from '@core/services/admin.service';
import { AccountService } from '@core/services/account.service';
import { ReturnsService, type ReturnMutation } from '@core/services/returns.service';
import { ToastService } from '@core/services/toast.service';
import { OrderReturnStatusComponent } from '@shared/components/order-return-status/order-return-status';
import { AdminDialog } from '@shared/directives/admin-dialog';

type ReturnAction = 'view' | ReturnStatus | 'refund';

@Component({
  selector: 'app-admin-returns',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, RouterLink, OrderReturnStatusComponent, AdminDialog],
  templateUrl: './admin-returns.html',
  styleUrl: './admin-returns.scss',
})
export class AdminReturns implements OnInit {
  readonly admin = inject(AdminService);
  private readonly returnsService = inject(ReturnsService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly account = inject(AccountService);
  private queueRequest = 0;
  private detailRequest = 0;

  readonly labels = RETURN_STATUS_LABELS;
  readonly statuses: readonly (ReturnStatus | 'all')[] = ['all', 'requested', 'approved', 'received', 'rejected'];
  readonly queue = signal<AdminOrder[]>([]);
  readonly total = signal(0);
  readonly page = signal(1);
  readonly limit = signal(25);
  readonly filter = signal<ReturnStatus | 'all'>('all');
  readonly query = signal('');
  readonly loading = signal(false);
  readonly queueError = signal('');
  readonly detailsLoading = signal(false);
  readonly lookupId = signal('');
  readonly selectedOrder = signal<AdminOrder | null>(null);
  readonly events = signal<ReturnEvent[]>([]);
  readonly action = signal<ReturnAction>('view');
  readonly saving = signal(false);
  readonly actionError = signal('');
  readonly pageCount = computed(() => Math.max(1, Math.ceil(this.total() / this.limit())));
  readonly form = this.fb.nonNullable.group({
    note: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(500)]],
    restock: ['', []],
    reference: ['', [Validators.maxLength(150)]],
  });

  constructor() {
    let identity = this.account.user();
    effect(() => {
      const current = this.account.user();
      if (current === identity) return;
      identity = current;
      ++this.queueRequest;
      ++this.detailRequest;
      this.queue.set([]);
      this.total.set(0);
      this.selectedOrder.set(null);
      this.events.set([]);
      this.loading.set(false);
      this.detailsLoading.set(false);
      this.saving.set(false);
      this.actionError.set('');
      this.queueError.set('');
    });
  }

  ngOnInit(): void {
    this.loadQueue();
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const id = params.get('order');
      if (id) this.openOrder(id);
    });
  }

  loadQueue(): void {
    const identity = this.account.user();
    const request = ++this.queueRequest;
    this.loading.set(true);
    this.queueError.set('');
    this.returnsService.queue(this.filter(), this.page(), this.query().trim()).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: response => {
        if (request !== this.queueRequest || identity !== this.account.user()) return;
        this.loading.set(false);
        if (!Array.isArray(response?.data) || !Number.isFinite(Number(response.total))) {
          this.queueError.set('Return records could not be read. Please refresh the queue.');
          return;
        }
        this.queue.set(response.data);
        this.total.set(Number(response.total));
        this.limit.set(Number(response.limit) || 25);
        if (this.page() > this.pageCount()) { this.page.set(this.pageCount()); this.loadQueue(); }
      },
      error: () => {
        if (request !== this.queueRequest || identity !== this.account.user()) return;
        this.loading.set(false);
        this.queueError.set('Return requests could not be loaded. Check your connection and retry.');
      },
    });
  }

  setFilter(status: ReturnStatus | 'all'): void {
    this.filter.set(status);
    this.page.set(1);
    this.loadQueue();
  }

  search(): void { this.page.set(1); this.loadQueue(); }

  changePage(delta: number): void {
    const next = this.page() + delta;
    if (this.loading() || next < 1 || next > this.pageCount()) return;
    this.page.set(next);
    this.loadQueue();
  }

  openOrder(id: string): void {
    if (this.saving() || !id.trim()) return;
    const identity = this.account.user();
    const request = ++this.detailRequest;
    this.detailsLoading.set(true);
    this.actionError.set('');
    this.returnsService.audit(id.trim()).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: response => {
        if (request !== this.detailRequest || identity !== this.account.user()) return;
        this.detailsLoading.set(false);
        if (!response?.order?.id || !Array.isArray(response.order.items)) {
          this.toast.error('This order could not be read. Please reopen it from Orders.');
          return;
        }
        this.selectedOrder.set(response.order);
        this.events.set(Array.isArray(response.events) ? response.events : []);
        this.setAction('view');
      },
      error: error => {
        if (request !== this.detailRequest || identity !== this.account.user()) return;
        this.detailsLoading.set(false);
        this.toast.error(error.error?.message || 'Order not found. Copy the full order ID from Orders & Fulfillment and retry.');
      },
    });
  }

  close(): void {
    if (this.saving()) return;
    ++this.detailRequest;
    this.selectedOrder.set(null);
    this.events.set([]);
    this.actionError.set('');
  }

  canRequest(order: AdminOrder): boolean { return canRequestOrderReturn(order); }
  canRefund(order: AdminOrder): boolean { return canRefundOrderReturn(order); }
  uncollectedCod(order: AdminOrder): boolean { return isUncollectedCodOrder(order); }
  isGateway(order: AdminOrder): boolean { return (order.payment_method || '').toLowerCase().trim() === 'razorpay'; }

  setAction(action: ReturnAction): void {
    this.action.set(action);
    this.actionError.set('');
    const maxLength = this.noteLimit();
    this.form.controls.note.setValidators([Validators.required, Validators.minLength(3), Validators.maxLength(maxLength)]);
    this.form.reset({ note: action === 'refund' ? (this.selectedOrder()?.return_reason || 'Received customer return').slice(0, maxLength) : '', restock: '', reference: '' });
  }

  noteLimit(): number {
    const order = this.selectedOrder();
    return this.action() === 'refund' && order && this.isGateway(order) ? 300 : 500;
  }

  actionTitle(): string {
    switch (this.action()) {
      case 'requested': return 'Open a return on behalf of the customer';
      case 'approved': return 'Approve return & provide return instructions';
      case 'rejected': return 'Decline return & explain the decision';
      case 'received': return 'Confirm receipt & record inspection';
      case 'refund': {
        const order = this.selectedOrder();
        return order && this.isGateway(order) ? 'Refund to the original payment method' : 'Record a completed external repayment';
      }
      default: return 'Return details';
    }
  }

  submit(): void {
    const order = this.selectedOrder();
    const identity = this.account.user();
    const action = this.action();
    if (!order || this.saving() || action === 'view') return;
    const permitted = action === 'requested' ? this.canRequest(order)
      : action === 'approved' || action === 'rejected' ? order.return_status === 'requested'
      : action === 'received' ? order.return_status === 'approved'
      : this.canRefund(order);
    if (!permitted) {
      this.actionError.set('The order is not ready for this action. Reopen it to check the latest return and payment status.');
      return;
    }
    const { note, restock, reference } = this.form.getRawValue();
    const cleanNote = note.trim();
    if (this.form.invalid || cleanNote.length < 3) {
      this.form.markAllAsTouched();
      this.actionError.set(`Enter a reason or review note between 3 and ${this.noteLimit()} characters.`);
      return;
    }
    if (action === 'received' && restock !== 'yes' && restock !== 'no') {
      this.actionError.set('Choose whether the inspected goods are fit to restock.');
      return;
    }
    if (action === 'refund' && !this.isGateway(order) && reference.trim().length < 3) {
      this.actionError.set('Enter the reference of the completed external repayment (at least 3 characters).');
      return;
    }
    let request: Observable<ReturnMutation>;
    if (action === 'requested') request = this.returnsService.request(order.id, cleanNote, true);
    else if (action === 'refund') request = this.isGateway(order)
      ? this.admin.refundOrder(order.id, cleanNote)
      : this.returnsService.recordManualRefund(order.id, reference.trim(), cleanNote);
    else request = this.returnsService.review(order.id, action, cleanNote, action === 'received' ? restock === 'yes' : undefined);
    this.saving.set(true);
    this.actionError.set('');
    request.pipe(takeUntilDestroyed(this.destroyRef), finalize(() => {
      if (identity === this.account.user()) this.saving.set(false);
    })).subscribe({
      next: response => {
        if (identity !== this.account.user()) return;
        if (!response?.ok || !response.order?.id) {
          this.actionError.set('The server did not confirm this change. Refresh the order before trying again.');
          return;
        }
        this.selectedOrder.set({ ...order, ...response.order });
        this.admin.orders.update(orders => orders.map(current => current.id === order.id ? { ...current, ...response.order } : current));
        this.setAction('view');
        this.toast.success(response.message || 'Return updated.');
        this.loadQueue();
        this.refreshHistory(order.id);
        if (action === 'received' && restock === 'yes') this.admin.refreshProducts();
      },
      error: error => {
        if (identity !== this.account.user()) return;
        this.actionError.set(error.error?.message || 'This action could not be saved. Refresh the order and try again.');
      },
    });
  }

  private refreshHistory(orderId: string): void {
    const identity = this.account.user();
    this.returnsService.audit(orderId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: response => {
        if (this.selectedOrder()?.id !== orderId || identity !== this.account.user()) return;
        this.events.set(Array.isArray(response.events) ? response.events : []);
        if (response.order?.id) this.selectedOrder.set(response.order);
      },
      error: () => {
        if (this.selectedOrder()?.id !== orderId || identity !== this.account.user()) return;
        this.toast.info('The action was saved. Reopen the order to reload its audit history.');
      },
    });
  }
}
