import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { CheckoutPage } from './checkout-page';
import { AddressService } from '@core/services/address.service';
import { AccountService } from '@core/services/account.service';
import { CartService } from '@core/services/cart.service';
import { SiteSettingsService } from '@core/services/site-settings.service';
import { PaymentService } from '@core/services/payment.service';
import type { SavedAddress } from '@core/models/address.model';
import { of } from 'rxjs';

describe('Checkout address restoration', () => {
  let page: CheckoutPage;
  let resolveLoad: () => void;
  const saved: SavedAddress = { id: 'saved-home', fullName: 'Alice Customer', mobile: '9811223344', house: 'Flat 12', street: 'Rosewood Avenue', landmark: 'Near park', city: 'Delhi', state: 'Delhi', pinCode: '110001', isDefault: true, location: null };
  let addresses: { addresses: ReturnType<typeof signal<SavedAddress[]>>; load: jasmine.Spy };
  let payment: { restorePendingOrder: () => null; reconcileOrder: jasmine.Spy; clearPendingOrder: jasmine.Spy };
  beforeEach(() => {
    payment = { restorePendingOrder: () => null, reconcileOrder: jasmine.createSpy('reconcileOrder'), clearPendingOrder: jasmine.createSpy('clearPendingOrder') };
    addresses = { addresses: signal<SavedAddress[]>([]), load: jasmine.createSpy('load').and.callFake(() => new Promise<void>(resolve => { resolveLoad = resolve; })) };
    TestBed.configureTestingModule({ providers: [
      { provide: AddressService, useValue: addresses },
      { provide: AccountService, useValue: { user: () => ({ name: 'Alice', email: 'alice@example.invalid' }) } },
      { provide: CartService, useValue: { lines: () => [] } },
      { provide: SiteSettingsService, useValue: {} },
      { provide: PaymentService, useValue: payment },
    ] });
    page = TestBed.runInInjectionContext(() => new CheckoutPage());
  });
  it('waits for database addresses before prefilling checkout', async () => {
    const initialized = page.ngOnInit();
    expect(page.form.controls.street.value).toBe('');
    addresses.addresses.set([saved]);
    resolveLoad();
    await initialized;
    expect(addresses.load).toHaveBeenCalledWith(true);
    expect(page.form.controls.street.value).toBe('Flat 12, Rosewood Avenue, Near park');
    expect(page.form.controls.postalCode.value).toBe('110001');
    expect(page.selectedAddressId()).toBe(saved.id);
  });
  it('does not overwrite details typed while server addresses are loading', async () => {
    const initialized = page.ngOnInit();
    page.form.controls.street.setValue('My newly entered street');
    page.form.controls.street.markAsDirty();
    addresses.addresses.set([saved]);
    resolveLoad();
    await initialized;
    expect(page.form.controls.street.value).toBe('My newly entered street');
  });
  it('uses the default even when it is not first in the response', async () => {
    const initialized = page.ngOnInit();
    addresses.addresses.set([{ ...saved, id: 'office', city: 'Noida', isDefault: false }, saved]);
    resolveLoad();
    await initialized;
    expect(page.form.controls.city.value).toBe('Delhi');
    expect(page.selectedAddressId()).toBe(saved.id);
  });

  it('explains a refunded payment without calling it an unpaid expired checkout', async () => {
    page.pending.set({ orderId: 'refunded-order' } as import('@core/services/payment.service').RazorpayOrderResponse);
    payment.reconcileOrder.and.returnValue(of({ refunded: true, cancelled: true, pending: false }));
    await page.checkPayment();
    expect(page.message()).toContain('payment was refunded');
    expect(page.pending()).toBeNull();
    expect(payment.clearPendingOrder).toHaveBeenCalled();
    expect(page.busy()).toBeFalse();
  });
});
