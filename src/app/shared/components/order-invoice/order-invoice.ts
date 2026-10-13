import { CommonModule } from '@angular/common';
import { Component, computed, inject, input, output, viewChild, ElementRef } from '@angular/core';
import { PrintDocumentService } from '@core/services/print-document.service';
import { ToastService } from '@core/services/toast.service';
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

  readonly taxRate = computed(() => {
    const value = this.order().tax_rate_percent;
    return value != null && Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : null;
  });
  readonly savedTax = computed(() => {
    const value = this.order().tax_amount;
    return value != null && Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : null;
  });
  readonly invoiceNumber = computed(() => `UB-INV-${this.order().id.slice(0, 8).toUpperCase()}`);
  readonly paymentLabel = computed(() => ({
    captured: 'Payment received', refunded: 'Payment refunded', pending: 'Payment pending', failed: 'Payment failed',
  }[this.order().payment_status] || this.order().payment_status));

  private readonly printer = inject(PrintDocumentService);
  private readonly toast = inject(ToastService);
  private readonly paper = viewChild.required<ElementRef<HTMLElement>>('invoiceDocument');

  async print(): Promise<void> {
    try { await this.printer.print(this.paper().nativeElement, `Tax_Invoice_${this.invoiceNumber()}`); }
    catch { this.toast.error('Invoice print preview could not be opened. Please retry.'); }
  }
}
