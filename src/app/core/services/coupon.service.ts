import { Injectable, inject, signal } from '@angular/core';
import type { Coupon, CouponValidationResult } from '@core/models/coupon.model';
import { ToastService } from './toast.service';

const STORAGE_KEY = 'urban-blade-coupons';

@Injectable({ providedIn: 'root' })
export class CouponService {
  private readonly toast = inject(ToastService);
  private readonly couponsSignal = signal<Coupon[]>(this.loadStoredCoupons());

  readonly coupons = this.couponsSignal.asReadonly();

  private loadStoredCoupons(): Coupon[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Coupon[];
        if (Array.isArray(parsed)) {
          // Remove legacy pre-seeded coupons so the admin starts with a clean slate
          const now = Date.now();
          const filtered = parsed
            .filter(
              (c) =>
                !['cp-urban10', 'cp-first100', 'cp-vip20'].includes(c.id) &&
                !['URBAN10', 'FIRST100', 'VIP20'].includes(c.code),
            )
            .map((c) => {
              // Automatically disable any coupon that has reached its expiration timeline
              if (c.expiresAt && new Date(c.expiresAt).getTime() <= now && c.isActive) {
                return { ...c, isActive: false };
              }
              return c;
            });

          if (filtered.length !== parsed.length) {
            this.persist(filtered);
          }
          return filtered;
        }
      }
    } catch {
      // ignore parsing error
    }
    return [];
  }

  private persist(coupons: Coupon[]): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(coupons));
    } catch {
      // ignore storage error
    }
  }

  isCouponExpired(coupon: Coupon): boolean {
    if (!coupon.expiresAt) return false;
    return new Date(coupon.expiresAt).getTime() <= Date.now();
  }

  checkAndExpireCoupons(): void {
    const now = Date.now();
    let hasChanged = false;
    const next = this.couponsSignal().map((c) => {
      if (c.expiresAt && c.isActive && new Date(c.expiresAt).getTime() <= now) {
        hasChanged = true;
        return { ...c, isActive: false };
      }
      return c;
    });

    if (hasChanged) {
      this.couponsSignal.set(next);
      this.persist(next);
    }
  }

  addCoupon(payload: Omit<Coupon, 'id' | 'usageCount' | 'createdAt'>): Coupon {
    const formattedCode = payload.code.trim().toUpperCase().replace(/\s+/g, '');
    const existing = this.couponsSignal().find(
      (c) => c.code.toUpperCase() === formattedCode,
    );

    if (existing) {
      this.toast.error(`Coupon code "${formattedCode}" already exists.`);
      throw new Error(`Coupon code ${formattedCode} already exists`);
    }

    const isExpired = payload.expiresAt && new Date(payload.expiresAt).getTime() <= Date.now();
    const newCoupon: Coupon = {
      ...payload,
      id: `cp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      code: formattedCode,
      isActive: isExpired ? false : payload.isActive,
      usageCount: 0,
      createdAt: new Date().toISOString(),
    };

    const next = [newCoupon, ...this.couponsSignal()];
    this.couponsSignal.set(next);
    this.persist(next);
    this.toast.success(`Coupon "${formattedCode}" created successfully.`);
    return newCoupon;
  }

  updateCoupon(id: string, updates: Partial<Coupon>): void {
    const now = Date.now();
    const next = this.couponsSignal().map((c) => {
      if (c.id === id) {
        const updated = { ...c, ...updates };
        if (updates.code) {
          updated.code = updates.code.trim().toUpperCase().replace(/\s+/g, '');
        }
        // If an updated expiration date is already in the past, disable it
        if (updated.expiresAt && new Date(updated.expiresAt).getTime() <= now) {
          updated.isActive = false;
        }
        return updated;
      }
      return c;
    });

    this.couponsSignal.set(next);
    this.persist(next);
    this.toast.success('Coupon details updated.');
  }

  toggleCoupon(id: string): void {
    const now = Date.now();
    const next = this.couponsSignal().map((c) => {
      if (c.id === id) {
        if (!c.isActive) {
          // Admin is manually reactivating the coupon
          const expired = c.expiresAt && new Date(c.expiresAt).getTime() <= now;
          if (expired) {
            // Clear past expired date so it stays active until admin sets a new deadline
            this.toast.info(
              `Coupon "${c.code}" manually reactivated. Expiry date cleared so it remains active.`,
            );
            return { ...c, isActive: true, expiresAt: undefined };
          }
          this.toast.info(`Coupon "${c.code}" is now ACTIVE.`);
          return { ...c, isActive: true };
        } else {
          this.toast.info(`Coupon "${c.code}" is now PAUSED.`);
          return { ...c, isActive: false };
        }
      }
      return c;
    });

    this.couponsSignal.set(next);
    this.persist(next);
  }

  deleteCoupon(id: string): void {
    const found = this.couponsSignal().find((c) => c.id === id);
    const next = this.couponsSignal().filter((c) => c.id !== id);
    this.couponsSignal.set(next);
    this.persist(next);
    if (found) {
      this.toast.info(`Coupon "${found.code}" deleted.`);
    }
  }

  recordUsage(code: string): void {
    const next = this.couponsSignal().map((c) => {
      if (c.code.toUpperCase() === code.trim().toUpperCase()) {
        return { ...c, usageCount: c.usageCount + 1 };
      }
      return c;
    });
    this.couponsSignal.set(next);
    this.persist(next);
  }

  validateCoupon(code: string, subtotal: number): CouponValidationResult {
    const clean = (code || '').trim().toUpperCase();
    if (!clean) {
      return { valid: false, discount: 0, reason: 'Please enter a coupon code.' };
    }

    const coupon = this.couponsSignal().find((c) => c.code === clean);
    if (!coupon) {
      return { valid: false, discount: 0, reason: `Coupon code "${clean}" is invalid or expired.` };
    }

    // Check if coupon has passed its fixed duration and expiration timeline
    if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() <= Date.now()) {
      if (coupon.isActive) {
        this.updateCoupon(coupon.id, { isActive: false });
      }
      return {
        valid: false,
        discount: 0,
        reason: `Coupon "${clean}" has expired and is no longer valid.`,
      };
    }

    if (!coupon.isActive) {
      return { valid: false, discount: 0, reason: `Coupon "${clean}" is currently inactive.` };
    }

    if (subtotal < coupon.minOrderValue) {
      return {
        valid: false,
        discount: 0,
        reason: `Minimum order amount of ₹${coupon.minOrderValue} required for coupon "${clean}".`,
        coupon,
      };
    }

    let discount = 0;
    if (coupon.discountType === 'percentage') {
      discount = Math.round((subtotal * coupon.discountValue) / 100);
      if (coupon.maxDiscountAmount && discount > coupon.maxDiscountAmount) {
        discount = coupon.maxDiscountAmount;
      }
    } else {
      discount = Math.min(coupon.discountValue, subtotal);
    }

    return {
      valid: true,
      discount,
      coupon,
    };
  }

  clearAll(): void {
    this.couponsSignal.set([]);
    this.persist([]);
    this.toast.info('All coupon codes cleared.');
  }
}
