import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-metric-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="metric-card" [class]="'metric-card--' + tone()">
      <div class="metric-card__top">
        <div class="metric-card__icon-box" [innerHTML]="icon()"></div>
        @if (trend()) {
          <div class="trend-badge" [class.trend-badge--negative]="trendNegative()">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              @if (!trendNegative()) {
                <polyline points="18 15 12 9 6 15" />
              } @else {
                <polyline points="6 9 12 15 18 9" />
              }
            </svg>
            <span>{{ trend() }}</span>
          </div>
        }
      </div>

      <div class="metric-card__content">
        <span class="metric-card__label">{{ title() }}</span>
        <div class="metric-card__num">{{ value() }}</div>
        @if (subtitle()) {
          <div class="metric-card__meta">
            <span class="meta-dot"></span>
            <span>{{ subtitle() }}</span>
          </div>
        }
      </div>

      <!-- Subtle background decoration line -->
      <div class="card-accent-bar"></div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .metric-card {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 18px;
        padding: 1.35rem 1.5rem;
        position: relative;
        overflow: hidden;
        box-shadow:
          0 1px 3px 0 rgba(15, 23, 42, 0.04),
          0 4px 12px -2px rgba(15, 23, 42, 0.03);
        transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        display: flex;
        flex-direction: column;
        gap: 0.85rem;
      }

      .metric-card:hover {
        transform: translateY(-2px);
        border-color: #cbd5e1;
        box-shadow:
          0 8px 24px -4px rgba(15, 23, 42, 0.08),
          0 2px 6px -1px rgba(15, 23, 42, 0.03);
      }

      .metric-card__top {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .metric-card__icon-box {
        width: 44px;
        height: 44px;
        border-radius: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #fffbeb;
        color: #b45309;
        border: 1px solid #fde68a;
        box-shadow: 0 1px 2px rgba(180, 83, 9, 0.08);
      }

      .metric-card--emerald .metric-card__icon-box {
        background: #ecfdf5;
        color: #047857;
        border-color: #a7f3d0;
        box-shadow: 0 1px 2px rgba(4, 120, 87, 0.08);
      }

      .metric-card--indigo .metric-card__icon-box {
        background: #eff6ff;
        color: #1d4ed8;
        border-color: #bfdbfe;
        box-shadow: 0 1px 2px rgba(29, 78, 216, 0.08);
      }

      .metric-card--rose .metric-card__icon-box {
        background: #fff1f2;
        color: #be123c;
        border-color: #fecdd3;
        box-shadow: 0 1px 2px rgba(190, 18, 60, 0.08);
      }

      .trend-badge {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        background: #ecfdf5;
        color: #047857;
        font-size: 0.75rem;
        font-weight: 700;
        padding: 0.25rem 0.65rem;
        border-radius: 9999px;
        border: 1px solid #a7f3d0;
      }

      .trend-badge--negative {
        background: #fff1f2;
        color: #be123c;
        border-color: #fecdd3;
      }

      .metric-card__content {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      .metric-card__label {
        font-size: 0.78rem;
        color: #64748b;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        font-weight: 700;
      }

      .metric-card__num {
        font-size: 1.95rem;
        font-weight: 800;
        color: #0f172a;
        letter-spacing: -0.035em;
        line-height: 1.1;
        font-feature-settings: 'tnum';
      }

      .metric-card__meta {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        font-size: 0.8rem;
        color: #64748b;
        font-weight: 500;
        margin-top: 0.2rem;
      }

      .meta-dot {
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: #94a3b8;
      }

      .card-accent-bar {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        height: 2px;
        background: transparent;
        transition: background 0.2s ease;
      }

      .metric-card:hover .card-accent-bar {
        background: #f59e0b;
      }

      .metric-card--emerald:hover .card-accent-bar {
        background: #10b981;
      }

      .metric-card--indigo:hover .card-accent-bar {
        background: #3b82f6;
      }

      .metric-card--rose:hover .card-accent-bar {
        background: #f43f5e;
      }
    `,
  ],
})
export class MetricCard {
  readonly title = input.required<string>();
  readonly value = input.required<string>();
  readonly icon = input.required<string>();
  readonly subtitle = input<string>();
  readonly trend = input<string>();
  readonly trendNegative = input<boolean>(false);
  readonly tone = input<'amber' | 'emerald' | 'indigo' | 'rose'>('amber');
}
