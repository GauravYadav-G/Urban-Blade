import { Injectable, computed, inject, signal } from '@angular/core';
import { CatalogService } from '@core/services/catalog.service';
import type { Product } from '@core/models/product.model';

const STORAGE_KEY = 'urban-blade-list';

@Injectable({ providedIn: 'root' })
export class ListService {
  private readonly catalog = inject(CatalogService);
  private readonly idsSignal = signal<string[]>(this.readStored());

  readonly products = computed<Product[]>(() =>
    Array.from(new Set(this.idsSignal().map(id => this.catalog.byId(id)?.id || id)))
      .map((id) => this.catalog.byId(id))
      .filter((item): item is Product => Boolean(item)),
  );

  has(productId: string): boolean {
    const canonical = this.catalog.byId(productId)?.id || productId;
    return this.idsSignal().some(id => (this.catalog.byId(id)?.id || id) === canonical);
  }

  toggle(productId: string): void {
    if (!this.catalog.byId(productId)) {
      return;
    }
    productId = this.catalog.byId(productId)?.id || productId;
    this.idsSignal.update((stored) => {
      const ids = Array.from(new Set(stored.map(id => this.catalog.byId(id)?.id || id)));
      const next = ids.includes(productId) ? ids.filter((id) => id !== productId) : [productId, ...ids];
      this.persist(next);
      return next;
    });
  }

  remove(productId: string): void {
    productId = this.catalog.byId(productId)?.id || productId;
    this.idsSignal.update((stored) => {
      const ids = Array.from(new Set(stored.map(id => this.catalog.byId(id)?.id || id)));
      const next = ids.filter((id) => id !== productId);
      this.persist(next);
      return next;
    });
  }

  private persist(ids: string[]): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    } catch {
      /* ignore */
    }
  }

  private readStored(): string[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  }
}
