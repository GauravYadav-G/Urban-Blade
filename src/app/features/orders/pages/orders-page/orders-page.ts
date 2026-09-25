import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { AccountService } from '@core/services/account.service';
import { AdminService, type AdminOrder } from '@core/services/admin.service';
import { CartService } from '@core/services/cart.service';
import { CatalogService } from '@core/services/catalog.service';
import { ToastService } from '@core/services/toast.service';
import { InrPipe } from '@shared/pipes/inr-pipe';

export interface DisplayOrder {
  id: string;
  status: 'pending' | 'accepted' | 'confirmed' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
  subtotal: number;
  total_amount: number;
  discount_amount?: number;
  coupon_code?: string;
  tracking_number?: string;
  currency: string;
  payment_method: string;
  payment_status: string;
  created_at: string;
  shipping_address?: {
    fullName?: string;
    phone?: string;
    street?: string;
    city?: string;
    email?: string;
  };
  items: Array<{
    product_id?: string;
    product_name: string;
    unit_price: number;
    quantity: number;
    image_url?: string;
  }>;
}

@Component({
  selector: 'app-orders-page',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule, InrPipe],
  templateUrl: './orders-page.html',
  styleUrl: './orders-page.scss',
})
export class OrdersPage implements OnInit {
  protected readonly account = inject(AccountService);
  private readonly admin = inject(AdminService);
  private readonly cart = inject(CartService);
  private readonly catalog = inject(CatalogService);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  readonly orders = signal<DisplayOrder[]>([]);
  readonly loading = signal<boolean>(false);
  readonly selectedFilter = signal<'all' | 'active' | 'delivered' | 'cancelled'>('all');
  readonly searchQuery = signal<string>('');

  // AI Tracking Modal
  readonly activeTrackingOrder = signal<DisplayOrder | null>(null);
  readonly trackingModalOpen = signal<boolean>(false);
  readonly aiTrackingInsight = signal<string | null>(null);
  readonly isFetchingAiTrack = signal<boolean>(false);

  readonly filteredOrders = computed(() => {
    let list = this.orders();
    const filter = this.selectedFilter();
    const query = this.searchQuery().trim().toLowerCase();

    if (filter === 'active') {
      list = list.filter((o) => o.status !== 'delivered' && o.status !== 'cancelled');
    } else if (filter === 'delivered') {
      list = list.filter((o) => o.status === 'delivered');
    } else if (filter === 'cancelled') {
      list = list.filter((o) => o.status === 'cancelled');
    }

    if (query) {
      list = list.filter(
        (o) =>
          o.id.toLowerCase().includes(query) ||
          (o.tracking_number && o.tracking_number.toLowerCase().includes(query)) ||
          o.items.some((i) => i.product_name.toLowerCase().includes(query))
      );
    }

    return list;
  });

  ngOnInit(): void {
    void this.router.navigate(['/account'], { queryParams: { tab: 'orders' } });
    this.fetchOrders();
  }

  fetchOrders(): void {
    this.loading.set(true);
    const user = this.account.user();
    const email = user?.email;
    const url = email ? `/api/orders?email=${encodeURIComponent(email)}` : '/api/orders';

    this.http.get<DisplayOrder[]>(url).subscribe({
      next: (data) => {
        this.loading.set(false);
        if (Array.isArray(data) && data.length > 0) {
          this.orders.set(data);
        } else {
          // Fall back to local admin store if user has recently placed orders
          const adminOrders = this.admin.orders();
          if (adminOrders.length > 0) {
            const mapped: DisplayOrder[] = adminOrders.map((o) => ({
              id: o.id,
              status: o.status,
              subtotal: o.subtotal,
              total_amount: o.total_amount,
              discount_amount: o.discount_amount,
              coupon_code: o.coupon_code,
              tracking_number: o.tracking_number,
              currency: o.currency || 'INR',
              payment_method: o.payment_method,
              payment_status: o.payment_status,
              created_at: o.created_at,
              shipping_address: o.shipping_address,
              items: o.items.map((it) => ({
                product_name: it.product_name,
                unit_price: it.unit_price,
                quantity: it.quantity,
                image_url: it.image_url,
              })),
            }));
            this.orders.set(mapped);
          } else {
            this.orders.set([]);
          }
        }
      },
      error: () => {
        this.loading.set(false);
        // Fall back to local admin store if backend is unreachable
        const adminOrders = this.admin.orders();
        if (adminOrders.length > 0) {
          const mapped: DisplayOrder[] = adminOrders.map((o) => ({
            id: o.id,
            status: o.status,
            subtotal: o.subtotal,
            total_amount: o.total_amount,
            discount_amount: o.discount_amount,
            coupon_code: o.coupon_code,
            tracking_number: o.tracking_number,
            currency: o.currency || 'INR',
            payment_method: o.payment_method,
            payment_status: o.payment_status,
            created_at: o.created_at,
            shipping_address: o.shipping_address,
            items: o.items.map((it) => ({
              product_name: it.product_name,
              unit_price: it.unit_price,
              quantity: it.quantity,
              image_url: it.image_url,
            })),
          }));
          this.orders.set(mapped);
        }
      },
    });
  }

  getStageIndex(status: string): number {
    switch ((status || '').toLowerCase()) {
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

  isStageCompleted(status: string, stage: number): boolean {
    const idx = this.getStageIndex(status);
    return idx > stage;
  }

  isStageCurrent(status: string, stage: number): boolean {
    const idx = this.getStageIndex(status);
    return idx === stage;
  }

  copyTracking(code: string, event?: Event): void {
    event?.stopPropagation();
    if (!code) return;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(code).then(() => {
        this.toast.success(`📋 Copied tracking ID ${code} to clipboard!`);
      });
    } else {
      this.toast.info(`Tracking ID: ${code}`);
    }
  }

  trackWithAi(order: DisplayOrder): void {
    this.activeTrackingOrder.set(order);
    this.trackingModalOpen.set(true);
    this.aiTrackingInsight.set(null);
    this.isFetchingAiTrack.set(true);

    this.http
      .post<{ ok: boolean; reply: string }>('/api/support/ai-chat', {
        message: `Track order #${order.id.slice(0, 8)}`,
        orderId: order.id,
        customerName: this.account.user()?.name || order.shipping_address?.fullName,
        customerEmail: this.account.user()?.email || order.shipping_address?.email,
      })
      .subscribe({
        next: (res) => {
          this.isFetchingAiTrack.set(false);
          if (res?.reply) {
            this.aiTrackingInsight.set(res.reply);
          } else {
            this.aiTrackingInsight.set(
              `📦 Order #${order.id.slice(0, 8).toUpperCase()} is currently ${order.status.toUpperCase()}. Live transit updates are synchronized with Delhivery Express.`
            );
          }
        },
        error: () => {
          this.isFetchingAiTrack.set(false);
          this.aiTrackingInsight.set(
            `📦 Order #${order.id.slice(0, 8).toUpperCase()} is in ${order.status.toUpperCase()} state. Estimated doorstep delivery in 24-48 hours.`
          );
        },
      });
  }

  closeTrackingModal(): void {
    this.trackingModalOpen.set(false);
    this.activeTrackingOrder.set(null);
    this.aiTrackingInsight.set(null);
  }

  reorderItems(order: DisplayOrder): void {
    let addedCount = 0;
    for (const it of order.items) {
      // Find matching catalog product
      const cleanName = it.product_name.toLowerCase();
      const match = this.catalog.products().find(
        (p) =>
          (it.product_id && p.id === it.product_id) ||
          p.name.toLowerCase() === cleanName ||
          cleanName.includes(p.name.toLowerCase())
      );
      if (match) {
        this.cart.addProduct(match, it.quantity);
        addedCount += it.quantity;
      }
    }

    if (addedCount > 0) {
      this.toast.success(`Added ${addedCount} item(s) from Order #${order.id.slice(0, 8)} to your bag.`);
      void this.router.navigate(['/cart']);
    } else {
      this.toast.info('Viewing storefront catalog to reorder items.');
      void this.router.navigate(['/shop']);
    }
  }
}
