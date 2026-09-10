import { Component, input, output, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { AdminProduct } from '@core/services/admin.service';

@Component({
  selector: 'app-product-drawer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    @if (open()) {
      <div class="drawer-backdrop" (click)="close.emit()">
        <div class="drawer-panel" (click)="$event.stopPropagation()">
          <div class="drawer-header">
            <div>
              <span class="drawer-badge">{{ isEdit() ? 'EDIT ITEM' : 'NEW CATALOG ITEM' }}</span>
              <h2>{{ isEdit() ? 'Product Studio' : 'Create Salon Product' }}</h2>
            </div>
            <button type="button" class="close-btn" (click)="close.emit()">✕</button>
          </div>

          <div class="drawer-content">
            <!-- Left: Form -->
            <form class="drawer-form" (submit)="onSubmit($event)">
              <label>
                <span>Product Name *</span>
                <input type="text" [(ngModel)]="form.name" name="name" required placeholder="e.g. Keratin Smooth Shampoo" />
              </label>

              <div class="form-row">
                <label>
                  <span>Selling Price (₹) *</span>
                  <input type="number" [(ngModel)]="form.price" name="price" required min="0" />
                </label>
                <label>
                  <span>Compare MRP (₹)</span>
                  <input type="number" [(ngModel)]="form.compareAtPrice" name="compareAtPrice" min="0" placeholder="Optional" />
                </label>
              </div>

              <div class="form-row">
                <label>
                  <span>Category</span>
                  <select [(ngModel)]="form.category" name="category">
                    <option value="hair">Hair Care</option>
                    <option value="beard">Beard & Moustache</option>
                    <option value="skin">Skin & Facials</option>
                    <option value="tools">Salon Tools</option>
                    <option value="gifts">Gift Cards</option>
                    <option value="services">Salon Services</option>
                  </select>
                </label>
                <label>
                  <span>Stock Quantity</span>
                  <input type="number" [(ngModel)]="form.stock_quantity" name="stock_quantity" min="0" />
                </label>
              </div>

              <div class="form-row">
                <label>
                  <span>Audience</span>
                  <select [(ngModel)]="form.audience" name="audience">
                    <option value="unisex">Unisex</option>
                    <option value="men">Men</option>
                    <option value="ladies">Ladies</option>
                  </select>
                </label>
                <label>
                  <span>Merchandising Badge</span>
                  <select [(ngModel)]="form.badge" name="badge">
                    <option [ngValue]="undefined">None</option>
                    <option value="deal">Today's Deal 🔥</option>
                    <option value="bestseller">Bestseller ⭐</option>
                    <option value="new">New Arrival ✨</option>
                  </select>
                </label>
              </div>

              <label>
                <span>Image URL</span>
                <input type="text" [(ngModel)]="form.imageUrl" name="imageUrl" placeholder="/images/products/..." />
              </label>

              <label>
                <span>Short Description</span>
                <textarea [(ngModel)]="form.description" name="description" rows="2" placeholder="Brief summary on the floor"></textarea>
              </label>

              <label>
                <span>Salon Floor Long Description</span>
                <textarea [(ngModel)]="form.longDescription" name="longDescription" rows="3" placeholder="Application steps, ingredients..."></textarea>
              </label>

              <div class="drawer-actions">
                <button type="submit" class="btn-save">
                  {{ isEdit() ? 'Update & Sync Store' : 'Publish Product' }}
                </button>
                <button type="button" class="btn-cancel" (click)="close.emit()">Cancel</button>
              </div>
            </form>

            <!-- Right: Live Storefront Card Preview -->
            <div class="drawer-preview">
              <span class="preview-tag">LIVE STOREFRONT PREVIEW</span>
              <div class="preview-card">
                <div class="preview-img-wrap">
                  <img [src]="form.imageUrl || '/images/products/hc-shampoo.jpg'" alt="Preview" />
                  @if (form.badge) {
                    <span class="preview-badge">{{ form.badge }}</span>
                  }
                </div>
                <div class="preview-info">
                  <span class="preview-cat">{{ form.category | uppercase }}</span>
                  <h4 class="preview-name">{{ form.name || 'Product Title' }}</h4>
                  <p class="preview-desc">{{ form.description || 'Description will appear here.' }}</p>
                  <div class="preview-price">
                    <span class="price-val">₹{{ form.price || 0 }}</span>
                    @if (form.compareAtPrice) {
                      <span class="price-strike">₹{{ form.compareAtPrice }}</span>
                    }
                  </div>
                  <div class="preview-stock-pill" [class.out]="(form.stock_quantity ?? 0) <= 0">
                    {{ (form.stock_quantity ?? 0) > 0 ? (form.stock_quantity + ' in stock') : 'Out of stock' }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    }
  `,
  styles: [
    `
      .drawer-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(15, 23, 42, 0.45);
        backdrop-filter: blur(4px);
        z-index: 100;
        display: flex;
        justify-content: flex-end;
      }
      .drawer-panel {
        width: 100%;
        max-width: 820px;
        background: #ffffff;
        color: #0f172a;
        height: 100%;
        display: flex;
        flex-direction: column;
        animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        box-shadow: -10px 0 40px rgba(0, 0, 0, 0.12);
        border-left: 1px solid #e2e8f0;
      }
      @keyframes slideIn {
        from {
          transform: translateX(100%);
        }
        to {
          transform: translateX(0);
        }
      }
      .drawer-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1.5rem 2rem;
        border-bottom: 1px solid #e2e8f0;
      }
      .drawer-badge {
        font-size: 0.65rem;
        font-weight: 800;
        color: #b45309;
        letter-spacing: 0.08em;
      }
      .drawer-header h2 {
        font-size: 1.25rem;
        font-weight: 800;
        color: #0f172a;
        margin: 0.2rem 0 0;
      }
      .close-btn {
        background: #f1f5f9;
        border: 1px solid #e2e8f0;
        color: #64748b;
        width: 34px;
        height: 34px;
        border-radius: 8px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1rem;
        transition: all 0.2s;
      }
      .close-btn:hover {
        background: #e2e8f0;
        color: #0f172a;
      }
      .drawer-content {
        flex: 1;
        overflow-y: auto;
        padding: 2rem;
        display: grid;
        grid-template-columns: 1.2fr 0.8fr;
        gap: 2rem;
      }
      .drawer-form {
        display: flex;
        flex-direction: column;
        gap: 1.15rem;
      }
      .form-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1rem;
      }
      label {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
      }
      label span {
        font-size: 0.75rem;
        font-weight: 700;
        color: #334155;
      }
      input,
      select,
      textarea {
        background: #ffffff;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        color: #0f172a;
        padding: 0.6rem 0.85rem;
        font-size: 0.85rem;
        outline: none;
        transition: border-color 0.2s;
      }
      input:focus,
      select:focus,
      textarea:focus {
        border-color: #f59e0b;
        box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.15);
      }
      .drawer-actions {
        display: flex;
        gap: 0.75rem;
        margin-top: 1rem;
        padding-top: 1rem;
        border-top: 1px solid #e2e8f0;
      }
      .btn-save {
        flex: 1;
        background: linear-gradient(135deg, #f59e0b, #d97706);
        border: none;
        color: #ffffff;
        font-weight: 700;
        padding: 0.75rem;
        border-radius: 8px;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(245, 158, 11, 0.35);
        transition: opacity 0.2s;
      }
      .btn-save:hover {
        opacity: 0.92;
      }
      .btn-cancel {
        background: #ffffff;
        border: 1px solid #cbd5e1;
        color: #475569;
        font-weight: 600;
        padding: 0.75rem 1.25rem;
        border-radius: 8px;
        cursor: pointer;
      }
      .btn-cancel:hover {
        background: #f8fafc;
        color: #0f172a;
      }
      .drawer-preview {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .preview-tag {
        font-size: 0.65rem;
        font-weight: 700;
        color: #64748b;
        letter-spacing: 0.08em;
      }
      .preview-card {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        overflow: hidden;
      }
      .preview-img-wrap {
        height: 180px;
        background: #ffffff;
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        border-bottom: 1px solid #f1f5f9;
      }
      .preview-img-wrap img {
        max-height: 100%;
        max-width: 100%;
        object-fit: contain;
      }
      .preview-badge {
        position: absolute;
        top: 8px;
        left: 8px;
        background: #fef3c7;
        color: #92400e;
        border: 1px solid #fde68a;
        font-size: 0.65rem;
        font-weight: 700;
        padding: 0.15rem 0.45rem;
        border-radius: 4px;
        text-transform: uppercase;
      }
      .preview-info {
        padding: 1rem;
      }
      .preview-cat {
        font-size: 0.65rem;
        color: #b45309;
        font-weight: 700;
      }
      .preview-name {
        font-size: 0.95rem;
        font-weight: 700;
        color: #0f172a;
        margin: 0.25rem 0 0.4rem;
      }
      .preview-desc {
        font-size: 0.75rem;
        color: #64748b;
        margin: 0 0 0.75rem;
        line-height: 1.4;
      }
      .preview-price {
        display: flex;
        align-items: baseline;
        gap: 0.5rem;
        margin-bottom: 0.5rem;
      }
      .price-val {
        font-size: 1.15rem;
        font-weight: 700;
        color: #d97706;
      }
      .price-strike {
        font-size: 0.8rem;
        color: #6b7280;
        text-decoration: line-through;
      }
      .preview-stock-pill {
        display: inline-block;
        font-size: 0.7rem;
        padding: 0.15rem 0.5rem;
        border-radius: 9999px;
        background: #ecfdf5;
        color: #047857;
        border: 1px solid #a7f3d0;
        font-weight: 700;
      }
      .preview-stock-pill.out {
        background: #fef2f2;
        color: #b91c1c;
        border: 1px solid #fecaca;
      }
    `,
  ],
})
export class ProductDrawer {
  readonly open = input<boolean>(false);
  readonly product = input<AdminProduct | null>(null);
  readonly save = output<Partial<AdminProduct>>();
  readonly close = output<void>();

  readonly isEdit = signal(false);

  form: any = {
    name: '',
    price: 499,
    compareAtPrice: null,
    category: 'hair',
    kind: 'retail',
    vendor: 'Urban Blade Lab',
    audience: 'unisex',
    stock_quantity: 100,
    imageUrl: '/images/products/hc-shampoo.jpg',
    description: '',
    longDescription: '',
    badge: undefined,
  };

  constructor() {
    effect(() => {
      const p = this.product();
      if (p) {
        this.isEdit.set(true);
        this.form = { ...p, stock_quantity: p.stock_quantity ?? 100 };
      } else {
        this.isEdit.set(false);
        this.form = {
          name: '',
          price: 499,
          compareAtPrice: null,
          category: 'hair',
          kind: 'retail',
          vendor: 'Urban Blade Lab',
          audience: 'unisex',
          stock_quantity: 100,
          imageUrl: '/images/products/hc-shampoo.jpg',
          description: '',
          longDescription: '',
          badge: undefined,
        };
      }
    });
  }

  onSubmit(e: Event): void {
    e.preventDefault();
    this.save.emit(this.form);
    this.close.emit();
  }
}
