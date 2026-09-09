import { Injectable, signal } from '@angular/core';
import { PRODUCTS } from '@core/data/products.data';
import type { Product, ProductCategory } from '@core/models/product.model';

export interface CatalogQuery {
  q?: string;
  cat?: string;
  deals?: boolean;
  audience?: string;
  sort?: 'featured' | 'price-asc' | 'price-desc' | 'rating';
}

const CATALOG_STORAGE_KEY = 'urban-blade-admin-products';

@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly productsSignal = signal<Product[]>(this.readInitialProducts());
  readonly products = this.productsSignal.asReadonly();

  readonly categories: { slug: ProductCategory; label: string }[] = [
    { slug: 'hair', label: 'Hair Care' },
    { slug: 'beard', label: 'Beard & Moustache' },
    { slug: 'skin', label: 'Skin' },
    { slug: 'tools', label: 'Tools' },
    { slug: 'gifts', label: 'Gift Cards' },
    { slug: 'services', label: 'Salon Services' },
  ];

  all(): Product[] {
    return this.productsSignal();
  }

  byId(id: string): Product | undefined {
    return this.productsSignal().find((p) => p.id === id || p.slug === id);
  }

  deals(): Product[] {
    return this.productsSignal().filter((p) => p.compareAtPrice && p.compareAtPrice > p.price);
  }

  bestsellers(): Product[] {
    return [...this.productsSignal()].sort((a, b) => b.reviewCount - a.reviewCount).slice(0, 12);
  }

  byCategory(cat: ProductCategory): Product[] {
    return this.productsSignal().filter((p) => p.category === cat);
  }

  upsertProduct(product: Product): void {
    this.productsSignal.update((list) => {
      const idx = list.findIndex((p) => p.id === product.id || p.slug === product.slug);
      let updated: Product[];
      if (idx > -1) {
        const next = [...list];
        next[idx] = { ...next[idx], ...product };
        updated = next;
      } else {
        updated = [product, ...list];
      }
      this.persistCatalog(updated);
      return updated;
    });
  }

  deleteProduct(id: string): void {
    this.productsSignal.update((list) => {
      const updated = list.filter((p) => p.id !== id && p.slug !== id);
      this.persistCatalog(updated);
      return updated;
    });
  }

  private readInitialProducts(): Product[] {
    try {
      const raw = localStorage.getItem(CATALOG_STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return PRODUCTS;
  }

  private persistCatalog(items: Product[]): void {
    try {
      localStorage.setItem(CATALOG_STORAGE_KEY, JSON.stringify(items));
    } catch {}
  }

  related(product: Product, limit = 8): Product[] {
    return this.productsSignal()
      .filter((p) => p.id !== product.id)
      .sort((a, b) => {
        const score = (item: Product) =>
          (item.category === product.category ? 8 : 0) +
          (item.compareAtPrice ? 2 : 0) +
          (item.badge === 'bestseller' ? 1 : 0) +
          item.reviewCount / 400;
        return score(b) - score(a);
      })
      .slice(0, limit);
  }

  search(query: CatalogQuery): Product[] {
    let list = [...this.productsSignal()];
    const q = query.q?.trim().toLowerCase();
    const cat = query.cat && query.cat !== 'all' ? query.cat : undefined;

    if (cat) {
      list = list.filter((p) => p.category === cat);
    }
    if (q) {
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.vendor.toLowerCase().includes(q) ||
          p.category.includes(q),
      );
    }
    if (query.deals) {
      list = list.filter((p) => p.compareAtPrice && p.compareAtPrice > p.price);
    }
    if (query.audience) {
      list = list.filter((p) => p.audience === query.audience || p.audience === 'unisex');
    }

    switch (query.sort) {
      case 'price-asc':
        list.sort((a, b) => a.price - b.price);
        break;
      case 'price-desc':
        list.sort((a, b) => b.price - a.price);
        break;
      case 'rating':
        list.sort((a, b) => b.rating - a.rating);
        break;
      default:
        list.sort((a, b) => Number(!!b.badge) - Number(!!a.badge) || b.reviewCount - a.reviewCount);
    }

    return list;
  }

  suggestions(term: string, limit = 6): Product[] {
    if (!term.trim()) {
      return [];
    }
    return this.search({ q: term }).slice(0, limit);
  }
}