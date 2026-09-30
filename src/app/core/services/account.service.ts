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
      return false;
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
      return false;
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

  async register(name: string, email: string, password: string): Promise<boolean> {
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedName = name.trim();

    try {
      const resp = await firstValueFrom(
        this.http.post<AuthResponse>(`${API_AUTH_URL}/register`, {
          name: trimmedName,
          email: trimmedEmail,
          password,
        })
      );
      if (resp && resp.token && resp.user) {
        this.persistToken(resp.token);
        this.userSignal.set(resp.user);
        this.persist(resp.user);
        return true;
      }
    } catch (err: any) {
      if (err?.status === 409) {
        throw new Error(err?.error?.message || 'An account with this email address already exists. Please sign in instead.');
      }
      throw new Error(err?.error?.message || 'Registration is unavailable. Please try again.');
    }
    return false;
  }

  async updateProfile(updates: { name?: string; phone?: string | null } | string): Promise<StoreUser | null> {
    const cur = this.userSignal();
    if (!cur) return null;
    const name = typeof updates === 'string' ? updates : updates.name;
    const phone = typeof updates === 'string' ? cur.phone : updates.phone;

    const payload: { name?: string; phone?: string } = {};
    if (name !== undefined) payload.name = name;
    if (phone !== undefined && phone !== null) payload.phone = phone;

    const updated: StoreUser = {
      ...cur,
      ...(name !== undefined ? { name } : {}),
      ...(phone !== undefined ? { phone } : {}),
    };
    this.userSignal.set(updated);
    this.persist(updated);

    const token = this.getToken();
    if (token) {
      try {
        const resp = await firstValueFrom(
          this.http.patch<{ ok: boolean; user: StoreUser }>(`${API_AUTH_URL}/profile`, payload)
        );
        if (resp && resp.user) {
          const merged: StoreUser = { ...updated, ...resp.user };
          this.userSignal.set(merged);
          this.persist(merged);
          return merged;
        }
      } catch {
        // Fallback to local storage persistence
      }
    }
    return updated;
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
      const token = localStorage.getItem(TOKEN_KEY);
      if (raw && token) {
        const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (payload.exp * 1000 > Date.now()) return JSON.parse(raw) as StoreUser;
      }
      return null;
    } catch {
      return null;
    }
  }
}
