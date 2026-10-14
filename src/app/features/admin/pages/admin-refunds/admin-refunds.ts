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
