import { Injectable, inject, computed, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { LoginCredentials, StoreUser } from '@core/models/user.model';
import { DEMO_ACCOUNT, ADMIN_ACCOUNT } from '@core/constants/salon.constants';

const STORAGE_KEY = 'urban-blade-user';
const TOKEN_KEY = 'urban-blade-token';
const SESSION_ID_KEY = 'urban-blade-session-id';

const API_AUTH_URL =
  typeof window !== 'undefined' && window.location.port === '4200'
    ? 'http://localhost:4000/api/auth'
    : '/api/auth';

interface AuthResponse {
  token: string;
  user: StoreUser;
}

@Injectable({ providedIn: 'root' })
export class AccountService {
  private readonly http = inject(HttpClient);
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

  getToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(TOKEN_KEY);
  }

  getSessionId(): string {
    if (typeof window === 'undefined') return 'guest-session';
    let sid = localStorage.getItem(SESSION_ID_KEY);
    if (!sid || sid === 'guest-session') {
      sid = 'sess_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
      localStorage.setItem(SESSION_ID_KEY, sid);
    }
    return sid;
  }

  async signIn(credentials: LoginCredentials): Promise<boolean> {
    const email = credentials.email.trim().toLowerCase();

    try {
      const resp = await firstValueFrom(
        this.http.post<AuthResponse>(`${API_AUTH_URL}/login`, {
          email,
          password: credentials.password,
        })
      );

      if (resp && resp.token && resp.user) {
        this.persistToken(resp.token);
        this.userSignal.set(resp.user);
        this.persist(resp.user);
        return true;
      }
    } catch {
      // Offline fallback for demo customer
      if (email === DEMO_ACCOUNT.email.toLowerCase() && credentials.password === DEMO_ACCOUNT.password) {
        const demoUser: StoreUser = {
          email: DEMO_ACCOUNT.email,
          name: DEMO_ACCOUNT.name,
          role: 'customer',
        };
        this.persistToken('demo_mock_jwt_token_customer');
        this.userSignal.set(demoUser);
        this.persist(demoUser);
        return true;
      }
    }

    return false;
  }

  async adminSignIn(credentials: LoginCredentials): Promise<boolean> {
    const email = credentials.email.trim().toLowerCase();

    try {
      const resp = await firstValueFrom(
        this.http.post<AuthResponse>(`${API_AUTH_URL}/login`, {
          email,
          password: credentials.password,
        })
      );

      if (resp && resp.token && resp.user) {
        // Enforce role boundary: only admin or vendor may pass
        if (resp.user.role !== 'admin' && resp.user.role !== 'vendor') {
          return false;
        }

        this.persistToken(resp.token);
        this.userSignal.set(resp.user);
        this.persist(resp.user);
        return true;
      }
    } catch {
      // Offline fallback for master admin and vendors
      const isMasterAdmin =
        email === ADMIN_ACCOUNT.email.toLowerCase() && credentials.password === ADMIN_ACCOUNT.password;
      const matchedVendor = this.defaultVendors[email];
      const isVendorMatch = !!matchedVendor && (credentials.password === 'Vendor@2026' || credentials.password.length >= 6);

      if (isMasterAdmin) {
        const adminUser: StoreUser = {
          email: ADMIN_ACCOUNT.email,
          name: ADMIN_ACCOUNT.name,
          role: 'admin',
        };
        this.persistToken('admin_offline_jwt_token');
        this.userSignal.set(adminUser);
        this.persist(adminUser);
        return true;
      }

      if (isVendorMatch && matchedVendor) {
        const vendorUser: StoreUser = {
          email,
          name: matchedVendor.name,
          role: 'vendor',
          vendorId: matchedVendor.id,
          vendorName: matchedVendor.name,
        };
        this.persistToken('vendor_offline_jwt_token');
        this.userSignal.set(vendorUser);
        this.persist(vendorUser);
        return true;
      }
    }

    return false;
  }

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

  async register(name: string, email: string, password = 'Blade@User123'): Promise<boolean> {
    try {
      const resp = await firstValueFrom(
        this.http.post<AuthResponse>(`${API_AUTH_URL}/register`, {
          name,
          email,
          password,
        })
      );
      if (resp && resp.token && resp.user) {
        this.persistToken(resp.token);
        this.userSignal.set(resp.user);
        this.persist(resp.user);
        return true;
      }
    } catch {
      // Local fallback
      const user: StoreUser = { name, email, role: 'customer' };
      this.userSignal.set(user);
      this.persist(user);
      return true;
    }
    return false;
  }

  updateProfile(name: string): void {
    const cur = this.userSignal();
    if (!cur) return;
    const updated: StoreUser = { ...cur, name };
    this.userSignal.set(updated);
    this.persist(updated);
  }

  signOut(): void {
    const token = this.getToken();
    if (token) {
      this.http.post(`${API_AUTH_URL}/logout`, {}).subscribe({ error: () => {} });
    }

    this.userSignal.set(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  }

  private persistToken(token: string): void {
    try {
      localStorage.setItem(TOKEN_KEY, token);
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
