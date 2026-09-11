import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { SALON } from '@core/constants/salon.constants';
import { CartService } from '@core/services/cart.service';
import { AdminService, type AdminOrder } from '@core/services/admin.service';
import { SiteSettingsService } from '@core/services/site-settings.service';
import { PaymentService, PaymentReceipt } from '@core/services/payment.service';
import { AddressService } from '@core/services/address.service';
import { AccountService } from '@core/services/account.service';
import type { SavedAddress } from '@core/models/address.model';
import { ToastService } from '@core/services/toast.service';
import { InrPipe } from '@shared/pipes/inr-pipe';

import { CouponService } from '@core/services/coupon.service';
import type { Coupon } from '@core/models/coupon.model';

@Component({
  selector: 'app-checkout-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, InrPipe],
  templateUrl: './checkout-page.html',
  styleUrl: './checkout-page.scss',
})
export class CheckoutPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  protected readonly cart = inject(CartService);
  private readonly admin = inject(AdminService);
  private readonly paymentService = inject(PaymentService);
  private readonly toast = inject(ToastService);
  readonly siteSettings = inject(SiteSettingsService);
  protected readonly account = inject(AccountService);
  protected readonly addressService = inject(AddressService);
  protected readonly couponService = inject(CouponService);

  readonly salon = SALON;
  readonly settings = this.siteSettings.settings;
  readonly placed = signal(false);
  readonly isInitiating = signal(false);
  readonly confirmedReceipt = signal<PaymentReceipt | null>(null);
  readonly confirmedOrder = signal<AdminOrder | null>(null);

  readonly savedAddresses = this.addressService.addresses;
  readonly selectedAddressId = signal<string | 'custom' | null>(null);
  readonly isCustomMode = signal<boolean>(false);
  readonly isEditing = signal<boolean>(false);
  readonly showAddressList = signal<boolean>(false);

  // Coupon promo code states
  readonly couponCodeInput = signal<string>('');
  readonly appliedCoupon = signal<Coupon | null>(null);
  readonly couponDiscount = signal<number>(0);
  readonly couponError = signal<string>('');
  readonly hasActiveCoupons = computed(() => this.couponService.coupons().some((c) => c.isActive));

  // Reactive ecommerce rules from Admin Settings
  readonly freeShippingThreshold = computed(() => this.settings().ecommerce.freeShippingThreshold);
  readonly standardShippingFee = computed(() => this.settings().ecommerce.standardShippingFee);
  readonly freeShippingEnabled = computed(() => this.settings().ecommerce.freeShippingEnabled ?? true);
  readonly taxRatePercent = computed(() => this.settings().ecommerce.taxRatePercent);
  readonly taxEnabled = computed(() => this.settings().ecommerce.taxEnabled ?? true);
  readonly taxInclusive = computed(() => this.settings().ecommerce.taxInclusive ?? true);

  readonly deliveryFee = computed(() => {
    const sub = this.cart.subtotal();
    if (this.freeShippingEnabled() && sub >= this.freeShippingThreshold()) {
      return 0;
    }
    return this.standardShippingFee();
  });

  readonly remainingForFreeShipping = computed(() => {
    const sub = this.cart.subtotal();
    const thresh = this.freeShippingThreshold();
    return sub < thresh ? thresh - sub : 0;
  });

  readonly taxAmount = computed(() => {
    if (!this.taxEnabled()) return 0;
    const rate = this.taxRatePercent();
    const taxableSubtotal = Math.max(0, this.cart.subtotal() - this.couponDiscount());
    if (this.taxInclusive()) {
      // GST included in price: Tax = Amount - (Amount / (1 + Rate/100))
      return Math.round(taxableSubtotal - taxableSubtotal / (1 + rate / 100));
    }
    // GST added on top: Tax = Amount * Rate / 100
    return Math.round((taxableSubtotal * rate) / 100);
  });

  readonly activeShipping = signal<{
    fullName: string;
    phone: string;
    street: string;
    city: string;
  }>({
    fullName: '',
    phone: '',
    street: '',
    city: 'Ghaziabad',
  });

  readonly estimatedTotal = computed(() => {
    const sub = this.cart.subtotal();
    const disc = this.couponDiscount();
    const ship = this.deliveryFee();
    const taxExtra = (!this.taxInclusive() && this.taxEnabled()) ? this.taxAmount() : 0;
    return Math.max(0, sub - disc + ship + taxExtra);
  });

  readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    phone: ['', [Validators.required, Validators.pattern(/^[0-9]{10}$/)]],
    address: ['', [Validators.required, Validators.minLength(5)]],
    city: ['Ghaziabad', [Validators.required, Validators.minLength(2)]],
    saveToProfile: [false],
    payment: ['razorpay' as 'razorpay' | 'cod', Validators.required],
  });

  ngOnInit(): void {
    const addresses = this.savedAddresses();
    const currentUser = this.account.user();

    if (addresses.length > 0) {
      const defaultAddr = addresses.find((a) => a.isDefault) || addresses[0];
      this.selectSavedAddress(defaultAddr);
    } else {
      this.selectedAddressId.set('custom');
      this.isCustomMode.set(true);
      this.isEditing.set(true);
      const name = currentUser?.name || '';
      this.form.patchValue({ name, city: 'Ghaziabad' });
      this.activeShipping.set({
        fullName: name,
        phone: '',
        street: '',
        city: 'Ghaziabad',
      });
    }
  }

  formatAddressLine(addr: SavedAddress): string {
    return [
      addr.house,
      addr.street,
      addr.landmark ? `Near ${addr.landmark}` : '',
    ]
      .filter(Boolean)
      .join(', ');
  }

  selectSavedAddress(addr: SavedAddress): void {
    this.selectedAddressId.set(addr.id);
    this.isCustomMode.set(false);
    this.isEditing.set(false);
    this.showAddressList.set(false);
    const line = this.formatAddressLine(addr);
    const phone = addr.mobile.replace(/\D/g, '').slice(-10);
    const city = addr.city || 'Ghaziabad';

    this.form.patchValue({
      name: addr.fullName,
      phone,
      address: line || addr.street,
      city,
    });

    this.activeShipping.set({
      fullName: addr.fullName,
      phone,
      street: line || addr.street,
      city,
    });
  }

  startEditingAddress(): void {
    this.isEditing.set(true);
    this.showAddressList.set(false);
    const curr = this.activeShipping();
    this.form.patchValue({
      name: curr.fullName,
      phone: curr.phone,
      address: curr.street,
      city: curr.city,
    });
  }

  stopEditingAddress(): void {
    if (this.savedAddresses().length === 0) {
      return;
    }
    this.isEditing.set(false);
    this.isCustomMode.set(false);
    this.showAddressList.set(false);
    const curr = this.activeShipping();
    this.form.patchValue({
      name: curr.fullName,
      phone: curr.phone,
      address: curr.street,
      city: curr.city,
    });
  }

  saveEditedAddress(): void {
    const nameCtrl = this.form.controls.name;
    const phoneCtrl = this.form.controls.phone;
    const addrCtrl = this.form.controls.address;
    const cityCtrl = this.form.controls.city;

    if (nameCtrl.invalid || phoneCtrl.invalid || addrCtrl.invalid || cityCtrl.invalid) {
      this.form.markAllAsTouched();
      this.toast.error('Please enter a valid recipient name, 10-digit mobile number, and street address.');
      return;
    }

    const val = this.form.getRawValue();
    const cleanPhone = val.phone.replace(/\D/g, '').slice(-10);

    this.activeShipping.set({
      fullName: val.name,
      phone: cleanPhone,
      street: val.address,
      city: val.city || 'Ghaziabad',
    });

    if (val.saveToProfile && this.isCustomMode()) {
      this.addressService.save({
        fullName: val.name,
        mobile: cleanPhone,
        location: null,
        house: '',
        street: val.address,
        landmark: '',
        pinCode: '201301',
        city: val.city || 'Ghaziabad',
        state: 'Uttar Pradesh',
        isDefault: this.savedAddresses().length === 0,
      });
    }

    this.isEditing.set(false);
    this.isCustomMode.set(false);
    this.toast.success('Delivery address updated for this order.');
  }

  openDifferentAddress(): void {
    this.showAddressList.set(true);
    this.isEditing.set(false);
  }

  closeDifferentAddress(): void {
    this.showAddressList.set(false);
  }

  selectCustomAddress(): void {
    this.selectedAddressId.set('custom');
    this.isCustomMode.set(true);
    this.isEditing.set(true);
    this.showAddressList.set(false);
    const user = this.account.user();
    this.form.patchValue({
      name: user?.name || '',
      phone: '',
      address: '',
      city: 'Ghaziabad',
    });
  }

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
      this.toast.error('Please enter a valid full name, 10-digit mobile number, and street address.');
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
      city: val.city || 'Ghaziabad',
    };

    // Save custom address to profile if requested
    if (val.saveToProfile && this.isCustomMode()) {
      this.addressService.save({
        fullName: val.name,
        mobile: cleanPhone,
        location: null,
        house: '',
        street: val.address,
        landmark: '',
        pinCode: '201301',
        city: val.city || 'Ghaziabad',
        state: 'Uttar Pradesh',
        isDefault: this.savedAddresses().length === 0,
      });
    }

    const couponCode = this.appliedCoupon()?.code;
    const discountAmount = this.couponDiscount();

    if (val.payment === 'cod') {
      // 1-Click Cash on Delivery
      this.paymentService.placeCodOrder({ items, shippingAddress, couponCode, discountAmount }).subscribe({
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
    this.paymentService.createRazorpayOrder({ items, shippingAddress, couponCode, discountAmount }).subscribe({
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

  applyCoupon(): void {
    const code = this.couponCodeInput().trim();
    if (!code) {
      this.couponError.set('Please enter a coupon code.');
      return;
    }

    const res = this.couponService.validateCoupon(code, this.cart.subtotal());
    if (res.valid && res.coupon) {
      this.appliedCoupon.set(res.coupon);
      this.couponDiscount.set(res.discount);
      this.couponError.set('');
      this.toast.success(`Coupon "${res.coupon.code}" applied! You saved ₹${res.discount}.`);
    } else {
      this.appliedCoupon.set(null);
      this.couponDiscount.set(0);
      this.couponError.set(res.reason || 'Invalid coupon code.');
      this.toast.error(res.reason || 'Invalid coupon code.');
    }
  }

  removeCoupon(): void {
    const code = this.appliedCoupon()?.code;
    this.appliedCoupon.set(null);
    this.couponDiscount.set(0);
    this.couponCodeInput.set('');
    this.couponError.set('');
    if (code) {
      this.toast.info(`Coupon "${code}" removed.`);
    }
  }

  onPaymentSuccess(receipt: PaymentReceipt): void {
    this.confirmedReceipt.set(receipt);
    this.placed.set(true);

    if (this.appliedCoupon()) {
      this.couponService.recordUsage(this.appliedCoupon()!.code);
    }

    const adminOrder: AdminOrder = {
      id: receipt.orderId,
      status: 'confirmed',
      subtotal: this.cart.subtotal(),
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
      notes: this.appliedCoupon()
        ? `Order placed via ${receipt.paymentDetails?.method || 'Razorpay'}. Coupon ${this.appliedCoupon()!.code} applied (-₹${this.couponDiscount()}).`
        : `Order placed via ${receipt.paymentDetails?.method || 'Razorpay'}.`,
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
