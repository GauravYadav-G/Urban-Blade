import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService, type AdminOrder } from '@core/services/admin.service';
import { AccountService } from '@core/services/account.service';
import { ToastService } from '@core/services/toast.service';

@Component({
  selector: 'app-admin-orders',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-orders.html',
  styleUrl: './admin-orders.scss',
})
export class AdminOrders implements OnInit, OnDestroy {
  readonly admin = inject(AdminService);
  readonly account = inject(AccountService);
  readonly toast = inject(ToastService);

  // Filter Signals
  readonly selectedTab = signal<string>('all');
  readonly selectedVendorFilter = signal<string>('all');
  readonly selectedPaymentFilter = signal<'all' | 'prepaid' | 'cod'>('all');
  readonly selectedTimeFilter = signal<'all' | 'today' | '7days' | 'month'>('all');
  readonly selectedUrgencyFilter = signal<'all' | 'delayed' | 'high_value'>('all');
  readonly searchQuery = signal<string>('');

  // Selection & Modal States
  readonly selectedOrder = signal<AdminOrder | null>(null);
  readonly selectedInvoiceOrder = signal<AdminOrder | null>(null);
  readonly shippingLabelModalOrders = signal<AdminOrder[] | null>(null);
  readonly copiedTrackingId = signal<string | null>(null);

  // Multi-Selection for Bulk Operations
  readonly selectedOrderIds = signal<string[]>([]);

  // Real-Time Delivery Partner Website Web Fetching
  readonly carrierSyncQuery = signal<string>('');
  readonly selectedCarrierPortal = signal<string>('auto');
  readonly isFetchingWebsite = signal<boolean>(false);
  readonly websiteTelemetryModal = signal<{ order: AdminOrder; websiteData: any } | null>(null);

  // Inspector Edits
  readonly tempCarrier = signal<string>('Urban Express Logistics');
  readonly tempNotes = signal<string>('');

  // Auto-Polling Interval (0 = Off, 15 = 15s, 30 = 30s)
  readonly autoPollSeconds = signal<number>(0);
  private pollTimer: any = null;

  // Available Carriers
  readonly carrierOptions = [
    'Urban Express Logistics',
    'BlueDart Express',
    'Delhivery Surface',
    'DTDC Air',
    'Porter Local',
  ];

  // Manual POS Order Modal State
  readonly isCreateModalOpen = signal(false);
  readonly manualCustomerName = signal('');
  readonly manualCustomerPhone = signal('');
  readonly manualCustomerCity = signal('Ghaziabad');
  readonly manualCustomerStreet = signal('Salon Walk-in / Counter POS');
  readonly manualProductId = signal('');
  readonly manualQuantity = signal(1);
  readonly manualPaymentMethod = signal<'upi' | 'cash_on_delivery' | 'card'>('upi');

  ngOnInit(): void {
    this.admin.refreshOrders();
    this.admin.refreshVendors();
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  refreshFromDb(): void {
    this.admin.refreshOrders(true);
  }

  // ─── AUTO-POLLING TELEMETRY ───────────────────────────────────────────────
  setAutoPoll(seconds: number): void {
    this.autoPollSeconds.set(seconds);
    this.stopPolling();
    if (seconds > 0) {
      this.toast.info(`⚡ Live Radar enabled: auto-syncing every ${seconds}s`);
      this.pollTimer = setInterval(() => {
        this.admin.refreshOrders(false);
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

    return {
      totalOrders: list.length,
      gmv,
      aov,
      activePipeline,
      deliveredCount,
      delayedSlaCount,
      highValueCount,
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
      if (tab === 'confirmed' || tab === 'accepted') {
        list = list.filter((o) => o.status === 'confirmed' || o.status === 'accepted' || o.status === 'pending');
      } else {
        list = list.filter((o) => o.status === tab);
      }
    }

    // 3. Payment Method Filter
    if (payFilter === 'cod') {
      list = list.filter((o) => o.payment_method === 'cash_on_delivery' || o.payment_method === 'Cash on Delivery');
    } else if (payFilter === 'prepaid') {
      list = list.filter((o) => o.payment_method !== 'cash_on_delivery' && o.payment_method !== 'Cash on Delivery');
    }

    // 4. Timeframe Filter
    if (timeFilter !== 'all') {
      const now = Date.now();
      list = list.filter((o) => {
        const t = new Date(o.created_at).getTime();
        if (isNaN(t)) return true;
        const diffHours = (now - t) / (1000 * 60 * 60);
        if (timeFilter === 'today') return diffHours <= 24;
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
    if (ids.length === 0) return;

    let advancedCount = 0;
    const orders = this.admin.orders().filter((o) => ids.includes(o.id));

    orders.forEach((order) => {
      const next = this.getNextStatus(order.status);
      if (next) {
        const generatedTracking = (next === 'shipped' || next === 'delivered') && !order.tracking_number
          ? `TRK-UB-${order.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`
          : order.tracking_number;
        this.admin.updateOrderStatus(order.id, next, generatedTracking);
        advancedCount++;
      }
    });

    this.toast.success(`⚡ Batch Operation: Advanced ${advancedCount} order(s) along the dispatch pipeline!`);
    this.clearSelection();
  }

  bulkMarkDelivered(): void {
    const ids = this.selectedOrderIds();
    if (ids.length === 0) return;

    let marked = 0;
    const orders = this.admin.orders().filter((o) => ids.includes(o.id));
    orders.forEach((o) => {
      if (o.status !== 'delivered' && o.status !== 'cancelled') {
        this.admin.updateOrderStatus(o.id, 'delivered');
        marked++;
      }
    });

    this.toast.success(`🎉 Batch Operation: Marked ${marked} order(s) as Delivered!`);
    this.clearSelection();
  }

  bulkAssignTracking(): void {
    const ids = this.selectedOrderIds();
    if (ids.length === 0) return;

    let assigned = 0;
    const orders = this.admin.orders().filter((o) => ids.includes(o.id));
    orders.forEach((o) => {
      if (!o.tracking_number) {
        const trk = `TRK-UB-${o.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
        this.admin.updateOrderStatus(o.id, o.status, trk);
        assigned++;
      }
    });

    this.toast.success(`🚚 Assigned Airway Bill (AWB) tracking codes to ${assigned} order(s)!`);
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
    if (ids.length === 0) return;
    const orders = this.admin.orders().filter((o) => ids.includes(o.id));
    this.shippingLabelModalOrders.set(orders);
  }

  // ─── REAL-TIME DELIVERY PARTNER WEBSITE WEB-FETCHING ──────────────────────
  fetchFromWebsite(explicitQuery?: string): void {
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
          this.toast.success(
            `🌐 Fetched from ${wd.carrier} website: Package is ${wd.rawPortalStatus} (${wd.currentLocation}). Order status updated to ${wd.status.toUpperCase()}!`
          );
          if (res.order) {
            this.websiteTelemetryModal.set({
              order: res.order,
              websiteData: wd,
            });
          }
          this.carrierSyncQuery.set('');
        } else {
          this.toast.info(`Consignment lookup completed for ${q}.`);
        }
      },
      error: (err) => {
        this.isFetchingWebsite.set(false);
        this.toast.error(`Carrier website fetch error: ${err.message || 'Unable to connect to portal'}`);
      },
    });
  }

  fetchSingleOrderWebsite(order: AdminOrder, event?: Event): void {
    event?.stopPropagation();
    const queryKey = order.tracking_number || order.id;
    this.isFetchingWebsite.set(true);
    this.admin.fetchCarrierWebsiteStatus(queryKey, order.carrier || 'auto').subscribe({
      next: (res) => {
        this.isFetchingWebsite.set(false);
        if (res.ok && res.websiteData) {
          const wd = res.websiteData;
          this.toast.success(
            `🌐 Verified with ${wd.carrier} website: #${order.id.slice(0, 8)} is ${wd.rawPortalStatus} @ ${wd.currentLocation}!`
          );
          this.websiteTelemetryModal.set({
            order: res.order || order,
            websiteData: wd,
          });
        }
      },
      error: () => {
        this.isFetchingWebsite.set(false);
        this.toast.error('Unable to fetch live status from carrier website.');
      },
    });
  }

  bulkFetchWebsites(): void {
    const ids = this.selectedOrderIds();
    if (ids.length === 0) return;

    this.isFetchingWebsite.set(true);
    this.admin.bulkFetchCarrierWebsites(ids).subscribe({
      next: (res) => {
        this.isFetchingWebsite.set(false);
        this.toast.success(`🌐 Successfully fetched live website statuses for ${res.updatedCount} orders!`);
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
    let url = `https://www.delhivery.com/track/package/${encodeURIComponent(awb)}`;
    if (carrier.includes('bluedart')) {
      url = `https://www.bluedart.com/tracking`;
    } else if (carrier.includes('dtdc')) {
      url = `https://www.dtdc.in/tracking/shipment-tracking.asp?trkType=awb&strCnno=${encodeURIComponent(awb)}`;
    }
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
    if (currentStatus === targetStage || currentStatus === 'cancelled' || currentStatus === 'delivered') return;
    const generatedTracking = (targetStage === 'shipped' || targetStage === 'delivered') && !order.tracking_number
      ? `TRK-UB-${order.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`
      : order.tracking_number;
    this.admin.updateOrderStatus(order.id, targetStage, generatedTracking);
    if (this.selectedOrder()?.id === order.id) {
      this.selectedOrder.update((o) => (o ? { ...o, status: targetStage, tracking_number: generatedTracking || o.tracking_number } : null));
    }
  }

  // ─── CUSTOMER COMMUNICATION & WHATSAPP ─────────────────────────────────────
  getWhatsAppUrl(order: AdminOrder): string {
    const rawPhone = (order.shipping_address?.phone || '').replace(/\D/g, '');
    const phone = rawPhone.length === 10 ? `91${rawPhone}` : rawPhone;
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
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  copyCustomerPhone(phone: string, event?: Event): void {
    event?.stopPropagation();
    if (!phone) return;
    navigator.clipboard?.writeText(phone);
    this.toast.success(`Copied customer phone: ${phone}`);
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
    });
    if (this.selectedOrder()?.id === order.id) {
      this.selectedOrder.update((o) => (o ? { ...o, carrier: this.tempCarrier(), notes: this.tempNotes() } : null));
    }
    this.toast.success(`Updated order #${order.id.slice(0, 8).toUpperCase()} logistics specifications.`);
  }

  cancelOrder(order: AdminOrder): void {
    const s = (order.status || '').toLowerCase().trim();
    if (s === 'delivered') {
      this.toast.error('Delivered orders have been fulfilled and cannot be cancelled.');
      return;
    }
    if (s === 'cancelled') {
      return;
    }
    if (confirm(`Are you sure you want to cancel Order #${order.id.slice(0, 8)}? Items will be restocked.`)) {
      this.admin.cancelOrder(order.id);
      if (this.selectedOrder()?.id === order.id) {
        this.selectedOrder.update((o) => (o ? { ...o, status: 'cancelled' } : null));
      }
    }
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

  // ─── INVOICE & SHIPPING LABEL MODALS ──────────────────────────────────────
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
    const rows = orders.map((o) => [
      o.id || '',
      `"${(o.shipping_address?.fullName || 'Customer').replace(/"/g, '""')}"`,
      o.shipping_address?.phone || '',
      o.shipping_address?.city || '',
      o.created_at || '',
      (o.status || '').toUpperCase(),
      (o.payment_method || '').toUpperCase(),
      o.total_amount || 0,
      o.items?.length || 0,
      `"${(o.items || []).map((i) => `${i.quantity}x ${i.product_name}`).join('; ').replace(/"/g, '""')}"`,
      o.tracking_number || '',
      o.carrier || 'Urban Express',
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // ─── MANUAL POS MODAL ─────────────────────────────────────────────────────
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
}
