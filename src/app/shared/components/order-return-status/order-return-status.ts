import { CommonModule } from '@angular/common';
import { Component, input } from '@angular/core';
import { isUncollectedCodOrder, RETURN_STATUS_LABELS, type OrderReturnDetails } from '@core/models/order-return.model';

@Component({
  selector: 'app-order-return-status',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (order().return_status; as status) {
      <section class="return-status" aria-label="Return progress">
        <div class="return-title"><strong>{{ labels[status] }}</strong>@if (order().return_requested_at) { <span>Requested {{ order().return_requested_at | date:'mediumDate' }}</span> }</div>
        @if (status !== 'rejected') {
          <ol class="return-stages">
            <li class="done">Requested</li>
            <li [class.done]="status === 'approved' || status === 'received'">Approved</li>
            <li [class.done]="status === 'received'">Received</li>
            <li [class.done]="order().refund_status === 'processed' || (status === 'received' && uncollectedCod())">{{ uncollectedCod() ? 'Closed' : 'Refunded' }}</li>
          </ol>
        }
        <p>{{ nextStep(status) }}</p>
        @if (order().return_review_note) { <p><strong>Review note:</strong> {{ order().return_review_note }}</p> }
        @if (order().refund_status === 'pending') { <p>Refund processing. Settlement will be confirmed after the payment provider updates its status.</p> }
        @if (order().refund_status === 'failed') { <p class="issue">Refund needs attention. Our team will review the payment and retry when appropriate.</p> }
        @if (order().refund_status === 'processed') { <p><strong>Refund completed:</strong> {{ order().refund_amount | currency:(order().currency || 'INR') }}@if (order().refunded_at) { on {{ order().refunded_at | date:'mediumDate' }} }</p> }
        @if (status === 'received' && uncollectedCod()) { <p><strong>Return complete.</strong> No refund is due because no COD payment was collected.</p> }
      </section>
    }
  `,
  styles: [`
    :host { display: block; }
    .return-status { border-top: 1px solid #e2e8f0; padding: 18px 20px; background: #fffcf5; font-size: 12px; color: #64748b; }
    .return-title { display: flex; flex-wrap: wrap; gap: 8px 20px; justify-content: space-between; }
    strong { color: #0b0f19; font-weight: 600; }
    .return-stages { display: flex; flex-wrap: wrap; padding: 0; margin: 14px 0; list-style: none; gap: 12px; }
    li { padding: 5px 8px; border: 1px solid #e2e8f0; border-radius: 5px; background: #fff; }
    li.done { color: #92400e; border-color: #fcd34d; background: #fef3c7; }
    p { margin: 8px 0 0; line-height: 1.7; overflow-wrap: anywhere; }
    .issue { color: #b91c1c; }
  `],
})
export class OrderReturnStatusComponent {
  readonly order = input.required<OrderReturnDetails>();
  readonly labels = RETURN_STATUS_LABELS;
  uncollectedCod(): boolean { return isUncollectedCodOrder(this.order()); }

  nextStep(status: string): string {
    switch (status) {
      case 'requested': return 'Your request is being reviewed. Keep the products and packaging ready while you wait for a decision.';
      case 'approved': return 'Follow the return instructions in the review note. Contact support if collection or shipping details have not been provided.';
      case 'received': return this.uncollectedCod() ? 'The returned parcel has been inspected and the return is closed.' : 'The returned parcel has been inspected. Refund progress appears below once repayment begins.';
      case 'rejected': return 'Your return was declined. Contact support with your order number if you need help with the decision.';
      default: return '';
    }
  }
}
