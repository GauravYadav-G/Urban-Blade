import { ShipmentTrackingComponent } from '@shared/components/shipment-tracking/shipment-tracking';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { Component, inject, signal, computed, effect, untracked, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService, type AdminOrder } from '@core/services/admin.service';
import { AccountService } from '@core/services/account.service';
import { ToastService } from '@core/services/toast.service';
import { OrderInvoice } from '@shared/components/order-invoice/order-invoice';

@Component({
  selector: 'app-admin-orders',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, OrderInvoice, ShipmentTrackingComponent],
  templateUrl: './admin-orders.html',
  styleUrl: './admin-orders.scss',
})
export class AdminOrders implements OnInit, OnDestroy {
  readonly admin = inject(AdminService);
  private readonly http = inject(HttpClient);
  readonly account = inject(AccountService);
  readonly toast = inject(ToastService);

  // Filter Signals
  readonly selectedTab = signal<string>('all');
  readonly selectedVendorFilter = signal<string>('all');
  readonly selectedPaymentFilter = signal<'all' | 'prepaid' | 'cod' | 'incomplete' | 'paid'>('all');
  readonly selectedTimeFilter = signal<'all' | 'today' | '7days' | 'month'>('all');
  readonly selectedUrgencyFilter = signal<'all' | 'delayed' | 'high_value'>('all');
  readonly searchQuery = signal<string>('');
  readonly incompleteOrdersCount = computed(() =>
    this.admin.orders().filter((o) => this.admin.isPaymentIncomplete(o)).length
  );
  readonly paidOrdersCount = computed(() =>
    this.admin.orders().filter((o) => this.admin.isPaymentPaid(o)).length
  );

  // Selection & Modal States
  readonly selectedOrder = signal<AdminOrder | null>(null);
  readonly selectedInvoiceOrder = signal<AdminOrder | null>(null);
  readonly shippingLabelModalOrders = signal<AdminOrder[] | null>(null);
  readonly copiedTrackingId = signal<string | null>(null);

  // Multi-Selection for Bulk Operations
  readonly selectedOrderIds = signal<string[]>([]);

  // Real-Time Delivery Partner Website Web Fetching
  readonly carrierSyncQuery = signal<string>('');
  readonly carrierReview = signal<{ carrier: string; awb: string; portalUrl: string } | null>(null);
  readonly carrierResult = signal('');
  readonly selectedCarrierPortal = signal<string>('auto');
  readonly isFetchingWebsite = signal<boolean>(false);
  readonly isReconciling = signal<boolean>(false);
  readonly isRefunding = signal<boolean>(false);
  readonly isCancelling = signal<boolean>(false);
  readonly websiteTelemetryModal = signal<{ order: AdminOrder | null; websiteData: any } | null>(null);

  // Inspector Edits
  readonly tempCarrier = signal<string>('Urban Express Logistics');
  readonly tempNotes = signal<string>('');

  // Auto-Polling Interval (0 = Off, 15 = 15s, 30 = 30s)
  readonly autoPollSeconds = signal<number>(15);
  private pollTimer: any = null;

  // Available Carriers
  readonly carrierOptions = [
    'Urban Express Logistics',
    'Shiprocket',
    'BlueDart Express',
    'Delhivery Surface',
    'Delhivery Express',
    'DTDC Air',
    'Porter Local',
  ];

  // Manual POS Order Modal State
  readonly isCreateModalOpen = signal(false);
  readonly isSavingManualOrder = signal(false);
  readonly manualCustomerName = signal('');
  readonly manualCustomerPhone = signal('');
  readonly manualCustomerCity = signal('Ghaziabad');
  readonly manualCustomerStreet = signal('Salon Walk-in / Counter POS');
  readonly manualProductId = signal('');
  readonly manualQuantity = signal(1);
  readonly manualPaymentMethod = signal<'UPI' | 'Cash' | 'Card'>('UPI');

  constructor() {
    effect(() => {
      const orders = this.admin.orders();
      untracked(() => {
        const selected = this.selectedOrder();
        if (selected) this.selectedOrder.set(orders.find(order => order.id === selected.id) || null);
        const telemetry = this.websiteTelemetryModal();
        if (telemetry) {
          const order = orders.find(order => order.id === telemetry.order?.id);
          if (order?.tracking_data) this.websiteTelemetryModal.set({ order, websiteData: order.tracking_data });
        }
      });
    });
    inject(ActivatedRoute).queryParamMap.pipe(takeUntilDestroyed()).subscribe(params => {
      this.searchQuery.set(params.get('q') || '');
    });
  }

  ngOnInit(): void {
    this.admin.refreshOrders();
    this.admin.refreshVendors();
    this.setAutoPoll(15, false);
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  refreshFromDb(): void {
    this.admin.refreshOrders(true);
  }

  // ─── AUTO-POLLING TELEMETRY ───────────────────────────────────────────────
  setAutoPoll(seconds: number, notify = true): void {
    this.autoPollSeconds.set(seconds);
    this.stopPolling();
    if (seconds > 0) {
      if (notify) this.toast.info(`Automatic refresh enabled: every ${seconds}s`);
      this.pollTimer = setInterval(() => {
        if (typeof document !== 'undefined' && !document.hidden) this.admin.refreshOrders(false);
      }, seconds * 1000);
    } else {
      this.toast.info('Radar auto-sync paused.');
    }
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  // ─── EXECUTIVE TELEMETRY KPI METRICS ───────────────────────────────────────
  readonly executiveTelemetry = computed(() => {
    const list = this.admin.orders();
    const nonCancelled = list.filter((o) => (o.status || '').toLowerCase() !== 'cancelled');
    const gmv = nonCancelled.reduce((acc, o) => acc + (Number(o.total_amount) || 0), 0);
    const aov = nonCancelled.length > 0 ? Math.round(gmv / nonCancelled.length) : 0;
    
    const activePipeline = list.filter((o) => {
      const s = (o.status || '').toLowerCase();
      return s === 'pending' || s === 'accepted' || s === 'confirmed' || s === 'processing' || s === 'shipped';
    }).length;

    const deliveredCount = list.filter((o) => (o.status || '').toLowerCase() === 'delivered').length;
    const delayedSlaCount = list.filter((o) => this.isDelayed(o)).length;
    const highValueCount = list.filter((o) => this.isHighValue(o)).length;
    const incompletePaymentsCount = list.filter((o) => this.admin.isPaymentIncomplete(o)).length;

    return {
      totalOrders: list.length,
      gmv,
      aov,
      activePipeline,
      deliveredCount,
      delayedSlaCount,
      highValueCount,
      incompletePaymentsCount,
    };
  });

  // ─── SLA & URGENCY HELPERS ────────────────────────────────────────────────
  isDelayed(order: AdminOrder): boolean {
    const s = (order.status || '').toLowerCase();
    if (s === 'shipped' || s === 'delivered' || s === 'cancelled') return false;
    const orderTime = new Date(order.created_at).getTime();
    if (isNaN(orderTime)) return false;
    const ageHours = (Date.now() - orderTime) / (1000 * 60 * 60);
    return ageHours >= 24;
  }

  getOrderAgeHours(order: AdminOrder): number {
    const orderTime = new Date(order.created_at).getTime();
    if (isNaN(orderTime)) return 0;
    return Math.floor((Date.now() - orderTime) / (1000 * 60 * 60));
  }

  isHighValue(order: AdminOrder): boolean {
    return (order.total_amount || 0) >= 2000;
  }

  // ─── FILTERED ORDERS COMPUTED ─────────────────────────────────────────────
  readonly filteredOrders = computed(() => {
    let list = this.admin.orders();
    const tab = this.selectedTab();
    const q = this.searchQuery().trim().toLowerCase();
    const isVendor = this.account.isVendor();
    const activeVendor = this.account.activeVendorName()?.toLowerCase();
    const vendorFilter = this.selectedVendorFilter().toLowerCase();
    const payFilter = this.selectedPaymentFilter();
    const timeFilter = this.selectedTimeFilter();
    const urgencyFilter = this.selectedUrgencyFilter();

    // 1. Vendor scoping
    if (isVendor && activeVendor) {
      list = list.filter((o) =>
        o.items.some(
          (i) =>
            (i.vendor && i.vendor.toLowerCase() === activeVendor) ||
            i.product_name.toLowerCase().includes(activeVendor)
        )
      );
    } else if (!isVendor && vendorFilter !== 'all') {
      list = list.filter((o) =>
        o.items.some(
          (i) =>
            (i.vendor && i.vendor.toLowerCase() === vendorFilter) ||
            i.product_name.toLowerCase().includes(vendorFilter)
        )
      );
    }

    // 2. Status Tab
    if (tab !== 'all') {
      if (tab === 'incomplete') {
        list = list.filter((o) => this.admin.isPaymentIncomplete(o));
      } else if (tab === 'confirmed' || tab === 'accepted') {
        list = list.filter(
          (o) => (o.status === 'confirmed' || o.status === 'accepted' || o.status === 'pending') && !this.admin.isPaymentIncomplete(o)
        );
      } else {
        list = list.filter((o) => o.status === tab);
      }
    }

    // 3. Payment Method & Status Filter
    if (payFilter === 'cod') {
      list = list.filter((o) => o.payment_method === 'cash_on_delivery' || o.payment_method === 'Cash on Delivery');
    } else if (payFilter === 'prepaid') {
      list = list.filter((o) => o.payment_method !== 'cash_on_delivery' && o.payment_method !== 'Cash on Delivery');
    } else if (payFilter === 'incomplete') {
      list = list.filter((o) => this.admin.isPaymentIncomplete(o));
    } else if (payFilter === 'paid') {
      list = list.filter((o) => this.admin.isPaymentPaid(o));
    }

    // 4. Timeframe Filter
    if (timeFilter !== 'all') {
      const now = Date.now();
      list = list.filter((o) => {
        const t = new Date(o.created_at).getTime();
        if (isNaN(t) || t > now) return false;
        const diffHours = (now - t) / (1000 * 60 * 60);
        if (timeFilter === 'today') return new Date(t).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) === new Date(now).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
        if (timeFilter === '7days') return diffHours <= 24 * 7;
        if (timeFilter === 'month') return diffHours <= 24 * 30;
        return true;
      });
    }

    // 5. Urgency / Priority Filter
    if (urgencyFilter === 'delayed') {
      list = list.filter((o) => this.isDelayed(o));
    } else if (urgencyFilter === 'high_value') {
      list = list.filter((o) => this.isHighValue(o));
    }

    // 6. Search Query
    if (q) {
      list = list.filter(
        (o) =>
          (o.id && o.id.toLowerCase().includes(q)) ||
          (o.tracking_number && o.tracking_number.toLowerCase().includes(q)) ||
          (o.shipping_address?.fullName && o.shipping_address.fullName.toLowerCase().includes(q)) ||
          (o.shipping_address?.city && o.shipping_address.city.toLowerCase().includes(q)) ||
          (o.shipping_address?.phone && o.shipping_address.phone.includes(q)) ||
          (o.carrier && o.carrier.toLowerCase().includes(q)) ||
          (o.items && o.items.some((i) => i.product_name && i.product_name.toLowerCase().includes(q)))
      );
    }

    return list;
  });

  // ─── MULTI-ORDER SELECTION ────────────────────────────────────────────────
  readonly selectedCount = computed(() => this.selectedOrderIds().length);

  isOrderSelected(id: string): boolean {
    return this.selectedOrderIds().includes(id);
  }

  toggleSelectOrder(id: string, event?: Event): void {
    event?.stopPropagation();
    const current = this.selectedOrderIds();
    if (current.includes(id)) {
      this.selectedOrderIds.set(current.filter((x) => x !== id));
    } else {
      this.selectedOrderIds.set([...current, id]);
    }
  }

  readonly isAllSelected = computed(() => {
    const list = this.filteredOrders();
    if (list.length === 0) return false;
    const set = new Set(this.selectedOrderIds());
    return list.every((o) => set.has(o.id));
  });

  toggleSelectAll(): void {
    const list = this.filteredOrders();
    if (this.isAllSelected()) {
      this.selectedOrderIds.set([]);
    } else {
      this.selectedOrderIds.set(list.map((o) => o.id));
    }
  }

  clearSelection(): void {
    this.selectedOrderIds.set([]);
  }

  // ─── BATCH OPERATIONS ─────────────────────────────────────────────────────
  bulkAdvanceSelected(): void {
    const ids = this.selectedOrderIds();
    if (ids.length === 0 || this.isFetchingWebsite()) return;
    if (ids.length > 25) { this.toast.error('Select up to 25 orders per carrier check.'); return; }

    let advancedCount = 0;
    const orders = this.admin.orders().filter((o) => ids.includes(o.id));

    orders.forEach((order) => {
      const next = this.getNextStatus(order.status);
      if (next && !this.admin.isPaymentIncomplete(order)) {
        const generatedTracking = (next === 'shipped' || next === 'delivered') && !order.tracking_number
          ? `TRK-UB-${order.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`
          : order.tracking_number;
        this.admin.updateOrderStatus(order.id, next, generatedTracking);
        advancedCount++;
      }
    });

    this.toast.info(`Submitted ${advancedCount} eligible order updates. Each result will be confirmed separately.`);
    this.clearSelection();
  }

  bulkMarkDelivered(): void {
    const ids = this.selectedOrderIds();
    if (ids.length === 0 || this.isFetchingWebsite()) return;
    if (ids.length > 25) { this.toast.error('Select up to 25 orders per carrier check.'); return; }

    let marked = 0;
    const orders = this.admin.orders().filter((o) => ids.includes(o.id));
    orders.forEach((o) => {
      if (o.status !== 'delivered' && o.status !== 'cancelled' && !this.admin.isPaymentIncomplete(o)) {
        this.admin.updateOrderStatus(o.id, 'delivered');
        marked++;
      }
    });

    this.toast.info(`Submitted ${marked} delivery updates. Each result will be confirmed separately.`);
    this.clearSelection();
  }

  bulkAssignTracking(): void {
    const ids = this.selectedOrderIds();
    if (ids.length === 0 || this.isFetchingWebsite()) return;
    if (ids.length > 25) { this.toast.error('Select up to 25 orders per carrier check.'); return; }

    let assigned = 0;
    const orders = this.admin.orders().filter((o) => ids.includes(o.id));
    orders.forEach((o) => {
      if (!o.tracking_number) {
        const trk = `TRK-UB-${o.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
        this.admin.updateOrderStatus(o.id, o.status, trk);
        assigned++;
      }
    });

    this.toast.info(`Submitted ${assigned} tracking updates. Each result will be confirmed separately.`);
    this.clearSelection();
  }

  bulkExportCSV(): void {
    const ids = this.selectedOrderIds();
    const orders = ids.length > 0 
      ? this.admin.orders().filter((o) => ids.includes(o.id))
      : this.filteredOrders();
    
    this.performExportCSV(orders, `urbanblade_orders_batch_${new Date().toISOString().split('T')[0]}.csv`);
  }

  bulkPrintShippingLabels(): void {
    const ids = this.selectedOrderIds();
    if (ids.length === 0 || this.isFetchingWebsite()) return;
    if (ids.length > 25) { this.toast.error('Select up to 25 orders per carrier check.'); return; }
    const orders = this.admin.orders().filter((o) => ids.includes(o.id));
    this.shippingLabelModalOrders.set(orders);
  }

  // ─── REAL-TIME DELIVERY PARTNER WEBSITE WEB-FETCHING ──────────────────────
  fetchFromWebsite(explicitQuery?: string): void {
    if (this.isFetchingWebsite()) return;
    this.carrierReview.set(null); this.carrierResult.set('');
    const q = (explicitQuery || this.carrierSyncQuery()).trim();
    if (!q) {
      this.toast.error('Please enter an Order Number or Tracking AWB to fetch from carrier website.');
      return;
    }

    this.isFetchingWebsite.set(true);
    const portal = this.selectedCarrierPortal();

    this.admin.fetchCarrierWebsiteStatus(q, portal).subscribe({
      next: (res) => {
        this.isFetchingWebsite.set(false);
        if (res.ok && res.websiteData) {
          const wd = res.websiteData;
          this.carrierResult.set(res.reason || (res.applied ? 'Verified status applied.' : 'Tracking checked; order status unchanged.'));
          this.toast.success(
            `${wd.source === 'live_web_fetch' ? '🌐 Portal' : '🔗 Carrier API'} verification from ${wd.carrier}: ${wd.rawPortalStatus} (${wd.currentLocation || 'location unavailable'}). ${res.applied ? `Order status updated to ${wd.status?.toUpperCase()}.` : 'No automatic status transition was applied.'}`
          );
          if (res.order) {
            this.websiteTelemetryModal.set({
              order: res.order,
              websiteData: wd,
            });
          } else {
            this.websiteTelemetryModal.set({ order: null, websiteData: wd });
          }
          this.carrierSyncQuery.set('');
        } else {
          this.toast.info(`Consignment lookup completed for ${q}.`);
        }
      },
      error: (err) => {
        this.isFetchingWebsite.set(false);
        const message = err.error?.message || err.error?.error || 'Unable to connect to the carrier portal.';
        this.carrierReview.set(err.error?.manualReview || null);
        this.carrierResult.set(message);
        this.toast.error(message);
      },
    });
  }

  fetchSingleOrderWebsite(order: AdminOrder, event?: Event): void {
    event?.stopPropagation();
    if (this.isFetchingWebsite()) return;
    this.carrierReview.set(null); this.carrierResult.set('');
    const queryKey = order.id;
    this.isFetchingWebsite.set(true);
    this.admin.fetchCarrierWebsiteStatus(queryKey, order.carrier || 'auto').subscribe({
      next: (res) => {
        this.isFetchingWebsite.set(false);
        if (res.ok && res.websiteData) {
          const wd = res.websiteData;
          this.toast.success(
            `${wd.source === 'live_web_fetch' ? '🌐 Portal' : '🔗 Carrier API'} verification from ${wd.carrier}: #${order.id.slice(0, 8)} is ${wd.rawPortalStatus} @ ${wd.currentLocation || 'location unavailable'}.`
          );
          this.websiteTelemetryModal.set({
            order: res.order || order,
            websiteData: wd,
          });
        }
      },
      error: (err) => {
        this.isFetchingWebsite.set(false);
        this.carrierReview.set(err.error?.manualReview || null);
        const message = err.error?.message || err.error?.error || 'Carrier status could not be verified. Check the tracking number, carrier, and connection settings.';
        this.carrierResult.set(message);
        this.toast.error(message);
      },
    });
  }

  bulkFetchWebsites(): void {
    const ids = this.selectedOrderIds();
    if (ids.length === 0 || this.isFetchingWebsite()) return;
    if (ids.length > 25) { this.toast.error('Select up to 25 orders per carrier check.'); return; }

    this.isFetchingWebsite.set(true);
    this.admin.bulkFetchCarrierWebsites(ids).subscribe({
      next: (res) => {
        this.isFetchingWebsite.set(false);
        const failures = res.results.filter(result => !result.ok).map(result => `${result.id}: ${result.message || 'Tracking unavailable'}`).join(' ');
        this.carrierResult.set(`${res.checkedCount} checked · ${res.updatedCount} updated · ${res.failedCount} require review. ${failures}`);
        this.toast.info(this.carrierResult());
        this.clearSelection();
      },
      error: () => {
        this.isFetchingWebsite.set(false);
        this.toast.error('Bulk carrier website fetch encountered an error.');
      },
    });
  }

  closeWebsiteTelemetryModal(): void {
    this.websiteTelemetryModal.set(null);
  }

  openOfficialTrackingPage(order: AdminOrder, event?: Event): void {
    event?.stopPropagation();
    const awb = order.tracking_number || order.id;
    const carrier = (order.carrier || '').toLowerCase();
    if (!order.tracking_number) { this.toast.error('Save the courier-issued AWB first.'); return; }
    let url = '';
    if (carrier.includes('shiprocket')) url = `https://shiprocket.co/tracking/${encodeURIComponent(awb)}`;
    else if (carrier.includes('delhivery')) url = `https://www.delhivery.com/track/package/${encodeURIComponent(awb)}`;
    if (carrier.includes('bluedart')) {
      url = `https://www.bluedart.com/tracking`;
    } else if (carrier.includes('dtdc')) {
      url = `https://www.dtdc.com/track-your-shipment/`;
    }
    if (!url) { this.toast.info('No official portal is configured for this carrier. Review the shipment manually.'); return; }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  // ─── STAGE PROGRESSION LOGIC ──────────────────────────────────────────────
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
    if (this.admin.isPaymentIncomplete(order)) {
      return { label: '⚠️ Payment Incomplete', icon: '⚠️', nextStatus: null, badgeClass: 'unpaid' };
    }
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
    if (this.admin.isPaymentIncomplete(order)) {
      this.toast.error(`Cannot advance order #${order.id.slice(0, 8)}: Customer payment is incomplete (${order.payment_status}).`);
      return;
    }
    const next = this.getNextStatus(order.status);
    if (next) {
      const generatedTracking = (next === 'shipped' || next === 'delivered') && !order.tracking_number
        ? `TRK-UB-${order.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`
        : order.tracking_number;
      this.admin.updateOrderStatus(order.id, next, generatedTracking, saved => {
        if (this.selectedOrder()?.id === order.id) this.selectedOrder.set(saved);
      });
    }
  }

  advanceToStage(order: AdminOrder, targetStage: AdminOrder['status'], event?: Event): void {
    event?.stopPropagation();
    if (this.admin.isPaymentIncomplete(order)) {
      this.toast.error(`Cannot advance order #${order.id.slice(0, 8)}: Customer payment is incomplete (${order.payment_status}).`);
      return;
    }
    const currentStatus = (order.status || '').toLowerCase().trim();
    if (currentStatus === targetStage || currentStatus === 'cancelled' || currentStatus === 'delivered') return;
    const generatedTracking = (targetStage === 'shipped' || targetStage === 'delivered') && !order.tracking_number
      ? `TRK-UB-${order.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`
      : order.tracking_number;
    this.admin.updateOrderStatus(order.id, targetStage, generatedTracking, saved => {
        if (this.selectedOrder()?.id === order.id) this.selectedOrder.set(saved);
      });
  }

  // ─── CUSTOMER COMMUNICATION & WHATSAPP ─────────────────────────────────────
  getWhatsAppUrl(order: AdminOrder): string {
    const rawPhone = (order.shipping_address?.phone || '').replace(/\D/g, '');
    const phone = rawPhone.length === 10 ? `91${rawPhone}` : rawPhone;
    if (phone.length < 10 || phone.length > 15) return '';
    const name = order.shipping_address?.fullName || 'Valued Customer';
    const tracking = order.tracking_number || `TRK-UB-${order.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    const carrier = order.carrier || 'Urban Express';
    const status = (order.status || 'confirmed').toUpperCase();

    const msg = `Hello ${name}! ✨\n\nYour Urban Blade luxury grooming order #${order.id.slice(0, 8).toUpperCase()} is currently ${status}.\n\n🚚 Carrier: ${carrier}\n📋 Airway Bill: ${tracking}\n💳 Total: ₹${order.total_amount}\n\nYou can track live consignment milestones anytime in your VIP Client Portal:\nhttps://urbanblade.in/account?tab=orders\n\nThank you for choosing Urban Blade! 💈`;

    return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
  }

  openWhatsApp(order: AdminOrder, event?: Event): void {
    event?.stopPropagation();
    const url = this.getWhatsAppUrl(order);
    if (!url) { this.toast.error('Add a valid customer phone number before opening WhatsApp.'); return; }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async copyCustomerPhone(phone: string, event?: Event): Promise<void> {
    event?.stopPropagation();
    if (!phone) return;
    try {
      await navigator.clipboard.writeText(phone);
      this.toast.success('Customer phone copied.');
    } catch {
      this.toast.error('Clipboard unavailable. Select and copy the phone number manually.');
    }
  }

  // ─── ORDER DETAILS INSPECTOR ──────────────────────────────────────────────
  viewOrder(order: AdminOrder): void {
    this.selectedOrder.set(order);
    this.tempCarrier.set(order.carrier || 'Urban Express Logistics');
    this.tempNotes.set(order.notes || '');
  }

  closeModal(): void {
    this.selectedOrder.set(null);
  }

  saveInspectorUpdates(order: AdminOrder): void {
    this.admin.updateOrderDetails(order.id, {
      carrier: this.tempCarrier(),
      notes: this.tempNotes(),
    }, saved => {
      if (this.selectedOrder()?.id === order.id) this.selectedOrder.set(saved);
    });
  }

  recordCollection(order: AdminOrder): void {
    const reference = window.prompt('Enter the receipt or carrier remittance reference for money already collected:')?.trim();
    if (!reference || reference.length < 3) return;
    this.http.post(`/api/admin/orders/${order.id}/collection`, { reference }).subscribe({
      next: () => { this.admin.refreshOrders(); this.toast.success('COD collection recorded.'); },
      error: error => this.toast.error(error.error?.message || 'Collection could not be recorded.'),
    });
  }

  cancelOrder(order: AdminOrder): void {
    const s = (order.status || '').toLowerCase().trim();
    if (s === 'delivered') {
      this.toast.error('Delivered orders have been fulfilled and cannot be cancelled.');
      return;
    }
    if (s === 'cancelled' && order.refund_status !== 'pending' && order.refund_status !== 'failed') {
      return;
    }
    if (this.admin.isPaymentPaid(order) && order.payment_method !== 'Razorpay') {
      const reference = window.prompt('Enter the receipt/reference for the refund already paid to this customer. No money is transferred by this action.')?.trim();
      if (!reference || reference.length < 3) return;
      this.http.post(`/api/admin/orders/${order.id}/refund/manual`, { reference, reason: 'Counter order cancelled and externally refunded' }).subscribe({
        next: () => { this.admin.refreshOrders(); this.admin.refreshProducts(); this.toast.success('External refund recorded.'); },
        error: error => this.toast.error(error.error?.message || 'External refund could not be recorded.'),
      });
      return;
    }
    if (this.admin.isPaymentPaid(order) || order.refund_status === 'pending' || order.refund_status === 'failed') {
      const existingReason = order.refund_reason?.trim();
      const reason = existingReason || window.prompt('Enter the customer-visible reason for this refund:', 'Order cancelled by administrator')?.trim();
      if (!reason || reason.length < 3) {
        this.toast.error('A refund reason of at least 3 characters is required.');
        return;
      }
      if (!confirm(`Refund the full payment for Order #${order.id.slice(0, 8)} and restore its inventory?`)) return;
      this.isRefunding.set(true);
      this.admin.refundOrder(order.id, reason).subscribe({
        next: (response) => {
          this.isRefunding.set(false);
          if (this.selectedOrder()?.id === order.id) this.selectedOrder.set(response.order);
          this.toast.success(response.message);
        },
        error: (error) => {
          this.isRefunding.set(false);
          this.toast.error(error.error?.message || 'Refund could not be completed. No local cancellation was applied.');
        },
      });
      return;
    }
    if (confirm(`Are you sure you want to cancel Order #${order.id.slice(0, 8)}? Items will be restocked.`)) {
      if (this.isCancelling()) return;
      this.isCancelling.set(true);
      this.admin.cancelOrder(order.id).subscribe({
        next: (response) => {
          this.isCancelling.set(false);
          if (this.selectedOrder()?.id === order.id) this.selectedOrder.set(response.order);
          this.toast.success(`Order #${order.id.slice(0, 8)} cancelled. Inventory was updated by the server.`);
        },
        error: (error) => {
          this.isCancelling.set(false);
          this.toast.error(error.error?.message || 'Cancellation failed. Inventory was not changed.');
        },
      });
    }
  }

  reconcilePayment(order: AdminOrder, event?: Event): void {
    event?.stopPropagation();
    if (this.isReconciling()) return;
    this.isReconciling.set(true);
    this.toast.info(`Connecting to Razorpay gateway to verify payment for #${order.id.slice(0, 8)}...`);

    this.admin.reconcilePayment(order.id).subscribe({
      next: (res) => {
        this.isReconciling.set(false);
        if (res.updated) {
          this.toast.success(res.message);
          if (this.selectedOrder()?.id === order.id && res.order) {
            this.selectedOrder.set(res.order);
          }
        } else {
          this.toast.info(res.message || 'Payment has not been completed on Razorpay yet.');
        }
      },
      error: (err) => {
        this.isReconciling.set(false);
        this.toast.error(err.error?.message || 'Failed to check payment status with gateway.');
      },
    });
  }

  // ─── TRACKING CODE CONTROLS ───────────────────────────────────────────────
  copyTrackingNumber(tracking: string, event?: Event): void {
    event?.stopPropagation();
    if (!tracking) return;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(tracking).then(() => {
        this.copiedTrackingId.set(tracking);
        this.toast.success(`📋 Copied tracking code ${tracking} to clipboard!`);
        setTimeout(() => this.copiedTrackingId.set(null), 2500);
      }).catch(() => this.toast.error('Clipboard unavailable. Select and copy the tracking number manually.'));
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
      this.admin.updateOrderStatus(order.id, order.status, clean, saved => {
        if (this.selectedOrder()?.id === order.id) this.selectedOrder.set(saved);
      });
    }
  }

  // ─── INVOICE & SHIPPING LABEL MODALS ──────────────────────────────────────
  openInvoice(order: AdminOrder, event?: Event): void {
    event?.stopPropagation();
    this.selectedInvoiceOrder.set(order);
  }

  closeInvoice(): void {
    this.selectedInvoiceOrder.set(null);
  }

  openShippingLabel(order: AdminOrder, event?: Event): void {
    event?.stopPropagation();
    this.shippingLabelModalOrders.set([order]);
  }

  closeShippingLabel(): void {
    this.shippingLabelModalOrders.set(null);
  }

  printShippingLabel(): void {
    const originalTitle = document.title;
    document.title = `Shipping_Labels_UrbanBlade_${new Date().toISOString().slice(0, 10)}`;
    window.print();
    setTimeout(() => {
      document.title = originalTitle;
    }, 1000);
  }

  // ─── CSV EXPORT ───────────────────────────────────────────────────────────
  exportCSV(): void {
    this.performExportCSV(this.filteredOrders(), `urbanblade_orders_${new Date().toISOString().split('T')[0]}.csv`);
  }

  private performExportCSV(orders: AdminOrder[], filename: string): void {
    const headers = ['Order_ID', 'Customer_Name', 'Phone', 'City', 'Order_Date', 'Status', 'Payment_Method', 'Total_Amount', 'Items_Count', 'Items_List', 'Tracking_AWB', 'Carrier'];
    const escapeCell = (value: string | number): string => {
      const text = String(value);
      // Spreadsheet apps execute formula-prefixed customer input unless neutralized.
      const safe = /^[\s]*[=+@-]/.test(text) ? `'${text}` : text;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const rows = orders.map((o) => [
      o.id || '', o.shipping_address?.fullName || 'Customer',
      o.shipping_address?.phone || '', o.shipping_address?.city || '',
      o.created_at || '', (o.status || '').toUpperCase(),
      (o.payment_method || '').toUpperCase(), o.total_amount || 0,
      o.items?.length || 0,
      (o.items || []).map((i) => `${i.quantity}x ${i.product_name}`).join('; '),
      o.tracking_number || '', o.carrier || 'Urban Express',
    ]);
    const csv = '\uFEFF' + [headers, ...rows].map(row => row.map(escapeCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ─── MANUAL POS MODAL ─────────────────────────────────────────────────────
  openCreateModal(): void {
    if (this.isSavingManualOrder()) return;
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
    if (this.isSavingManualOrder()) return;
    this.isCreateModalOpen.set(false);
  }

  saveManualOrder(): void {
    if (this.isSavingManualOrder()) return;
    if (!this.manualCustomerName().trim() || !this.manualCustomerPhone().trim()) {
      alert('Please provide customer name and phone number.');
      return;
    }

    const prod = this.admin.products().find((p) => p.id === this.manualProductId());
    if (!prod) {
      alert('No product selected.');
      return;
    }

    const phone = this.manualCustomerPhone().replace(/[\s()+-]/g, '');
    if (!/^(?:91)?[6-9]\d{9}$/.test(phone)) {
      this.toast.error('Enter a valid Indian mobile number, optionally prefixed with +91.');
      return;
    }
    const qty = Number(this.manualQuantity());
    if (!Number.isSafeInteger(qty) || qty < 1) {
      this.toast.error('Quantity must be a positive whole number.');
      return;
    }
    const available = prod.availableQuantity ?? prod.stock_quantity ?? prod.stockQuantity ?? 0;
    if (!prod.inStock || qty > available) {
      this.toast.error(`Only ${available} units are available. Choose another quantity or product.`);
      return;
    }
    const subtotal = prod.price * qty;

    const order: AdminOrder = {
      id: crypto.randomUUID(),
      status: 'accepted',
      subtotal,
      total_amount: subtotal,
      currency: 'INR',
      payment_method: this.manualPaymentMethod(),
      payment_status: 'captured',
      shipping_address: {
        fullName: this.manualCustomerName().trim(),
        phone: this.manualCustomerPhone().trim(),
        city: this.manualCustomerCity().trim(),
        street: this.manualCustomerStreet().trim(),
      },
      created_at: new Date().toISOString(),
      items: [
        {
          product_id: prod.id,
          product_name: prod.name,
          unit_price: prod.price,
          quantity: qty,
          image_url: prod.imageUrl,
        },
      ],
    };

    this.isSavingManualOrder.set(true);
    this.admin.addOrder(order, true, (saved) => {
      this.isSavingManualOrder.set(false);
      if (saved) this.isCreateModalOpen.set(false);
    });
  }
}
