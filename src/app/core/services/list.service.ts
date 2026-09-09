import { Injectable, computed, inject, signal } from '@angular/core';
import { CatalogService } from '@core/services/catalog.service';
import type { Product } from '@core/models/product.model';

const STORAGE_KEY = 'urban-blade-list';

@Injectable({ providedIn: 'root' })
export class ListService {
  private readonly catalog = inject(CatalogService);
  private readonly idsSignal = signal<string[]>(this.readStored());

  readonly products = computed<Product[]>(() =>
    this.idsSignal()
      .map((id) => this.catalog.byId(id))
      .filter((item): item is Product => Boolean(item)),
  );

  has(productId: string): boolean {
    return this.idsSignal().includes(productId);
  }

  toggle(productId: string): void {
    if (!this.catalog.byId(productId)) {
      return;
    }
    this.idsSignal.update((ids) => {
      const next = ids.includes(productId) ? ids.filter((id) => id !== productId) : [productId, ...ids];
      this.persist(next);
      return next;
    });
  }

  remove(productId: string): void {
    this.idsSignal.update((ids) => {
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
