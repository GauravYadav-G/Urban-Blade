import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-metric-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="metric-card" [class]="'metric-card--' + tone()">
      <div class="metric-card__header">
        <div class="metric-card__icon" [innerHTML]="icon()"></div>
        @if (trend()) {
          <span class="trend-pill" [class.trend-pill--negative]="trendNegative()">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              @if (!trendNegative()) {
                <path d="M7 17L17 7M17 7H7M17 7V17" />
              } @else {
                <path d="M7 7L17 17M17 17H7M17 17V7" />
              }
            </svg>
            {{ trend() }}
          </span>
        }
      </div>

      <div class="metric-card__body">
        <h4 class="metric-card__title">{{ title() }}</h4>
        <div class="metric-card__value">{{ value() }}</div>
        @if (subtitle()) {
          <p class="metric-card__sub">{{ subtitle() }}</p>
        }
      </div>

      <div class="glow-orb"></div>
    </div>
  `,
  styles: [
    `
      .metric-card {
        background: rgba(17, 24, 39, 0.7);
        backdrop-filter: blur(16px);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 16px;
        padding: 1.25rem 1.5rem;
        position: relative;
        overflow: hidden;
        transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.25s;
      }
      .metric-card:hover {
        transform: translateY(-2px);
        border-color: rgba(245, 158, 11, 0.3);
      }
      .metric-card__header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1rem;
      }
      .metric-card__icon {
        width: 42px;
        height: 42px;
        border-radius: 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(245, 158, 11, 0.12);
        color: #fbbf24;
        border: 1px solid rgba(245, 158, 11, 0.2);
      }
      .metric-card--emerald .metric-card__icon {
        background: rgba(16, 185, 129, 0.12);
        color: #34d399;
        border-color: rgba(16, 185, 129, 0.2);
      }
      .metric-card--indigo .metric-card__icon {
        background: rgba(99, 102, 241, 0.12);
        color: #818cf8;
        border-color: rgba(99, 102, 241, 0.2);
      }
      .metric-card--rose .metric-card__icon {
        background: rgba(244, 63, 94, 0.12);
        color: #fb7185;
        border-color: rgba(244, 63, 94, 0.2);
      }

      .trend-pill {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        background: rgba(16, 185, 129, 0.15);
        color: #34d399;
        font-size: 0.75rem;
        font-weight: 700;
        padding: 0.2rem 0.55rem;
        border-radius: 9999px;
        border: 1px solid rgba(16, 185, 129, 0.3);
      }
      .trend-pill--negative {
        background: rgba(244, 63, 94, 0.15);
        color: #fb7185;
        border-color: rgba(244, 63, 94, 0.3);
      }

      .metric-card__title {
        font-size: 0.8rem;
        color: #9ca3af;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        font-weight: 600;
        margin: 0 0 0.35rem;
      }
      .metric-card__value {
        font-size: 1.75rem;
        font-weight: 700;
        color: #f9fafb;
        letter-spacing: -0.02em;
        line-height: 1.1;
      }
      .metric-card__sub {
        font-size: 0.75rem;
        color: #6b7280;
        margin: 0.35rem 0 0;
      }

      .glow-orb {
        position: absolute;
        top: -40px;
        right: -40px;
        width: 100px;
        height: 100px;
        background: radial-gradient(circle, rgba(245, 158, 11, 0.15) 0%, transparent 70%);
        pointer-events: none;
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
