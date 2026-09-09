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
  readonly greetingName = computed(() => this.userSignal()?.name.split(' ')[0] ?? 'sign in');

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

    if (!isMasterAdmin && !isCustomAdmin) {
      return false;
    }

    const user: StoreUser = {
      email: isMasterAdmin ? ADMIN_ACCOUNT.email : credentials.email,
      name: isMasterAdmin ? ADMIN_ACCOUNT.name : 'Console Administrator',
      role: 'admin',
    };

    this.userSignal.set(user);
    this.persist(user);
    return true;
  }

  adminSignOut(): void {
    this.signOut();
  }

  register(name: string, email: string): void {
    const user: StoreUser = { name, email, role: 'customer' };
    this.userSignal.set(user);
    this.persist(user);
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
