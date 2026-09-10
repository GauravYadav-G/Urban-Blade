import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { SiteSettingsService } from '@core/services/site-settings.service';
import { CouponService } from '@core/services/coupon.service';
import type { SiteSettings } from '@core/models/site-settings.model';
import type { Coupon } from '@core/models/coupon.model';
import { InrPipe } from '@shared/pipes/inr-pipe';

@Component({
  selector: 'app-admin-website',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, InrPipe],
  templateUrl: './admin-website.html',
  styleUrl: './admin-website.scss',
})
export class AdminWebsite {
  private readonly fb = inject(FormBuilder);
  readonly siteSettings = inject(SiteSettingsService);
  readonly couponService = inject(CouponService);

  readonly isSavedRecently = signal(false);
  readonly showCouponModal = signal(false);
  readonly editingCouponId = signal<string | null>(null);

  // Main Storefront CMS Form
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
      freeShippingEnabled: [this.siteSettings.settings().ecommerce.freeShippingEnabled ?? true],
      freeShippingThreshold: [
        this.siteSettings.settings().ecommerce.freeShippingThreshold,
        [Validators.required, Validators.min(0)],
      ],
      standardShippingFee: [
        this.siteSettings.settings().ecommerce.standardShippingFee,
        [Validators.required, Validators.min(0)],
      ],
      taxEnabled: [this.siteSettings.settings().ecommerce.taxEnabled ?? true],
      taxInclusive: [this.siteSettings.settings().ecommerce.taxInclusive ?? true],
      taxRatePercent: [
        this.siteSettings.settings().ecommerce.taxRatePercent,
        [Validators.required, Validators.min(0), Validators.max(100)],
      ],
      currency: [this.siteSettings.settings().ecommerce.currency || 'INR', Validators.required],
    }),
    operations: this.fb.group({
      chairCount: [this.siteSettings.settings().operations.chairCount, [Validators.required, Validators.min(1)]],
      acceptingOrders: [this.siteSettings.settings().operations.acceptingOrders],
      emergencyNotice: [this.siteSettings.settings().operations.emergencyNotice],
    }),
  });

  // Dedicated Coupon Code Form
  readonly couponForm = this.fb.group({
    code: ['', [Validators.required, Validators.pattern(/^[A-Za-z0-9_-]{3,20}$/)]],
    discountType: ['percentage' as 'percentage' | 'fixed', Validators.required],
    discountValue: [10, [Validators.required, Validators.min(1)]],
    minOrderValue: [499, [Validators.required, Validators.min(0)]],
    maxDiscountAmount: [200, [Validators.min(1)]],
    description: ['', [Validators.required, Validators.minLength(5)]],
    expiresAt: [''],
    isActive: [true],
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

  // ─── Coupon Management Handlers ───
  openCreateCoupon(): void {
    this.editingCouponId.set(null);
    this.couponForm.reset({
      code: '',
      discountType: 'percentage',
      discountValue: 10,
      minOrderValue: 499,
      maxDiscountAmount: 200,
      description: '',
      expiresAt: '',
      isActive: true,
    });
    this.showCouponModal.set(true);
  }

  openEditCoupon(c: Coupon): void {
    this.editingCouponId.set(c.id);
    this.couponForm.reset({
      code: c.code,
      discountType: c.discountType,
      discountValue: c.discountValue,
      minOrderValue: c.minOrderValue,
      maxDiscountAmount: c.maxDiscountAmount || null,
      description: c.description,
      expiresAt: c.expiresAt ? this.formatForDateTimeLocal(c.expiresAt) : '',
      isActive: c.isActive,
    });
    this.showCouponModal.set(true);
  }

  formatForDateTimeLocal(isoString?: string): string {
    if (!isoString) return '';
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '';
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  closeCouponModal(): void {
    this.showCouponModal.set(false);
    this.editingCouponId.set(null);
  }

  saveCoupon(): void {
    if (this.couponForm.invalid) {
      this.couponForm.markAllAsTouched();
      return;
    }

    const val = this.couponForm.getRawValue();
    const editingId = this.editingCouponId();
    const expiresAt = val.expiresAt ? new Date(val.expiresAt).toISOString() : undefined;

    if (editingId) {
      this.couponService.updateCoupon(editingId, {
        code: val.code || '',
        discountType: val.discountType as 'percentage' | 'fixed',
        discountValue: Number(val.discountValue),
        minOrderValue: Number(val.minOrderValue),
        maxDiscountAmount: val.discountType === 'percentage' && val.maxDiscountAmount ? Number(val.maxDiscountAmount) : undefined,
        description: val.description || '',
        expiresAt,
        isActive: Boolean(val.isActive),
      });
    } else {
      try {
        this.couponService.addCoupon({
          code: val.code || '',
          discountType: val.discountType as 'percentage' | 'fixed',
          discountValue: Number(val.discountValue),
          minOrderValue: Number(val.minOrderValue),
          maxDiscountAmount: val.discountType === 'percentage' && val.maxDiscountAmount ? Number(val.maxDiscountAmount) : undefined,
          description: val.description || '',
          expiresAt,
          isActive: Boolean(val.isActive),
        });
      } catch {
        return; // Error toast handled in service
      }
    }

    this.closeCouponModal();
  }

  toggleCoupon(id: string): void {
    this.couponService.toggleCoupon(id);
  }

  deleteCoupon(id: string): void {
    if (confirm('Are you sure you want to delete this coupon? This action cannot be undone.')) {
      this.couponService.deleteCoupon(id);
    }
  }

  clearAllCoupons(): void {
    if (confirm('Are you sure you want to clear all coupon codes?')) {
      this.couponService.clearAll();
    }
  }
}
