import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TrackedOrder } from '@core/models/shipment-tracking.model';

@Component({
  selector: 'app-shipment-tracking',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section aria-label="Carrier tracking" aria-live="polite">
      <h4>Shipment tracking</h4>
      <p>{{ order().carrier || 'Carrier not assigned' }} · {{ order().tracking_number || 'Awaiting dispatch' }}</p>
      @if (order().tracking_data; as tracking) {
        <strong>{{ tracking.rawPortalStatus }}</strong>
        @if (tracking.currentLocation) { <p>Location: {{ tracking.currentLocation }}</p> }
        <p>Estimated delivery: {{ tracking.expectedDelivery || 'Not provided by carrier' }}</p>
        <p class="muted">Last verified: {{ tracking.checkedAt | date:'medium' }}</p>
        @if (order().tracking_error) {
          <p class="notice">Carrier refresh is delayed. Showing the last verified update.</p>
        }
        <ol>
          @for (scan of tracking.checkpoints; track $index) {
            <li>
              <strong>{{ scan.activity || scan.stage }}</strong>
              <div>{{ scan.location }}</div>
              <small>{{ scan.timestamp }}</small>
            </li>
          }
        </ol>
      } @else if (order().tracking_number) {
        <p>{{ order().tracking_automatic ? 'Awaiting a verified carrier update. This view refreshes automatically.' : 'Automatic carrier tracking is not connected. No verified carrier update is available yet.' }}</p>
        @if (order().tracking_error) { <p class="notice">The last carrier check failed. The system will retry automatically.</p> }
      } @else {
        <p>Tracking details will appear after a carrier and tracking number are assigned.</p>
      }
    </section>
  `,
  styles: [`
    :host { display: block; }
    section { padding: 1rem; border: 1px solid #64748b40; border-radius: 12px; }
    h4 { margin: 0 0 .65rem; } p { margin: .5rem 0; }
    .muted, small { color: #64748b; } .notice { color: #b47708; }
    ol { padding-left: 1.25rem; max-height: 260px; overflow-y: auto; }
    li { padding: .5rem 0; }
  `],
})
export class ShipmentTrackingComponent {
  readonly order = input.required<TrackedOrder>();
}
