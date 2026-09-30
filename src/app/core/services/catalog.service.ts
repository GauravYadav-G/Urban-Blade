import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { PRODUCTS } from '@core/data/products.data';
import type { Product, ProductCategory, MarketplacePrice, PriceComparison, Marketplace } from '@core/models/product.model';
import { Observable, of, catchError, firstValueFrom } from 'rxjs';

export interface CatalogQuery {
  q?: string;
  cat?: string;
  deals?: boolean;
  audience?: string;
  sort?: 'featured' | 'price-asc' | 'price-desc' | 'rating';
  page?: number;
  limit?: number;
}

export interface PaginatedProducts {
  items: Product[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const CATALOG_STORAGE_KEY = 'urban-blade-admin-products';

const API_BASE =
  typeof window !== 'undefined' && window.location.port === '4200'
    ? 'http://localhost:4000/api'
    : '/api';

@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly http = inject(HttpClient);
  private readonly productsSignal = signal<Product[]>(this.readInitialProducts());
  readonly products = this.productsSignal.asReadonly();
  readonly loading = signal(true);
  readonly loadError = signal('');

  constructor() { void this.refreshCatalog(); }

  async refreshCatalog(): Promise<void> {
    this.loading.set(true);
    const products: Product[] = [];
    try {
      for (let page = 1; page <= 100; page++) {
        const result = await firstValueFrom(this.http.get<{ data: Product[] }>(`${API_BASE}/products?page=${page}&limit=100`));
        products.push(...result.data);
        if (result.data.length < 100) break;
      }
      this.productsSignal.set(products);
      this.persistCatalog(products);
      this.loadError.set('');
    } catch {
      this.loadError.set('The catalog is temporarily unavailable. Please try again.');
    } finally { this.loading.set(false); }
  }

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

  /** Fetch price comparison for a product from the backend */
  getPriceComparison(productId: string): Observable<PriceComparison> {
    return this.http.get<PriceComparison>(`${API_BASE}/products/${productId}/compare`).pipe(
      catchError((err) => {
        console.warn('Price comparison fetch failed:', err.message);
        return of({
          productId,
          ourPrice: 0,
          ourCompareAtPrice: null,
          marketplacePrices: [],
          bestMarketplacePrice: null,
          lastRefreshed: null,
          error: 'Failed to fetch price comparison',
        });
      })
    );
  }

  /** Trigger a price refresh for marketplace links (admin only) */
  refreshPrices(): Observable<{ success: boolean; message: string; products: any[] }> {
    return this.http.post<{ success: boolean; message: string; products: any[] }>(
      `${API_BASE}/admin/marketplace/refresh`,
      {}
    ).pipe(
      catchError((err) => {
        console.warn('Price refresh failed:', err.message);
        return of({ success: false, message: err.message, products: [] });
      })
    );
  }

  /** Add or update a marketplace link for a product (admin only) */
  upsertMarketplaceLink(productId: string, marketplace: Marketplace, url: string, price?: number): Observable<any> {
    return this.http.post(`${API_BASE}/admin/products/${productId}/marketplace`, { marketplace, url, price }).pipe(
      catchError((err) => {
        console.warn('Marketplace link upsert failed:', err.message);
        return of({ success: false, error: err.message });
      })
    );
  }

  /** Delete a marketplace link for a product (admin only) */
  deleteMarketplaceLink(productId: string, marketplace: Marketplace): Observable<any> {
    return this.http.delete(`${API_BASE}/admin/products/${productId}/marketplace/${marketplace}`).pipe(
      catchError((err) => {
        console.warn('Marketplace link delete failed:', err.message);
        return of({ success: false, error: err.message });
      })
    );
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
    return [];
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

    // Apply pagination
    const page = query.page || 1;
    const limit = query.limit || 24;
    const start = (page - 1) * limit;
    const end = start + limit;

    return list.slice(start, end);
  }

  /** Search with pagination metadata */
  searchPaginated(query: CatalogQuery): PaginatedProducts {
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

    const page = query.page || 1;
    const limit = query.limit || 24;
    const total = list.length;
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const end = start + limit;

    return {
      items: list.slice(start, end),
      total,
      page,
      limit,
      totalPages,
    };
  }

  suggestions(term: string, limit = 6): Product[] {
    if (!term.trim()) {
      return [];
    }
    return this.search({ q: term }).slice(0, limit);
  }
}