import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of, Subject } from 'rxjs';
import { BookPage } from './book-page';
import { AccountService } from '@core/services/account.service';
import { AddressService } from '@core/services/address.service';
import { CatalogService } from '@core/services/catalog.service';
import { AdminService, type AdminBooking } from '@core/services/admin.service';
import { SiteSettingsService } from '@core/services/site-settings.service';
import type { Product } from '@core/models/product.model';

describe('Appointment booking interactions', () => {
  let page: BookPage;
  let products: ReturnType<typeof signal<Product[]>>;
  let save: jasmine.Spy;
  let response: Subject<AdminBooking>;
  const service = { id: '11111111-1111-4111-8111-111111111111', slug: 'precision-cut', name: 'Precision haircut', price: 500, inStock: true } as Product;
  beforeEach(() => {
    products = signal([service]);
    response = new Subject<AdminBooking>();
    save = jasmine.createSpy('addBooking').and.returnValue(response);
    TestBed.configureTestingModule({ providers: [
      { provide: AccountService, useValue: { user: () => ({ name: 'Alex Morgan', email: 'alex@example.invalid', phone: '9811223344' }) } },
      { provide: AddressService, useValue: { addresses: () => [], load: () => Promise.resolve() } },
      { provide: CatalogService, useValue: { byCategory: () => products() } },
      { provide: AdminService, useValue: { addBooking: save } },
      { provide: SiteSettingsService, useValue: { settings: signal({ business: {} }) } },
      { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({ service: 'precision-cut' })), snapshot: { queryParamMap: convertToParamMap({ service: 'precision-cut' }) } } },
    ] });
    page = TestBed.runInInjectionContext(() => new BookPage());
    page.form.patchValue({ date: '2099-12-31', time: '14:00' });
  });
  afterEach(() => response.complete());
  it('prefills the signed-in customer and carries the exact service ID', () => {
    page.submit();
    const booking = save.calls.mostRecent().args[0] as AdminBooking;
    expect(booking.service_id).toBe(service.id);
    expect(booking.customer_name).toBe('Alex Morgan');
    expect(booking.customer_phone).toBe('9811223344');
    expect(save.calls.mostRecent().args[1]).toBe('customer');
  });
  it('rejects invalid phone numbers', () => {
    page.form.controls.phone.setValue('abcdefghij');
    page.submit();
    expect(save).not.toHaveBeenCalled();
  });
  it('requires a full address for home visits', () => {
    page.form.patchValue({ visitType: 'home', address: 'short' });
    page.submit();
    expect(save).not.toHaveBeenCalled();
    expect(page.form.controls.address.hasError('required')).toBeTrue();
  });
  it('prevents duplicate submissions while saving', () => {
    page.submit();
    page.submit();
    expect(save).toHaveBeenCalledTimes(1);
    response.next(save.calls.mostRecent().args[0] as AdminBooking);
    expect(page.submitted).toBeTrue();
    expect(page.saving()).toBeFalse();
  });
  it('rejects appointment dates in the past', () => {
    page.form.controls.date.setValue('2020-01-01');
    page.submit();
    expect(save).not.toHaveBeenCalled();
    expect(page.form.controls.date.hasError('past')).toBeTrue();
  });
  it('selects a service when the asynchronous catalog arrives', () => {
    products.set([]);
    page.form.controls.service.setValue('');
    TestBed.flushEffects();
    products.set([service]);
    TestBed.flushEffects();
    expect(page.form.controls.service.value).toBe(service.id);
    expect(page.selectedService()?.price).toBe(500);
  });
});
