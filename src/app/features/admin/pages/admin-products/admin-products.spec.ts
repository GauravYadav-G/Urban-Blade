import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { AdminProducts } from './admin-products';
import { AdminService, type AdminProduct } from '@core/services/admin.service';
import { AccountService } from '@core/services/account.service';
import { ecommerceProduct } from '@core/testing/ecommerce-fixtures';

describe('Admin product management scenarios', () => {
  let page: AdminProducts;
  let vendor: boolean;
  let vendorName: string | null;
  let admin: { products: ReturnType<typeof signal<AdminProduct[]>>; saveProduct: jasmine.Spy };
  beforeEach(() => {
    vendor = false; vendorName = null;
    admin = { products: signal([
      ecommerceProduct({ id: 'own', vendor: 'Studio', stock_quantity: 20 }),
      ecommerceProduct({ id: 'other', vendor: 'Studio North', stock_quantity: 1 }),
      ecommerceProduct({ id: 'reserved', vendor: 'Studio', stock_quantity: 10, inStock: true }) as AdminProduct,
    ]), saveProduct: jasmine.createSpy('saveProduct') };
    admin.products.update(list => list.map(p => p.id === 'reserved' ? { ...p, stock_reserved: 10 } : p));
    TestBed.configureTestingModule({ providers: [
      { provide: AdminService, useValue: admin },
      { provide: AccountService, useValue: { isVendor: () => vendor, activeVendorName: () => vendorName } },
      { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({})) } },
    ] });
    page = TestBed.runInInjectionContext(() => new AdminProducts());
  });
  it('AP-01 filters low stock using sellable units', () => {
    page.selectedStockFilter.set('low-stock'); expect(page.filteredProducts().map(p => p.id)).toEqual(['other']);
  });
  it('AP-02 treats fully reserved stock as unavailable', () => {
    page.selectedStockFilter.set('out-of-stock'); expect(page.filteredProducts().map(p => p.id)).toEqual(['reserved']);
  });
  it('AP-03 matches search without case sensitivity', () => {
    page.searchQuery.set(' NORTH '); expect(page.filteredProducts().map(p => p.id)).toEqual(['other']);
  });
  it('AP-04 isolates vendors using exact names rather than prefixes', () => {
    vendor = true; vendorName = 'Studio'; expect(page.filteredProducts().map(p => p.id)).toEqual(['own', 'reserved']);
  });
  it('AP-05 hides vendor records when the tenant identity is missing', () => {
    vendor = true; expect(page.filteredProducts()).toEqual([]);
  });
  it('AP-06 prevents duplicate saves and preserves failed edits', () => {
    page.drawerOpen.set(true); page.onSave({ name: 'Edited' }); page.onSave({ name: 'Edited' });
    expect(admin.saveProduct).toHaveBeenCalledTimes(1); page.closeDrawer(); expect(page.drawerOpen()).toBeTrue();
    admin.saveProduct.calls.mostRecent().args[2](); expect(page.saving()).toBeFalse(); expect(page.drawerOpen()).toBeTrue();
  });
  it('AP-07 forces vendor ownership when saving', () => {
    vendor = true; vendorName = 'Studio'; page.onSave({ vendor: 'Another merchant', name: 'Serum' });
    expect(admin.saveProduct.calls.mostRecent().args[0].vendor).toBe('Studio');
  });
});
