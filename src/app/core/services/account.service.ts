import { Injectable, computed, signal } from '@angular/core';
import type { LoginCredentials, StoreUser } from '@core/models/user.model';
import { DEMO_ACCOUNT, ADMIN_ACCOUNT } from '@core/constants/salon.constants';

const STORAGE_KEY = 'urban-blade-user';

@Injectable({ providedIn: 'root' })
export class AccountService {
  private readonly userSignal = signal<StoreUser | null>(this.readStored());

  readonly user = this.userSignal.asReadonly();
  readonly isSignedIn = computed(() => this.userSignal() !== null);
  readonly isAdmin = computed(() => this.userSignal()?.role === 'admin');
  readonly isVendor = computed(() => this.userSignal()?.role === 'vendor');
  readonly activeVendorName = computed(() => this.userSignal()?.vendorName || null);
  readonly activeVendorId = computed(() => this.userSignal()?.vendorId || null);
  readonly isImpersonatingVendor = computed(() => !!this.userSignal()?.isImpersonated);
  readonly greetingName = computed(() => this.userSignal()?.name.split(' ')[0] ?? 'sign in');

  private readonly defaultVendors: Record<string, { id: string; name: string }> = {
    'lab@urbanblade.in': { id: 'vnd-lab', name: 'Urban Blade Lab' },
    'grooming@urbanblade.in': { id: 'vnd-grooming', name: 'Urban Blade Grooming' },
    'tools@urbanblade.in': { id: 'vnd-tools', name: 'Urban Blade Tools' },
    'skin@urbanblade.in': { id: 'vnd-skin', name: 'Urban Blade Skin' },
    'salon@urbanblade.in': { id: 'vnd-salon', name: 'Urban Blade Salon' },
  };

  signIn(credentials: LoginCredentials): boolean {
    const email = credentials.email.trim().toLowerCase();
    const isMasterAdmin =
      email === ADMIN_ACCOUNT.email.toLowerCase() && credentials.password === ADMIN_ACCOUNT.password;
    const isDemoCustomer =
      email === DEMO_ACCOUNT.email.toLowerCase() && credentials.password === DEMO_ACCOUNT.password;

    if (!isMasterAdmin && !isDemoCustomer && credentials.password.length < 4) {
      return false;
    }

    let user: StoreUser;
    if (isMasterAdmin) {
      user = {
        email: ADMIN_ACCOUNT.email,
        name: ADMIN_ACCOUNT.name,
        role: 'admin',
      };
    } else if (isDemoCustomer) {
      user = {
        email: DEMO_ACCOUNT.email,
        name: DEMO_ACCOUNT.name,
        role: 'customer',
      };
    } else {
      user = {
        email: credentials.email,
        name: credentials.email
          .split('@')[0]
          .replace(/[._]/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase()),
        role: email.includes('admin') ? 'admin' : 'customer',
      };
    }

    this.userSignal.set(user);
    this.persist(user);
    return true;
  }

  adminSignIn(credentials: LoginCredentials): boolean {
    const email = credentials.email.trim().toLowerCase();
    const isMasterAdmin =
      email === ADMIN_ACCOUNT.email.toLowerCase() && credentials.password === ADMIN_ACCOUNT.password;
    const isCustomAdmin = email.includes('admin') && credentials.password.length >= 6;
    let matchedVendor: { id: string; name: string } | undefined = this.defaultVendors[email];
    if (!matchedVendor) {
      try {
        const stored = localStorage.getItem('urban-blade-admin-vendors');
        if (stored) {
          const vendors = JSON.parse(stored) as Array<{ id: string; name: string; email: string }>;
          const found = vendors.find((v) => v.email?.trim().toLowerCase() === email);
          if (found) {
            matchedVendor = { id: found.id, name: found.name };
          }
        }
      } catch {
        /* ignore */
      }
    }
    const isVendorMatch = !!matchedVendor && (credentials.password === 'Vendor@2026' || credentials.password.length >= 6);

    if (!isMasterAdmin && !isCustomAdmin && !isVendorMatch) {
      return false;
    }

    let user: StoreUser;
    if (isMasterAdmin) {
      user = {
        email: ADMIN_ACCOUNT.email,
        name: ADMIN_ACCOUNT.name,
        role: 'admin',
      };
    } else if (isVendorMatch && matchedVendor) {
      user = {
        email,
        name: matchedVendor.name,
        role: 'vendor',
        vendorId: matchedVendor.id,
        vendorName: matchedVendor.name,
      };
    } else {
      user = {
        email: credentials.email,
        name: 'Console Administrator',
        role: 'admin',
      };
    }

    this.userSignal.set(user);
    this.persist(user);
    return true;
  }

  /**
   * Master Admin can 1-click preview and experience any vendor portal
   */
  switchVendorPreview(vendorName: string, vendorId: string): void {
    const current = this.userSignal();
    if (!current || (current.role !== 'admin' && !current.isImpersonated)) return;

    const impersonated: StoreUser = {
      email: `${vendorId}@vendor.urbanblade.in`,
      name: `${vendorName} (Vendor Mode)`,
      role: 'vendor',
      vendorId,
      vendorName,
      isImpersonated: true,
    };
    this.userSignal.set(impersonated);
    this.persist(impersonated);
  }

  /**
   * Exit vendor preview and return to Master Admin
   */
  exitVendorPreview(): void {
    const adminUser: StoreUser = {
      email: ADMIN_ACCOUNT.email,
      name: ADMIN_ACCOUNT.name,
      role: 'admin',
    };
    this.userSignal.set(adminUser);
    this.persist(adminUser);
  }

  adminSignOut(): void {
    this.signOut();
  }

  register(name: string, email: string): void {
    const user: StoreUser = { name, email, role: 'customer' };
    this.userSignal.set(user);
    this.persist(user);
  }

  updateProfile(name: string): void {
    const cur = this.userSignal();
    if (!cur) return;
    const updated: StoreUser = { ...cur, name };
    this.userSignal.set(updated);
    this.persist(updated);
  }

  signOut(): void {
    this.userSignal.set(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  private persist(user: StoreUser): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    } catch {
      /* ignore */
    }
  }

  private readStored(): StoreUser | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) as StoreUser;
      return null;
    } catch {
      return null;
    }
  }
}
