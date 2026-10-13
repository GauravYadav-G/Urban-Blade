import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AccountService } from '@core/services/account.service';
import type { AddressDraft, SavedAddress } from '@core/models/address.model';

const STORAGE_KEY = 'urban-blade-addresses';
const API = '/api/account/addresses';

@Injectable({ providedIn: 'root' })
export class AddressService {
  private readonly account = inject(AccountService);
  private readonly http = inject(HttpClient);
  private legacy = this.readStore();
  private readonly state = signal<{ owner: string; items: SavedAddress[] }>({ owner: '', items: [] });
  private readonly guest = signal<SavedAddress[]>(this.legacy['guest'] ?? []);
  private pendingLoad: { owner: string; promise: Promise<void> } | null = null;
  private loadedOwner = '';
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly addresses = computed(() => {
    const owner = this.owner();
    return owner ? (this.state().owner === owner ? this.state().items : []) : this.guest();
  });

  constructor() {
    effect(() => {
      const owner = this.owner();
      untracked(() => {
        if (owner) void this.load();
        else {
          this.loadedOwner = '';
          this.state.set({ owner: '', items: [] });
          this.loading.set(false);
          this.error.set('');
        }
      });
    });
  }

  async load(force = false): Promise<void> {
    const owner = this.owner();
    if (!owner) return;
    if (this.pendingLoad?.owner === owner) return this.pendingLoad.promise;
    if (!force && this.loadedOwner === owner) return;
    this.loading.set(true);
    this.error.set('');
    const email = this.account.user()?.email.trim().toLowerCase() ?? '';
    const promise = this.fetchAndMigrate(owner, email);
    this.pendingLoad = { owner, promise };
    await promise;
    if (this.pendingLoad?.promise === promise) this.pendingLoad = null;
  }

  private async fetchAndMigrate(owner: string, email: string): Promise<void> {
    try {
      let items = await firstValueFrom(this.http.get<SavedAddress[]>(API));
      if (this.owner() === owner) this.state.set({ owner, items: Array.isArray(items) ? items : [] });
      // Only import this signed-in customer's old address book, never the guest book.
      for (const address of this.legacy[email] ?? []) {
        if (this.owner() !== owner) return;
        if (!items.some(item => item.id === address.id || this.sameAddress(item, address))) {
          // Preserve an existing server default when another device imports old data.
          items = await firstValueFrom(this.http.post<SavedAddress[]>(API, {
            ...address, mobile: address.mobile.replace(/\D/g, '').slice(-10),
            isDefault: !items.length && address.isDefault,
          }));
        }
      }
      if (this.owner() !== owner) return;
      this.state.set({ owner, items: Array.isArray(items) ? items : [] });
      this.loadedOwner = owner;
      delete this.legacy[email];
      this.persistLegacy();
    } catch {
      if (this.owner() === owner) this.error.set('Saved addresses could not be loaded. Please retry.');
    } finally {
      if (this.owner() === owner) this.loading.set(false);
    }
  }

  async save(draft: AddressDraft, existingId?: string): Promise<void> {
    if (!this.owner()) {
      const id = existingId ?? crypto.randomUUID();
      const saved = { ...draft, id };
      const current = this.guest();
      const items = existingId ? current.map(item => item.id === id ? saved : item) : [...current, saved];
      this.saveGuest(this.normalizeDefault(items, draft.isDefault ? id : undefined));
      return;
    }
    // Avoid duplicate addresses on repeated checkout attempts.
    const equivalent = this.addresses().find(item => this.sameAddress(item, draft));
    const id = existingId ?? equivalent?.id;
    await this.mutate(() => id
      ? firstValueFrom(this.http.put<SavedAddress[]>(`${API}/${id}`, draft))
      : firstValueFrom(this.http.post<SavedAddress[]>(API, draft)));
  }

  async remove(id: string): Promise<void> {
    if (!this.owner()) { this.saveGuest(this.normalizeDefault(this.guest().filter(item => item.id !== id))); return; }
    await this.mutate(() => firstValueFrom(this.http.delete<SavedAddress[]>(`${API}/${id}`)));
  }

  async setDefault(id: string): Promise<void> {
    if (!this.owner()) { this.saveGuest(this.normalizeDefault(this.guest(), id)); return; }
    await this.mutate(() => firstValueFrom(this.http.patch<SavedAddress[]>(`${API}/${id}/default`, {})));
  }

  private async mutate(request: () => Promise<SavedAddress[]>): Promise<void> {
    if (this.saving()) throw new Error('An address change is already in progress.');
    const owner = this.owner();
    this.saving.set(true);
    this.error.set('');
    try {
      const items = await request();
      if (this.owner() === owner) this.state.set({ owner, items });
    } catch (error) {
      if (this.owner() === owner) this.error.set('Your address change could not be saved. Please retry.');
      throw error;
    } finally {
      this.saving.set(false);
    }
  }

  private owner(): string { const user = this.account.user(); return user ? (user.id || user.email.toLowerCase()) : ''; }
  private sameAddress(a: AddressDraft, b: AddressDraft): boolean {
    return (['fullName', 'mobile', 'house', 'street', 'landmark', 'pinCode', 'city', 'state'] as const)
      .every(key => a[key].trim().toLowerCase() === b[key].trim().toLowerCase());
  }
  private normalizeDefault(items: SavedAddress[], preferredId?: string): SavedAddress[] {
    const id = (preferredId && items.some(item => item.id === preferredId) ? preferredId : undefined)
      ?? items.find(item => item.isDefault)?.id ?? items[0]?.id;
    return items.map(item => ({ ...item, isDefault: item.id === id }));
  }
  private saveGuest(items: SavedAddress[]): void {
    this.guest.set(items);
    this.legacy['guest'] = items;
    this.persistLegacy();
  }
  private persistLegacy(): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.legacy)); } catch { /* storage may be unavailable */ }
  }
  private readStore(): Record<string, SavedAddress[]> {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      return Object.fromEntries(Object.entries(parsed).filter(([, value]) => Array.isArray(value)));
    } catch { return {}; }
  }
}
