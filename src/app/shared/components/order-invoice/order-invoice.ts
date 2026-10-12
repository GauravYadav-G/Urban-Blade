import { CommonModule } from '@angular/common';
import { Component, computed, inject, input, output } from '@angular/core';
import { SiteSettingsService } from '@core/services/site-settings.service';
import { InrPipe } from '@shared/pipes/inr-pipe';

export interface InvoiceOrder {
  id: string;
  created_at: string;
  total_amount: number;
  subtotal?: number;
  discount_amount?: number;
  shipping_fee?: number;
  tax_amount?: number;
  tax_rate_percent?: number;
  tax_inclusive?: boolean;
  coupon_code?: string;
  payment_method: string;
  payment_status: string;
  transaction_id?: string;
  gateway_order_id?: string;
  tracking_number?: string;
  carrier?: string;
  shipping_address?: {
    fullName?: string;
    street?: string;
    city?: string;
    state?: string;
    pinCode?: string;
    postalCode?: string;
    phone?: string;
    email?: string;
  };
  items: Array<{ product_name: string; unit_price: number; quantity: number }>;
}

@Component({
  selector: 'app-order-invoice',
  standalone: true,
  imports: [CommonModule, InrPipe],
  templateUrl: './order-invoice.html',
  styleUrl: './order-invoice.scss',
})
export class OrderInvoice {
  readonly order = input.required<InvoiceOrder>();
  readonly close = output<void>();
  readonly site = inject(SiteSettingsService);

  readonly taxRate = computed(() =>
    Math.max(
      0,
      Number(this.order().tax_rate_percent) ||
        (this.site.settings().ecommerce.taxEnabled
          ? Number(this.site.settings().ecommerce.taxRatePercent) || 0
          : 0)
    )
  );

  taxableValue(amount: number): number {
    const rate = this.taxRate();
    return rate > 0 ? amount / (1 + rate / 100) : amount;
  }

  taxValue(amount: number): number {
    return amount - this.taxableValue(amount);
  }

  invoiceTax(): number {
    const stored = Number(this.order().tax_amount);
    return Number.isFinite(stored) && stored > 0 ? stored : this.taxValue(this.order().total_amount);
  }

  print(): void {
    const originalTitle = document.title;
    document.title = `Tax_Invoice_UB_${this.order().id.slice(0, 8).toUpperCase()}`;
    window.print();
    window.setTimeout(() => (document.title = originalTitle), 1000);
  }
}
