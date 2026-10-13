import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PaymentService } from './payment.service';
import { AccountService } from './account.service';

describe('Checkout retry keys', () => {
  let payment: PaymentService;
  let http: HttpTestingController;
  const payload = {
    items: [{ productId: 'product-1', quantity: 1 }], expectedTotal: 599,
    shippingAddress: { fullName: 'Customer', phone: '9999999999', street: 'Test Street', city: 'Delhi' },
  };

  beforeEach(() => {
    sessionStorage.removeItem('checkout-attempt');
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(), provideHttpClientTesting(),
      { provide: AccountService, useValue: { user: () => ({ email: 'buyer@example.com' }) } },
    ] });
    payment = TestBed.inject(PaymentService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    sessionStorage.removeItem('checkout-attempt');
    sessionStorage.removeItem('urban-blade-pending-payment');
  });

  function create(): string {
    payment.createRazorpayOrder(payload).subscribe();
    const request = http.expectOne(request => request.url.endsWith('/orders/razorpay/create-order'));
    const key = request.request.headers.get('x-idempotency-key')!;
    request.flush({ orderId: 'order-1', razorpayOrderId: 'rzp-1' });
    return key;
  }

  it('reuses the same key while a checkout is unresolved', () => {
    expect(create()).toBe(create());
  });

  it('starts a fresh checkout after an expired or reconciled order is cleared', () => {
    const previous = create();
    payment.clearPendingOrder();
    expect(create()).not.toBe(previous);
  });
});
