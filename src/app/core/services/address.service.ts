import { Injectable, computed, inject, signal } from '@angular/core';
import { AccountService } from '@core/services/account.service';
import type { AddressDraft, SavedAddress } from '@core/models/address.model';

const STORAGE_KEY = 'urban-blade-addresses';

@Injectable({ providedIn: 'root' })
export class AddressService {
  private readonly account = inject(AccountService);
  private readonly storeSignal = signal<Record<string, SavedAddress[]>>(this.readStore());

  readonly addresses = computed(() => {
    const key = this.userKey();
    return key ? (this.storeSignal()[key] ?? []) : [];
  });

  save(draft: AddressDraft, existingId?: string): void {
    const key = this.userKey();
    if (!key) {
      return;
    }

    this.storeSignal.update((store) => {
      const current = store[key] ?? [];
      const id = existingId ?? crypto.randomUUID();
      const nextAddress: SavedAddress = { ...draft, id };
      const merged = existingId
        ? current.map((item) => (item.id === id ? nextAddress : item))
        : [...current, nextAddress];

      const normalized = this.normalizeDefault(merged, nextAddress);
      const next = { ...store, [key]: normalized };
      this.persist(next);
      return next;
    });
  }

  remove(id: string): void {
    const key = this.userKey();
    if (!key) {
      return;
    }

    this.storeSignal.update((store) => {
      const current = store[key] ?? [];
      const remaining = current.filter((item) => item.id !== id);
      if (remaining.length && !remaining.some((item) => item.isDefault)) {
        remaining[0] = { ...remaining[0], isDefault: true };
      }
      const next = { ...store, [key]: remaining };
      this.persist(next);
      return next;
    });
  }

  setDefault(id: string): void {
    const key = this.userKey();
    if (!key) {
      return;
    }

    this.storeSignal.update((store) => {
      const current = store[key] ?? [];
      const next = {
        ...store,
        [key]: current.map((item) => ({ ...item, isDefault: item.id === id })),
      };
      this.persist(next);
      return next;
    });
  }

  private userKey(): string | null {
    const email = this.account.user()?.email?.trim().toLowerCase();
    return email || null;
  }

  private normalizeDefault(addresses: SavedAddress[], saved: SavedAddress): SavedAddress[] {
    if (addresses.length === 1) {
      return [{ ...addresses[0], isDefault: true }];
    }
    if (!saved.isDefault) {
      return addresses.some((item) => item.isDefault)
        ? addresses
        : addresses.map((item, index) => ({ ...item, isDefault: index === 0 }));
    }
    return addresses.map((item) => ({ ...item, isDefault: item.id === saved.id }));
  }

  private persist(store: Record<string, SavedAddress[]>): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      /* ignore quota / private mode */
    }
  }

  private readStore(): Record<string, SavedAddress[]> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Record<string, SavedAddress[]>) : {};
    } catch {
      return {};
    }
  }
}
