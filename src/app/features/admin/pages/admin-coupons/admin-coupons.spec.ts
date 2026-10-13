import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AdminCoupons } from './admin-coupons';
import { CouponService } from '@core/services/coupon.service';
import { ToastService } from '@core/services/toast.service';

describe('Admin coupon form scenarios', () => {
  let page: AdminCoupons;
  let add: jasmine.Spy;
  beforeEach(() => {
    add = jasmine.createSpy('addCoupon').and.resolveTo({});
    TestBed.configureTestingModule({ providers: [
      { provide: CouponService, useValue: { coupons: signal([]), addCoupon: add, isCouponExpired: () => false } },
      { provide: ToastService, useValue: { error() {}, info() {} } },
    ] });
    page = TestBed.runInInjectionContext(() => new AdminCoupons()); page.openCreateModal();
  });
  it('AC-01 rejects incomplete coupon forms', async () => { await page.saveCoupon(); expect(add).not.toHaveBeenCalled(); });
  it('AC-02 rejects discounts above one hundred percent', async () => {
    page.couponForm.patchValue({ code: 'SAVE', discountValue: 101 }); await page.saveCoupon(); expect(add).not.toHaveBeenCalled();
  });
  it('AC-03 keeps failed coupon data open for retry', async () => {
    add.and.rejectWith(new Error('Fixture outage')); page.couponForm.patchValue({ code: 'save10' });
    await page.saveCoupon(); expect(page.showModal()).toBeTrue(); expect(page.couponForm.controls.code.value).toBe('save10');
  });
  it('AC-04 normalizes codes and closes successful forms', async () => {
    page.couponForm.patchValue({ code: 'save10' }); await page.saveCoupon();
    expect(add.calls.mostRecent().args[0].code).toBe('SAVE10'); expect(page.showModal()).toBeFalse();
  });
});
