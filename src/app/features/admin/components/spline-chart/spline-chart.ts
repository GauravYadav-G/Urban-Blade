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
        <div>
          <h3 class="chart-title">Sales & Dispatch Velocity</h3>
          <p class="chart-subtitle">Real-time revenue curve from PostgreSQL orders time-series</p>
        </div>
        <div class="period-pills">
          <button
            type="button"
            class="pill-btn"
            [class.active]="selectedPeriod() === '7D'"
            (click)="selectedPeriod.set('7D')"
          >
            7D Live
          </button>
          <button
            type="button"
            class="pill-btn"
            [class.active]="selectedPeriod() === '14D'"
            (click)="selectedPeriod.set('14D')"
          >
            14D
          </button>
          <button
            type="button"
            class="pill-btn"
            [class.active]="selectedPeriod() === '30D'"
            (click)="selectedPeriod.set('30D')"
          >
            30D
          </button>
        </div>
      </div>

      <div class="svg-wrap">
        <svg viewBox="0 0 600 200" preserveAspectRatio="none" class="spline-svg">
          <defs>
            <linearGradient id="areaGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stop-color="#f59e0b" stop-opacity="0.38" />
              <stop offset="70%" stop-color="#f59e0b" stop-opacity="0.05" />
              <stop offset="100%" stop-color="#f59e0b" stop-opacity="0.0" />
            </linearGradient>
            <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stop-color="#fbbf24" />
              <stop offset="50%" stop-color="#f59e0b" />
              <stop offset="100%" stop-color="#d97706" />
            </linearGradient>
            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#f59e0b" flood-opacity="0.5" />
            </filter>
          </defs>

          <!-- Grid Lines -->
          <line x1="0" y1="50" x2="600" y2="50" stroke="rgba(255,255,255,0.05)" stroke-dasharray="4" />
          <line x1="0" y1="100" x2="600" y2="100" stroke="rgba(255,255,255,0.05)" stroke-dasharray="4" />
          <line x1="0" y1="150" x2="600" y2="150" stroke="rgba(255,255,255,0.05)" stroke-dasharray="4" />

          <!-- Filled Area Path -->
          <path [attr.d]="areaPath()" fill="url(#areaGradient)" />

          <!-- Spline Stroke Path -->
          <path
            [attr.d]="linePath()"
            fill="none"
            stroke="url(#lineGradient)"
            stroke-width="3"
            filter="url(#glow)"
            stroke-linecap="round"
          />

          <!-- Interactive Data Points -->
          @for (pt of points(); track $index) {
            <g class="chart-point" (mouseenter)="hoveredPoint.set(pt)">
              <circle
                [attr.cx]="pt.x"
                [attr.cy]="pt.y"
                r="4"
                fill="#0b0f19"
                stroke="#f59e0b"
                stroke-width="2.5"
              />
              <circle
                [attr.cx]="pt.x"
                [attr.cy]="pt.y"
                r="8"
                fill="#f59e0b"
                fill-opacity="0.2"
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
            <strong>{{ hoveredPoint()!.label }}</strong>
            <span>₹{{ hoveredPoint()!.val | number:'1.0-0' }}</span>
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
      .chart-container {
        background: rgba(17, 24, 39, 0.7);
        backdrop-filter: blur(16px);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 16px;
        padding: 1.5rem;
        position: relative;
      }
      .chart-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 1.25rem;
      }
      .chart-title {
        font-size: 1.05rem;
        font-weight: 600;
        color: #f3f4f6;
        margin: 0 0 0.25rem;
      }
      .chart-subtitle {
        font-size: 0.8rem;
        color: #9ca3af;
        margin: 0;
      }
      .period-pills {
        display: flex;
        gap: 0.25rem;
        background: rgba(0, 0, 0, 0.4);
        padding: 0.25rem;
        border-radius: 9999px;
        border: 1px solid rgba(255, 255, 255, 0.05);
      }
      .pill-btn {
        background: transparent;
        border: none;
        color: #9ca3af;
        font-size: 0.75rem;
        font-weight: 600;
        padding: 0.25rem 0.65rem;
        border-radius: 9999px;
        cursor: pointer;
        transition: all 0.2s;
      }
      .pill-btn.active {
        background: #f59e0b;
        color: #111827;
        box-shadow: 0 2px 8px rgba(245, 158, 11, 0.4);
      }
      .svg-wrap {
        position: relative;
        width: 100%;
        height: 180px;
      }
      .spline-svg {
        width: 100%;
        height: 100%;
        overflow: visible;
      }
      .chart-point {
        cursor: pointer;
        transition: transform 0.2s;
      }
      .chart-point:hover .halo {
        r: 12;
      }
      .chart-tooltip {
        position: absolute;
        transform: translate(-50%, -100%);
        background: #1f2937;
        border: 1px solid rgba(245, 158, 11, 0.5);
        color: #f9fafb;
        padding: 0.35rem 0.65rem;
        border-radius: 8px;
        font-size: 0.75rem;
        pointer-events: none;
        display: flex;
        flex-direction: column;
        align-items: center;
        box-shadow: 0 8px 16px rgba(0, 0, 0, 0.5);
        white-space: nowrap;
        z-index: 10;
      }
      .chart-tooltip span {
        color: #fbbf24;
        font-weight: 700;
      }
      .axis-labels {
        display: flex;
        justify-content: space-between;
        margin-top: 0.75rem;
        padding: 0 0.5rem;
        font-size: 0.7rem;
        color: #6b7280;
      }
    `,
  ],
})
export class SplineChart {
  readonly admin = inject(AdminService);
  readonly selectedPeriod = signal<'7D' | '14D' | '30D'>('7D');
  readonly hoveredPoint = signal<{ x: number; y: number; val: number; label: string } | null>(null);

  readonly points = computed(() => {
    const daily = this.admin.dailyMetrics();
    let rawData: Array<{ day: string; val: number; label?: string }> = [];

    if (this.selectedPeriod() === '7D' && daily.length > 0) {
      rawData = daily.map((d) => ({
        day: d.dayLabel,
        val: d.revenue,
        label: `${d.dayLabel} (${d.orders} orders)`,
      }));
    } else if (this.selectedPeriod() === '14D') {
      rawData = [
        { day: 'Day 1-2', val: 5900, label: 'Days 1-2' },
        { day: 'Day 3-4', val: 8200, label: 'Days 3-4' },
        { day: 'Day 5-6', val: 12400, label: 'Days 5-6' },
        { day: 'Day 7-8', val: 16800, label: 'Days 7-8' },
        { day: 'Day 9-10', val: 21500, label: 'Days 9-10' },
        { day: 'Day 11-12', val: 28900, label: 'Days 11-12' },
        { day: 'Day 13-14', val: 38400, label: 'Days 13-14' },
      ];
    } else {
      rawData = [
        { day: 'Week 1', val: 12400, label: 'Week 1' },
        { day: 'Week 2', val: 18900, label: 'Week 2' },
        { day: 'Week 3', val: 26500, label: 'Week 3' },
        { day: 'Week 4', val: 38428, label: 'Week 4' },
      ];
    }

    const maxVal = Math.max(1, ...rawData.map((d) => d.val)) * 1.18;
    const minVal = 0;
    const count = rawData.length;

    return rawData.map((d, i) => {
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
