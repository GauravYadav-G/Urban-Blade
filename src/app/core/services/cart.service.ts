import { Injectable, computed, signal } from '@angular/core';
import { lineFromProduct, type CartLine } from '@core/models/cart.model';
import type { Product } from '@core/models/product.model';

export interface CartAddToast {
  productId: string;
  productName: string;
  imageUrl: string;
  qty: number;
  lineQty: number;
  itemCount: number;
}

const STORAGE_KEY = 'urban-blade-cart';
export const CART_TOAST_DURATION_MS = 4000;
export const MAX_CART_QTY = 8;

@Injectable({ providedIn: 'root' })
export class CartService {
  private readonly linesSignal = signal<CartLine[]>(this.readStored());
  private readonly toastSignal = signal<CartAddToast | null>(null);
  syncToServer?: (items: CartLine[]) => void;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  readonly lines = this.linesSignal.asReadonly();
  readonly addToast = this.toastSignal.asReadonly();
  readonly itemCount = computed(() => this.linesSignal().reduce((sum, line) => sum + line.qty, 0));
  readonly subtotal = computed(() =>
    this.linesSignal().reduce((sum, line) => sum + line.unitPrice * line.qty, 0),
  );

  mergeServerCart(items: CartLine[]): void {
    const valid = Array.isArray(items)
      ? items
          .filter(i => i && typeof i.productId === 'string' && Number.isInteger(i.qty) && i.qty > 0 && Number.isFinite(i.unitPrice))
          .map(i => ({ ...i, qty: Math.min(i.qty, MAX_CART_QTY) }))
      : [];
    const merged = new Map(valid.map(i => [i.productId, i]));
    for (const local of this.linesSignal()) merged.set(local.productId, local);
    const next = Array.from(merged.values()).slice(0, 100);
    this.linesSignal.set(next); this.persist(next);
  }

  addProduct(product: Product, qty = 1): void {
    if (!product.inStock || !Number.isInteger(qty) || qty < 1) return;
    qty = Math.min(qty, MAX_CART_QTY);
    this.linesSignal.update((current) => {
      const existing = current.find((l) => l.productId === product.id);
      const next = existing
        ? current.map((l) => (l.productId === product.id ? { ...l, qty: Math.min(l.qty + qty, MAX_CART_QTY) } : l))
        : [...current, lineFromProduct(product, qty)];
      this.persist(next);
      return next;
    });
    this.showToast(product, qty);
  }

  updateQty(lineId: string, qty: number): void {
    if (!Number.isInteger(qty)) return;
    if (qty < 1) {
      this.removeLine(lineId);
      return;
    }
    const clampedQty = Math.min(qty, MAX_CART_QTY);
    this.linesSignal.update((lines) => {
      const next = lines.map((l) => (l.lineId === lineId ? { ...l, qty: clampedQty } : l));
      this.persist(next);
      return next;
    });
  }

  updatePrices(prices: Array<{ productId: string; slug?: string; unitPrice: number }>): void {
    const next = this.linesSignal().map(line => {
      const price = prices.find(item =>
        item.productId === line.productId ||
        (line.slug && item.productId === line.slug) ||
        (item.slug && (item.slug === line.productId || item.slug === line.slug))
      );
      if (price) {
        return {
          ...line,
          productId: price.productId || line.productId,
          slug: price.slug || line.slug,
          unitPrice: price.unitPrice,
        };
      }
      return line;
    });
    this.linesSignal.set(next);
    this.persist(next);
  }

  removeLine(lineId: string): void {
    this.linesSignal.update((lines) => {
      const next = lines.filter((l) => l.lineId !== lineId);
      this.persist(next);
      return next;
    });
  }

  clear(): void {
    this.linesSignal.set([]);
    this.persist([]);
  }

  dismissToast(): void {
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
      this.toastTimer = undefined;
    }
    this.toastSignal.set(null);
  }

  private showToast(product: Product, qty: number): void {
    this.dismissToast();
    const line = this.linesSignal().find((l) => l.productId === product.id);
    this.toastSignal.set({
      productId: product.id,
      productName: product.name,
      imageUrl: product.imageUrl,
      qty,
      lineQty: line?.qty ?? qty,
      itemCount: this.itemCount(),
    });
    this.toastTimer = setTimeout(() => this.dismissToast(), CART_TOAST_DURATION_MS);
  }

  private persist(lines: CartLine[]): void {
    this.syncToServer?.(lines);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {
      /* ignore quota / private mode */
    }
  }

  private readStored(): CartLine[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as CartLine[];
      return Array.isArray(parsed)
        ? parsed.map(l => ({ ...l, qty: Math.min(Math.max(1, Number(l.qty) || 1), MAX_CART_QTY) }))
        : [];
    } catch {
      return [];
    }
  }
}
