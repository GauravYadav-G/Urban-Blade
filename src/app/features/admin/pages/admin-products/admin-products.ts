import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService, type AdminProduct } from '@core/services/admin.service';
import { AccountService } from '@core/services/account.service';
import { ProductDrawer } from '../../components/product-drawer/product-drawer';

@Component({
  selector: 'app-admin-products',
  standalone: true,
  imports: [CommonModule, FormsModule, ProductDrawer],
  templateUrl: './admin-products.html',
  styleUrl: './admin-products.scss',
})
export class AdminProducts implements OnInit {
  readonly admin = inject(AdminService);
  readonly account = inject(AccountService);

  readonly searchQuery = signal('');
  readonly selectedCategory = signal<string>('all');
  readonly selectedKind = signal<string>('all');
  readonly selectedStockFilter = signal<'all' | 'in-stock' | 'low-stock' | 'out-of-stock'>('all');

  readonly drawerOpen = signal(false);
  readonly editingProduct = signal<AdminProduct | null>(null);

  ngOnInit(): void {
    this.admin.refreshProducts();
  }

  refreshFromDb(): void {
    this.admin.refreshProducts(true);
  }

  readonly stockCounts = computed(() => {
    const list = this.admin.products();
    return {
      all: list.length,
      inStock: list.filter((p) => p.inStock && (p.stock_quantity ?? 0) > 0).length,
      lowStock: list.filter((p) => (p.stock_quantity ?? 0) > 0 && (p.stock_quantity ?? 0) <= 15).length,
      outOfStock: list.filter((p) => !p.inStock || (p.stock_quantity ?? 0) <= 0).length,
    };
  });

  readonly filteredProducts = computed(() => {
    let list = this.admin.products();
    const isVendor = this.account.isVendor();
    const activeVendor = this.account.activeVendorName()?.toLowerCase();
    const q = this.searchQuery().trim().toLowerCase();
    const cat = this.selectedCategory();
    const kind = this.selectedKind();
    const stock = this.selectedStockFilter();

    if (isVendor && activeVendor) {
      list = list.filter(
        (p) =>
          p.vendor?.toLowerCase() === activeVendor ||
          p.vendor?.toLowerCase().includes(activeVendor)
      );
    }

    if (cat !== 'all') {
      list = list.filter((p) => p.category === cat);
    }
    if (kind !== 'all') {
      list = list.filter((p) => p.kind === kind);
    }
    if (stock === 'in-stock') {
      list = list.filter((p) => p.inStock && (p.stock_quantity ?? 0) > 0);
    } else if (stock === 'low-stock') {
      list = list.filter((p) => (p.stock_quantity ?? 0) > 0 && (p.stock_quantity ?? 0) <= 15);
    } else if (stock === 'out-of-stock') {
      list = list.filter((p) => !p.inStock || (p.stock_quantity ?? 0) <= 0);
    }

    if (q) {
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.vendor.toLowerCase().includes(q)
      );
    }
    return list;
  });

  openCreate(): void {
    if (this.account.isVendor()) {
      this.editingProduct.set({
        vendor: this.account.activeVendorName() || 'Vendor Partner',
      } as any);
    } else {
      this.editingProduct.set(null);
    }
    this.drawerOpen.set(true);
  }

  openEdit(product: AdminProduct): void {
    this.editingProduct.set(product);
    this.drawerOpen.set(true);
  }

  duplicateProduct(product: AdminProduct): void {
    const cloned: Partial<AdminProduct> = {
      ...product,
      id: '',
      name: `${product.name} (Copy)`,
      slug: `${product.slug || product.id}-copy-${Date.now().toString().slice(-4)}`,
    };
    this.editingProduct.set(cloned as AdminProduct);
    this.drawerOpen.set(true);
  }

  getDiscountPercent(price: number, compareAt?: number): number | null {
    if (!compareAt || compareAt <= price) return null;
    return Math.round(((compareAt - price) / compareAt) * 100);
  }

  closeDrawer(): void {
    this.drawerOpen.set(false);
  }

  onSave(product: Partial<AdminProduct>): void {
    if (this.account.isVendor() && this.account.activeVendorName()) {
      product.vendor = this.account.activeVendorName()!;
    }
    this.admin.saveProduct(product);
  }

  onDelete(p: AdminProduct): void {
    if (confirm(`Are you sure you want to delete "${p.name}"?`)) {
      this.admin.deleteProduct(p.id);
    }
  }

  exportCSV(): void {
    const items = this.filteredProducts();
    const headers = ['ID', 'Name', 'Category', 'Price_INR', 'Compare_At_Price', 'Stock_Quantity', 'In_Stock', 'Badge', 'Rating'];
    const rows = items.map((p) => [
      p.id,
      `"${p.name.replace(/"/g, '""')}"`,
      p.category,
      p.price,
      p.compareAtPrice || '',
      p.stock_quantity ?? 100,
      p.inStock ? 'YES' : 'NO',
      p.badge || '',
      p.rating,
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `urbanblade_catalog_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  batchRestock(amount = 25): void {
    this.filteredProducts().forEach((p) => {
      this.admin.updateStock(p.id, amount);
    });
  }
}
