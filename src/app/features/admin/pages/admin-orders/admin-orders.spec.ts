import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { AdminOrders } from './admin-orders';
import { AdminService, AdminOrder, AdminProduct } from '@core/services/admin.service';
import { AccountService } from '@core/services/account.service';
import { ToastService } from '@core/services/toast.service';

describe('Admin order regressions', () => {
  let page: AdminOrders;
  let admin: { orders: ReturnType<typeof signal<AdminOrder[]>>; products: ReturnType<typeof signal<AdminProduct[]>>; addOrder: jasmine.Spy };
  let toast: { error: jasmine.Spy; info: jasmine.Spy; success: jasmine.Spy };
  const order = { id: 'order-1', shipping_address: {}, items: [] } as unknown as AdminOrder;

  beforeEach(() => {
    admin = {
      orders: signal<AdminOrder[]>([]),
      products: signal([{ id: 'product-1', name: 'Shampoo', price: 500, inStock: true, availableQuantity: 2 } as AdminProduct]),
      addOrder: jasmine.createSpy('addOrder'),
    };
    toast = { error: jasmine.createSpy('error'), info: jasmine.createSpy('info'), success: jasmine.createSpy('success') };
    TestBed.configureTestingModule({ providers: [
      { provide: AdminService, useValue: admin },
      { provide: AccountService, useValue: { isVendor: () => false, activeVendorName: () => null } },
      { provide: ToastService, useValue: toast },
      { provide: HttpClient, useValue: {} },
      { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({})) } },
    ] });
    page = TestBed.runInInjectionContext(() => new AdminOrders());
    page.openCreateModal();
    page.manualCustomerName.set('Customer');
    page.manualCustomerPhone.set('+91 9811223344');
  });

  it('does not construct a WhatsApp link without a valid phone', () => {
    expect(page.getWhatsAppUrl(order)).toBe('');
  });

  it('normalizes ten digit phones for WhatsApp', () => {
    expect(page.getWhatsAppUrl({ ...order, shipping_address: { fullName: 'Customer', city: 'Delhi', phone: '9811223344' } })).toContain('https://wa.me/919811223344?');
  });

  it('rejects fractional POS quantities', () => {
    page.manualQuantity.set(1.5);
    page.saveManualOrder();
    expect(admin.addOrder).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it('rejects quantities above available stock', () => {
    page.manualQuantity.set(3);
    page.saveManualOrder();
    expect(admin.addOrder).not.toHaveBeenCalled();
  });

  it('does not silently substitute a removed product', () => {
    page.manualProductId.set('missing');
    spyOn(window, 'alert');
    page.saveManualOrder();
    expect(admin.addOrder).not.toHaveBeenCalled();
  });

  it('keeps failed POS data open and prevents duplicate submissions', () => {
    page.saveManualOrder();
    page.saveManualOrder();
    expect(admin.addOrder).toHaveBeenCalledTimes(1);
    expect(page.isCreateModalOpen()).toBeTrue();
    const complete = admin.addOrder.calls.mostRecent().args[2] as (saved: boolean) => void;
    complete(false);
    expect(page.isSavingManualOrder()).toBeFalse();
    expect(page.isCreateModalOpen()).toBeTrue();
    expect(page.manualCustomerName()).toBe('Customer');
    page.saveManualOrder();
    (admin.addOrder.calls.mostRecent().args[2] as (saved: boolean) => void)(true);
    expect(page.isCreateModalOpen()).toBeFalse();
  });

  it('exports comma-containing and formula-prefixed customer fields safely', async () => {
    admin.orders.set([{ ...order, shipping_address: { fullName: '=1+1', city: 'Delhi, NCR', phone: '9811223344' }, carrier: 'Courier, Inc' }]);
    const create = spyOn(URL, 'createObjectURL').and.returnValue('blob:test');
    spyOn(HTMLAnchorElement.prototype, 'click');
    page.exportCSV();
    const blob = create.calls.mostRecent().args[0] as Blob;
    const csv = await blob.text();
    expect(csv).toContain('"\'=1+1"');
    expect(csv).toContain('"Delhi, NCR"');
    expect(csv).toContain('"Courier, Inc"');
  });
});
