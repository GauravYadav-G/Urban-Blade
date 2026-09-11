import { Component, inject } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AdminService } from '@core/services/admin.service';
import { AccountService } from '@core/services/account.service';
import { AdminSessionService } from '@core/services/admin-session.service';
import { ToastService } from '@core/services/toast.service';
import { ToastContainer } from '@shared/components/toast-container/toast-container';

@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, CommonModule, ToastContainer],
  templateUrl: './admin-layout.html',
  styleUrl: './admin-layout.scss',
})
export class AdminLayout {
  readonly admin = inject(AdminService);
  readonly account = inject(AccountService);
  readonly session = inject(AdminSessionService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  onSignOut(): void {
    this.account.adminSignOut();
    this.toast.info('Console locked. Signed out successfully.');
    void this.router.navigate(['/admin/login']);
  }

  readonly navSections = [
    {
      title: 'OVERVIEW',
      items: [
        {
          label: 'Executive Dashboard',
          route: '/admin/dashboard',
          icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>`,
        },
      ],
    },
    {
      title: 'COMMERCE & CATALOG',
      items: [
        {
          label: 'Products & Inventory',
          route: '/admin/products',
          badge: '40',
          icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`,
        },
        {
          label: 'Orders & Fulfillment',
          route: '/admin/orders',
          badge: '12',
          badgeTone: 'amber',
          icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>`,
        },
        {
          label: 'Coupons & Promos',
          route: '/admin/coupons',
          icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1.5"/></svg>`,
        },
      ],
    },
    {
      title: 'SALON OPERATIONS',
      items: [
        {
          label: 'Floor Appointments',
          route: '/admin/bookings',
          badge: '8',
          icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
        },
        {
          label: 'Customer Directory',
          route: '/admin/customers',
          icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
        },
      ],
    },
    {
      title: 'SETTINGS & SYSTEM',
      items: [
        {
          label: 'Storefront CMS & Rules',
          route: '/admin/website',
          icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
        },
        {
          label: 'Cluster Telemetry',
          route: '/admin/system',
          icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>`,
        },
      ],
    },
  ];

  get navItems() {
    return this.navSections.flatMap((s) => s.items);
  }
}
