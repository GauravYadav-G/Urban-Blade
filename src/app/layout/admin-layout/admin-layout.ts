import { Component, inject, signal, computed, OnInit, ViewChild, ElementRef, HostListener } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService } from '@core/services/admin.service';
import { AccountService } from '@core/services/account.service';
import { AdminSessionService } from '@core/services/admin-session.service';
import { ToastService } from '@core/services/toast.service';
import { ToastContainer } from '@shared/components/toast-container/toast-container';
import { SupportChatboxComponent } from '../../features/admin/components/support-chatbox/support-chatbox';

export interface AdminNavItem {
  label: string;
  route: string;
  icon: string;
  badge?: string;
  badgeTone?: string;
}

export interface AdminNavSection {
  title: string;
  items: AdminNavItem[];
}

@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, CommonModule, FormsModule, ToastContainer, SupportChatboxComponent],
  templateUrl: './admin-layout.html',
  styleUrl: './admin-layout.scss',
})
export class AdminLayout implements OnInit {
  readonly admin = inject(AdminService);
  readonly account = inject(AccountService);
  readonly session = inject(AdminSessionService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;
  readonly globalSearchQuery = signal<string>('');
  readonly isSupportChatOpen = signal(false);

  @HostListener('window:keydown', ['$event'])
  handleKeyboardShortcut(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.searchInput?.nativeElement?.focus();
    }
  }

  onGlobalSearch(): void {
    const q = this.globalSearchQuery().trim();
    if (!q) return;
    if (q.startsWith('#') || q.toLowerCase().startsWith('ord') || q.toLowerCase().startsWith('trk') || /\d{3,}/.test(q)) {
      void this.router.navigate(['/admin/orders']);
    } else {
      void this.router.navigate(['/admin/products']);
    }
    this.toast.info(`Searching for "${q}"`);
  }

  readonly supportInquiryCount = computed(() => {
    return this.admin.supportInquiries().filter(i => i.status === 'open' || i.status === 'escalated').length;
  });

  ngOnInit(): void {
    this.admin.refreshInquiries();
    this.admin.refreshTasks();
    this.admin.refreshVendors();
  }

  onSignOut(): void {
    if (this.account.isImpersonatingVendor()) {
      this.account.exitVendorPreview();
      this.toast.info('Returned to Superadmin view.');
      return;
    }
    this.account.adminSignOut();
    this.toast.info('Console locked. Signed out successfully.');
    void this.router.navigate(['/admin/login']);
  }

  readonly visibleNavSections = computed<AdminNavSection[]>(() => {
    const isVendor = this.account.isVendor();

    if (isVendor) {
      return [
        {
          title: 'VENDOR DESK',
          items: [
            {
              label: 'Vendor Dashboard',
              route: '/admin/dashboard',
              icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>`,
            },
          ],
        },
        {
          title: 'MERCHANT CATALOG',
          items: [
            {
              label: 'Vendor Products',
              route: '/admin/products',
              icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`,
            },
            {
              label: 'Vendor Orders',
              route: '/admin/orders',
              icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>`,
            },
          ],
        },
      ];
    }

    // Master Admin sections
    return [
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
        title: 'MULTI-VENDOR COMMERCE',
        items: [
          {
            label: 'Multi-Vendor Hub',
            route: '/admin/vendors',
            badge: `${this.admin.vendors().length || '5'}`,
            badgeTone: 'amber',
            icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
          },
          {
            label: 'Products & Inventory',
            route: '/admin/products',
            icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`,
          },
          {
            label: 'Orders & Fulfillment',
            route: '/admin/orders',
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
        title: 'SALON OPERATIONS & USERS',
        items: [
          {
            label: 'Floor Appointments',
            route: '/admin/bookings',
            icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
          },
          {
            label: 'User Directory & Tasks',
            route: '/admin/customers',
            badge: `${this.admin.adminTasks().filter(t => t.status !== 'completed').length || ''}`,
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
  });
}
