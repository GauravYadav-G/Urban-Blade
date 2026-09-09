import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService, type AdminProduct } from '@core/services/admin.service';
import { ProductDrawer } from '../../components/product-drawer/product-drawer';

@Component({
  selector: 'app-admin-products',
  standalone: true,
  imports: [CommonModule, FormsModule, ProductDrawer],
  templateUrl: './admin-products.html',
  styleUrl: './admin-products.scss',
})
export class AdminProducts {
  readonly admin = inject(AdminService);

  readonly searchQuery = signal('');
  readonly selectedCategory = signal<string>('all');
  readonly selectedKind = signal<string>('all');

  readonly drawerOpen = signal(false);
  readonly editingProduct = signal<AdminProduct | null>(null);

  readonly filteredProducts = computed(() => {
    let list = this.admin.products();
    const q = this.searchQuery().trim().toLowerCase();
    const cat = this.selectedCategory();
    const kind = this.selectedKind();

    if (cat !== 'all') {
      list = list.filter((p) => p.category === cat);
    }
    if (kind !== 'all') {
      list = list.filter((p) => p.kind === kind);
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
    this.editingProduct.set(null);
    this.drawerOpen.set(true);
  }

  openEdit(product: AdminProduct): void {
    this.editingProduct.set(product);
    this.drawerOpen.set(true);
  }

  closeDrawer(): void {
    this.drawerOpen.set(false);
  }

  onSave(product: Partial<AdminProduct>): void {
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
