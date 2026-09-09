import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { DEFAULT_MAP_CENTER, INDIA_STATES } from '@core/constants/india.constants';
import type { MapLocation, SavedAddress } from '@core/models/address.model';
import { AccountService } from '@core/services/account.service';
import { AddressService } from '@core/services/address.service';

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

@Component({
  selector: 'app-account-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './account-page.html',
  styleUrl: './account-page.scss',
})
export class AccountPage {
  protected readonly account = inject(AccountService);
  protected readonly addresses = inject(AddressService);
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly sanitizer = inject(DomSanitizer);

  protected readonly states = INDIA_STATES;
  protected readonly initials = computed(() => {
    const parts = (this.account.user()?.name ?? '').split(/\s+/).filter(Boolean);
    return parts
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || 'U';
  });
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

  protected readonly mapEmbedUrl = computed<SafeResourceUrl>(() => {
    const pin = this.pinnedLocation();
    const lat = pin?.lat ?? DEFAULT_MAP_CENTER.lat;
    const lng = pin?.lng ?? DEFAULT_MAP_CENTER.lng;
    const delta = 0.012;
    const url = `https://www.openstreetmap.org/export/embed.html?bbox=${lng - delta},${lat - delta},${lng + delta},${lat + delta}&layer=mapnik&marker=${lat},${lng}`;
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  });

  signOut(): void {
    this.account.signOut();
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
      isDefault: this.addresses.addresses().length === 0,
    });
    this.showForm.set(true);
  }

  startEdit(address: SavedAddress): void {
    this.editingId.set(address.id);
    this.pinnedLocation.set(address.location);
    this.locationQuery.set(address.location?.label ?? '');
    this.mapMessage.set('');
    this.mapOpen.set(Boolean(address.location));
    this.form.reset({
      fullName: address.fullName,
      mobile: address.mobile,
      house: address.house,
      street: address.street,
      landmark: address.landmark,
      pinCode: address.pinCode,
      city: address.city,
      state: address.state,
      isDefault: address.isDefault,
    });
    this.showForm.set(true);
  }

  cancelForm(): void {
    this.showForm.set(false);
    this.mapOpen.set(false);
    this.editingId.set(null);
    this.pinnedLocation.set(null);
    this.mapMessage.set('');
  }

  toggleMap(): void {
    this.mapOpen.update((open) => !open);
  }

  onLocationInput(event: Event): void {
    this.locationQuery.set((event.target as HTMLInputElement).value);
  }

  clearPin(): void {
    this.pinnedLocation.set(null);
    this.locationQuery.set('');
    this.mapMessage.set('Map pin removed.');
  }

  saveAddress(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    this.addresses.save(
      {
        ...value,
        location: this.pinnedLocation(),
      },
      this.editingId() ?? undefined,
    );
    this.cancelForm();
  }

  removeAddress(id: string): void {
    this.addresses.remove(id);
    if (this.editingId() === id) {
      this.cancelForm();
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
