import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AdminService, type AdminOrder } from '@core/services/admin.service';
import { ToastService } from '@core/services/toast.service';

type RefundFilter = 'all' | 'pending' | 'processed' | 'failed';

@Component({
  selector: 'app-admin-refunds',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './admin-refunds.html',
  styleUrl: './admin-refunds.scss',
})
export class AdminRefunds implements OnInit {
  readonly admin = inject(AdminService);
  private readonly http = inject(HttpClient);
  readonly returns = computed(() => this.admin.orders().filter(order => Boolean(order.return_status)));
  private readonly toast = inject(ToastService);

  readonly searchQuery = signal('');
  readonly filter = signal<RefundFilter>('all');
  readonly processingOrderId = signal<string | null>(null);
  readonly inspectingOrder = signal<AdminOrder | null>(null);

  readonly refunds = computed(() =>
    this.admin.orders().filter((order) => Boolean(order.refund_status))
  );

  readonly filteredRefunds = computed(() => {
    const query = this.searchQuery().trim().toLowerCase();
    const status = this.filter();
    return this.refunds().filter((order) => {
      const address = order.shipping_address;
      const matchesStatus = status === 'all' || order.refund_status === status;
      const matchesSearch =
        !query ||
        [
          order.id,
          order.refund_id,
          order.transaction_id,
          order.gateway_order_id,
          address?.fullName,
          address?.phone,
          order.refund_reason,
          order.refund_failure_reason,
        ].some((value) => String(value || '').toLowerCase().includes(query));
      return matchesStatus && matchesSearch;
    });
  });

  readonly pendingCount = computed(
    () => this.refunds().filter((order) => order.refund_status === 'pending').length
  );
  readonly failedCount = computed(
    () => this.refunds().filter((order) => order.refund_status === 'failed').length
  );
  readonly processedCount = computed(
    () => this.refunds().filter((order) => order.refund_status === 'processed').length
  );
  readonly refundedValue = computed(() =>
    this.refunds()
      .filter((order) => order.refund_status === 'processed')
      .reduce((total, order) => total + Number(order.refund_amount || order.total_amount || 0), 0)
  );

  ngOnInit(): void {
    this.admin.refreshOrders(true);
  }

  statusLabel(order: AdminOrder): string {
    if (order.refund_status === 'processed') return 'Refunded (Settled)';
    if (order.refund_status === 'failed') return 'Action Required';
    return 'Processing in Gateway';
  }

  openInspector(order: AdminOrder, event?: Event): void {
    event?.stopPropagation();
    this.inspectingOrder.set(order);
  }

  closeInspector(): void {
    this.inspectingOrder.set(null);
  }

  reviewReturn(order: AdminOrder, status: 'approved' | 'rejected' | 'received'): void {
    const note = window.prompt('Enter the return review or inspection note:')?.trim();
    if (!note || note.length < 3 || this.processingOrderId()) return;
    const restock = status === 'received' ? window.confirm('Are all returned items inspected and fit to restock? Cancel means do not restock.') : undefined;
    this.processingOrderId.set(order.id);
    this.http.put(`/api/admin/orders/${order.id}/return`, { status, note, restock }).subscribe({
      next: () => { this.processingOrderId.set(null); this.admin.refreshOrders(); this.toast.success('Return review saved.'); },
      error: error => { this.processingOrderId.set(null); this.toast.error(error.error?.message || 'Return review failed.'); },
    });
  }

  refundReturn(order: AdminOrder): void {
    if (order.payment_method === 'Razorpay') { this.reconcile(order); return; }
    const reference = window.prompt('Enter the reference of the completed external refund. This records the repayment; it does not transfer money.')?.trim();
    if (!reference || reference.length < 3 || this.processingOrderId()) return;
    this.processingOrderId.set(order.id);
    this.http.post(`/api/admin/orders/${order.id}/refund/manual`, { reference, reason: order.return_reason || 'Received customer return' }).subscribe({
      next: () => { this.processingOrderId.set(null); this.admin.refreshOrders(); this.toast.success('External refund recorded.'); },
      error: error => { this.processingOrderId.set(null); this.toast.error(error.error?.message || 'Refund record failed.'); },
    });
  }

  reconcile(order: AdminOrder, event?: Event): void {
    event?.stopPropagation();
    if (this.processingOrderId()) return;
    const reason =
      order.refund_reason?.trim() || 'Administrator refund settlement review';
    this.processingOrderId.set(order.id);
    this.admin.refundOrder(order.id, reason).subscribe({
      next: (response) => {
        this.processingOrderId.set(null);
        if (this.inspectingOrder()?.id === order.id) {
          this.inspectingOrder.set(response.order);
        }
        this.toast.success(response.message);
      },
      error: (error) => {
        this.processingOrderId.set(null);
        this.toast.error(
          error.error?.message || 'Unable to reconcile this refund with Razorpay gateway.'
        );
      },
    });
  }
}
