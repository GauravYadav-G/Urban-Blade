import { DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval, finalize } from 'rxjs';
import { canRequestOrderReturn, type OrderReturnDetails } from '@core/models/order-return.model';
import { ReturnsService } from '@core/services/returns.service';
import { OrderReturnStatusComponent } from '@shared/components/order-return-status/order-return-status';
import { AdminDialog } from '@shared/directives/admin-dialog';
import type { TrackedOrder } from '@core/models/shipment-tracking.model';
import { ShipmentTrackingComponent } from '@shared/components/shipment-tracking/shipment-tracking';
import { Component, computed, inject, signal, OnInit, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, FormsModule, Validators } from '@angular/forms';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { DEFAULT_MAP_CENTER, INDIA_STATES } from '@core/constants/india.constants';
import type { MapLocation, SavedAddress } from '@core/models/address.model';
import { AccountService } from '@core/services/account.service';
import { AddressService } from '@core/services/address.service';
import { AdminService } from '@core/services/admin.service';
import { CartService } from '@core/services/cart.service';
import { CatalogService } from '@core/services/catalog.service';
import { ToastService } from '@core/services/toast.service';
import { InrPipe } from '@shared/pipes/inr-pipe';
import { OrderInvoice } from '@shared/components/order-invoice/order-invoice';

type AccountTab = 'overview' | 'orders' | 'bookings' | 'addresses' | 'profile';
const ACCOUNT_TABS: readonly AccountTab[] = ['overview', 'orders', 'bookings', 'addresses', 'profile'];

interface NominatimSearchHit {
  lat: string;
  lon: string;
  display_name: string;
}

interface NominatimReverseHit {
  display_name?: string;
  address?: {
    house_number?: string;
    road?: string;
    pedestrian?: string;
    neighbourhood?: string;
    suburb?: string;
    village?: string;
    hamlet?: string;
    sector?: string;
    city?: string;
    town?: string;
    county?: string;
    state?: string;
    postcode?: string;
  };
}

export interface CustomerOrder extends TrackedOrder, OrderReturnDetails {
  id: string;
  status: 'pending' | 'accepted' | 'confirmed' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
  subtotal: number;
  total_amount: number;
  discount_amount?: number;
  shipping_fee?: number;
  tax_amount?: number;
  tax_rate_percent?: number;
  tax_inclusive?: boolean;
  transaction_id?: string;
  coupon_code?: string;
  tracking_number?: string;
  currency: string;
  payment_method: string;
  payment_status: string;
  created_at: string;
  shipping_address?: {
    city?: string;
    state?: string;
    pinCode?: string;
    fullName?: string;
    phone?: string;
    street?: string;
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

export interface CustomerBooking {
  stylist_name?: string | null;
  id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  booking_date: string;
  time_slot: string;
  status: 'confirmed' | 'completed' | 'cancelled';
  total_price: number;
  notes?: string;
  created_at: string;
  visit_type?: 'salon' | 'home';
  service_address?: string | null;
}

@Component({
  selector: 'app-account-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, RouterLink, InrPipe, OrderInvoice, ShipmentTrackingComponent, OrderReturnStatusComponent, AdminDialog],
  templateUrl: './account-page.html',
  styleUrl: './account-page.scss',
})
export class AccountPage implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private fetchingOrders = false;
  protected readonly account = inject(AccountService);
  protected readonly addresses = inject(AddressService);
  private readonly admin = inject(AdminService);
  private readonly cart = inject(CartService);
  private readonly catalog = inject(CatalogService);
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  private readonly returnsService = inject(ReturnsService);

  constructor() {
    let returnIdentity = this.account.user();
    effect(() => {
      const user = this.account.user();
      if (user !== returnIdentity) {
        returnIdentity = user;
        this.returnOrder.set(null);
        this.returnError.set('');
        this.requestingReturn.set(null);
        this.returnForm.reset({ category: '', details: '', acknowledged: false });
      }
      if (user) {
        if (!this.profileName()) this.profileName.set(user.name);
        if (!this.profileEmail()) this.profileEmail.set(user.email);
        if (!this.profilePhone()) {
          const defaultAddrMobile = this.addresses.addresses().find((a) => a.isDefault)?.mobile;
          if (user.phone) {
            this.profilePhone.set(user.phone);
          } else if (defaultAddrMobile) {
            this.profilePhone.set(defaultAddrMobile);
          }
        }
      }
    });
  }

  // Active Dashboard Navigation Tab
  readonly activeTab = signal<AccountTab>('profile');

  readonly accountNavigation: readonly { tab: AccountTab; label: string; icon: string }[] = [
    { tab: 'profile', label: 'Account details', icon: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0' },
    { tab: 'overview', label: 'Overview', icon: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z' },
    { tab: 'orders', label: 'Orders & receipts', icon: 'M6 3h12l3 4v14H3V7l3-4M3 7h18M8 11a4 4 0 0 0 8 0' },
    { tab: 'bookings', label: 'Appointments', icon: 'M3 5h18v16H3zM3 10h18M8 2v6M16 2v6' },
    { tab: 'addresses', label: 'Address book', icon: 'M21 10c0 7-9 12-9 12S3 17 3 10a9 9 0 0 1 18 0M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0' },
  ];
  readonly sectionTitle = computed(() => ({
    overview: 'Welcome back.', orders: 'Your orders', bookings: 'Your appointments',
    addresses: 'Address book', profile: 'Account details',
  })[this.activeTab()]);
  readonly sectionDescription = computed(() => ({
    overview: 'A little overview of everything you have with us.',
    orders: 'Follow deliveries, view receipts, and request or track a product return.',
    bookings: 'Make time for yourself. Keep your next visit in view.',
    addresses: 'Keep your delivery details ready for next time.',
    profile: 'Manage your Urban Blade profile.',
  })[this.activeTab()]);

  // Orders & Bookings Data
  readonly orders = signal<CustomerOrder[]>([]);
  readonly bookings = signal<CustomerBooking[]>([]);
  readonly loadingOrders = signal<boolean>(false);
  readonly loadingBookings = signal<boolean>(false);
  readonly ordersError = signal('');
  readonly bookingsError = signal('');

  // Orders Filtering & Search
  readonly orderStatusFilter = signal<'all' | 'active' | 'delivered' | 'cancelled' | 'returns'>('all');
  readonly orderSearchQuery = signal<string>('');

  readonly filteredOrders = computed(() => {
    let list = this.orders();
    const filter = this.orderStatusFilter();
    const q = this.orderSearchQuery().trim().toLowerCase();

    if (filter === 'active') {
      list = list.filter((o) => o.status !== 'delivered' && o.status !== 'cancelled');
    } else if (filter === 'delivered') {
      list = list.filter((o) => o.status === 'delivered');
    } else if (filter === 'cancelled') {
      list = list.filter((o) => o.status === 'cancelled');
    } else if (filter === 'returns') {
      list = list.filter((o) => Boolean(o.return_status || o.refund_status));
    }

    if (q) {
      list = list.filter(
        (o) =>
          o.id.toLowerCase().includes(q) ||
          (o.tracking_number && o.tracking_number.toLowerCase().includes(q)) ||
          (o.shipping_address?.fullName && o.shipping_address.fullName.toLowerCase().includes(q)) ||
          o.items.some((i) => i.product_name.toLowerCase().includes(q))
      );
    }

    return list;
  });

  // AI Order Tracking Modal State
  readonly trackingModalOpen = signal<boolean>(false);
  readonly activeTrackingOrder = signal<CustomerOrder | null>(null);
  readonly aiTrackingInsight = signal<string | null>(null);
  readonly isFetchingAiTrack = signal<boolean>(false);
  readonly isSavingProfile = signal<boolean>(false);

  // Invoice Modal State
  readonly selectedInvoiceOrder = signal<CustomerOrder | null>(null);

  readonly totalOrdersCount = computed(() => this.orders().length);
  readonly activeOrdersCount = computed(() =>
    this.orders().filter((o) => o.status !== 'delivered' && o.status !== 'cancelled').length
  );
  readonly upcomingBookings = computed(() => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    return this.bookings()
      .filter(booking => booking.status === 'confirmed' && booking.booking_date.slice(0, 10) >= today)
      .slice().sort((a, b) => a.booking_date.localeCompare(b.booking_date) || a.time_slot.localeCompare(b.time_slot));
  });
  readonly upcomingBookingsCount = computed(() => this.upcomingBookings().length);



  protected readonly states = INDIA_STATES;
  protected readonly initials = computed(() => {
    const parts = (this.account.user()?.name ?? '').split(/\s+/).filter(Boolean);
    return (
      parts
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() ?? '')
        .join('') || 'U'
    );
  });

  // Address Form State
  protected readonly showForm = signal(false);
  protected readonly mapOpen = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly pinnedLocation = signal<MapLocation | null>(null);
  protected readonly locationQuery = signal('');
  protected readonly mapStatus = signal<'idle' | 'locating' | 'searching'>('idle');
  protected readonly mapMessage = signal('');

  protected readonly form = this.fb.nonNullable.group({
    fullName: ['', [Validators.required, Validators.minLength(2)]],
    mobile: ['', [Validators.required, Validators.pattern(/^[6-9]\d{9}$/)]],
    house: ['', Validators.required],
    street: ['', Validators.required],
    landmark: [''],
    pinCode: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
    city: ['', Validators.required],
    state: ['', Validators.required],
    isDefault: [false],
  });

  // Profile Form State
  readonly profileName = signal<string>('');
  readonly profileEmail = signal<string>('');
  readonly profilePhone = signal<string>('');
  readonly profileSavedMessage = signal<string>('');

  protected readonly mapEmbedUrl = computed<SafeResourceUrl>(() => {
    const pin = this.pinnedLocation();
    const lat = pin?.lat ?? DEFAULT_MAP_CENTER.lat;
    const lng = pin?.lng ?? DEFAULT_MAP_CENTER.lng;
    const delta = 0.012;
    const url = `https://www.openstreetmap.org/export/embed.html?bbox=${lng - delta},${lat - delta},${lng + delta},${lat + delta}&layer=mapnik&marker=${lat},${lng}`;
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  });

  ngOnInit(): void {
    void this.addresses.load(true);
    const user = this.account.user();
    if (user) {
      this.profileName.set(user.name);
      this.profileEmail.set(user.email);
      const defaultAddrMobile = this.addresses.addresses().find((a) => a.isDefault)?.mobile;
      this.profilePhone.set(user.phone || defaultAddrMobile || '');
    }

    // Synchronize active tab from URL query params (e.g. /account?tab=orders)
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const tabParam = params.get('tab');
      const tab = ACCOUNT_TABS.find(tab => tab === tabParam) ?? 'profile';
      this.activeTab.set(tab);
    });

    this.fetchUserOrders();
    this.fetchUserBookings();
    interval(15_000).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (typeof document !== 'undefined' && !document.hidden) this.fetchUserOrders(true);
    });
  }

  switchTab(tab: 'overview' | 'orders' | 'bookings' | 'addresses' | 'profile'): void {
    this.activeTab.set(tab);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab },
      queryParamsHandling: 'merge',
    });
  }

  fetchUserOrders(background = false): void {
    if (this.fetchingOrders) return;
    this.fetchingOrders = true;
    if (!background) { this.loadingOrders.set(true); this.ordersError.set(''); }
    const identity = this.account.user();
    const email = this.account.user()?.email;
    const url = email ? `/api/orders?email=${encodeURIComponent(email)}` : '/api/orders';

    this.http.get<CustomerOrder[]>(url).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        this.fetchingOrders = false;
        this.loadingOrders.set(false);
        if (identity !== this.account.user()) return;
        // An empty response is authoritative. Never replace it with the shared
        // admin cache, which contains orders belonging to other customers.
        this.ordersError.set('');
        this.orders.set(Array.isArray(data) ? data : []);
        const activeId = this.activeTrackingOrder()?.id;
        if (activeId) this.activeTrackingOrder.set(this.orders().find(order => order.id === activeId) || null);
      },
      error: () => {
        this.fetchingOrders = false;
        this.loadingOrders.set(false);
        if (identity !== this.account.user()) return;
        this.ordersError.set('Your orders could not be loaded. Please try again.');
        if (!background) this.toast.error('Orders could not be loaded. Please retry.');
      },
    });
  }

  readonly requestingReturn = signal<string | null>(null);
  readonly returnOrder = signal<CustomerOrder | null>(null);
  readonly returnError = signal('');
  readonly returnReasons = ['Damaged or defective product', 'Wrong product delivered', 'Missing or incorrect items', 'Product quality concern', 'Other reason'];
  readonly returnForm = this.fb.nonNullable.group({
    category: ['', Validators.required],
    details: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(400)]],
    acknowledged: [false, Validators.requiredTrue],
  });

  canRequestReturn(order: CustomerOrder): boolean { return canRequestOrderReturn(order); }

  requestReturn(order: CustomerOrder): void {
    if (this.requestingReturn() || !this.canRequestReturn(order)) return;
    this.returnOrder.set(order);
    this.returnError.set('');
    this.returnForm.reset({ category: '', details: '', acknowledged: false });
  }

  closeReturn(): void {
    if (this.requestingReturn()) return;
    this.returnOrder.set(null);
    this.returnError.set('');
  }

  submitReturn(): void {
    const order = this.returnOrder();
    if (!order || this.requestingReturn()) return;
    const { category, details } = this.returnForm.getRawValue();
    if (this.returnForm.invalid || details.trim().length < 3 || !this.returnReasons.includes(category)) {
      this.returnForm.markAllAsTouched();
      this.returnError.set('Choose a reason, describe the issue in at least 3 characters, and confirm the full-order return.');
      return;
    }
    const reason = `${category}: ${details.trim()}`;
    const identity = this.account.user();
    this.returnError.set('');
    this.requestingReturn.set(order.id);
    this.returnsService.request(order.id, reason).pipe(takeUntilDestroyed(this.destroyRef), finalize(() => {
      if (identity === this.account.user() && this.requestingReturn() === order.id) this.requestingReturn.set(null);
    })).subscribe({
      next: response => {
        if (identity !== this.account.user()) return;
        if (!response?.ok || !response.order?.id) {
          this.returnError.set('The return request was not confirmed. Refresh your orders before retrying.');
          return;
        }
        this.orders.update(orders => orders.map(current => current.id === order.id ? { ...current, ...response.order } : current));
        this.returnOrder.set(null);
        this.fetchUserOrders(true);
        this.toast.success('Return requested. Track the review and refund progress in your orders.');
      },
      error: error => {
        if (identity !== this.account.user()) return;
        this.returnError.set(error.error?.message || 'Your return could not be requested. Check your connection and try again.');
      },
    });
  }

  fetchUserBookings(): void {
    this.loadingBookings.set(true);
    this.bookingsError.set('');
    const identity = this.account.user();
    const email = this.account.user()?.email;
    const url = email ? `/api/bookings?email=${encodeURIComponent(email)}` : '/api/bookings';

    this.http.get<CustomerBooking[]>(url).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        this.loadingBookings.set(false);
        if (identity !== this.account.user()) return;
        this.bookings.set(Array.isArray(data) ? data : []);
      },
      error: () => {
        this.loadingBookings.set(false);
        if (identity !== this.account.user()) return;
        this.bookingsError.set('Your appointments could not be loaded. Please try again.');
      },
    });
  }

  getStageIndex(status?: string | null): number {
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

  isStageCompleted(status?: string | null, stage: number = 0): boolean {
    return this.getStageIndex(status) > stage;
  }

  isStageCurrent(status?: string | null, stage: number = 0): boolean {
    return this.getStageIndex(status) === stage;
  }

  copyTracking(code?: string, event?: Event): void {
    event?.stopPropagation();
    if (!code) return;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(code).then(() => {
        this.toast.success(`Tracking number ${code} copied.`);
      }).catch(() => this.toast.error('Clipboard unavailable. Please copy the tracking number manually.'));
    } else {
      this.toast.info(`Airway Bill: ${code}`);
    }
  }

  reorderItems(order: CustomerOrder, event?: Event): void {
    event?.stopPropagation();
    let addedCount = 0;
    for (const it of order.items) {
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
      this.toast.success(`Added ${addedCount} item(s) from Order #${order.id.slice(0, 8)} to your cart.`);
      void this.router.navigate(['/cart']);
    } else {
      this.toast.info('Viewing product catalog to replenish items.');
      void this.router.navigate(['/shop']);
    }
  }

  trackWithAi(order: CustomerOrder): void {
    this.activeTrackingOrder.set(order);
    this.trackingModalOpen.set(true);
    this.fetchUserOrders(true);
  }

  closeTrackingModal(): void {
    this.trackingModalOpen.set(false);
    this.activeTrackingOrder.set(null);
    this.aiTrackingInsight.set(null);
  }

  openInvoice(order: CustomerOrder, event?: Event): void {
    event?.stopPropagation();
    this.selectedInvoiceOrder.set(order);
  }

  closeInvoice(): void {
    this.selectedInvoiceOrder.set(null);
  }

  async saveProfile(): Promise<void> {
    if (this.isSavingProfile()) return;
    this.profileSavedMessage.set('');
    const name = this.profileName().trim();
    const phone = this.profilePhone().trim();
    if (!name) {
      this.toast.error('Name cannot be empty.');
      return;
    }
    if (phone && !/^[6-9]\d{9}$/.test(phone)) {
      this.toast.error('Enter a valid 10-digit Indian mobile number.');
      return;
    }
    this.isSavingProfile.set(true);
    try {
      await this.account.updateProfile({ name, phone });
      this.profileSavedMessage.set('Profile information successfully updated.');
      this.toast.success('Your profile details have been saved.');
    } catch {
      this.profileSavedMessage.set('');
      this.toast.error('Profile update failed. Please retry.');
    } finally {
      this.isSavingProfile.set(false);
      setTimeout(() => {
        this.profileSavedMessage.set('');
      }, 2500);
    }
  }

  signOut(): void {
    this.account.signOut();
    this.toast.info('Signed out of account.');
    void this.router.navigate(['/']);
  }

  startAdd(): void {
    this.editingId.set(null);
    this.pinnedLocation.set(null);
    this.locationQuery.set('');
    this.mapMessage.set('');
    this.mapOpen.set(true);
    this.form.reset({
      fullName: this.account.user()?.name ?? '',
      mobile: '',
      house: '',
      street: '',
      landmark: '',
      pinCode: '',
      city: '',
      state: '',
      isDefault: false,
    });
    this.showForm.set(true);
  }

  startEdit(address: SavedAddress): void {
    this.editingId.set(address.id);
    this.pinnedLocation.set(address.location ?? null);
    this.locationQuery.set(address.location?.label ?? '');
    this.mapMessage.set(address.location ? 'Saved pin loaded.' : '');
    this.mapOpen.set(false);
    this.form.reset({
      fullName: address.fullName,
      mobile: address.mobile,
      house: address.house,
      street: address.street,
      landmark: address.landmark ?? '',
      pinCode: address.pinCode,
      city: address.city,
      state: address.state,
      isDefault: address.isDefault,
    });
    this.showForm.set(true);
  }

  cancelForm(): void {
    this.showForm.set(false);
    this.editingId.set(null);
    this.pinnedLocation.set(null);
    this.mapOpen.set(false);
    this.form.reset();
  }

  async saveAddress(): Promise<void> {
    if (this.addresses.saving()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.toast.error('Please complete all required address fields.');
      return;
    }

    const value = this.form.getRawValue();
    try {
      await this.addresses.save({ ...value, location: this.pinnedLocation() }, this.editingId() ?? undefined);
      this.toast.success('Address saved to your account.');
      this.cancelForm();
    } catch {
      this.toast.error('Your address could not be saved. Please retry.');
    }
  }

  async removeAddress(id: string): Promise<void> {
    if (this.addresses.saving()) return;
    if (!confirm('Remove this delivery address from your account?')) return;
    try {
      await this.addresses.remove(id);
      this.toast.info('Address removed.');
      if (this.editingId() === id) this.cancelForm();
    } catch {
      this.toast.error('Address could not be removed. Please retry.');
    }
  }

  async makeDefaultAddress(id: string): Promise<void> {
    if (this.addresses.saving()) return;
    try {
      await this.addresses.setDefault(id);
      this.toast.success('Default address updated.');
    } catch {
      this.toast.error('Default address could not be updated. Please retry.');
    }
  }

  async useCurrentLocation(): Promise<void> {
    if (!navigator.geolocation) {
      this.mapMessage.set('Location is not supported in this browser.');
      return;
    }

    this.mapOpen.set(true);
    this.mapStatus.set('locating');
    this.mapMessage.set('');

    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 12000,
        });
      });
      await this.applyCoordinates(position.coords.latitude, position.coords.longitude);
    } catch {
      this.mapMessage.set('Could not read your location. Allow location access or search instead.');
    } finally {
      this.mapStatus.set('idle');
    }
  }

  async searchLocation(): Promise<void> {
    const query = this.locationQuery().trim();
    if (!query) {
      this.mapMessage.set('Enter an area, landmark, or city to search.');
      return;
    }

    this.mapOpen.set(true);
    this.mapStatus.set('searching');
    this.mapMessage.set('');

    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=in&q=${encodeURIComponent(query)}`;
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      const results = (await response.json()) as NominatimSearchHit[];
      const hit = results[0];
      if (!hit) {
        this.mapMessage.set('No matching place found. Try a nearby landmark or pin code.');
        return;
      }
      await this.applyCoordinates(Number(hit.lat), Number(hit.lon), hit.display_name);
    } catch {
      this.mapMessage.set('Map search is unavailable right now. Try again in a moment.');
    } finally {
      this.mapStatus.set('idle');
    }
  }

  private async applyCoordinates(lat: number, lng: number, fallbackLabel?: string): Promise<void> {
    const details = await this.reverseGeocode(lat, lng);
    const label = details?.display_name || fallbackLabel || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    this.pinnedLocation.set({ lat, lng, label });
    this.locationQuery.set(label);
    this.mapMessage.set('Location pinned on the map.');
    this.fillFromGeo(details);
  }

  private async reverseGeocode(lat: number, lng: number): Promise<NominatimReverseHit | null> {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      return (await response.json()) as NominatimReverseHit;
    } catch {
      return null;
    }
  }

  private fillFromGeo(details: NominatimReverseHit | null): void {
    const place = details?.address;
    if (!place) {
      return;
    }

    const street = [
      place.road || place.pedestrian,
      place.suburb || place.neighbourhood || place.sector,
      place.village || place.hamlet,
    ]
      .filter(Boolean)
      .join(', ');
    if (place.house_number && !this.form.controls.house.value) {
      this.form.controls.house.setValue(place.house_number);
    }
    const city = place.city || place.town || place.village || place.county || '';
    const matchedState = INDIA_STATES.find((state) => state.toLowerCase() === (place.state ?? '').toLowerCase()) ?? '';

    if (street && !this.form.controls.street.value) {
      this.form.controls.street.setValue(street);
    }
    if (place.postcode && !this.form.controls.pinCode.value) {
      this.form.controls.pinCode.setValue(place.postcode.replace(/\s/g, '').slice(0, 6));
    }
    if (city && !this.form.controls.city.value) {
      this.form.controls.city.setValue(city);
    }
    if (matchedState && !this.form.controls.state.value) {
      this.form.controls.state.setValue(matchedState);
    }
  }
}
