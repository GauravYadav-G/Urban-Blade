import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AdminService } from '@core/services/admin.service';
import { SiteSettingsService } from '@core/services/site-settings.service';
import { MetricCard } from '../../components/metric-card/metric-card';
import { SplineChart } from '../../components/spline-chart/spline-chart';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, MetricCard, SplineChart],
  templateUrl: './admin-dashboard.html',
  styleUrl: './admin-dashboard.scss',
})
export class AdminDashboard {
  readonly admin = inject(AdminService);
  readonly siteSettings = inject(SiteSettingsService);
}
