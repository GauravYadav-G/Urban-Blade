import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService, type AdminOrder } from '@core/services/admin.service';
import { ToastService } from '@core/services/toast.service';

@Component({
  selector: 'app-admin-orders',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-orders.html',
  styleUrl: './admin-orders.scss',
})
export class AdminOrders implements OnInit {
  readonly admin = inject(AdminService);
  readonly toast = inject(ToastService);

  readonly selectedTab = signal<string>('all');
  readonly searchQuery = signal<string>('');
  readonly selectedOrder = signal<AdminOrder | null>(null);
  readonly selectedInvoiceOrder = signal<AdminOrder | null>(null);
  readonly copiedTrackingId = signal<string | null>(null);

  ngOnInit(): void {
    this.admin.refreshOrders();
  }

  refreshFromDb(): void {
    this.admin.refreshOrders(true);
  }

  // Manual POS Order Modal State
  readonly isCreateModalOpen = signal(false);
  readonly manualCustomerName = signal('');
  readonly manualCustomerPhone = signal('');
  readonly manualCustomerCity = signal('Ghaziabad');
  readonly manualCustomerStreet = signal('Salon Walk-in / Counter POS');
  readonly manualProductId = signal('');
  readonly manualQuantity = signal(1);
  readonly manualPaymentMethod = signal<'upi' | 'cash_on_delivery' | 'card'>('upi');

  readonly filteredOrders = computed(() => {
    let list = this.admin.orders();
    const tab = this.selectedTab();
    const q = this.searchQuery().trim().toLowerCase();

    if (tab !== 'all') {
      if (tab === 'confirmed' || tab === 'accepted') {
        list = list.filter((o) => o.status === 'confirmed' || o.status === 'accepted' || o.status === 'pending');
      } else {
        list = list.filter((o) => o.status === tab);
      }
    }

    if (q) {
      list = list.filter(
        (o) =>
          o.id.toLowerCase().includes(q) ||
          (o.tracking_number && o.tracking_number.toLowerCase().includes(q)) ||
          o.shipping_address.fullName.toLowerCase().includes(q) ||
          o.shipping_address.city.toLowerCase().includes(q) ||
          o.shipping_address.phone.includes(q) ||
          o.items.some((i) => i.product_name.toLowerCase().includes(q))
      );
    }

    return list;
  });

  openCreateModal(): void {
    const prods = this.admin.products();
    if (prods.length > 0) {
      this.manualProductId.set(prods[0].id);
    }
    this.manualCustomerName.set('');
    this.manualCustomerPhone.set('');
    this.manualQuantity.set(1);
    this.isCreateModalOpen.set(true);
  }

  closeCreateModal(): void {
    this.isCreateModalOpen.set(false);
  }

  saveManualOrder(): void {
    if (!this.manualCustomerName().trim() || !this.manualCustomerPhone().trim()) {
      alert('Please provide customer name and phone number.');
      return;
    }

    const prod = this.admin.products().find((p) => p.id === this.manualProductId()) || this.admin.products()[0];
    if (!prod) {
      alert('No product selected.');
      return;
    }

    const qty = Math.max(1, Number(this.manualQuantity()) || 1);
    const subtotal = prod.price * qty;

    const order: AdminOrder = {
      id: `ord-pos-${Date.now().toString().slice(-6)}`,
      status: 'accepted',
      subtotal,
      total_amount: subtotal,
      currency: 'INR',
      payment_method: this.manualPaymentMethod(),
      payment_status: 'paid',
      shipping_address: {
        fullName: this.manualCustomerName().trim(),
        phone: this.manualCustomerPhone().trim(),
        city: this.manualCustomerCity().trim(),
        street: this.manualCustomerStreet().trim(),
      },
      created_at: new Date().toISOString(),
      items: [
        {
          product_name: prod.name,
          unit_price: prod.price,
          quantity: qty,
          image_url: prod.imageUrl,
        },
      ],
    };

    this.admin.addOrder(order, true);
    this.isCreateModalOpen.set(false);
  }

  cancelOrder(order: AdminOrder): void {
    if (confirm(`Are you sure you want to cancel Order #${order.id.slice(0, 8)}? Items will be restocked.`)) {
      this.admin.cancelOrder(order.id);
      if (this.selectedOrder()?.id === order.id) {
        this.selectedOrder.update((o) => (o ? { ...o, status: 'cancelled' } : null));
      }
    }
  }

  setTab(tab: string): void {
    this.selectedTab.set(tab);
  }

  viewOrder(order: AdminOrder): void {
    this.selectedOrder.set(order);
  }

  closeModal(): void {
    this.selectedOrder.set(null);
  }

  openInvoice(order: AdminOrder, event?: Event): void {
    event?.stopPropagation();
    this.selectedInvoiceOrder.set(order);
  }

  closeInvoice(): void {
    this.selectedInvoiceOrder.set(null);
  }

  printInvoice(): void {
    const inv = this.selectedInvoiceOrder();
    const originalTitle = document.title;
    if (inv?.id) {
      document.title = `Tax_Invoice_UB_${inv.id.slice(0, 8).toUpperCase()}`;
    }
    window.print();
    setTimeout(() => {
      document.title = originalTitle;
    }, 1000);
  }

  getStageIndex(status?: string | null): number {
    const s = (status || '').toLowerCase().trim();
    switch (s) {
      case 'pending':
      case 'accepted':
      case 'confirmed':
        return 0;
      case 'processing':
        return 1;
      case 'shipped':
        return 2;
      case 'delivered':
        return 3;
      default:
        return -1;
    }
  }

  isStageCompleted(orderStatus?: string | null, stageIndex: number = 0): boolean {
    const current = this.getStageIndex(orderStatus);
    return current > stageIndex;
  }

  isStageCurrent(orderStatus?: string | null, stageIndex: number = 0): boolean {
    const current = this.getStageIndex(orderStatus);
    return current === stageIndex;
  }

  getNextStatus(status?: string | null): AdminOrder['status'] | null {
    const s = (status || '').toLowerCase().trim();
    switch (s) {
      case 'pending':
      case 'accepted':
      case 'confirmed':
        return 'processing';
      case 'processing':
        return 'shipped';
      case 'shipped':
        return 'delivered';
      default:
        return null;
    }
  }

  getNextStageAction(order: AdminOrder): { label: string; icon: string; nextStatus: AdminOrder['status'] | null; badgeClass: string } {
    const s = (order?.status || '').toLowerCase().trim();
    switch (s) {
      case 'pending':
      case 'accepted':
      case 'confirmed':
        return { label: 'Pack Order', icon: '⚡', nextStatus: 'processing', badgeClass: 'pack' };
      case 'processing':
        return { label: 'Dispatch & Ship', icon: '📦', nextStatus: 'shipped', badgeClass: 'ship' };
      case 'shipped':
        return { label: 'Mark Delivered', icon: '✅', nextStatus: 'delivered', badgeClass: 'deliver' };
      case 'delivered':
        return { label: 'Delivered', icon: '🎉', nextStatus: null, badgeClass: 'done' };
      case 'cancelled':
        return { label: 'Cancelled', icon: '✕', nextStatus: null, badgeClass: 'cancelled' };
      default:
        return { label: 'Advance', icon: '➔', nextStatus: null, badgeClass: 'default' };
    }
  }

  advanceStatus(order: AdminOrder, event?: Event): void {
    event?.stopPropagation();
    const next = this.getNextStatus(order.status);
    if (next) {
      const generatedTracking = (next === 'shipped' || next === 'delivered') && !order.tracking_number
        ? `TRK-UB-${order.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`
        : order.tracking_number;
      this.admin.updateOrderStatus(order.id, next, generatedTracking);
      if (this.selectedOrder()?.id === order.id) {
        this.selectedOrder.update((o) => (o ? { ...o, status: next, tracking_number: generatedTracking || o.tracking_number } : null));
      }
    }
  }

  advanceToStage(order: AdminOrder, targetStage: AdminOrder['status'], event?: Event): void {
    event?.stopPropagation();
    const currentStatus = (order.status || '').toLowerCase().trim();
    if (currentStatus === targetStage || currentStatus === 'cancelled') return;
    const generatedTracking = (targetStage === 'shipped' || targetStage === 'delivered') && !order.tracking_number
      ? `TRK-UB-${order.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`
      : order.tracking_number;
    this.admin.updateOrderStatus(order.id, targetStage, generatedTracking);
    if (this.selectedOrder()?.id === order.id) {
      this.selectedOrder.update((o) => (o ? { ...o, status: targetStage, tracking_number: generatedTracking || o.tracking_number } : null));
    }
  }

  copyTrackingNumber(tracking: string, event?: Event): void {
    event?.stopPropagation();
    if (!tracking) return;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(tracking).then(() => {
        this.copiedTrackingId.set(tracking);
        this.toast.success(`📋 Copied tracking code ${tracking} to clipboard!`);
        setTimeout(() => this.copiedTrackingId.set(null), 2500);
      });
    } else {
      this.toast.info(`Tracking code: ${tracking}`);
    }
  }

  editTrackingNumber(order: AdminOrder, event?: Event): void {
    event?.stopPropagation();
    const current = order.tracking_number || `TRK-UB-${order.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    const custom = prompt('Enter Courier Tracking Code / Airway Bill (AWB):', current);
    if (custom && custom.trim() && custom.trim() !== current) {
      const clean = custom.trim().toUpperCase();
      this.admin.updateOrderStatus(order.id, order.status, clean);
      if (this.selectedOrder()?.id === order.id) {
        this.selectedOrder.update((o) => (o ? { ...o, tracking_number: clean } : null));
      }
      this.toast.success(`Tracking number updated to ${clean}`);
    }
  }

  getNextStageLabel(order: AdminOrder): string {
    return this.getNextStageAction(order).label;
  }

  exportCSV(): void {
    const orders = this.filteredOrders();
    const headers = ['Order_ID', 'Customer_Name', 'Phone', 'City', 'Order_Date', 'Status', 'Payment_Method', 'Total_Amount', 'Items_Count', 'Items_List'];
    const rows = orders.map((o) => [
      o.id,
      `"${o.shipping_address.fullName.replace(/"/g, '""')}"`,
      o.shipping_address.phone,
      o.shipping_address.city,
      o.created_at,
      o.status.toUpperCase(),
      o.payment_method.toUpperCase(),
      o.total_amount,
      o.items.length,
      `"${o.items.map((i) => `${i.quantity}x ${i.product_name}`).join('; ').replace(/"/g, '""')}"`,
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `urbanblade_orders_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
