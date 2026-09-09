import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdminService } from '@core/services/admin.service';

@Component({
  selector: 'app-admin-system',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './admin-system.html',
  styleUrl: './admin-system.scss',
})
export class AdminSystem {
  readonly admin = inject(AdminService);

  refresh(): void {
    this.admin.fetchTelemetry();
    this.admin.recomputeAndPersistMetrics?.();
  }

  flushCache(): void {
    this.admin.flushCache();
  }

  resetFactorySeed(): void {
    if (confirm('Reset orders, salon appointments, and catalog to factory baseline data?')) {
      this.admin.resetFactoryData();
    }
  }
}
