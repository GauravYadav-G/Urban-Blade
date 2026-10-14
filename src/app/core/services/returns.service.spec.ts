import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ReturnsService } from './returns.service';
import { canRefundOrderReturn, canRequestOrderReturn } from '@core/models/order-return.model';

describe('Return API boundaries', () => {
  let service: ReturnsService;
  let http: HttpTestingController;
  const order = { id: 'order-1', status: 'delivered', total_amount: '800.00', currency: 'INR', payment_method: 'Razorpay', payment_status: 'captured', shipping_address: null, items: [{ product_name: 'Shampoo', unit_price: '400.00', quantity: 2 }] };

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(ReturnsService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('keeps customer requests on the customer endpoint and normalizes the response', () => {
    service.request('order-1', 'Damaged bottle').subscribe(response => {
      expect(response.order.total_amount).toBe(800);
      expect(response.order.items[0].unit_price).toBe(400);
      expect(response.order.shipping_address.fullName).toBe('Customer');
    });
    const request = http.expectOne('/api/orders/order-1/return');
    expect(request.request.body).toEqual({ reason: 'Damaged bottle' });
    request.flush({ ok: true, order: { ...order, return_status: 'requested' } });
  });

  it('records an explicit no-restock decision and omits it from approval', () => {
    service.review('order-1', 'received', 'Opened packaging', false).subscribe();
    const receipt = http.expectOne('/api/admin/orders/order-1/return');
    expect(receipt.request.body).toEqual({ status: 'received', note: 'Opened packaging', restock: false });
    receipt.flush({ ok: true, order: { ...order, return_status: 'received' } });
    service.review('order-1', 'approved', 'Send back by courier').subscribe();
    const approval = http.expectOne('/api/admin/orders/order-1/return');
    expect(approval.request.body).toEqual({ status: 'approved', note: 'Send back by courier' });
    approval.flush({ ok: true, order: { ...order, return_status: 'approved' } });
  });

  it('rejects malformed queue records instead of displaying an empty success', () => {
    const failed = jasmine.createSpy('failed');
    service.queue('all', 1).subscribe({ error: failed });
    http.expectOne(request => request.url === '/api/admin/returns').flush({ data: [{ ...order, items: null }], total: 1, page: 1, limit: 25 });
    expect(failed).toHaveBeenCalled();
  });

  it('searches and paginates the complete server queue', () => {
    service.queue('requested', 3, 'Shampoo').subscribe();
    const request = http.expectOne(request => request.url === '/api/admin/returns');
    expect(request.request.params.get('status')).toBe('requested');
    expect(request.request.params.get('page')).toBe('3');
    expect(request.request.params.get('q')).toBe('Shampoo');
    request.flush({ data: [], total: 0, page: 3, limit: 25 });
  });

  it('allows physically returning unpaid COD without offering a payment refund', () => {
    const cod = { status: 'delivered', payment_method: 'cash_on_delivery', payment_status: 'pending' };
    expect(canRequestOrderReturn(cod)).toBeTrue();
    expect(canRefundOrderReturn({ ...cod, return_status: 'received' })).toBeFalse();
    expect(canRequestOrderReturn({ ...cod, payment_reconciliation_error: 'Needs review' })).toBeFalse();
  });

  it('blocks repeat requests and already-refunded orders', () => {
    const paid = { status: 'delivered', payment_method: 'Razorpay', payment_status: 'captured' };
    expect(canRequestOrderReturn(paid)).toBeTrue();
    expect(canRequestOrderReturn({ ...paid, return_status: 'requested' })).toBeFalse();
    expect(canRequestOrderReturn({ ...paid, refund_amount: 100 })).toBeFalse();
    expect(canRequestOrderReturn({ ...paid, status: 'shipped' })).toBeFalse();
  });
});
