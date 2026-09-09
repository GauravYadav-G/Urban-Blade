import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { SALON } from '@core/constants/salon.constants';
import { CartService } from '@core/services/cart.service';
import { AdminService, type AdminOrder } from '@core/services/admin.service';
import { SiteSettingsService } from '@core/services/site-settings.service';
import { PaymentService, CheckoutSessionResponse, PaymentReceipt } from '@core/services/payment.service';
import { ToastService } from '@core/services/toast.service';
import { InrPipe } from '@shared/pipes/inr-pipe';
import { PaymentModal } from '../../components/payment-modal/payment-modal';

@Component({
  selector: 'app-checkout-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, InrPipe, PaymentModal],
  templateUrl: './checkout-page.html',
  styleUrl: './checkout-page.scss',
})
export class CheckoutPage {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  protected readonly cart = inject(CartService);
  private readonly admin = inject(AdminService);
  private readonly paymentService = inject(PaymentService);
  private readonly toast = inject(ToastService);
  readonly siteSettings = inject(SiteSettingsService);

  readonly salon = SALON;
  readonly settings = this.siteSettings.settings;
  readonly placed = signal(false);
  readonly isInitiating = signal(false);
  readonly activeSession = signal<CheckoutSessionResponse | null>(null);
  readonly confirmedReceipt = signal<PaymentReceipt | null>(null);

  readonly form = this.fb.nonNullable.group({
    name: ['Gaurav Yadav', [Validators.required, Validators.minLength(2)]],
    phone: ['9015618265', [Validators.required, Validators.pattern(/^[0-9]{10}$/)]],
    address: [SALON.address, [Validators.required, Validators.minLength(5)]],
    payment: ['upi' as 'upi' | 'card' | 'cash_on_delivery', Validators.required],
  });

  initiateCheckout(event?: Event): void {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    if (this.cart.lines().length === 0) {
      this.toast.error('Your cart is empty. Please add items to checkout.');
      return;
    }

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.toast.error('Please enter a valid full name and 10-digit mobile number.');
      return;
    }

    this.isInitiating.set(true);
    const val = this.form.getRawValue();
    const cleanPhone = val.phone.replace(/\D/g, '').slice(-10);

    const items = this.cart.lines().map((line) => ({
      productId: line.productId,
      slug: (line as any).slug || line.productId.replace(/^(hc|bd|sk|tl|gf|sv)-/, ''),
      quantity: line.qty,
    }));

    this.paymentService
      .createCheckoutSession({
        items,
        shippingAddress: {
          fullName: val.name,
          phone: cleanPhone,
          street: val.address,
          city: 'Ghaziabad',
        },
        paymentMethod: val.payment,
      })
      .subscribe({
        next: (session) => {
          this.isInitiating.set(false);
          this.activeSession.set(session);
        },
        error: (err) => {
          this.isInitiating.set(false);
          const errorMsg =
            err.error?.message ||
            'Unable to reserve inventory in Neon PostgreSQL. Please try again.';
          this.toast.error(errorMsg);
        },
      });
  }

  onPaymentSuccess(receipt: PaymentReceipt): void {
    this.activeSession.set(null);
    this.confirmedReceipt.set(receipt);
    this.placed.set(true);

    // Sync into local Admin signals for real-time reactivity
    const adminOrder: AdminOrder = {
      id: receipt.orderId,
      status: 'confirmed',
      subtotal: receipt.totalAmount >= 999 ? receipt.totalAmount : receipt.totalAmount - 99,
      total_amount: receipt.totalAmount,
      currency: 'INR',
      payment_method: receipt.paymentDetails?.method || 'UPI',
      payment_status: 'captured',
      shipping_address: {
        fullName: receipt.shippingAddress.fullName,
        phone: receipt.shippingAddress.phone,
        city: receipt.shippingAddress.city || 'Ghaziabad',
        street: receipt.shippingAddress.street,
      },
      created_at: receipt.confirmedAt,
      items: receipt.items.map((i) => ({
        product_name: i.product_name,
        unit_price: Number(i.unit_price),
        quantity: i.quantity,
        image_url: i.image_url,
      })),
      tracking_number: `TRK-UB-${receipt.orderId.slice(0, 6).toUpperCase()}`,
    };
    this.admin.addOrder(adminOrder);

    this.cart.clear();
  }

  onPaymentCancelled(): void {
    this.activeSession.set(null);
  }

  shop(): void {
    void this.router.navigate(['/']);
  }
}
