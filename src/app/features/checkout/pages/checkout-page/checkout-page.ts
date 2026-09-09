import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { SALON } from '@core/constants/salon.constants';
import { CartService } from '@core/services/cart.service';
import { AdminService, type AdminOrder } from '@core/services/admin.service';
import { SiteSettingsService } from '@core/services/site-settings.service';
import { PaymentService, PaymentReceipt } from '@core/services/payment.service';
import { ToastService } from '@core/services/toast.service';
import { InrPipe } from '@shared/pipes/inr-pipe';

@Component({
  selector: 'app-checkout-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, InrPipe],
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
  readonly confirmedReceipt = signal<PaymentReceipt | null>(null);
  readonly confirmedOrder = signal<AdminOrder | null>(null);

  readonly estimatedTotal = computed(() => {
    const sub = this.cart.subtotal();
    return sub >= 999 ? sub : sub + 99;
  });

  readonly form = this.fb.nonNullable.group({
    name: ['Gaurav Yadav', [Validators.required, Validators.minLength(2)]],
    phone: ['9015618265', [Validators.required, Validators.pattern(/^[0-9]{10}$/)]],
    address: [SALON.address, [Validators.required, Validators.minLength(5)]],
    payment: ['razorpay' as 'razorpay' | 'cod', Validators.required],
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

    const shippingAddress = {
      fullName: val.name,
      phone: cleanPhone,
      street: val.address,
      city: 'Ghaziabad',
    };

    if (val.payment === 'cod') {
      // 1-Click Cash on Delivery
      this.paymentService.placeCodOrder({ items, shippingAddress }).subscribe({
        next: (receipt) => {
          this.isInitiating.set(false);
          this.toast.success(`🎉 COD Order #${receipt.receiptNumber} confirmed in Neon PostgreSQL!`);
          this.onPaymentSuccess(receipt);
        },
        error: (err) => {
          this.isInitiating.set(false);
          const msg = err.error?.message || 'Unable to place Cash on Delivery order. Please try again.';
          this.toast.error(msg);
        },
      });
      return;
    }

    // Official Razorpay Standard Checkout
    this.paymentService.createRazorpayOrder({ items, shippingAddress }).subscribe({
      next: (orderData) => {
        this.isInitiating.set(false);
        this.toast.info('Launching official Razorpay payment gateway...');

        this.paymentService.launchRazorpayCheckout(orderData, {
          onSuccess: (rzpResp) => {
            this.isInitiating.set(true);
            this.toast.info('Cryptographically verifying payment with Neon PostgreSQL...');

            this.paymentService
              .verifyRazorpayPayment({
                orderId: orderData.orderId,
                razorpayOrderId: rzpResp.razorpay_order_id,
                razorpayPaymentId: rzpResp.razorpay_payment_id,
                razorpaySignature: rzpResp.razorpay_signature,
              })
              .subscribe({
                next: (receipt) => {
                  this.isInitiating.set(false);
                  this.toast.success(`🎉 Payment Verified! Order #${receipt.receiptNumber} confirmed.`);
                  this.onPaymentSuccess(receipt);
                },
                error: (err) => {
                  this.isInitiating.set(false);
                  const msg = err.error?.message || 'Payment verification failed.';
                  this.toast.error(msg);
                },
              });
          },
          onDismiss: () => {
            this.isInitiating.set(false);
            this.toast.info('Payment window closed. Your cart remains saved.');
          },
          onError: (err) => {
            this.isInitiating.set(false);
            this.toast.error(err?.description || 'Razorpay payment could not be processed.');
          },
        });
      },
      error: (err) => {
        this.isInitiating.set(false);
        const msg = err.error?.message || 'Unable to initialize Razorpay checkout. Please try again.';
        this.toast.error(msg);
      },
    });
  }

  onPaymentSuccess(receipt: PaymentReceipt): void {
    this.confirmedReceipt.set(receipt);
    this.placed.set(true);

    const adminOrder: AdminOrder = {
      id: receipt.orderId,
      status: 'confirmed',
      subtotal: receipt.totalAmount >= 999 ? receipt.totalAmount : receipt.totalAmount - 99,
      total_amount: receipt.totalAmount,
      currency: 'INR',
      payment_method: receipt.paymentDetails?.method || 'Razorpay',
      payment_status: receipt.paymentStatus,
      transaction_id: receipt.paymentId || (receipt as any).transactionId || '',
      gateway_order_id: receipt.paymentDetails?.razorpayOrderId || '',
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
      notes: `Order placed via ${receipt.paymentDetails?.method || 'Razorpay'} with Neon DB stock reservation.`,
    };
    this.confirmedOrder.set(adminOrder);
    this.admin.addOrder(adminOrder);

    this.cart.clear();
  }

  printInvoice(): void {
    const inv = this.confirmedOrder();
    const originalTitle = document.title;
    if (inv?.id) {
      document.title = `Tax_Invoice_UB_${inv.id.slice(0, 8).toUpperCase()}`;
    }
    window.print();
    setTimeout(() => {
      document.title = originalTitle;
    }, 1000);
  }

  shop(): void {
    void this.router.navigate(['/shop']);
  }
}
