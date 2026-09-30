import { Injectable, inject, signal, effect } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { Coupon, CouponValidationResult } from '@core/models/coupon.model';
import { ToastService } from './toast.service';
import { AccountService } from './account.service';
@Injectable({ providedIn: 'root' })
export class CouponService {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  private readonly account = inject(AccountService);
  private readonly couponsSignal = signal<Coupon[]>([]);
  readonly coupons = this.couponsSignal.asReadonly();
  constructor() { effect(() => { const admin = this.account.isAdmin(); void this.refresh(admin); }); }
  async refresh(admin = this.account.isAdmin()): Promise<void> {
    try { const result = await firstValueFrom(this.http.get<{data: Coupon[]}>(admin ? '/api/admin/coupons' : '/api/coupons')); this.couponsSignal.set(result.data); }
    catch { this.couponsSignal.set([]); }
  }
  isCouponExpired(c: Coupon): boolean { return !!c.expiresAt && new Date(c.expiresAt).getTime() <= Date.now(); }
  checkAndExpireCoupons(): void { void this.refresh(); }
  async addCoupon(payload: Omit<Coupon, 'id' | 'usageCount' | 'createdAt'>): Promise<Coupon> {
    try { const c = await firstValueFrom(this.http.post<Coupon>('/api/admin/coupons', payload)); await this.refresh(); this.toast.success('Coupon created.'); return c; }
    catch (err: any) { this.toast.error(err.error?.message || 'Coupon could not be saved.'); throw err; }
  }
  async updateCoupon(id: string, updates: Partial<Coupon>): Promise<void> {
    const existing = this.couponsSignal().find(c => c.id === id);
    if (!existing) return;
    try { await firstValueFrom(this.http.put(`/api/admin/coupons/${encodeURIComponent(id)}`, { ...existing, ...updates })); await this.refresh(); this.toast.success('Coupon updated.'); }
    catch (err: any) { this.toast.error(err.error?.message || 'Coupon could not be updated.'); throw err; }
  }
  toggleCoupon(id: string): void { const c = this.couponsSignal().find(c => c.id === id); if (c) void this.updateCoupon(id, { isActive: !c.isActive }).catch(() => {}); }
  deleteCoupon(id: string): void { this.http.delete(`/api/admin/coupons/${encodeURIComponent(id)}`).subscribe({ next: () => { void this.refresh(); }, error: () => this.toast.error('Coupon could not be deleted.') }); }
  recordUsage(_code: string): void { void this.refresh(); }
  validateCoupon(code: string, subtotal: number): CouponValidationResult {
    const c = this.couponsSignal().find(c => c.code === code.trim().toUpperCase());
    if (!c || !c.isActive || this.isCouponExpired(c) || subtotal < c.minOrderValue) return { valid: false, discount: 0, reason: 'Coupon unavailable or minimum order value not reached.' };
    return { valid: true, coupon: c, discount: Math.round(Math.min(subtotal, c.discountType === 'percentage' ? subtotal * c.discountValue / 100 : c.discountValue, c.maxDiscountAmount ?? Infinity) * 100) / 100 };
  }
  clearAll(): void { for (const c of this.couponsSignal()) this.deleteCoupon(c.id); }
}
