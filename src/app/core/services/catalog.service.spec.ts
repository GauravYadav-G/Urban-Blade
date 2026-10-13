import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { CatalogService } from './catalog.service';
import { ecommerceProduct } from '../testing/ecommerce-fixtures';

describe('Standard ecommerce product discovery', () => {
  let catalog: CatalogService;
  let http: HttpTestingController;
  const products = [
    ecommerceProduct({ id: 'hair', price: 500, compareAtPrice: 600, audience: 'men', rating: 4 }),
    ecommerceProduct({ id: 'skin', name: 'Face Cream', category: 'skin', description: 'Face care', price: 200, audience: 'ladies', rating: 5 }),
    ecommerceProduct({ id: 'beard', name: 'Beard Oil', category: 'beard', description: 'Beard care', price: 800, audience: 'unisex', rating: 3 }),
  ];
  beforeEach(async () => {
    localStorage.removeItem('urban-blade-catalog-v2');
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    catalog = TestBed.inject(CatalogService); http = TestBed.inject(HttpTestingController);
    http.expectOne(request => request.url.includes('/products?page=1')).flush({ data: products });
    await Promise.resolve();
  });
  afterEach(() => { http.verify(); localStorage.removeItem('urban-blade-catalog-v2'); });
  it('CAT-01 searches products without case sensitivity', () => { expect(catalog.search({ q: ' FACE ' }).map(p => p.id)).toEqual(['skin']); });
  it('CAT-02 filters by category', () => { expect(catalog.search({ cat: 'beard' }).map(p => p.id)).toEqual(['beard']); });
  it('CAT-03 filters deals using the actual comparison price', () => { expect(catalog.search({ deals: true }).map(p => p.id)).toEqual(['hair']); });
  it('CAT-04 sorts prices low to high', () => { expect(catalog.search({ sort: 'price-asc' }).map(p => p.price)).toEqual([200, 500, 800]); });
  it('CAT-05 sorts prices high to low', () => { expect(catalog.search({ sort: 'price-desc' }).map(p => p.price)).toEqual([800, 500, 200]); });
  it('CAT-06 sorts by rating', () => { expect(catalog.search({ sort: 'rating' }).map(p => p.rating)).toEqual([5, 4, 3]); });
  it('CAT-07 includes unisex products in an audience filter', () => { expect(catalog.search({ audience: 'men' }).map(p => p.id).sort()).toEqual(['beard', 'hair']); });
  it('CAT-08 returns an empty list for unmatched searches', () => { expect(catalog.search({ q: 'nonexistent product' })).toEqual([]); });
});
