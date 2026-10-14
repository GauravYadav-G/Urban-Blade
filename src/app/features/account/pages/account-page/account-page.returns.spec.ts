import { HttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { AccountService } from '@core/services/account.service';
import { AddressService } from '@core/services/address.service';
import { AdminService, type AdminOrder } from '@core/services/admin.service';
import { CartService } from '@core/services/cart.service';
import { CatalogService } from '@core/services/catalog.service';
import { ReturnsService, type ReturnMutation } from '@core/services/returns.service';
import { ToastService } from '@core/services/toast.service';
import { AccountPage } from './account-page';

describe('Customer return requests', () => {
  let page: AccountPage;
  let pending: Subject<ReturnMutation>;
  let request: jasmine.Spy;
  let user: ReturnType<typeof signal<{ id: string; name: string; email: string } | null>>;
  const order: AdminOrder = {
    id: 'order-1', status: 'delivered', payment_method: 'Razorpay', payment_status: 'captured',
    total_amount: 800, subtotal: 800, currency: 'INR', created_at: '2026-10-14T10:00:00Z',
    shipping_address: { fullName: 'Customer', city: 'Delhi', phone: '9811223344' },
    items: [{ product_id: 'product-1', product_name: 'Shampoo', unit_price: 400, quantity: 2 }],
  };

  beforeEach(() => {
    pending = new Subject<ReturnMutation>();
    request = jasmine.createSpy('request').and.returnValue(pending);
    user = signal<{ id: string; name: string; email: string } | null>({ id: 'customer-1', name: 'Customer', email: 'customer@example.test' });
    TestBed.configureTestingModule({ providers: [
      { provide: ReturnsService, useValue: { request } },
      { provide: AccountService, useValue: { user } },
      { provide: AddressService, useValue: { addresses: signal([]) } },
      { provide: AdminService, useValue: {} },
      { provide: CartService, useValue: {} },
      { provide: CatalogService, useValue: {} },
      { provide: HttpClient, useValue: {} },
      { provide: Router, useValue: {} },
      { provide: ActivatedRoute, useValue: {} },
      { provide: DomSanitizer, useValue: {} },
      { provide: ToastService, useValue: { success: jasmine.createSpy(), error: jasmine.createSpy() } },
    ] });
    page = TestBed.runInInjectionContext(() => new AccountPage());
    page.orders.set([order]);
    page.requestReturn(order);
    page.returnForm.patchValue({ category: 'Damaged or defective product', details: 'Bottle seal is broken' });
  });
  afterEach(() => pending.complete());

  it('requires full-order acknowledgement and a bounded reason', () => {
    page.submitReturn();
    expect(request).not.toHaveBeenCalled();
    page.returnForm.controls.acknowledged.setValue(true);
    page.returnForm.controls.details.setValue('a'.repeat(401));
    page.submitReturn();
    expect(request).not.toHaveBeenCalled();
    page.returnForm.controls.details.setValue('Bottle seal is broken');
    page.submitReturn();
    expect(request).toHaveBeenCalledOnceWith('order-1', 'Damaged or defective product: Bottle seal is broken');
  });

  it('retains request details after a failure and blocks duplicate requests', () => {
    page.returnForm.controls.acknowledged.setValue(true);
    page.submitReturn();
    page.submitReturn();
    expect(request).toHaveBeenCalledTimes(1);
    pending.error({ error: { message: 'This order needs payment review.' } });
    expect(page.requestingReturn()).toBeNull();
    expect(page.returnOrder()).toBe(order);
    expect(page.returnForm.controls.details.value).toBe('Bottle seal is broken');
    expect(page.returnError()).toContain('payment review');
  });

  it('clears the dialog on logout and ignores late responses from the previous customer', () => {
    page.returnForm.controls.acknowledged.setValue(true);
    page.submitReturn();
    user.set(null);
    TestBed.flushEffects();
    expect(page.returnOrder()).toBeNull();
    expect(page.requestingReturn()).toBeNull();
    pending.next({ ok: true, order: { ...order, shipping_address: { fullName: 'Customer', city: 'Delhi', phone: '' }, return_status: 'requested' } });
    expect(page.orders()[0].return_status).toBeUndefined();
    expect(page.returnOrder()).toBeNull();
  });
});
