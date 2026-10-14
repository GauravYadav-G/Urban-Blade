import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { signal } from '@angular/core';
import { of, Subject } from 'rxjs';
import { AdminReturns } from './admin-returns';
import { AdminService, type AdminOrder } from '@core/services/admin.service';
import { AccountService } from '@core/services/account.service';
import { ReturnsService, type ReturnMutation } from '@core/services/returns.service';
import { ToastService } from '@core/services/toast.service';

describe('Admin return lifecycle controls', () => {
  let page: AdminReturns;
  let pending: Subject<ReturnMutation>;
  let returns: { review: jasmine.Spy; request: jasmine.Spy; recordManualRefund: jasmine.Spy; queue: jasmine.Spy; audit: jasmine.Spy };
  let admin: { orders: ReturnType<typeof signal<AdminOrder[]>>; refundOrder: jasmine.Spy; refreshProducts: jasmine.Spy };
  const order: AdminOrder = { id: 'order-1', status: 'delivered', payment_method: 'Cash', payment_status: 'captured', return_status: 'approved', return_reason: 'Damaged packaging', total_amount: 800, subtotal: 800, created_at: '2026-10-14T10:00:00Z', currency: 'INR', items: [], shipping_address: { fullName: 'Customer', phone: '9811223344', city: 'Delhi' } };

  beforeEach(() => {
    pending = new Subject<ReturnMutation>();
    returns = {
      review: jasmine.createSpy('review').and.returnValue(pending),
      request: jasmine.createSpy('request').and.returnValue(pending),
      recordManualRefund: jasmine.createSpy('recordManualRefund').and.returnValue(pending),
      queue: jasmine.createSpy('queue').and.returnValue(of({ data: [], total: 0, page: 1, limit: 25 })),
      audit: jasmine.createSpy('audit').and.returnValue(of({ order, events: [] })),
    };
    admin = { orders: signal([order]), refundOrder: jasmine.createSpy('refundOrder').and.returnValue(pending), refreshProducts: jasmine.createSpy('refreshProducts') };
    TestBed.configureTestingModule({ providers: [
      { provide: ReturnsService, useValue: returns },
      { provide: AdminService, useValue: admin },
      { provide: AccountService, useValue: { user: signal({ id: 'admin-1' }) } },
      { provide: ToastService, useValue: { success: jasmine.createSpy(), error: jasmine.createSpy(), info: jasmine.createSpy() } },
      { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({})) } },
    ] });
    page = TestBed.runInInjectionContext(() => new AdminReturns());
    page.selectedOrder.set(order);
    page.setAction('received');
    page.form.controls.note.setValue('Seal broken, not suitable for sale');
  });
  afterEach(() => pending.complete());

  it('requires inspection and an explicit inventory outcome', () => {
    page.submit();
    expect(returns.review).not.toHaveBeenCalled();
    expect(page.actionError()).toContain('restock');
    page.form.controls.restock.setValue('no');
    page.submit();
    expect(returns.review).toHaveBeenCalledOnceWith('order-1', 'received', 'Seal broken, not suitable for sale', false);
  });

  it('prevents double submissions and closing while an action is pending', () => {
    page.form.controls.restock.setValue('yes');
    page.submit();
    page.submit();
    page.close();
    expect(returns.review).toHaveBeenCalledTimes(1);
    expect(page.selectedOrder()).toBe(order);
    pending.error({ error: { message: 'Inventory changed. Review the reservation.' } });
    expect(page.saving()).toBeFalse();
    expect(page.action()).toBe('received');
    expect(page.form.controls.note.value).toBe('Seal broken, not suitable for sale');
    expect(page.actionError()).toContain('Inventory changed');
  });

  it('requires the actual repayment reference for offline returns', () => {
    page.selectedOrder.set({ ...order, return_status: 'received' });
    page.setAction('refund');
    page.submit();
    expect(returns.recordManualRefund).not.toHaveBeenCalled();
    page.form.controls.reference.setValue('bank-ref-123');
    page.submit();
    expect(returns.recordManualRefund).toHaveBeenCalledOnceWith('order-1', 'bank-ref-123', 'Damaged packaging');
    expect(admin.refundOrder).not.toHaveBeenCalled();
  });

  it('does not offer or submit refunds for unpaid COD goods', () => {
    page.selectedOrder.set({ ...order, return_status: 'received', payment_method: 'cash_on_delivery', payment_status: 'pending' });
    page.setAction('refund');
    page.form.controls.reference.setValue('receipt-1');
    page.submit();
    expect(returns.recordManualRefund).not.toHaveBeenCalled();
    expect(admin.refundOrder).not.toHaveBeenCalled();
    expect(page.canRefund(page.selectedOrder()!)).toBeFalse();
  });

  it('enforces the gateway refund reason limit before contacting the server', () => {
    page.selectedOrder.set({ ...order, return_status: 'received', payment_method: 'Razorpay' });
    page.setAction('refund');
    page.form.controls.note.setValue('a'.repeat(301));
    page.submit();
    expect(admin.refundOrder).not.toHaveBeenCalled();
    expect(page.actionError()).toContain('300');
    page.form.controls.note.setValue('Returned damaged bottle');
    page.submit();
    expect(admin.refundOrder).toHaveBeenCalledOnceWith('order-1', 'Returned damaged bottle');
  });
});
