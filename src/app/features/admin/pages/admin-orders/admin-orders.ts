import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService, type AdminOrder } from '@core/services/admin.service';

@Component({
  selector: 'app-admin-orders',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-orders.html',
  styleUrl: './admin-orders.scss',
})
export class AdminOrders {
  readonly admin = inject(AdminService);

  readonly selectedTab = signal<string>('all');
  readonly searchQuery = signal<string>('');
  readonly selectedOrder = signal<AdminOrder | null>(null);
  readonly selectedInvoiceOrder = signal<AdminOrder | null>(null);

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
      list = list.filter((o) => o.status === tab);
    }

    if (q) {
      list = list.filter(
        (o) =>
          o.id.toLowerCase().includes(q) ||
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

    this.admin.addOrder(order);
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
    window.print();
  }

  advanceStatus(order: AdminOrder): void {
    const flow: Record<string, string> = {
      accepted: 'processing',
      processing: 'shipped',
      shipped: 'delivered',
    };
    const next = flow[order.status] as AdminOrder['status'] | undefined;
    if (next) {
      this.admin.updateOrderStatus(order.id, next);
      if (this.selectedOrder()?.id === order.id) {
        this.selectedOrder.update((o) => (o ? { ...o, status: next } : null));
      }
    }
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
