import { Injectable, inject, signal } from '@angular/core';
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
    freeShippingThreshold: 999,
    standardShippingFee: 99,
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
  private readonly toast = inject(ToastService);
  private readonly settingsSignal = signal<SiteSettings>(this.loadSettings());

  readonly settings = this.settingsSignal.asReadonly();

  private loadSettings(): SiteSettings {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          announcement: { ...DEFAULT_SITE_SETTINGS.announcement, ...(parsed.announcement || {}) },
          business: { ...DEFAULT_SITE_SETTINGS.business, ...(parsed.business || {}) },
          ecommerce: { ...DEFAULT_SITE_SETTINGS.ecommerce, ...(parsed.ecommerce || {}) },
          operations: { ...DEFAULT_SITE_SETTINGS.operations, ...(parsed.operations || {}) },
        };
      }
    } catch {
      // ignore parsing error
    }
    return DEFAULT_SITE_SETTINGS;
  }

  saveSettings(newSettings: SiteSettings): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newSettings));
      this.settingsSignal.set(newSettings);
      this.toast.success('Live website settings updated and broadcasted.');
    } catch {
      this.toast.error('Failed to persist settings.');
    }
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
    this.toast.info('Website settings reset to factory defaults.');
  }
}
