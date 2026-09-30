import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { CartService } from '@core/services/cart.service';
import { AccountService } from '@core/services/account.service';
import { AddressService } from '@core/services/address.service';
import { SiteSettingsService } from '@core/services/site-settings.service';
import { PaymentService, PaymentReceipt, OrderQuote, RazorpayOrderResponse } from '@core/services/payment.service';
import { InrPipe } from '@shared/pipes/inr-pipe';
import type { SavedAddress } from '@core/models/address.model';

@Component({ selector: 'app-checkout-page', standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, InrPipe],
  templateUrl: './checkout-page.html', styleUrl: './checkout-page.scss' })
export class CheckoutPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  readonly cart = inject(CartService);
  readonly account = inject(AccountService);
  readonly addresses = inject(AddressService);
  readonly site = inject(SiteSettingsService);
  readonly payment = inject(PaymentService);
  readonly busy = signal(false);
  readonly message = signal('');
  readonly error = signal('');
  readonly quote = signal<OrderQuote | null>(null);
  readonly receipt = signal<PaymentReceipt | null>(null);
  readonly coupon = signal('');
  readonly couponInput = signal('');
  readonly pending = signal<RazorpayOrderResponse | null>(null);
  readonly total = computed(() => this.quote()?.totalAmount ?? this.cart.subtotal());
  readonly form = this.fb.nonNullable.group({
    name: [this.account.user()?.name || '', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
    phone: [this.account.user()?.phone || '', [Validators.required, Validators.pattern(/^[6-9][0-9]{9}$/)]],
    street: ['', [Validators.required, Validators.minLength(5), Validators.maxLength(500)]],
    city: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
    state: ['', [Validators.required, Validators.maxLength(100)]],
    postalCode: ['', [Validators.required, Validators.pattern(/^[1-9][0-9]{5}$/)]],
    save: [false], method: ['razorpay' as 'razorpay' | 'cod'],
  });
  async ngOnInit(): Promise<void> {
    const address = this.addresses.addresses().find(a => a.isDefault) || this.addresses.addresses()[0];
    if (address) this.selectAddress(address);
    this.pending.set(this.payment.restorePendingOrder());
    if (this.pending()) await this.checkPayment();
    else if (this.cart.lines().length) await this.refreshQuote();
  }
  selectAddress(a: SavedAddress): void {
    this.form.patchValue({ name: a.fullName, phone: a.mobile.replace(/\D/g, '').slice(-10),
      street: [a.house, a.street, a.landmark].filter(Boolean).join(', '), city: a.city, state: a.state, postalCode: a.pinCode });
  }
  invalid(field: 'name' | 'phone' | 'street' | 'city' | 'state' | 'postalCode'): boolean {
    const c = this.form.controls[field]; return c.touched && c.invalid;
  }
  private items() { return this.cart.lines().map(l => ({ productId: l.productId, quantity: l.qty, slug: l.slug })); }
  async refreshQuote(code = this.coupon()): Promise<boolean> {
    if (this.busy()) return false;
    this.busy.set(true); this.error.set(''); this.message.set('');
    try {
      const q = await firstValueFrom(this.payment.quoteOrder(this.items(), code || undefined));
      this.cart.updatePrices(q.verifiedItems); this.quote.set(q); this.coupon.set(q.couponCode || '');
      return true;
    } catch (err: any) { this.error.set(err.error?.message || 'We could not check prices and stock. Please try again.'); return false; }
    finally { this.busy.set(false); }
  }
  async applyCoupon(): Promise<void> { await this.refreshQuote(this.couponInput().trim().toUpperCase()); }
  async removeCoupon(): Promise<void> { if (await this.refreshQuote('')) this.couponInput.set(''); }
  async submit(): Promise<void> {
    if (this.busy() || this.pending() || this.receipt()) return;
    this.form.markAllAsTouched();
    if (this.form.invalid) { this.error.set('Check the highlighted delivery details.'); return; }
    if (!this.cart.lines().length) return;
    const before = this.quote()?.totalAmount;
    if (!await this.refreshQuote()) return;
    if (before !== this.quote()!.totalAmount) { this.message.set('Your total has changed. Review the updated amount, then continue.'); return; }
    this.busy.set(true); this.error.set('');
    const v = this.form.getRawValue();
    const shippingAddress = { fullName: v.name.trim(), phone: v.phone, street: v.street.trim(), city: v.city.trim(), state: v.state.trim(), postalCode: v.postalCode, email: this.account.user()?.email };
    const payload = { items: this.items(), shippingAddress, couponCode: this.coupon() || undefined, expectedTotal: this.quote()!.totalAmount };
    try {
      if (v.save) this.addresses.save({ fullName: v.name, mobile: v.phone, house: '', street: v.street, landmark: '', city: v.city, state: v.state, pinCode: v.postalCode, location: null, isDefault: !this.addresses.addresses().length });
      if (v.method === 'cod') this.complete(await firstValueFrom(this.payment.placeCodOrder(payload)));
      else {
        const order = await firstValueFrom(this.payment.createRazorpayOrder(payload));
        this.pending.set(order); this.payment.rememberPendingOrder(order);
        await this.openPayment(order);
      }
    } catch (err: any) { this.error.set(err.error?.message || 'Checkout could not be completed. Retry with the same cart; your request will not create a duplicate order.'); }
    finally { if (!this.pending()) this.busy.set(false); else if (this.error()) this.busy.set(false); }
  }
  async resumePayment(): Promise<void> {
    if (this.busy() || !this.pending()) return;
    await this.checkPayment();
    if (this.pending() && !this.error()) { this.busy.set(true); await this.openPayment(this.pending()!); }
  }
  private async openPayment(order: RazorpayOrderResponse): Promise<void> {
    await this.payment.launchRazorpayCheckout(order, {
      onSuccess: response => {
        this.message.set('Payment received by the gateway. Confirming your order…');
        this.payment.verifyRazorpayPayment({ orderId: order.orderId, razorpayOrderId: response.razorpay_order_id, razorpayPaymentId: response.razorpay_payment_id, razorpaySignature: response.razorpay_signature }).subscribe({
          next: r => this.complete(r),
          error: () => { this.busy.set(false); this.error.set('Confirmation is pending. Use “Check payment status” before making another payment.'); },
        });
      },
      onDismiss: () => { this.busy.set(false); this.message.set('Payment window closed. You can resume this same order or check its payment status.'); },
      onError: err => { this.busy.set(false); this.error.set(err?.description || 'Payment could not be completed. Your order is saved for retry.'); },
    });
  }
  async checkPayment(): Promise<void> {
    const order = this.pending(); if (!order || this.busy()) return;
    this.busy.set(true); this.error.set('');
    try {
      const result = await firstValueFrom(this.payment.reconcileOrder(order.orderId));
      if (result.receipt) this.complete(result.receipt);
      else if (result.cancelled) { this.pending.set(null); this.payment.clearPendingOrder(); this.message.set('This checkout expired without a confirmed payment. Review your cart to start again.'); }
      else this.message.set('Payment has not been confirmed yet. Resume this order to pay, or check again if your account was debited.');
    } catch (err: any) { this.error.set(err.error?.message || 'Payment status is unavailable. Do not pay again until confirmation is available.'); }
    finally { this.busy.set(false); }
  }
  private complete(r: PaymentReceipt): void {
    this.receipt.set(r); this.pending.set(null); this.payment.clearPendingOrder();
    this.busy.set(false); this.error.set(''); this.message.set(''); this.cart.clear();
  }
  printReceipt(): void { window.print(); }
}
