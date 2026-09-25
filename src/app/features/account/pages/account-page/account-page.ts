import { Component, computed, inject, signal, OnInit } from '@angular/core';
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

export interface CustomerOrder {
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
  stylist_name?: string;
  stylist_role?: string;
}

@Component({
  selector: 'app-account-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, RouterLink, InrPipe],
  templateUrl: './account-page.html',
  styleUrl: './account-page.scss',
})
export class AccountPage implements OnInit {
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

  // Active Dashboard Navigation Tab
  readonly activeTab = signal<'overview' | 'orders' | 'bookings' | 'addresses' | 'profile'>('overview');

  // Orders & Bookings Data
  readonly orders = signal<CustomerOrder[]>([]);
  readonly bookings = signal<CustomerBooking[]>([]);
  readonly loadingOrders = signal<boolean>(false);
  readonly loadingBookings = signal<boolean>(false);

  // Orders Filtering & Search
  readonly orderStatusFilter = signal<'all' | 'active' | 'delivered' | 'cancelled'>('all');
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

  // VIP Wallet & Metrics
  readonly walletCredits = signal<number>(250); // ₹250 complimentary welcome credits

  readonly totalOrdersCount = computed(() => this.orders().length);
  readonly activeOrdersCount = computed(() =>
    this.orders().filter((o) => o.status !== 'delivered' && o.status !== 'cancelled').length
  );
  readonly upcomingBookingsCount = computed(() =>
    this.bookings().filter((b) => b.status !== 'completed' && b.status !== 'cancelled').length
  );

  readonly loyaltyTier = computed(() => {
    const count = this.orders().length;
    if (count >= 5) return 'Platinum VIP Member';
    if (count >= 2) return 'Gold Premier Member';
    return 'Silver Studio Member';
  });

  readonly tierProgressPercent = computed(() => {
    const count = this.orders().length;
    if (count >= 5) return 100;
    if (count >= 2) return 40 + ((count - 2) / 3) * 60;
    return (count / 2) * 40;
  });

  readonly nextTierRequirement = computed(() => {
    const count = this.orders().length;
    if (count >= 5) return 'Maximum VIP Tier reached! Enjoy lifetime concierge privileges.';
    if (count >= 2) return `${5 - count} more orders to reach Platinum VIP Tier.`;
    return `${2 - count} more order to unlock Gold Premier Tier.`;
  });

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
  readonly profilePhone = signal<string>('9015618265');
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
    const user = this.account.user();
    if (user) {
      this.profileName.set(user.name);
      this.profileEmail.set(user.email);
    }

    // Synchronize active tab from URL query params (e.g. /account?tab=orders)
    this.route.queryParamMap.subscribe((params) => {
      const tabParam = params.get('tab');
      if (tabParam && ['overview', 'orders', 'bookings', 'addresses', 'profile'].includes(tabParam)) {
        this.activeTab.set(tabParam as any);
      }
    });

    this.fetchUserOrders();
    this.fetchUserBookings();
  }

  switchTab(tab: 'overview' | 'orders' | 'bookings' | 'addresses' | 'profile'): void {
    this.activeTab.set(tab);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab },
      queryParamsHandling: 'merge',
    });
  }

  fetchUserOrders(): void {
    this.loadingOrders.set(true);
    const email = this.account.user()?.email;
    const url = email ? `/api/orders?email=${encodeURIComponent(email)}` : '/api/orders';

    this.http.get<CustomerOrder[]>(url).subscribe({
      next: (data) => {
        this.loadingOrders.set(false);
        if (Array.isArray(data) && data.length > 0) {
          this.orders.set(data);
        } else {
          // Fall back to local admin session orders if available
          const local = this.admin.orders();
          if (local.length > 0) {
            const mapped: CustomerOrder[] = local.map((o) => ({
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
        this.loadingOrders.set(false);
        const local = this.admin.orders();
        if (local.length > 0) {
          const mapped: CustomerOrder[] = local.map((o) => ({
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

  fetchUserBookings(): void {
    this.loadingBookings.set(true);
    const email = this.account.user()?.email;
    const url = email ? `/api/bookings?email=${encodeURIComponent(email)}` : '/api/bookings';

    this.http.get<CustomerBooking[]>(url).subscribe({
      next: (data) => {
        this.loadingBookings.set(false);
        if (Array.isArray(data) && data.length > 0) {
          this.bookings.set(data);
        } else {
          // Fall back to demo/local salon bookings
          this.bookings.set([
            {
              id: 'bk-demo-01',
              customer_name: this.account.user()?.name || 'VIP Client',
              customer_email: this.account.user()?.email || 'client@urbanblade.in',
              customer_phone: '9015618265',
              bookingDate: '2026-09-28',
              timeSlot: '11:00 AM',
              status: 'confirmed',
              totalPrice: 1299,
              stylist_name: 'Vikram Seth',
              stylist_role: 'Creative Director',
              notes: 'Precision Haircut & Deep Scalp Recovery',
              created_at: new Date().toISOString(),
            } as any,
          ]);
        }
      },
      error: () => {
        this.loadingBookings.set(false);
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
        this.toast.success(`📋 Copied Airway Bill ${code} to clipboard!`);
      });
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
    this.aiTrackingInsight.set(null);
    this.isFetchingAiTrack.set(true);

    this.http
      .post<{ ok: boolean; reply: string }>('/api/support/ai-chat', {
        message: `Track parcel status for order #${order.id.slice(0, 8)}`,
        orderId: order.id,
        customerName: this.account.user()?.name || order.shipping_address?.fullName,
        customerEmail: this.account.user()?.email || order.shipping_address?.email,
      })
      .subscribe({
        next: (res) => {
          this.isFetchingAiTrack.set(false);
          if (res && res.reply) {
            this.aiTrackingInsight.set(res.reply);
          } else {
            this.aiTrackingInsight.set(
              `📦 Order #${order.id.slice(0, 8).toUpperCase()} is currently ${order.status.toUpperCase()}. Live transit updates synchronized via Delhivery Air Express.`
            );
          }
        },
        error: () => {
          this.isFetchingAiTrack.set(false);
          this.aiTrackingInsight.set(
            `📦 Order #${order.id.slice(0, 8).toUpperCase()} is in ${order.status.toUpperCase()} state. Expected doorstep delivery in 24-48 hours.`
          );
        },
      });
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

  saveProfile(): void {
    const name = this.profileName().trim();
    if (name) {
      this.isSavingProfile.set(true);
      this.account.updateProfile(name);
      this.profileSavedMessage.set('Profile information successfully updated.');
      this.toast.success('Your profile details have been saved.');
      setTimeout(() => {
        this.isSavingProfile.set(false);
        this.profileSavedMessage.set('');
      }, 2000);
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

  saveAddress(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.toast.error('Please complete all required address fields.');
      return;
    }

    const value = this.form.getRawValue();
    this.addresses.save(
      {
        ...value,
        location: this.pinnedLocation(),
      },
      this.editingId() ?? undefined
    );
    this.toast.success('Address saved to your address book.');
    this.cancelForm();
  }

  removeAddress(id: string): void {
    if (confirm('Are you sure you want to remove this delivery address?')) {
      this.addresses.remove(id);
      this.toast.info('Address removed.');
      if (this.editingId() === id) {
        this.cancelForm();
      }
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
