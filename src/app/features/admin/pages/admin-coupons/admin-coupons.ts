import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { CouponService } from '@core/services/coupon.service';
import type { Coupon } from '@core/models/coupon.model';
import { ToastService } from '@core/services/toast.service';

@Component({
  selector: 'app-admin-coupons',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './admin-coupons.html',
  styleUrl: './admin-coupons.scss',
})
export class AdminCoupons implements OnInit, OnDestroy {
  readonly couponService = inject(CouponService);
  private readonly fb = inject(FormBuilder);
  private readonly toast = inject(ToastService);

  private expirationTimerId: ReturnType<typeof setInterval> | null = null;

  readonly searchQuery = signal('');
  readonly filterStatus = signal<'all' | 'active' | 'inactive' | 'expired'>('all');
  readonly showModal = signal(false);
  readonly editingCouponId = signal<string | null>(null);

  readonly couponForm = this.fb.group({
    code: ['', [Validators.required, Validators.pattern(/^[A-Za-z0-9_-]+$/)]],
    description: [''],
    discountType: ['percentage' as 'percentage' | 'fixed', Validators.required],
    discountValue: [10, [Validators.required, Validators.min(1)]],
    minOrderValue: [499, [Validators.required, Validators.min(0)]],
    maxDiscountAmount: [null as number | null],
    expiresAt: [''],
    isActive: [true],
  });

  ngOnInit(): void {
    // Check coupon expirations on load and every 30 seconds
    this.couponService.checkAndExpireCoupons();
    this.expirationTimerId = setInterval(() => {
      this.couponService.checkAndExpireCoupons();
    }, 30000);
  }

  ngOnDestroy(): void {
    if (this.expirationTimerId) {
      clearInterval(this.expirationTimerId);
      this.expirationTimerId = null;
    }
  }

  readonly filteredCoupons = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const filter = this.filterStatus();
    return this.couponService.coupons().filter((c) => {
      const matchesSearch =
        !q ||
        c.code.toLowerCase().includes(q) ||
        (c.description && c.description.toLowerCase().includes(q));

      const isExp = this.couponService.isCouponExpired(c);
      let matchesStatus = true;
      if (filter === 'active') {
        matchesStatus = c.isActive && !isExp;
      } else if (filter === 'inactive') {
        matchesStatus = !c.isActive && !isExp;
      } else if (filter === 'expired') {
        matchesStatus = isExp;
      }

      return matchesSearch && matchesStatus;
    });
  });

  readonly totalCouponsCount = computed(() => this.couponService.coupons().length);
  readonly activeCouponsCount = computed(
    () =>
      this.couponService
        .coupons()
        .filter((c) => c.isActive && !this.couponService.isCouponExpired(c)).length,
  );
  readonly expiredCouponsCount = computed(
    () => this.couponService.coupons().filter((c) => this.couponService.isCouponExpired(c)).length,
  );
  readonly totalRedemptions = computed(() =>
    this.couponService.coupons().reduce((acc, c) => acc + (c.usageCount || 0), 0),
  );

  formatForDateTimeLocal(isoString?: string): string {
    if (!isoString) return '';
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '';
    const pad = (n: number) => n.toString().padStart(2, '0');
    const year = d.getFullYear();
    const month = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    const hours = pad(d.getHours());
    const minutes = pad(d.getMinutes());
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  setDurationPreset(hours: number): void {
    const target = new Date(Date.now() + hours * 3600 * 1000);
    this.couponForm.patchValue({
      expiresAt: this.formatForDateTimeLocal(target.toISOString()),
    });
    this.toast.info(`Timeline set for ${hours >= 24 ? hours / 24 + ' day(s)' : hours + ' hour(s)'}.`);
  }

  clearExpiry(): void {
    this.couponForm.patchValue({ expiresAt: '' });
  }

  openCreateModal(): void {
    this.editingCouponId.set(null);
    this.couponForm.reset({
      code: '',
      description: '',
      discountType: 'percentage',
      discountValue: 10,
      minOrderValue: 499,
      maxDiscountAmount: null,
      expiresAt: '',
      isActive: true,
    });
    this.showModal.set(true);
  }

  openEditModal(coupon: Coupon): void {
    this.editingCouponId.set(coupon.id);
    this.couponForm.setValue({
      code: coupon.code,
      description: coupon.description || '',
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      minOrderValue: coupon.minOrderValue,
      maxDiscountAmount: coupon.maxDiscountAmount ?? null,
      expiresAt: this.formatForDateTimeLocal(coupon.expiresAt),
      isActive: coupon.isActive,
    });
    this.showModal.set(true);
  }

  closeModal(): void {
    this.showModal.set(false);
    this.editingCouponId.set(null);
  }

  saveCoupon(): void {
    if (this.couponForm.invalid) {
      this.toast.error('Please verify coupon details before saving.');
      return;
    }

    const val = this.couponForm.getRawValue();
    const code = (val.code || '').trim().toUpperCase().replace(/\s+/g, '');
    const discountType = val.discountType || 'percentage';
    const discountValue = Number(val.discountValue) || 0;
    const minOrderValue = Number(val.minOrderValue) || 0;
    const maxDiscountAmount =
      discountType === 'percentage' && val.maxDiscountAmount
        ? Number(val.maxDiscountAmount)
        : undefined;
    const expiresAt = val.expiresAt ? new Date(val.expiresAt).toISOString() : undefined;
    const isActive = Boolean(val.isActive);

    const editId = this.editingCouponId();
    if (editId) {
      this.couponService.updateCoupon(editId, {
        code,
        description: val.description || '',
        discountType,
        discountValue,
        minOrderValue,
        maxDiscountAmount,
        expiresAt,
        isActive,
      });
      this.closeModal();
    } else {
      try {
        this.couponService.addCoupon({
          code,
          description: val.description || '',
          discountType,
          discountValue,
          minOrderValue,
          maxDiscountAmount,
          expiresAt,
          isActive,
        });
        this.closeModal();
      } catch {
        // error toast already handled in service
      }
    }
  }

  toggleActive(coupon: Coupon): void {
    this.couponService.toggleCoupon(coupon.id);
  }

  deleteCoupon(coupon: Coupon): void {
    if (confirm(`Are you sure you want to delete coupon code "${coupon.code}"?`)) {
      this.couponService.deleteCoupon(coupon.id);
    }
  }

  copyCode(code: string): void {
    navigator.clipboard.writeText(code).then(() => {
      this.toast.info(`Copied code "${code}" to clipboard!`);
    });
  }

  isExpired(coupon: Coupon): boolean {
    return this.couponService.isCouponExpired(coupon);
  }

  getTimelineStatus(coupon: Coupon): {
    text: string;
    subtext: string;
    isExpired: boolean;
    isWarning: boolean;
  } {
    if (!coupon.expiresAt) {
      return {
        text: 'No Expiry (Indefinite)',
        subtext: 'Runs until manually paused',
        isExpired: false,
        isWarning: false,
      };
    }

    const expiryTime = new Date(coupon.expiresAt).getTime();
    const diff = expiryTime - Date.now();

    if (diff <= 0) {
      const expDate = new Date(coupon.expiresAt);
      const dateStr = expDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
      const timeStr = expDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return {
        text: 'EXPIRED (Auto-Disabled)',
        subtext: `Ended on ${dateStr}, ${timeStr}`,
        isExpired: true,
        isWarning: false,
      };
    }

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;

    let text = '';
    if (days > 0) {
      text = `Expires in ${days}d ${remainingHours}h`;
    } else if (hours > 0) {
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      text = `Expires in ${hours}h ${minutes}m`;
    } else {
      const minutes = Math.max(1, Math.floor(diff / (1000 * 60)));
      text = `Expires in ${minutes}m`;
    }

    const expDate = new Date(coupon.expiresAt);
    const dateStr = expDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const timeStr = expDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    return {
      text,
      subtext: `Timeline: ${dateStr}, ${timeStr}`,
      isExpired: false,
      isWarning: hours < 24,
    };
  }
}
