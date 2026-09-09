import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { SALON } from '@core/constants/salon.constants';
import { CartService } from '@core/services/cart.service';
import { AdminService, type AdminOrder } from '@core/services/admin.service';
import { SiteSettingsService } from '@core/services/site-settings.service';
import { InrPipe } from '@shared/pipes/inr-pipe';

@Component({
  selector: 'app-checkout-page',
  imports: [ReactiveFormsModule, RouterLink, InrPipe],
  templateUrl: './checkout-page.html',
  styleUrl: './checkout-page.scss',
})
export class CheckoutPage {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  protected readonly cart = inject(CartService);
  private readonly admin = inject(AdminService);
  readonly siteSettings = inject(SiteSettingsService);

  readonly salon = SALON;
  readonly settings = this.siteSettings.settings;
  readonly placed = signal(false);

  readonly form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    phone: ['', [Validators.required, Validators.minLength(10)]],
    address: [SALON.address, Validators.required],
    payment: ['upi', Validators.required],
  });

  placeOrder(): void {
    if (this.form.invalid || this.cart.lines().length === 0) {
      this.form.markAllAsTouched();
      return;
    }

    const val = this.form.getRawValue();
    const lines = this.cart.lines();
    const subtotal = this.cart.subtotal();

    const order: AdminOrder = {
      id: `ord-ub-${Date.now().toString().slice(-6)}`,
      status: 'accepted',
      subtotal,
      total_amount: subtotal,
      currency: 'INR',
      payment_method: val.payment,
      payment_status: val.payment === 'cash_on_delivery' ? 'pending' : 'paid',
      shipping_address: {
        fullName: val.name,
        phone: val.phone,
        city: 'Ghaziabad',
        street: val.address,
      },
      created_at: new Date().toISOString(),
      items: lines.map((l) => ({
        product_name: l.name,
        unit_price: l.unitPrice,
        quantity: l.qty,
        image_url: l.imageUrl,
      })),
    };

    this.admin.addOrder(order);
    this.placed.set(true);
    this.cart.clear();
  }

  shop(): void {
    void this.router.navigate(['/']);
  }
}
