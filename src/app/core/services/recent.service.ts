import { Injectable, computed, inject, signal } from '@angular/core';
import { CatalogService } from '@core/services/catalog.service';
import type { Product } from '@core/models/product.model';

const STORAGE_KEY = 'urban-blade-recent';
const LIMIT = 16;

@Injectable({ providedIn: 'root' })
export class RecentService {
  private readonly catalog = inject(CatalogService);
  private readonly idsSignal = signal<string[]>(this.readStored());

  readonly products = computed<Product[]>(() =>
    this.idsSignal()
      .map((id) => this.catalog.byId(id))
      .filter((item): item is Product => Boolean(item)),
  );

  record(productId: string): void {
    if (!this.catalog.byId(productId)) {
      return;
    }
    this.idsSignal.update((ids) => {
      const next = [productId, ...ids.filter((id) => id !== productId)].slice(0, LIMIT);
      this.persist(next);
      return next;
    });
  }

  clear(): void {
    this.idsSignal.set([]);
    this.persist([]);
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
