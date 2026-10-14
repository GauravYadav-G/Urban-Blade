import type { TrackedOrder } from '@core/models/shipment-tracking.model';
import { Injectable, inject, signal, computed, effect, untracked } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, firstValueFrom, Subject, takeUntil, finalize } from 'rxjs';
import { AccountService } from './account.service';
import { CatalogService } from './catalog.service';
import { ToastService } from './toast.service';
import type { Product } from '@core/models/product.model';
import type { VendorAccount, RazorpayUpiValidationResult } from '@core/models/vendor.model';
import type { SupportInquiry, AdminTask, AiChatResponse } from '@core/models/support.model';
import type { OrderReturnDetails } from '@core/models/order-return.model';

export interface AdminMetrics {
  revenue: {
    today: number;
    week: number;
    month: number;
    trendPercent: number | null;
  };
  orders: {
    total: number;
    accepted: number;
    processing: number;
    shipped: number;
    delivered: number;
    cancelled: number;
    incompletePayment: number;
    trendPercent: number | null;
  };
  bookings: {
    total: number;
    today: number;
    occupancyRate: number | null;
    trendPercent: number | null;
  };
  inventory: {
    totalProducts: number;
    lowStock: number;
    outOfStock: number;
  };
}

export interface DailyMetric {
  date: string;
  dayLabel: string;
  revenue: number;
  orders: number;
}

export interface AdminProduct extends Product {
  version?: number;
  enabled?: boolean;
  stock_quantity?: number;
  stock_reserved?: number;
  availableQuantity?: number;
}

export interface AdminOrder extends TrackedOrder, OrderReturnDetails {
  id: string;
  status: 'accepted' | 'processing' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled' | 'pending';
  subtotal: number;
  total_amount: number;
  currency: string;
  payment_method: string;
  payment_status: string;
  return_status?: 'requested' | 'approved' | 'rejected' | 'received' | null;
  return_reason?: string;
  return_review_note?: string;
  return_requested_at?: string | null;
  return_requested_by?: string | null;
  return_reviewed_at?: string | null;
  return_reviewed_by?: string | null;
  return_received_at?: string | null;
  return_restock?: boolean | null;
  payment_reconciliation_error?: string | null;
  refund_status?: 'pending' | 'processed' | 'failed' | null;
  refund_id?: string;
  refund_amount?: number;
  confirmed_refund_amount?: number;
  refund_reason?: string;
  refund_requested_at?: string;
  refunded_at?: string;
  refund_failure_reason?: string;
  transaction_id?: string;
  gateway_order_id?: string;
  shipping_address: {
    fullName: string;
    city: string;
    phone: string;
    street?: string;
    email?: string;
  };
  created_at: string;
  items: Array<{
    product_id?: string;
    product_name: string;
    unit_price: number;
    quantity: number;
    image_url?: string;
    vendor?: string;
  }>;
  tracking_number?: string;
  carrier?: string;
  coupon_code?: string;
  discount_amount?: number;
  shipping_fee?: number;
  tax_amount?: number;
  tax_rate_percent?: number;
  tax_inclusive?: boolean;
  updated_at?: string;
  notes?: string;
}

export interface AdminBooking {
  service_id?: string;
  id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  stylist_name?: string;
  stylist_id?: string;
  visit_type?: 'salon' | 'home';
  service_address?: string | null;
  booking_date: string;
  time_slot: string;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
  total_price: number;
  notes?: string;
}

export interface AdminCustomer {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'customer' | 'stylist';
  created_at: string;
  total_orders: number;
  total_spent: number;
  is_vip?: boolean;
}

export interface FinancialSummary {
  macro: {
    totalGrossRevenue: number;
    totalProductRetailRevenue: number;
    totalSalonServicesRevenue: number;
    totalDiscountsGiven: number;
    totalOrdersCount: number;
    totalBookingsCount: number;
    netPlatformEstimatedMargin: number;
    payoutLiabilityPayable: number;
  };
  productFinancials: Array<{
    id: string;
    name: string;
    category: string;
    vendor: string;
    unit_price: number;
    stock_quantity: number;
    units_sold: number;
    gross_revenue: number;
    platform_margin: number;
    vendor_payout: number;
  }>;
  bookingFinancials: Array<{
    visit_type: 'salon' | 'home';
    total_bookings: number;
    completed_bookings: number;
    cancelled_bookings: number;
    gross_revenue: number;
    avg_ticket_size: number;
    travel_surcharge_collected: number;
  }>;
  paymentBreakdown: Array<{
    payment_method: string;
    payment_status: string;
    count: number;
    total_amount: number;
  }>;
  vendorSettlements: Array<{
    id: string;
    name: string;
    commission_rate: number;
    payout_account: any;
    gross_sales: number;
    payable_amount: number;
    platform_cut: number;
    paid_amount: number;
  }>;
}

export interface SystemTelemetry {
  system: {
    eventLoopLagMs: number;
    memory: {
      rssMb: number;
      heapUsedMb: number;
      heapTotalMb: number;
    };
    uptimeSeconds: number;
  };
  postgres: {
    ok: boolean;
    latencyMs: number;
  };
  redis: {
    ok: boolean;
    latencyMs: number;
    mode: string;
  };
  target: string;
}

const STORAGE_KEY_ORDERS = 'urban-blade-admin-orders';
const STORAGE_KEY_BOOKINGS = 'urban-blade-admin-bookings';
const STORAGE_KEY_CUSTOMERS = 'urban-blade-admin-customers';
const STORAGE_KEY_PRODUCTS = 'urban-blade-admin-products';
const STORAGE_KEY_VENDORS = 'urban-blade-admin-vendors';
const STORAGE_KEY_TASKS = 'urban-blade-admin-tasks';
const STORAGE_KEY_INQUIRIES = 'urban-blade-admin-inquiries';

const ADMIN_API_BASE =
  typeof window !== 'undefined' && window.location.port === '4200'
    ? 'http://localhost:4000/api/admin'
    : '/api/admin';

const PUBLIC_API_BASE =
  typeof window !== 'undefined' && window.location.port === '4200'
    ? 'http://localhost:4000/api'
    : '/api';

const API_BASE = ADMIN_API_BASE;

const SUPPORT_API_BASE = `${ADMIN_API_BASE}/support`;

@Injectable({ providedIn: 'root' })
export class AdminService {
  private readonly sessionEnded = new Subject<void>();
  private readonly http = inject(HttpClient);
  private readonly catalog = inject(CatalogService);
  private readonly toast = inject(ToastService);
  private readonly stockSyncTimers = new Map<string, ReturnType<typeof setTimeout>>();

  readonly isSyncing = signal<boolean>(false);

  // Core Persistent Reactive Signals
  readonly orders = signal<AdminOrder[]>([]);
  readonly bookings = signal<AdminBooking[]>([]);
  readonly customers = signal<AdminCustomer[]>([]);
  readonly products = signal<AdminProduct[]>([]);
  readonly vendors = signal<VendorAccount[]>([]);
  readonly adminTasks = signal<AdminTask[]>([]);
  readonly supportInquiries = signal<SupportInquiry[]>([]);
  readonly activeSupportInquiryId = signal<string | null>(null);
  readonly isAiAutoPilot = signal<boolean>(true);
  readonly isChatDrawerOpen = signal<boolean>(false);
  readonly dailyMetrics = signal<DailyMetric[]>([]);

  // Dynamic Calculated KPI Metrics
  readonly metrics = signal<AdminMetrics>(this.computeMetrics());

  readonly system = signal<SystemTelemetry>({
    system: {
      eventLoopLagMs: 0,
      memory: { rssMb: 0, heapUsedMb: 0, heapTotalMb: 0 },
      uptimeSeconds: 0,
    },
    postgres: { ok: false, latencyMs: 0 },
    redis: { ok: false, latencyMs: 0, mode: 'unknown' },
    target: 'Awaiting live telemetry',
  });

  readonly lowStockItems = computed(() =>
    this.products().filter((p) => (p.stock_quantity ?? 0) <= 15)
  );

  private readonly account = inject(AccountService);

  constructor() {
    for (const key of [STORAGE_KEY_ORDERS, STORAGE_KEY_BOOKINGS, STORAGE_KEY_CUSTOMERS, STORAGE_KEY_PRODUCTS, STORAGE_KEY_VENDORS, STORAGE_KEY_TASKS, STORAGE_KEY_INQUIRIES]) {
      try { localStorage.removeItem(key); } catch {}
    }
    effect(() => {
      const user = this.account.user();
      untracked(() => {
        this.sessionEnded.next();
        this.broadcastChannel?.close();
        this.broadcastChannel = null;
        this.pendingDeletes.clear();
        this.activeSupportInquiryId.set(null);
        this.isChatDrawerOpen.set(false);
        this.adjustingStock.set(new Set());
        this.orders.set([]); this.bookings.set([]); this.customers.set([]);
        this.products.set([]); this.vendors.set([]); this.adminTasks.set([]); this.supportInquiries.set([]);
        this.dailyMetrics.set([]);
        this.recomputeAndPersistMetrics();
        if (user?.role === 'admin' || user?.role === 'vendor') this.syncWithBackend();
      });
    });
  }

  // ─── REAL-TIME STOREFRONT TO ADMIN INTEGRATION ────────────────────────────

  /**
   * Called by CheckoutPage or Admin POS when an order is registered.
   */
  addOrder(order: AdminOrder, syncToBackend = false, onComplete?: (saved: boolean) => void): void {
    if (syncToBackend) {
      this.http.post(`${API_BASE}/orders`, order).pipe(takeUntil(this.sessionEnded)).subscribe({
        next: () => { this.refreshOrders(); this.refreshProducts(); this.toast.success('Counter order saved.'); onComplete?.(true); },
        error: error => { this.toast.error(error.error?.message || 'Counter order could not be saved.'); onComplete?.(false); },
      });
      return;
    }
    // Checkout already committed inventory on the server. Never decrement it again.
    this.orders.update(list => [order, ...list.filter(item => item.id !== order.id)]);
    this.recomputeAndPersistMetrics();
  }

  /**
   * Called by BookPage when client reserves a salon visit.
   * Immediately registers in chair dispatch roster and recalculates occupancy.
   */
  addBooking(booking: AdminBooking, source: 'admin' | 'customer' = 'admin'): Observable<AdminBooking> {
    const endpoint = source === 'admin' ? `${API_BASE}/bookings` : `${PUBLIC_API_BASE}/bookings`;
    return this.http.post<AdminBooking>(endpoint, booking).pipe(tap((saved) => {
      const persisted = { ...booking, ...saved };
      this.bookings.update((list) => [persisted, ...list.filter((item) => item.id !== persisted.id)]);
      this.saveBookings(this.bookings());
      this.recomputeAndPersistMetrics();
    }));
  }

  // ─── ORDER MANAGEMENT MUTATIONS & PAYMENT STATUS HELPERS ───────────────────

  isPaymentIncomplete(order: { payment_method?: string; payment_status?: string; status?: string } | null | undefined): boolean {
    if (!order) return false;
    const isCod = order.payment_method === 'cash_on_delivery' || order.payment_method === 'Cash on Delivery';
    if (isCod) return false;
    const ps = (order.payment_status || '').toLowerCase().trim();
    return ps === 'pending' || ps === 'failed' || ps === 'incomplete';
  }

  isPaymentPaid(order: { payment_method?: string; payment_status?: string; status?: string } | null | undefined): boolean {
    if (!order) return false;
    const ps = (order.payment_status || '').toLowerCase().trim();
    if (ps === 'captured' || ps === 'paid') return true;
    return false;
  }

  isPaymentFailed(order: { payment_method?: string; payment_status?: string; status?: string } | null | undefined): boolean {
    if (!order) return false;
    return (order.payment_status || '').toLowerCase().trim() === 'failed';
  }

  getPaymentStatusLabel(order: { payment_method?: string; payment_status?: string; status?: string } | null | undefined): string {
    if (!order) return 'Unknown';
    const isCod = order.payment_method === 'cash_on_delivery' || order.payment_method === 'Cash on Delivery';
    const ps = (order.payment_status || '').toLowerCase().trim();
    if (isCod) {
      return ps === 'captured' || ps === 'paid' ? 'COD Collected' : 'COD (Due on Delivery)';
    }
    if (ps === 'captured' || ps === 'paid') return 'Paid';
    if (ps === 'failed') return 'Payment Failed';
    if (ps === 'refunded') return 'Refunded';
    return 'Payment Incomplete';
  }

  updateOrderStatus(orderId: string, status: AdminOrder['status'], trackingNumber?: string, onSaved?: (order: AdminOrder) => void): void {
    const existing = this.orders().find((o) => o.id === orderId);
    if (existing && this.isPaymentIncomplete(existing) && (status === 'processing' || status === 'shipped' || status === 'delivered')) {
      this.toast.error(`Cannot advance order #${orderId.slice(0, 8)}: Customer payment is incomplete (${existing.payment_status}).`);
      return;
    }

    this.http.put<{ ok: boolean; order: AdminOrder }>(
      `${API_BASE}/orders/${orderId}/status`, { status, trackingNumber }
    ).pipe(takeUntil(this.sessionEnded)).subscribe({
      next: (res) => {
        if (!res.ok || !res.order) { this.toast.error('The server did not confirm this update.'); return; }
        this.orders.update(list => list.map(order => order.id === orderId ? { ...order, ...res.order } : order));
        this.saveOrders(this.orders());
        this.recomputeAndPersistMetrics();
        this.toast.success('Order status updated.');
        onSaved?.(res.order);
      },
      error: (err) => this.toast.error(err.error?.message || 'Unable to update order. Please try again.'),
    });
  }

  updateOrderDetails(orderId: string, updates: Partial<AdminOrder>, onSaved?: (order: AdminOrder) => void): void {
    const order = this.orders().find(item => item.id === orderId);
    if (!order) return;
    this.http.put<{ order: AdminOrder }>(`${API_BASE}/orders/${orderId}/status`, {
      status: updates.status || order.status,
      trackingNumber: updates.tracking_number,
      notes: updates.notes,
      carrier: updates.carrier,
    }).pipe(takeUntil(this.sessionEnded)).subscribe({
      next: response => {
        this.orders.update(list => list.map(item => item.id === orderId ? { ...item, ...response.order } : item));
        this.recomputeAndPersistMetrics();
        this.toast.success('Order details saved.');
        onSaved?.(response.order);
      },
      error: error => this.toast.error(error.error?.message || 'Order details could not be saved.'),
    });
  }

  reconcilePayment(orderId: string): Observable<{ ok: boolean; updated: boolean; paymentStatus: string; order?: AdminOrder; message: string }> {
    return this.http
      .post<{ ok: boolean; updated: boolean; paymentStatus: string; order?: any; message: string }>(
        `${API_BASE}/orders/${orderId}/reconcile-payment`,
        {}
      )
      .pipe(
        tap((res) => {
          if (res.ok && res.order) {
            const mappedOrder: AdminOrder = {
              ...res.order,
              subtotal: Number(res.order.subtotal) || Number(res.order.total_amount) || 0,
              total_amount: Number(res.order.total_amount) || 0,
              items: (res.order.items || []).map((it: any) => ({
                product_name: it.product_name || 'Item',
                unit_price: Number(it.unit_price) || 0,
                quantity: Number(it.quantity) || 1,
                image_url: it.image_url,
                vendor: it.vendor,
              })),
            };
            this.orders.update((list) =>
              list.map((o) => (o.id === mappedOrder.id ? mappedOrder : o))
            );
            this.saveOrders(this.orders());
            this.recomputeAndPersistMetrics();
          }
        })
      );
  }

  refundOrder(orderId: string, reason: string): Observable<{ ok: boolean; order: AdminOrder; refundStatus: string; message: string }> {
    return this.http.post<{ ok: boolean; order: AdminOrder; refundStatus: string; message: string }>(
      `${API_BASE}/orders/${orderId}/refund`,
      { reason }
    ).pipe(
      tap((response) => {
        if (!response.ok || !response.order) return;
        this.orders.update((orders) => orders.map((order) =>
          order.id === orderId ? { ...order, ...response.order } : order
        ));
        this.saveOrders(this.orders());
        this.recomputeAndPersistMetrics();
      })
    );
  }

  fetchCarrierWebsiteStatus(orderIdOrNumber: string, carrier?: string): Observable<{ ok: boolean; order?: AdminOrder; websiteData: any; applied?: boolean; reason?: string }> {
    return this.http
      .post<{ ok: boolean; order?: AdminOrder; websiteData: any; applied?: boolean; reason?: string }>(
        `${API_BASE}/orders/fetch-carrier-website`,
        { orderIdOrNumber, carrier }
      )
      .pipe(
        tap((res) => {
          if (res.ok && res.order) {
            this.orders.update((list) =>
              list.map((o) => (o.id === res.order!.id ? { ...o, ...res.order } : o))
            );
            this.saveOrders(this.orders());
            this.recomputeAndPersistMetrics();
          }
        })
      );
  }

  bulkFetchCarrierWebsites(orderIds: string[], carrier?: string): Observable<{ ok: boolean; updatedCount: number; checkedCount: number; failedCount: number; results: any[] }> {
    return this.http
      .post<{ ok: boolean; updatedCount: number; checkedCount: number; failedCount: number; results: any[] }>(
        `${API_BASE}/orders/bulk-fetch-carrier-websites`,
        { orderIds, carrier }
      )
      .pipe(
        tap((res) => {
          if (res.ok && Array.isArray(res.results)) {
            this.orders.update((list) =>
              list.map((o) => {
                const hit = res.results.find((r) => r.id === o.id);
                return hit && hit.order ? { ...o, ...hit.order } : o;
              })
            );
            this.saveOrders(this.orders());
            this.recomputeAndPersistMetrics();
          }
        })
      );
  }

  cancelOrder(orderId: string): Observable<{ ok: boolean; order: AdminOrder }> {
    const target = this.orders().find((o) => o.id === orderId);
    if (!target) throw new Error('ORDER_NOT_FOUND');
    if ((target.status || '').toLowerCase().trim() === 'delivered') {
      throw new Error('DELIVERED_ORDER_NOT_CANCELLABLE');
    }
    return this.http.put<{ ok: boolean; order: AdminOrder }>(
      `${API_BASE}/orders/${orderId}/status`,
      { status: 'cancelled' }
    ).pipe(tap((response) => {
      if (!response.ok || !response.order) return;
      this.orders.update((orders) => orders.map((order) =>
        order.id === orderId ? { ...order, ...response.order } : order
      ));
      this.saveOrders(this.orders());
      this.recomputeAndPersistMetrics();
    }));
  }

  // ─── BOOKING MANAGEMENT MUTATIONS ─────────────────────────────────────────

  updateBookingStatus(bookingId: string, status: AdminBooking['status']): Observable<AdminBooking> {
    return this.http.put<AdminBooking>(`${API_BASE}/bookings/${bookingId}/status`, {status}).pipe(tap(saved=>{
      this.bookings.update(list=>list.map(booking=>booking.id===bookingId?{...booking,...saved}:booking));
      this.recomputeAndPersistMetrics();
    }));
  }

  rescheduleBooking(
    bookingId: string,
    newDate: string,
    newSlot: string,
    visitType: 'salon' | 'home' = 'salon',
    serviceAddress?: string | null,
    stylistName?: string
  ): Observable<AdminBooking> {
    const cleanDate = (newDate || '').slice(0, 10);
    return this.http.put<AdminBooking>(`${API_BASE}/bookings/${bookingId}/schedule`, {
      bookingDate: cleanDate,
      timeSlot: newSlot,
      visitType,
      serviceAddress: visitType === 'home' ? (serviceAddress || null) : null,
      stylistId: stylistName || null,
    }).pipe(tap((saved) => {
      const normalized: AdminBooking = {
        ...saved,
        booking_date: (saved.booking_date || cleanDate).slice(0, 10),
        visit_type: (saved.visit_type || visitType) as 'salon' | 'home',
        stylist_name: saved.stylist_name || undefined,
      };
      this.bookings.update((list) => list.map((booking) => booking.id === bookingId ? { ...booking, ...normalized } : booking));
      this.saveBookings(this.bookings());
      this.recomputeAndPersistMetrics();
    }));
  }

  readonly bookingsCheckedAt=signal<string|null>(null);
  readonly bookingsError=signal(false);

  refreshBookings(): void {
    this.http.get<{ data: AdminBooking[] }>(`${API_BASE}/bookings`).pipe(takeUntil(this.sessionEnded)).subscribe({
      next: (response) => {
        if (!Array.isArray(response?.data)) return;
        const normalized = response.data.map((b) => ({
          ...b,
          booking_date: (b.booking_date || '').slice(0, 10),
          visit_type: (b.visit_type || 'salon') as 'salon' | 'home',
          stylist_name: b.stylist_name || undefined,
        }));
        this.bookings.set(normalized);
        this.bookingsCheckedAt.set(new Date().toISOString());
        this.bookingsError.set(false);
        this.saveBookings(normalized);
        this.recomputeAndPersistMetrics();
      },
      error: () => {this.bookingsError.set(true);this.toast.error('Appointments could not be refreshed.');},
    });
  }

  // ─── PRODUCT & INVENTORY MANAGEMENT ───────────────────────────────────────

  readonly adjustingStock = signal<ReadonlySet<string>>(new Set());

  updateStock(productId: string, delta: number): void {
    if (this.adjustingStock().has(productId) || !Number.isInteger(delta) || delta === 0) return;
    this.adjustingStock.update(ids => new Set([...ids, productId]));
    this.http.post(`/api/admin/inventory/${productId}/adjust`, { delta, reason: 'Admin inventory adjustment', requestId: crypto.randomUUID() }).pipe(takeUntil(this.sessionEnded)).subscribe({
      next: () => { this.finishStockAdjustment(productId); this.refreshProducts(); void this.catalog.refreshCatalog(); this.toast.success('Inventory adjustment saved.'); },
      error: error => { this.finishStockAdjustment(productId); this.toast.error(error.error?.message || 'Stock could not be changed.'); this.refreshProducts(); },
    });
  }

  private finishStockAdjustment(productId: string): void {
    this.adjustingStock.update(ids => { const next = new Set(ids); next.delete(productId); return next; });
  }

  toggleInStock(productId: string): void {
    const current = this.products().find(product => product.id === productId);
    if (!current || this.adjustingStock().has(productId)) return;
    this.adjustingStock.update(ids => new Set([...ids, productId]));
    this.http.put(`${ADMIN_API_BASE}/products/${productId}`, { inStock: !(current.enabled ?? current.inStock) }).pipe(takeUntil(this.sessionEnded)).subscribe({
      next: () => { this.finishStockAdjustment(productId); this.refreshProducts(); void this.catalog.refreshCatalog(); this.toast.success('Product availability updated; quantities are unchanged.'); },
      error: error => { this.finishStockAdjustment(productId); this.toast.error(error.error?.message || 'Availability could not be changed.'); },
    });
  }

  saveProduct(item: Partial<AdminProduct>, onSaved?: () => void, onSettled?: () => void): void {
    const slug =
      item.slug ||
      item.name?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') ||
      `prod-${Date.now()}`;
    const id = item.id || `prod-${Date.now()}`;

    const stockQty = item.stock_quantity ?? 0;
    const inStock = stockQty > 0 && (item.inStock ?? true);

    const completeProduct: AdminProduct = {
      id,
      name: item.name || 'New Salon Item',
      slug,
      description: item.description || '',
      longDescription: item.longDescription || item.description || '',
      highlights: item.highlights || ['Salon Grade', 'Premium Formula'],
      price: item.price ?? 499,
      compareAtPrice: item.compareAtPrice,
      currency: 'INR',
      imageUrl: item.imageUrl || '/images/products/hc-shampoo.jpg',
      category: item.category || 'hair',
      kind: item.kind || 'retail',
      vendor: item.vendor || 'Urban Blade Lab',
      audience: item.audience || 'unisex',
      freeDelivery: item.freeDelivery ?? true,
      rating: item.rating || 5.0,
      reviewCount: item.reviewCount || 1,
      badge: item.badge,
      inStock,
      stock_quantity: stockQty,
      stockQuantity: stockQty,
    };

    const payload = {
      ...completeProduct,
      expectedVersion: this.products().find(p => p.id === item.id)?.version,
      stockQuantity: completeProduct.stock_quantity,
      stock_quantity: completeProduct.stock_quantity,
      compareAtPrice: completeProduct.compareAtPrice,
      compare_at_price: completeProduct.compareAtPrice,
      imageUrl: completeProduct.imageUrl,
      image_url: completeProduct.imageUrl,
    };

    const request = item.id ? this.http.put(`${ADMIN_API_BASE}/products/${item.id}`, payload) : this.http.post(`${ADMIN_API_BASE}/products`, payload);
    request.pipe(takeUntil(this.sessionEnded), finalize(() => onSettled?.())).subscribe({
      next: () => { this.refreshProducts(); void this.catalog.refreshCatalog(); this.toast.success('Product saved.'); onSaved?.(); },
      error: error => { this.toast.error(error.error?.message || 'Product could not be saved. Refresh and retry.'); this.refreshProducts(); },
    });
  }

  deleteProduct(id: string): void {
    this.http.delete(`${ADMIN_API_BASE}/products/${id}`).pipe(takeUntil(this.sessionEnded)).subscribe({
      next: () => {
        this.products.update((list) => list.filter((p) => p.id !== id && p.slug !== id));
        this.catalog.deleteProduct(id);
        this.saveProducts(this.products());
        this.recomputeAndPersistMetrics();
        void this.catalog.refreshCatalog();
        this.toast.success('Product removed from catalog and database.');
      },
      error: error => {
        this.toast.error(error.error?.message || 'Product could not be deleted. Refresh and retry.');
        this.refreshProducts();
      },
    });
  }

  // ─── CUSTOMER CRM MUTATIONS ───────────────────────────────────────────────

  updateCustomerRole(customerId: string, role: 'admin' | 'customer' | 'stylist'): void {
    const previous = this.customers().find((customer) => customer.id === customerId);
    if (!previous) return;
    this.customers.update((list) =>
      list.map((c) => (c.id === customerId ? { ...c, role } : c))
    );
    this.saveCustomers(this.customers());
    this.http.put<AdminCustomer>(`${API_BASE}/customers/${customerId}/role`, { role }).pipe(takeUntil(this.sessionEnded)).subscribe({
      next: (saved) => {
        this.customers.update((list) => list.map((customer) => customer.id === customerId ? { ...customer, ...saved } : customer));
        this.saveCustomers(this.customers());
        this.toast.success(`Customer role updated to ${role.toUpperCase()}.`);
      },
      error: () => {
        this.customers.update((list) => list.map((customer) => customer.id === customerId ? previous : customer));
        this.saveCustomers(this.customers());
        this.toast.error('Customer role could not be updated.');
      },
    });
  }

  setBadge(productId: string, badge: any): void {
    const previous = this.products().find((product) => product.id === productId || product.slug === productId);
    this.products.update((list) =>
      list.map((p) =>
        p.id === productId || p.slug === productId ? { ...p, badge } : p
      )
    );

    const catalogProd = this.catalog.byId(productId);
    if (catalogProd) {
      this.catalog.upsertProduct({ ...catalogProd, badge });
    }

    this.saveProducts(this.products());
    this.http.put(`${ADMIN_API_BASE}/products/${productId}`, { badge }).pipe(takeUntil(this.sessionEnded)).subscribe({
      next: () => {
        void this.catalog.refreshCatalog();
        this.toast.success('Product badge updated.');
      },
      error: error => {
        if (previous) {
          this.products.update((list) => list.map((product) =>
            product.id === previous.id ? previous : product
          ));
          this.saveProducts(this.products());
          this.recomputeAndPersistMetrics();
        }
        this.toast.error(error.error?.message || 'Product badge could not be updated.');
      },
    });
  }

  fetchCustomerDetails(id: string): Observable<{ user: any; orders: any[]; bookings: any[] }> {
    return this.http.get<{ user: any; orders: any[]; bookings: any[] }>(
      `${API_BASE}/customers/${encodeURIComponent(id)}/details`
    );
  }

  // ─── SYSTEM & CACHE ───────────────────────────────────────────────────────

  readonly telemetryCheckedAt=signal<string|null>(null);
  readonly telemetryError=signal(false);

  fetchTelemetry(): void {
    this.isSyncing.set(true);
    this.http.get<SystemTelemetry>(`${API_BASE}/system`).pipe(takeUntil(this.sessionEnded)).subscribe({
      next: (data) => {
        this.system.set(data);
        this.telemetryCheckedAt.set(new Date().toISOString());
        this.telemetryError.set(false);
        this.isSyncing.set(false);
      },
      error: () => {
        this.isSyncing.set(false);
        this.telemetryError.set(true);
        this.toast.error('Live system telemetry is unavailable. Previously loaded values are shown.');
      },
    });
  }

  flushCache(): void {
    this.isSyncing.set(true);
    this.http.post(`${API_BASE}/cache/flush`, {}).pipe(takeUntil(this.sessionEnded)).subscribe({
      next: () => this.finishFlush(),
      error: () => {
        this.isSyncing.set(false);
        this.toast.error('Cache flush failed. No cache state was changed.');
      },
    });
  }

  private finishFlush(): void {
    setTimeout(() => {
      this.isSyncing.set(false);
      this.fetchTelemetry();
      this.toast.success('Redis L2 cluster & process caches successfully flushed.');
    }, 500);
  }

  reloadLiveData(): void {
    this.refreshOrders(true);
    this.refreshProducts(true);
    if (!this.account.isAdmin()) return;
    this.refreshVendors(true);
    this.refreshTasks();
    this.refreshInquiries();
    this.fetchTelemetry();
  }

  // ─── INTERNAL PERSISTENCE & KPI CALCULATION ───────────────────────────────

  private computeMetrics(): AdminMetrics {
    const ordersList = this.orders ? this.orders() : [];
    const bookingsList = this.bookings ? this.bookings() : [];
    const productsList = this.products ? this.products() : [];

    const collectedOrders = ordersList.filter((o) => ['captured', 'refunded'].includes(o.payment_status));
    const netCollected = (order: AdminOrder): number => {
      const total = Number(order.total_amount || 0);
      const refunded = order.confirmed_refund_amount ??
        (order.payment_status === 'refunded' || order.refund_status === 'processed' ? Number(order.refund_amount ?? total) : 0);
      return Math.max(0, total - Number(refunded || 0));
    };

    const todayStr = new Date().toISOString().split('T')[0];
    const todayOrders = collectedOrders.filter((o) => o.created_at.startsWith(todayStr));
    const todayRev = todayOrders.reduce((sum, o) => sum + netCollected(o), 0);

    const incompletePayment = ordersList.filter((o) => this.isPaymentIncomplete(o)).length;
    const accepted = ordersList.filter(
      (o) => (o.status === 'accepted' || o.status === 'confirmed' || o.status === 'pending') && !this.isPaymentIncomplete(o)
    ).length;
    const processing = ordersList.filter((o) => o.status === 'processing').length;
    const shipped = ordersList.filter((o) => o.status === 'shipped').length;
    const delivered = ordersList.filter((o) => o.status === 'delivered').length;
    const cancelled = ordersList.filter((o) => o.status === 'cancelled').length;

    const todayBookings = bookingsList.filter(
      (b) => b.booking_date === todayStr && b.status !== 'cancelled'
    ).length;
    const occupancyRate = null;

    const lowStock = productsList.filter((p) => (p.stock_quantity ?? 0) <= 15).length;
    const outOfStock = productsList.filter((p) => (p.stock_quantity ?? 0) === 0).length;

    return {
      revenue: {
        today: todayRev,
        week: collectedOrders.filter(o => new Date(o.created_at).getTime() >= Date.now()-7*86400000).reduce((sum,o)=>sum+netCollected(o),0),
        month: collectedOrders.filter(o => new Date(o.created_at).getTime() >= Date.now()-30*86400000).reduce((sum,o)=>sum+netCollected(o),0),
        trendPercent: null,
      },
      orders: {
        total: ordersList.length,
        accepted,
        processing,
        shipped,
        delivered,
        cancelled,
        incompletePayment,
        trendPercent: null,
      },
      bookings: {
        total: bookingsList.length,
        today: todayBookings,
        occupancyRate,
        trendPercent: null,
      },
      inventory: {
        totalProducts: productsList.length,
        lowStock,
        outOfStock,
      },
    };
  }

  recomputeAndPersistMetrics(): void {
    const updated = this.computeMetrics();
    this.metrics.set(updated);
  }

  private recordCustomerOrder(order: AdminOrder): void {
    const existing = this.customers().find(
      (c) =>
        c.name.toLowerCase() === order.shipping_address.fullName.toLowerCase() ||
        c.email.toLowerCase() === order.shipping_address.phone
    );

    if (existing) {
      this.customers.update((list) =>
        list.map((c) =>
          c.id === existing.id
            ? {
                ...c,
                total_orders: c.total_orders + 1,
                total_spent: c.total_spent + order.total_amount,
              }
            : c
        )
      );
    } else {
      const newCust: AdminCustomer = {
        id: `usr-ub-${Date.now().toString().slice(-4)}`,
        name: order.shipping_address.fullName,
        email: `${order.shipping_address.fullName.toLowerCase().replace(/\s+/g, '')}@client.in`,
        role: 'customer',
        created_at: new Date().toISOString(),
        total_orders: 1,
        total_spent: order.total_amount,
      };
      this.customers.update((list) => [newCust, ...list]);
    }

    this.saveCustomers(this.customers());
  }

  refreshOrders(notify = false): void {
    if ((!this.account.isAdmin() && !this.account.isVendor()) || this.isSyncing()) return;
    const identity = this.account.user();
    this.isSyncing.set(true);
    this.http.get<{ data: any[] }>(`${API_BASE}/orders`).pipe(takeUntil(this.sessionEnded)).subscribe({
      next: (res) => {
        if (identity !== this.account.user()) return;
        this.isSyncing.set(false);
        if (Array.isArray(res?.data)) {
          const mapped: AdminOrder[] = res.data.map((o) => ({
            id: o.id,
            status: ((o.status || 'accepted').toLowerCase().trim()) as AdminOrder['status'],
            subtotal: Number(o.subtotal) || Number(o.total_amount) || 0,
            total_amount: Number(o.total_amount) || 0,
            currency: o.currency || 'INR',
            payment_method: o.payment_method || 'Razorpay',
            payment_status: o.payment_status || 'pending',
            return_status: o.return_status,
            return_reason: o.return_reason,
            return_review_note: o.return_review_note,
            return_requested_at: o.return_requested_at,
            return_requested_by: o.return_requested_by,
            return_reviewed_at: o.return_reviewed_at,
            return_reviewed_by: o.return_reviewed_by,
            return_received_at: o.return_received_at,
            return_restock: o.return_restock,
            payment_reconciliation_error: o.payment_reconciliation_error,
            refund_status: o.refund_status || null,
            refund_id: o.refund_id || undefined,
            refund_amount: o.refund_amount ? Number(o.refund_amount) : undefined,
            confirmed_refund_amount: o.confirmed_refund_amount == null ? undefined : Number(o.confirmed_refund_amount),
            refund_reason: o.refund_reason || undefined,
            refund_requested_at: o.refund_requested_at || undefined,
            refunded_at: o.refunded_at || undefined,
            refund_failure_reason: o.refund_failure_reason || undefined,
            transaction_id: o.transaction_id || o.payment_id || '',
            gateway_order_id: o.gateway_order_id || o.idempotency_key || undefined,
            shipping_address: (() => {
              try {
                const parsed = typeof o.shipping_address === 'string'
                  ? JSON.parse(o.shipping_address)
                  : o.shipping_address;
                if (parsed && typeof parsed === 'object') {
                  return {
                    fullName: parsed.fullName || parsed.name || 'Walk-in Customer',
                    city: parsed.city || 'Ghaziabad',
                    phone: parsed.phone || '',
                    street: parsed.street || '',
                    email: parsed.email || '',
                  };
                }
              } catch {}
              return { fullName: 'Walk-in Customer', city: 'Ghaziabad', phone: '', street: '', email: '' };
            })(),
            created_at: o.created_at || new Date().toISOString(),
            updated_at: o.updated_at,
            items: (o.items || []).map((i: any) => ({
              product_id: i.product_id,
              product_name: i.product_name || 'Salon Care Item',
              unit_price: Number(i.unit_price) || 0,
              quantity: Number(i.quantity) || 1,
              image_url: i.image_url || '/images/products/hc-hair-serum.jpg',
              vendor: i.vendor || undefined,
            })),
            tracking_number: o.tracking_number || undefined,
            carrier: o.carrier || undefined,
            tracking_data: o.tracking_data,
            tracking_checked_at: o.tracking_checked_at,
            tracking_error: o.tracking_error,
            tracking_automatic: o.tracking_automatic,
            coupon_code: o.coupon_code || undefined,
            discount_amount: Number(o.discount_amount) || 0,
            shipping_fee: Number(o.shipping_fee) || 0,
            tax_amount: Number(o.tax_amount) || 0,
            tax_rate_percent: Number(o.tax_rate_percent) || 0,
            tax_inclusive: Boolean(o.tax_inclusive),
          }));
          this.orders.set(mapped);
          this.saveOrders(mapped);
          this.recomputeAndPersistMetrics();
          if (notify) {
            this.toast.success(`⚡ Synced ${mapped.length} live orders from Neon PostgreSQL.`);
          }
        }
      },
      error: (err) => {
        this.isSyncing.set(false);
        console.warn('Failed to sync orders from Neon DB:', err);
        if (notify) {
          this.toast.warning('Database sync failed. Showing cached orders.');
        }
      },
    });
  }

  readonly productsLoading = signal(false);
  readonly productsError = signal(false);

  refreshProducts(notify = false): void {
    if (!this.account.isAdmin() && !this.account.isVendor()) return;
    const identity = this.account.user();
    this.productsLoading.set(true);
    this.productsError.set(false);
    const fetchFresh = () => {
      this.http.get<{ data: any[] }>(`${ADMIN_API_BASE}/products?limit=200&t=${Date.now()}`).pipe(takeUntil(this.sessionEnded), finalize(() => this.productsLoading.set(false))).subscribe({
        next: (res) => {
          if (identity !== this.account.user()) return;
          if (Array.isArray(res?.data)) {
            const mapped: AdminProduct[] = res.data.map((p) => ({
              id: p.id,
              version: Number(p.version),
              enabled: p.enabled ?? p.in_stock,
              name: p.name,
              slug: p.slug,
              description: p.description,
              longDescription: p.longDescription || p.long_description || p.description,
              highlights: p.highlights || [],
              price: Number(p.price),
              compareAtPrice: p.compareAtPrice != null ? Number(p.compareAtPrice) : (p.compare_at_price != null ? Number(p.compare_at_price) : undefined),
              currency: p.currency || 'INR',
              imageUrl: p.imageUrl || p.image_url || '/images/products/hc-shampoo.jpg',
              category: p.category,
              kind: p.kind,
              vendor: p.vendor,
              audience: p.audience,
              freeDelivery: p.freeDelivery ?? p.free_delivery ?? true,
              rating: Number(p.rating || 5),
              reviewCount: Number(p.reviewCount ?? p.review_count ?? 1),
              badge: p.badge,
              inStock: Boolean(p.inStock ?? p.in_stock ?? true),
              stock_quantity: Number(p.stock_quantity ?? p.stockQuantity ?? 0),
              stock_reserved: Number(p.stock_reserved || 0),
              availableQuantity: Number(p.availableQuantity ?? p.stock_quantity ?? 0),
            }));
            this.products.set(mapped);
            this.saveProducts(mapped);
            mapped.forEach((prod) => this.catalog.upsertProduct(prod));
            this.recomputeAndPersistMetrics();
            if (notify) {
              this.toast.success(`⚡ Synced ${mapped.length} catalog products from database.`);
            }
          }
        },
        error: () => { this.productsError.set(true); this.toast.error('Inventory could not be loaded. Please retry.'); },
      });
    };

    if (notify) {
      this.http.post(`${ADMIN_API_BASE}/cache/flush`, {}).pipe(takeUntil(this.sessionEnded)).subscribe({
        next: () => fetchFresh(),
        error: () => fetchFresh(),
      });
    } else {
      fetchFresh();
    }
  }

  private syncWithBackend(): void {
    this.refreshOrders();
    this.refreshProducts();
    if (!this.account.isAdmin()) return;
    this.refreshVendors();

    this.http.get<AdminMetrics>(`${API_BASE}/metrics`).pipe(takeUntil(this.sessionEnded)).subscribe({
      next: (m) => this.metrics.set(m),
      error: () => {},
    });

    this.http.get<{ data: DailyMetric[] }>(`${API_BASE}/metrics/daily`).pipe(takeUntil(this.sessionEnded)).subscribe({
      next: (res) => {
        if (Array.isArray(res.data)) this.dailyMetrics.set(res.data);
      },
      error: () => {},
    });

    this.http.get<{ data: any[] }>(`${API_BASE}/bookings`).pipe(takeUntil(this.sessionEnded)).subscribe({
      next: (res) => {
        if (Array.isArray(res.data)) {
          this.bookings.set(res.data);
          this.saveBookings(res.data);
          this.recomputeAndPersistMetrics();
        }
      },
      error: () => {},
    });

    this.http.get<{ data: any[] }>(`${API_BASE}/customers`).pipe(takeUntil(this.sessionEnded)).subscribe({
      next: (res) => {
        if (Array.isArray(res.data)) {
          this.customers.set(res.data);
          this.saveCustomers(res.data);
        }
      },
      error: () => {},
    });

    // Real-time live synchronization for Customer Support Inquiries
    this.refreshInquiries();
    this.startInquiriesLivePolling();
  }









  private saveOrders(_items: AdminOrder[]): void {
    // Staff data is kept in memory only.
  }

  private saveBookings(_items: AdminBooking[]): void {
    // Staff data is kept in memory only.
  }

  private saveCustomers(_items: AdminCustomer[]): void {
    // Staff data is kept in memory only.
  }

  private saveProducts(_items: AdminProduct[]): void {
    // Staff data is kept in memory only.
  }

  // ─── MULTI-VENDOR METHODS ─────────────────────────────────────────────────
  loadVendorDirectory(): Observable<{ data: VendorAccount[] }> {
    return this.http.get<{ data: VendorAccount[] }>(`${API_BASE}/vendors`).pipe(
      tap(result => this.vendors.set(result.data || []))
    );
  }

  saveVendorProfile(id: string | null, payload: Partial<VendorAccount>): Observable<{ vendor: VendorAccount }> {
    const request = id
      ? this.http.put<{ vendor: VendorAccount }>(`${API_BASE}/vendors/${encodeURIComponent(id)}`, payload)
      : this.http.post<{ vendor: VendorAccount }>(`${API_BASE}/vendors`, payload);
    return request.pipe(tap(({ vendor }) => {
      this.vendors.update(list => id
        ? list.map(item => item.id === id ? { ...item, ...vendor } : item)
        : [vendor, ...list]);
    }));
  }

  refreshVendors(notify = false): void {
    this.http.get<{ data: VendorAccount[] }>(`${API_BASE}/vendors`).pipe(takeUntil(this.sessionEnded)).subscribe({
      next: (res) => {
        if (Array.isArray(res?.data)) {
          this.vendors.set(res.data);
          this.saveVendors(res.data);
          if (notify) this.toast.success(`⚡ Synced ${res.data.length} vendor business accounts.`);
        }
      },
      error: () => {
        if (notify) this.toast.error('Vendor data could not be loaded.');
      },
    });
  }

  addVendor(vendorData: Partial<VendorAccount>): void {
    const slug = (vendorData.name || 'vendor').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const newVendor: VendorAccount = {
      id: `vnd-${slug}`,
      name: vendorData.name || 'Partner Vendor',
      slug,
      email: vendorData.email || `${slug}@urbanblade.in`,

      contact_person: vendorData.contact_person || '',
      phone: vendorData.phone || '',
      commission_rate: vendorData.commission_rate ?? 12,
      status: 'active',
      payout_account: vendorData.payout_account,
      product_count: 0,
      total_sales: 0,
      order_count: 0,
      created_at: new Date().toISOString(),
    };

    const previousVendor = this.vendors().find((v) => v.id === newVendor.id);
    this.vendors.update((list) => [newVendor, ...list.filter((v) => v.id !== newVendor.id)]);
    this.saveVendors(this.vendors());

    const payload = {
      ...newVendor,
      password: vendorData.password,
      contactPerson: newVendor.contact_person,
      commissionRate: newVendor.commission_rate,
      payoutAccount: newVendor.payout_account,
    };
    this.http.post<{ ok: boolean; vendor?: VendorAccount }>(`${API_BASE}/vendors`, payload).pipe(takeUntil(this.sessionEnded)).subscribe({
      next: (res) => {
        if (res?.vendor) {
          this.vendors.update((list) => list.map((v) => (v.id === newVendor.id ? res.vendor! : v)));
          this.saveVendors(this.vendors());
        }
        this.toast.success(`🏢 Vendor Business Account "${newVendor.name}" registered successfully!`);
      },
      error: (err) => {
        this.vendors.update((list) => {
          const withoutFailedVendor = list.filter((v) => v.id !== newVendor.id);
          return previousVendor ? [previousVendor, ...withoutFailedVendor] : withoutFailedVendor;
        });
        this.saveVendors(this.vendors());
        this.toast.error(err?.error?.message || 'Vendor account could not be saved. Please try again.');
      },
    });
  }

  updateVendor(id: string, updates: Partial<VendorAccount>): void {
    const previous = this.vendors().find((v) => v.id === id);
    this.vendors.update((list) =>
      list.map((v) => (v.id === id ? { ...v, ...updates, updated_at: new Date().toISOString() } : v))
    );
    this.saveVendors(this.vendors());

    const payload = {
      ...updates,
      contactPerson: updates.contact_person,
      commissionRate: updates.commission_rate,
      payoutAccount: updates.payout_account,
    };
    this.http.put<{ ok: boolean; vendor?: VendorAccount }>(`${API_BASE}/vendors/${id}`, payload).pipe(takeUntil(this.sessionEnded)).subscribe({
      next: (res) => {
        if (res?.vendor) {
          this.vendors.update((list) => list.map((v) => (v.id === id ? res.vendor! : v)));
          this.saveVendors(this.vendors());
        }
        this.toast.success('Vendor profile updated.');
      },
      error: (err) => {
        if (previous) {
          this.vendors.update((list) => list.map((v) => (v.id === id ? previous : v)));
          this.saveVendors(this.vendors());
        }
        this.toast.error(err?.error?.message || 'Vendor profile update failed.');
      },
    });
  }

  toggleVendorStatus(id: string): void {
    const current = this.vendors().find((v) => v.id === id);
    if (!current) return;
    const nextStatus = current.status === 'active' ? 'suspended' : 'active';
    this.updateVendor(id, { status: nextStatus });
  }

  // ─── TASK OPERATIONS METHODS ──────────────────────────────────────────────
  refreshTasks(): void {
    this.http.get<{ data: AdminTask[] }>(`${API_BASE}/tasks`).pipe(takeUntil(this.sessionEnded)).subscribe({
      next: (res) => {
        if (Array.isArray(res?.data)) {
          this.adminTasks.set(res.data);
          this.saveTasks(res.data);
        }
      },
      error: () => this.toast.error('Operational tasks could not be loaded.'),
    });
  }

  addTask(taskData: Partial<AdminTask>): void {
    const newTask: AdminTask = {
      id: `tsk-${Date.now()}`,
      title: taskData.title || 'Operational Task',
      description: taskData.description || '',
      assignee: taskData.assignee || 'Master Admin',
      priority: taskData.priority || 'medium',
      status: 'pending',
      due_date: taskData.due_date || 'Soon',
      related_user: taskData.related_user || '',
      created_at: new Date().toISOString(),
    };

    this.adminTasks.update((list) => [newTask, ...list]);
    this.saveTasks(this.adminTasks());
    this.http.post<{ ok: boolean; task?: AdminTask }>(`${API_BASE}/tasks`, {
      title: newTask.title,
      description: newTask.description,
      assignee: newTask.assignee,
      priority: newTask.priority,
      dueDate: newTask.due_date,
      relatedUser: newTask.related_user,
    }).pipe(takeUntil(this.sessionEnded)).subscribe({
      next: (res) => {
        if (res?.task) {
          this.adminTasks.update((list) => list.map((t) => (t.id === newTask.id ? res.task! : t)));
          this.saveTasks(this.adminTasks());
        }
        this.toast.success(`Operational task "${newTask.title}" assigned.`);
      },
      error: () => {
        this.adminTasks.update((list) => list.filter((task) => task.id !== newTask.id));
        this.saveTasks(this.adminTasks());
        this.toast.error('Task could not be created.');
      },
    });
  }

  updateTaskStatus(id: string, status: AdminTask['status']): void {
    const previous = this.adminTasks().find((task) => task.id === id);
    if (!previous) return;
    this.adminTasks.update((list) =>
      list.map((t) => (t.id === id ? { ...t, status, updated_at: new Date().toISOString() } : t))
    );
    this.saveTasks(this.adminTasks());
    this.http.put(`${API_BASE}/tasks/${id}`, { status }).pipe(takeUntil(this.sessionEnded)).subscribe({
      next: () => this.toast.success(`Task moved to ${status.toUpperCase().replace('_', ' ')}`),
      error: () => {
        this.adminTasks.update((list) => list.map((task) => task.id === id ? previous : task));
        this.saveTasks(this.adminTasks());
        this.toast.error('Task status could not be updated.');
      },
    });
  }

  deleteTask(id: string): void {
    const previous = this.adminTasks();
    this.adminTasks.update((list) => list.filter((t) => t.id !== id));
    this.saveTasks(this.adminTasks());
    this.http.delete(`${API_BASE}/tasks/${id}`).pipe(takeUntil(this.sessionEnded)).subscribe({
      next: () => this.toast.info('Task removed.'),
      error: () => {
        this.adminTasks.set(previous);
        this.saveTasks(previous);
        this.toast.error('Task could not be removed.');
      },
    });
  }

  private broadcastChannel: BroadcastChannel | null = null;

  // ─── SUPPORT INQUIRIES & AI REAL-LIFE CHATBOT ──────────────────────────────
  // IDs currently being deleted — excluded from every poll refresh so they never reappear
  private readonly pendingDeletes = new Set<string>();

  private startInquiriesLivePolling(): void {
    if (typeof window !== 'undefined' && !this.broadcastChannel) {
      if ('BroadcastChannel' in window) {
        this.broadcastChannel = new BroadcastChannel('urban_support_bus');
        this.broadcastChannel.onmessage = (e) => {
          if (e.data?.type === 'USER_QUERY') {
            if (e.data?.deletedInquiryId) {
              this.pendingDeletes.add(e.data.deletedInquiryId);
              this.supportInquiries.update((list) => list.filter((i) => i.id !== e.data.deletedInquiryId));
              this.saveInquiries(this.supportInquiries());
            }
            this.refreshInquiries(!e.data?.deletedInquiryId);
          }
        };
      }
    }
  }

  refreshInquiries(showToast = false): void {
    if (!this.account.isAdmin()) return;
    this.http.get<{ data: SupportInquiry[] }>(`${SUPPORT_API_BASE}/inquiries`).pipe(takeUntil(this.sessionEnded)).subscribe({
      next: (res) => {
        if (res?.data && Array.isArray(res.data)) {
          // Filter out any IDs currently in the delete pipeline — prevents reappearance
          const filtered = this.pendingDeletes.size > 0
            ? res.data.filter((i) => !this.pendingDeletes.has(i.id))
            : res.data;

          const prevCount = this.supportInquiries().length;
          this.supportInquiries.set(filtered);
          this.saveInquiries(filtered);

          if (!filtered.some(inquiry => inquiry.id === this.activeSupportInquiryId())) {
            this.activeSupportInquiryId.set(filtered[0]?.id ?? null);
          }

          if (filtered.length > prevCount && prevCount > 0 && showToast) {
            this.toast.info('🔔 New customer inquiry received in real time!');
          }
        }
      },
      error: () => {},
    });
  }

  createInquiry(payload: {
    userName: string;
    userEmail: string;
    subject: string;
    orderId?: string;
    vendorName?: string;
    priority?: 'low' | 'medium' | 'high';
    initialMessage?: string;
  }, onSaved?: () => void, onComplete?: () => void): void {
    this.http.post<{ ok: boolean; inquiry: SupportInquiry }>(`${SUPPORT_API_BASE}/inquiries`, payload).pipe(takeUntil(this.sessionEnded), finalize(() => onComplete?.())).subscribe({
      next: (res) => {
        if (res?.ok && res.inquiry) {
          onSaved?.();
          this.supportInquiries.update((list) => [res.inquiry, ...list]);
          this.saveInquiries(this.supportInquiries());
          this.activeSupportInquiryId.set(res.inquiry.id);
          this.toast.success(`Support ticket #${res.inquiry.id.slice(0, 8)} created for ${res.inquiry.user_name}.`);
          if (this.broadcastChannel) {
            this.broadcastChannel.postMessage({ type: 'ADMIN_REPLY', inquiryId: res.inquiry.id });
          }
        } else {
          this.toast.error('Ticket was not saved. Please retry.');
        }
      },
      error: () => {
        this.toast.error('Failed to create support ticket.');
      },
    });
  }

  deleteInquiry(id: string): void {
    this.deleteInquiries([id]);
  }

  deleteInquiries(ids: string[]): void {
    if (!ids.length) return;
    const snapshot = this.supportInquiries();
    const identity = this.account.user();

    // Mark as pending so polling never restores them
    ids.forEach((id) => this.pendingDeletes.add(id));

    // Optimistic remove from local signal
    this.supportInquiries.update((list) => list.filter((i) => !ids.includes(i.id)));
    this.saveInquiries(this.supportInquiries());

    // Broadcast immediately so customer widgets instantly clear
    if (this.broadcastChannel) {
      this.broadcastChannel.postMessage({ type: 'INQUIRY_DELETED', ids });
    }

    // Fire parallel DELETEs to backend
    const deletes = ids.map((id) =>
      firstValueFrom(this.http.delete<{ ok: boolean }>(`${SUPPORT_API_BASE}/inquiries/${id}`).pipe(takeUntil(this.sessionEnded)))
        .catch(() => null)
    );

    Promise.all(deletes).then((results) => {
      if (identity !== this.account.user()) return;
      ids.forEach(id => this.pendingDeletes.delete(id));
      const failed = ids.filter((_, i) => results[i] === null);
      if (failed.length === 0) {
        this.toast.success(`${ids.length} ${ids.length === 1 ? 'inquiry' : 'inquiries'} permanently deleted.`);
        ids.forEach((id) => this.pendingDeletes.delete(id));
      } else {
        // Partial failure — restore failed ones
        failed.forEach((id) => this.pendingDeletes.delete(id));
        const failedItems = snapshot.filter((i) => failed.includes(i.id));
        this.supportInquiries.update((list) => [...failedItems, ...list]);
        this.saveInquiries(this.supportInquiries());
        this.toast.error(`${failed.length} deletion(s) failed — please try again.`);
        if (ids.length - failed.length > 0) {
          this.toast.success(`${ids.length - failed.length} deleted successfully.`);
        }
      }
    });
  }


  sendInquiryMessage(
    inquiryId: string,
    text: string,
    sender: 'admin' | 'ai' = 'admin',
    onSaved?: () => void,
    onComplete?: () => void
  ): void {
    this.http.post<{ ok: boolean; inquiry?: SupportInquiry }>(
      `${SUPPORT_API_BASE}/inquiries/${inquiryId}/message`, { text, sender }
    ).pipe(takeUntil(this.sessionEnded), finalize(() => onComplete?.())).subscribe({
      next: (res) => {
        if (!res?.ok || !res.inquiry) {
          this.toast.error('Reply was not saved. Please retry.');
          return;
        }
        this.supportInquiries.update(list => list.map(inquiry =>
          inquiry.id === inquiryId ? res.inquiry! : inquiry
        ));
        this.saveInquiries(this.supportInquiries());
        this.broadcastChannel?.postMessage({ type: 'ADMIN_REPLY', inquiryId });
        onSaved?.();
      },
      error: () => this.toast.error('Reply could not be sent. Please retry.'),
    });
  }

  updateInquiryStatus(inquiryId: string, status: SupportInquiry['status']): void {
    this.http.put<{ ok: boolean; inquiry?: SupportInquiry }>(
      `${SUPPORT_API_BASE}/inquiries/${inquiryId}/status`, { status }
    ).pipe(takeUntil(this.sessionEnded)).subscribe({
      next: (res) => {
        if (!res?.ok || !res.inquiry) {
          this.toast.error('Ticket status was not saved. Please retry.');
          return;
        }
        this.supportInquiries.update(list => list.map(inquiry =>
          inquiry.id === inquiryId ? res.inquiry! : inquiry
        ));
        this.saveInquiries(this.supportInquiries());
        this.toast.success(`Inquiry ticket updated: ${status.replace('_', ' ').toUpperCase()}`);
        this.broadcastChannel?.postMessage({ type: 'STATUS_CHANGE', inquiryId, status });
      },
      error: () => this.toast.error('Ticket status could not be updated. Please retry.'),
    });
  }

  queryAiChatbot(payload: {
    message: string;
    inquiryId?: string;
    orderId?: string;
    vendorName?: string;
    customerName?: string;
  }): Observable<AiChatResponse> {
    return this.http.post<AiChatResponse>(`${SUPPORT_API_BASE}/ai-chat`, payload);
  }

  toggleChatDrawer(): void {
    this.isChatDrawerOpen.update((v) => !v);
  }

  toggleAiAutoPilot(): void {
    this.isAiAutoPilot.update((v) => !v);
    this.toast.info(
      this.isAiAutoPilot()
        ? '🤖 AI Concierge Auto-Pilot ENABLED (Real-time intelligent inquiry resolution active)'
        : '👤 AI Auto-Pilot paused (Human Master Admin response mode active)'
    );
  }

  // ─── STORAGE LOADERS & PERSISTENCE ────────────────────────────────────────






  private saveVendors(_items: VendorAccount[]): void {
    // Staff data is kept in memory only.
  }

  private saveTasks(_items: AdminTask[]): void {
    // Staff data is kept in memory only.
  }

  private saveInquiries(_items: SupportInquiry[]): void {
    // Staff data is kept in memory only.
  }

  // ─── FINANCIAL OPERATIONS & AUDIT SETTLEMENTS ──────────────────────────────
  getFinancialSummary(): Observable<{ ok: boolean } & FinancialSummary> {
    return this.http.get<{ ok: boolean } & FinancialSummary>(`${API_BASE}/finance/summary`);
  }

  getDailyMetrics(): Observable<{ data: Array<{ date: string; dayLabel: string; revenue: number; orders: number }> }> {
    return this.http.get<{ data: Array<{ date: string; dayLabel: string; revenue: number; orders: number }> }>(`${API_BASE}/metrics/daily`);
  }

  processVendorPayout(vendorId: string, amount: number, reference: string, notes?: string): Observable<any> {
    return this.http.post(`${API_BASE}/finance/process-payout`, { vendorId, amount, reference, notes }).pipe(
      tap(() => {
        this.toast.success(`External payment of ₹${amount.toLocaleString()} recorded.`);
      })
    );
  }

  validateVendorUpi(id: string, upi?: string): Observable<{ ok: boolean; validation: RazorpayUpiValidationResult; message: string }> {
    return this.http.post<{ ok: boolean; validation: RazorpayUpiValidationResult; message: string }>(
      `${API_BASE}/vendors/${id}/validate-upi`,
      { upi }
    );
  }

  verifyVendorPayout(
    id: string,
    verified: boolean,
    reference?: string,
    details?: { verifiedBeneficiaryName?: string; upi?: string; method?: string }
  ): Observable<{ ok: boolean; vendor?: VendorAccount; message?: string }> {
    return this.http.post<{ ok: boolean; vendor?: VendorAccount; message?: string }>(
      `${API_BASE}/vendors/${id}/verify-payout`,
      {
        verified,
        reference,
        verifiedBeneficiaryName: details?.verifiedBeneficiaryName,
        upi: details?.upi,
        method: details?.method,
      }
    ).pipe(
      tap((res) => {
        if (res.vendor) {
          this.vendors.update((list) => list.map((v) => (v.id === id ? res.vendor! : v)));
          this.saveVendors(this.vendors());
        }
        this.toast.success(res.message || (verified ? 'Vendor payout credentials verified.' : 'Verification status revoked.'));
      })
    );
  }
}
