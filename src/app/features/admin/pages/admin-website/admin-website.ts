import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { SiteSettingsService } from '@core/services/site-settings.service';
import type { SiteSettings } from '@core/models/site-settings.model';

@Component({
  selector: 'app-admin-website',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './admin-website.html',
  styleUrl: './admin-website.scss',
})
export class AdminWebsite {
  private readonly fb = inject(FormBuilder);
  readonly siteSettings = inject(SiteSettingsService);

  readonly isSavedRecently = signal(false);

  // Form initialized from current persistent reactive site settings
  readonly form = this.fb.group({
    announcement: this.fb.group({
      enabled: [this.siteSettings.settings().announcement.enabled],
      badge: [this.siteSettings.settings().announcement.badge, Validators.required],
      text: [this.siteSettings.settings().announcement.text, Validators.required],
      linkText: [this.siteSettings.settings().announcement.linkText],
      linkUrl: [this.siteSettings.settings().announcement.linkUrl],
    }),
    business: this.fb.group({
      name: [this.siteSettings.settings().business.name, Validators.required],
      tagline: [this.siteSettings.settings().business.tagline],
      phoneDisplay: [this.siteSettings.settings().business.phoneDisplay, Validators.required],
      phoneTel: [this.siteSettings.settings().business.phoneTel, Validators.required],
      email: [this.siteSettings.settings().business.email, [Validators.required, Validators.email]],
      address: [this.siteSettings.settings().business.address, Validators.required],
      city: [this.siteSettings.settings().business.city, Validators.required],
      pin: [this.siteSettings.settings().business.pin, Validators.required],
      hours: [this.siteSettings.settings().business.hours, Validators.required],
      mapsUrl: [this.siteSettings.settings().business.mapsUrl],
    }),
    ecommerce: this.fb.group({
      freeShippingThreshold: [this.siteSettings.settings().ecommerce.freeShippingThreshold, [Validators.required, Validators.min(0)]],
      standardShippingFee: [this.siteSettings.settings().ecommerce.standardShippingFee, [Validators.required, Validators.min(0)]],
      taxRatePercent: [this.siteSettings.settings().ecommerce.taxRatePercent, [Validators.required, Validators.min(0)]],
      currency: [this.siteSettings.settings().ecommerce.currency, Validators.required],
    }),
    operations: this.fb.group({
      chairCount: [this.siteSettings.settings().operations.chairCount, [Validators.required, Validators.min(1)]],
      acceptingOrders: [this.siteSettings.settings().operations.acceptingOrders],
      emergencyNotice: [this.siteSettings.settings().operations.emergencyNotice],
    }),
  });

  onSave(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue() as SiteSettings;
    this.siteSettings.saveSettings(value);
    this.isSavedRecently.set(true);
    setTimeout(() => this.isSavedRecently.set(false), 3000);
  }

  onReset(): void {
    if (confirm('Reset all website configuration back to initial defaults?')) {
      this.siteSettings.resetToDefaults();
      const current = this.siteSettings.settings();
      this.form.patchValue(current);
    }
  }
}
