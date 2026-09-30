import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { SALON } from '@core/constants/salon.constants';
import type { SiteSettings } from '@core/models/site-settings.model';
import { ToastService } from './toast.service';

const STORAGE_KEY = 'urban-blade-site-settings';

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  announcement: {
    enabled: true,
    badge: 'OFFICIAL',
    text: '⚡ Urban Blade Master Studio: Experience Delhi NCR’s Finest Grooming & Premium Hair Care',
    linkText: 'Book Chair',
    linkUrl: '/book',
  },
  business: {
    name: SALON.name,
    tagline: SALON.tagline,
    phoneDisplay: SALON.phoneDisplay,
    phoneTel: SALON.phoneTel,
    email: SALON.email,
    address: SALON.address,
    city: SALON.city,
    pin: SALON.pin,
    hours: SALON.hours,
    mapsUrl: SALON.mapsUrl,
  },
  ecommerce: {
    freeShippingEnabled: true,
    freeShippingThreshold: 999,
    standardShippingFee: 99,
    taxEnabled: true,
    taxInclusive: true,
    taxRatePercent: 18,
    currency: 'INR',
  },
  operations: {
    chairCount: 6,
    acceptingOrders: true,
    emergencyNotice: '',
  },
};

@Injectable({ providedIn: 'root' })
export class SiteSettingsService {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  private readonly settingsSignal = signal<SiteSettings>(DEFAULT_SITE_SETTINGS);

  readonly settings = this.settingsSignal.asReadonly();

  constructor() {
    this.http.get<Partial<SiteSettings>>('/api/settings').subscribe({ next: data => this.apply(data), error: () => {} });
  }
  private apply(data: Partial<SiteSettings>): void {
    this.settingsSignal.set({
      announcement: { ...DEFAULT_SITE_SETTINGS.announcement, ...data.announcement },
      business: { ...DEFAULT_SITE_SETTINGS.business, ...data.business },
      ecommerce: { ...DEFAULT_SITE_SETTINGS.ecommerce, ...data.ecommerce },
      operations: { ...DEFAULT_SITE_SETTINGS.operations, ...data.operations },
    });
  }
  saveSettings(newSettings: SiteSettings): void {
    this.http.put<SiteSettings>('/api/settings', newSettings).subscribe({
      next: data => { this.apply(data); this.toast.success('Website settings saved.'); },
      error: () => this.toast.error('Settings could not be saved. Please retry.'),
    });
  }

  updatePartial(partial: Partial<SiteSettings>): void {
    const current = this.settingsSignal();
    const updated: SiteSettings = {
      announcement: { ...current.announcement, ...(partial.announcement || {}) },
      business: { ...current.business, ...(partial.business || {}) },
      ecommerce: { ...current.ecommerce, ...(partial.ecommerce || {}) },
      operations: { ...current.operations, ...(partial.operations || {}) },
    };
    this.saveSettings(updated);
  }

  resetToDefaults(): void {
    this.saveSettings(DEFAULT_SITE_SETTINGS);

  }
}
