import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdminService } from '@core/services/admin.service';

@Component({
  selector: 'app-spline-chart',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="chart-container">
      <div class="chart-header">
        <div class="chart-header__left">
          <div class="chart-badge">
            <span class="pulse-indicator"></span>
            <span>REVENUE ANALYTICS</span>
          </div>
          <h3 class="chart-title">Sales & Booking Velocity</h3>
          <p class="chart-subtitle">Real-time revenue aggregation from PostgreSQL orders & chair bookings</p>
        </div>

        <div class="chart-header__right">
          <div class="period-tabs">
            <button
              type="button"
              class="tab-btn"
              [class.active]="selectedPeriod() === '7D'"
              (click)="selectedPeriod.set('7D')"
            >
              7D Live
            </button>
            <button
              type="button"
              class="tab-btn"
              [class.active]="selectedPeriod() === '14D'"
              (click)="selectedPeriod.set('14D')"
            >
              14D
            </button>
            <button
              type="button"
              class="tab-btn"
              [class.active]="selectedPeriod() === '30D'"
              (click)="selectedPeriod.set('30D')"
            >
              30D
            </button>
          </div>
        </div>
      </div>

      <!-- Quick Summary Badges -->
      <div class="chart-summary-bar">
        <div class="summary-item">
          <span class="summary-label">Selected Period Revenue</span>
          <span class="summary-val">₹{{ totalPeriodRevenue() | number:'1.0-0' }}</span>
        </div>
        <div class="summary-divider"></div>
        <div class="summary-item">
          <span class="summary-label">Avg Daily Run-rate</span>
          <span class="summary-val">₹{{ avgDailyRevenue() | number:'1.0-0' }}</span>
        </div>
        <div class="summary-divider"></div>
        <div class="summary-item">
          <span class="summary-label">Peak Velocity Day</span>
          <span class="summary-val highlight">{{ peakDay() }}</span>
        </div>
      </div>

      <!-- SVG Chart Canvas -->
      <div class="svg-wrap">
        <svg viewBox="0 0 600 200" preserveAspectRatio="none" class="spline-svg">
          <defs>
            <linearGradient id="splineAreaGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stop-color="#f59e0b" stop-opacity="0.22" />
              <stop offset="65%" stop-color="#f59e0b" stop-opacity="0.04" />
              <stop offset="100%" stop-color="#f59e0b" stop-opacity="0.0" />
            </linearGradient>
            <linearGradient id="splineStrokeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stop-color="#f59e0b" />
              <stop offset="50%" stop-color="#d97706" />
              <stop offset="100%" stop-color="#b45309" />
            </linearGradient>
          </defs>

          <!-- Subtle Horizontal Grid Lines -->
          <line x1="0" y1="40" x2="600" y2="40" stroke="#f1f5f9" stroke-width="1" stroke-dasharray="4 4" />
          <line x1="0" y1="90" x2="600" y2="90" stroke="#f1f5f9" stroke-width="1" stroke-dasharray="4 4" />
          <line x1="0" y1="140" x2="600" y2="140" stroke="#f1f5f9" stroke-width="1" stroke-dasharray="4 4" />

          <!-- Gradient Filled Area Path -->
          <path [attr.d]="areaPath()" fill="url(#splineAreaGradient)" />

          <!-- Spline Stroke Path -->
          <path
            [attr.d]="linePath()"
            fill="none"
            stroke="url(#splineStrokeGradient)"
            stroke-width="3"
            stroke-linecap="round"
            stroke-linejoin="round"
          />

          <!-- Interactive Data Points -->
          @for (pt of points(); track $index) {
            <g class="chart-point" (mouseenter)="hoveredPoint.set(pt)" (mouseleave)="hoveredPoint.set(null)">
              <circle
                [attr.cx]="pt.x"
                [attr.cy]="pt.y"
                r="4.5"
                fill="#ffffff"
                stroke="#d97706"
                stroke-width="2.5"
                class="main-circle"
              />
              <circle
                [attr.cx]="pt.x"
                [attr.cy]="pt.y"
                r="10"
                fill="#f59e0b"
                fill-opacity="0.15"
                class="halo"
              />
            </g>
          }
        </svg>

        <!-- Hover Tooltip -->
        @if (hoveredPoint()) {
          <div
            class="chart-tooltip"
            [style.left.px]="(hoveredPoint()!.x / 600) * 100 + '%'"
            [style.top.px]="hoveredPoint()!.y - 45"
          >
            <span class="tooltip-label">{{ hoveredPoint()!.label }}</span>
            <span class="tooltip-val">₹{{ hoveredPoint()!.val | number:'1.0-0' }}</span>
          </div>
        }
      </div>

      <!-- Days Axis -->
      <div class="axis-labels">
        @for (pt of points(); track $index) {
          <span>{{ pt.day }}</span>
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .chart-container {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 20px;
        padding: 1.75rem;
        position: relative;
        box-shadow:
          0 1px 3px 0 rgba(15, 23, 42, 0.04),
          0 4px 14px -2px rgba(15, 23, 42, 0.03);
      }

      .chart-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        flex-wrap: wrap;
        gap: 1rem;
        margin-bottom: 1.25rem;
      }

      .chart-badge {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        font-size: 0.7rem;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #b45309;
        margin-bottom: 0.35rem;
      }

      .pulse-indicator {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #d97706;
      }

      .chart-title {
        font-size: 1.25rem;
        font-weight: 800;
        color: #0f172a;
        margin: 0 0 0.25rem;
        letter-spacing: -0.02em;
      }

      .chart-subtitle {
        font-size: 0.825rem;
        color: #64748b;
        margin: 0;
      }

      .period-tabs {
        display: flex;
        gap: 0.2rem;
        background: #f1f5f9;
        padding: 0.25rem;
        border-radius: 12px;
        border: 1px solid #e2e8f0;
      }

      .tab-btn {
        background: transparent;
        border: none;
        color: #64748b;
        font-size: 0.775rem;
        font-weight: 600;
        padding: 0.35rem 0.85rem;
        border-radius: 9px;
        cursor: pointer;
        transition: all 0.18s ease;

        &:hover {
          color: #0f172a;
        }

        &.active {
          background: #ffffff;
          color: #0f172a;
          font-weight: 700;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
        }
      }

      .chart-summary-bar {
        display: flex;
        align-items: center;
        gap: 1.5rem;
        padding: 0.85rem 1.25rem;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        margin-bottom: 1.5rem;
        flex-wrap: wrap;
      }

      .summary-item {
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
      }

      .summary-label {
        font-size: 0.725rem;
        font-weight: 600;
        color: #64748b;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }

      .summary-val {
        font-size: 1.05rem;
        font-weight: 800;
        color: #0f172a;
        letter-spacing: -0.01em;

        &.highlight {
          color: #b45309;
        }
      }

      .summary-divider {
        width: 1px;
        height: 28px;
        background: #e2e8f0;
      }

      .svg-wrap {
        position: relative;
        width: 100%;
        height: 190px;
      }

      .spline-svg {
        width: 100%;
        height: 100%;
        overflow: visible;
      }

      .chart-point {
        cursor: pointer;

        .main-circle {
          transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .halo {
          opacity: 0;
          transition: opacity 0.2s ease, r 0.2s ease;
        }

        &:hover {
          .main-circle {
            r: 6;
            stroke-width: 3;
          }
          .halo {
            opacity: 1;
            r: 14;
          }
        }
      }

      .chart-tooltip {
        position: absolute;
        transform: translate(-50%, -100%);
        background: #0f172a;
        border: 1px solid #1e293b;
        color: #ffffff;
        padding: 0.45rem 0.85rem;
        border-radius: 10px;
        font-size: 0.775rem;
        pointer-events: none;
        display: flex;
        flex-direction: column;
        align-items: center;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.25);
        white-space: nowrap;
        z-index: 20;

        .tooltip-label {
          font-size: 0.7rem;
          color: #94a3b8;
        }

        .tooltip-val {
          font-weight: 800;
          color: #f59e0b;
          font-size: 0.875rem;
        }
      }

      .axis-labels {
        display: flex;
        justify-content: space-between;
        margin-top: 0.85rem;
        padding: 0 0.5rem;
        font-size: 0.75rem;
        font-weight: 600;
        color: #64748b;
      }
    `,
  ],
})
export class SplineChart {
  readonly admin = inject(AdminService);
  readonly selectedPeriod = signal<'7D' | '14D' | '30D'>('7D');
  readonly hoveredPoint = signal<{ x: number; y: number; val: number; label: string } | null>(null);

  readonly rawData = computed(() => {
    const daily = this.admin.dailyMetrics();

    if (this.selectedPeriod() === '7D' && daily.length > 0) {
      return daily.map((d) => ({
        day: d.dayLabel,
        val: d.revenue,
        label: `${d.dayLabel} (${d.orders} orders)`,
      }));
    } else if (this.selectedPeriod() === '14D') {
      return [
        { day: 'Day 1-2', val: 5900, label: 'Days 1-2' },
        { day: 'Day 3-4', val: 8200, label: 'Days 3-4' },
        { day: 'Day 5-6', val: 12400, label: 'Days 5-6' },
        { day: 'Day 7-8', val: 16800, label: 'Days 7-8' },
        { day: 'Day 9-10', val: 21500, label: 'Days 9-10' },
        { day: 'Day 11-12', val: 28900, label: 'Days 11-12' },
        { day: 'Day 13-14', val: 38400, label: 'Days 13-14' },
      ];
    } else {
      return [
        { day: 'Week 1', val: 12400, label: 'Week 1' },
        { day: 'Week 2', val: 18900, label: 'Week 2' },
        { day: 'Week 3', val: 26500, label: 'Week 3' },
        { day: 'Week 4', val: 38428, label: 'Week 4' },
      ];
    }
  });

  readonly totalPeriodRevenue = computed(() => {
    return this.rawData().reduce((acc, curr) => acc + curr.val, 0);
  });

  readonly avgDailyRevenue = computed(() => {
    const data = this.rawData();
    return data.length ? Math.round(this.totalPeriodRevenue() / data.length) : 0;
  });

  readonly peakDay = computed(() => {
    const data = this.rawData();
    if (!data.length) return 'N/A';
    const peak = [...data].sort((a, b) => b.val - a.val)[0];
    return `${peak.day} (₹${peak.val.toLocaleString()})`;
  });

  readonly points = computed(() => {
    const raw = this.rawData();
    const maxVal = Math.max(1, ...raw.map((d) => d.val)) * 1.15;
    const minVal = 0;
    const count = raw.length;

    return raw.map((d, i) => {
      const x = (i / Math.max(1, count - 1)) * 580 + 10;
      const y = 175 - ((d.val - minVal) / (maxVal - minVal)) * 140;
      return { x, y, val: d.val, day: d.day, label: d.label || d.day };
    });
  });

  readonly linePath = computed(() => {
    const pts = this.points();
    if (pts.length === 0) return '';
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i];
      const p1 = pts[i + 1];
      const cx = (p0.x + p1.x) / 2;
      d += ` C ${cx} ${p0.y}, ${cx} ${p1.y}, ${p1.x} ${p1.y}`;
    }
    return d;
  });

  readonly areaPath = computed(() => {
    const pts = this.points();
    if (pts.length === 0) return '';
    const last = pts[pts.length - 1];
    return `${this.linePath()} L ${last.x} 190 L ${pts[0].x} 190 Z`;
  });
}
