import { Component, input, output, signal, effect, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { AdminProduct } from '@core/services/admin.service';

interface ImagePreset {
  name: string;
  url: string;
  category: string;
}

@Component({
  selector: 'app-product-drawer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    @if (open()) {
      <div class="studio-backdrop" (click)="close.emit()">
        <div class="studio-modal" (click)="$event.stopPropagation()">
          
          <!-- ═════════════════════════════════════════════════════════════════
               1. STUDIO HEADER BAR
               ═════════════════════════════════════════════════════════════════ -->
          <header class="studio-header">
            <div class="sh-left">
              <div class="sh-badge-row">
                <span class="studio-mode-badge" [class.create]="!isEdit()">
                  {{ isEdit() ? 'PRODUCT STUDIO · EDIT' : 'PRODUCT STUDIO · NEW' }}
                </span>
                @if (discountPercent() > 0) {
                  <span class="discount-pill">{{ discountPercent() }}% OFF</span>
                }
                @if (form.stock_quantity !== undefined) {
                  <span class="stock-pill" [class.out]="form.stock_quantity <= 0" [class.low]="form.stock_quantity > 0 && form.stock_quantity <= 15">
                    {{ form.stock_quantity <= 0 ? 'Out of Stock' : (form.stock_quantity <= 15 ? 'Low Stock (' + form.stock_quantity + ')' : form.stock_quantity + ' Available') }}
                  </span>
                }
              </div>
              <h2>{{ isEdit() ? (form.name || 'Edit Catalog Item') : 'Create New Product' }}</h2>
              <span class="sh-id-tag">ID: {{ form.id || 'Generated on save' }} · Slug: /product/{{ form.slug || 'slug' }}</span>
            </div>

            <div class="sh-actions">
              @if (isEdit()) {
                <button type="button" class="btn-ghost" (click)="duplicateItem()" title="Clone this item">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                  </svg>
                  <span>Clone</span>
                </button>
              }

              <button type="button" class="btn-cancel" (click)="close.emit()">Cancel</button>

              <button type="button" class="btn-save" (click)="submitForm()">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                  <polyline points="17 21 17 13 7 13 7 21"></polyline>
                  <polyline points="7 3 7 8 15 8"></polyline>
                </svg>
                <span>{{ isEdit() ? 'Update & Sync Storefront' : 'Publish Product' }}</span>
              </button>

              <button type="button" class="btn-close-modal" (click)="close.emit()" title="Close studio">✕</button>
            </div>
          </header>

          <!-- ═════════════════════════════════════════════════════════════════
               2. STUDIO TABBED NAVIGATION
               ═════════════════════════════════════════════════════════════════ -->
          <nav class="studio-nav">
            <button type="button" class="tab-btn" [class.active]="activeTab() === 'general'" (click)="activeTab.set('general')">
              <span>1. General &amp; Category</span>
            </button>
            <button type="button" class="tab-btn" [class.active]="activeTab() === 'pricing'" (click)="activeTab.set('pricing')">
              <span>2. Pricing &amp; Inventory</span>
            </button>
            <button type="button" class="tab-btn" [class.active]="activeTab() === 'media'" (click)="activeTab.set('media')">
              <span>3. Media &amp; Gallery Presets</span>
            </button>
            <button type="button" class="tab-btn" [class.active]="activeTab() === 'details'" (click)="activeTab.set('details')">
              <span>4. Highlights &amp; Floor Guide</span>
            </button>
          </nav>

          <!-- ═════════════════════════════════════════════════════════════════
               3. STUDIO BODY: FORM & REAL-TIME PREVIEW
               ═════════════════════════════════════════════════════════════════ -->
          <div class="studio-body">
            
            <!-- Main Form Canvas -->
            <div class="studio-form-canvas">

              <!-- TAB 1: GENERAL & CATALOG -->
              @if (activeTab() === 'general') {
                <div class="form-section">
                  <div class="fs-title">
                    <h3>Basic Catalog Information</h3>
                    <p>Core metadata displayed in storefront listings and category filters.</p>
                  </div>

                  <div class="form-group">
                    <label>Product Title *</label>
                    <input 
                      type="text" 
                      [(ngModel)]="form.name" 
                      (input)="onNameChange()" 
                      placeholder="e.g. Keratin Smooth Salon Shampoo" 
                      required 
                    />
                  </div>

                  <div class="form-row-2">
                    <div class="form-group">
                      <div class="label-with-action">
                        <label>URL Handle / Slug *</label>
                        <button type="button" class="btn-text-action" (click)="generateSlug()">Auto-Generate</button>
                      </div>
                      <input type="text" [(ngModel)]="form.slug" placeholder="e.g. keratin-smooth-shampoo" required />
                    </div>

                    <div class="form-group">
                      <label>Department / Category *</label>
                      <select [(ngModel)]="form.category">
                        <option value="hair">Hair Care (Shampoos, Oils, Clays)</option>
                        <option value="beard">Beard &amp; Moustache</option>
                        <option value="skin">Executive Skincare &amp; Facials</option>
                        <option value="tools">Salon Electricals &amp; Shears</option>
                        <option value="gifts">Gift Cards &amp; Experiences</option>
                        <option value="services">In-Salon Master Barber Services</option>
                      </select>
                    </div>
                  </div>

                  <div class="form-row-3">
                    <div class="form-group">
                      <label>Fulfillment Kind</label>
                      <select [(ngModel)]="form.kind">
                        <option value="retail">Retail (Shipped Doorstep)</option>
                        <option value="service">Salon Service (In-Store Booking)</option>
                        <option value="gift">Gift Voucher (Digital / Card)</option>
                      </select>
                    </div>

                    <div class="form-group">
                      <label>Audience</label>
                      <select [(ngModel)]="form.audience">
                        <option value="unisex">Unisex Formulated</option>
                        <option value="men">Men's Grooming</option>
                        <option value="ladies">Ladies Salon</option>
                      </select>
                    </div>

                    <div class="form-group">
                      <label>Vendor / Brand Partner</label>
                      <input type="text" [(ngModel)]="form.vendor" placeholder="e.g. Urban Blade Lab" />
                    </div>
                  </div>

                  <div class="form-row-3">
                    <div class="form-group">
                      <label>Merchandising Badge</label>
                      <select [(ngModel)]="form.badge">
                        <option [ngValue]="undefined">None</option>
                        <option value="deal">Today's Deal 🔥</option>
                        <option value="bestseller">Bestseller ⭐</option>
                        <option value="new">New Arrival ✨</option>
                      </select>
                    </div>

                    <div class="form-group">
                      <label>Star Rating (1.0 to 5.0)</label>
                      <input type="number" [(ngModel)]="form.rating" min="1" max="5" step="0.1" />
                    </div>

                    <div class="form-group">
                      <label>Review Count</label>
                      <input type="number" [(ngModel)]="form.reviewCount" min="0" />
                    </div>
                  </div>

                  <div class="checkbox-row">
                    <label class="custom-toggle">
                      <input type="checkbox" [(ngModel)]="form.freeDelivery" />
                      <span>Free Doorstep Delivery Eligible (across NCR)</span>
                    </label>
                  </div>
                </div>
              }

              <!-- TAB 2: PRICING & INVENTORY -->
              @if (activeTab() === 'pricing') {
                <div class="form-section">
                  <div class="fs-title">
                    <h3>Pricing, Margins &amp; Inventory Control</h3>
                    <p>Configure retail prices, strike-through compare MRP, and live warehouse inventory counts.</p>
                  </div>

                  <div class="form-row-2">
                    <div class="form-group">
                      <label>Selling Price (₹) *</label>
                      <div class="input-currency-wrap">
                        <span class="currency-symbol">₹</span>
                        <input type="number" [(ngModel)]="form.price" min="0" step="1" required />
                      </div>
                    </div>

                    <div class="form-group">
                      <label>Compare-at MRP (₹) (Optional Strike-through)</label>
                      <div class="input-currency-wrap">
                        <span class="currency-symbol">₹</span>
                        <input type="number" [(ngModel)]="form.compareAtPrice" min="0" step="1" placeholder="Leave blank if no discount" />
                      </div>
                    </div>
                  </div>

                  <!-- Margin & Discount Calculation Notice -->
                  <div class="discount-calculation-card">
                    <div class="dcc-icon">🏷️</div>
                    <div class="dcc-text">
                      <strong>Computed Storefront Discount: {{ discountPercent() }}% OFF</strong>
                      @if (discountPercent() > 0) {
                        <p>Customers will see a strike-through of ₹{{ form.compareAtPrice }} and save ₹{{ (form.compareAtPrice || 0) - (form.price || 0) }}.</p>
                      } @else {
                        <p>Product will be listed at standard retail price without discount badges.</p>
                      }
                    </div>
                  </div>

                  <div class="form-group">
                    <label>Current Stock Quantity</label>
                    <div class="stock-adjust-group">
                      <input type="number" [(ngModel)]="form.stock_quantity" min="0" class="stock-qty-input" />
                      <div class="quick-stock-buttons">
                        <button type="button" class="btn-stock-quick" (click)="adjustStock(-10)">-10</button>
                        <button type="button" class="btn-stock-quick" (click)="adjustStock(-1)">-1</button>
                        <button type="button" class="btn-stock-quick" (click)="adjustStock(10)">+10</button>
                        <button type="button" class="btn-stock-quick" (click)="adjustStock(25)">+25</button>
                        <button type="button" class="btn-stock-quick" (click)="adjustStock(50)">+50</button>
                      </div>
                    </div>
                  </div>

                  <div class="checkbox-row">
                    <label class="custom-toggle">
                      <input type="checkbox" [(ngModel)]="form.inStock" />
                      <span>Product Available for Purchase (In Stock)</span>
                    </label>
                  </div>
                </div>
              }

              <!-- TAB 3: MEDIA & GALLERY PRESETS -->
              @if (activeTab() === 'media') {
                <div class="form-section">
                  <div class="fs-title">
                    <h3>Visual Asset &amp; Image Presets</h3>
                    <p>Provide a custom image URL or select from our curated studio photography library.</p>
                  </div>

                  <div class="form-group">
                    <label>Primary Image URL *</label>
                    <div class="image-input-wrap">
                      <input type="text" [(ngModel)]="form.imageUrl" placeholder="/images/products/..." required />
                      <button type="button" class="btn-secondary-action" (click)="form.imageUrl = '/images/products/hc-shampoo.jpg'">Default</button>
                    </div>
                  </div>

                  <!-- Presets Gallery -->
                  <div class="presets-gallery-container">
                    <div class="pg-header">
                      <h4>1-Click Studio Image Presets</h4>
                      <div class="pg-filter-pills">
                        <button type="button" [class.active]="presetFilter() === 'hair'" (click)="presetFilter.set('hair')">Hair</button>
                        <button type="button" [class.active]="presetFilter() === 'beard'" (click)="presetFilter.set('beard')">Beard</button>
                        <button type="button" [class.active]="presetFilter() === 'skin'" (click)="presetFilter.set('skin')">Skin</button>
                        <button type="button" [class.active]="presetFilter() === 'tools'" (click)="presetFilter.set('tools')">Tools</button>
                        <button type="button" [class.active]="presetFilter() === 'services'" (click)="presetFilter.set('services')">Services &amp; Gifts</button>
                      </div>
                    </div>

                    <div class="presets-grid">
                      @for (item of filteredPresets(); track item.url) {
                        <div 
                          class="preset-card" 
                          [class.selected]="form.imageUrl === item.url" 
                          (click)="form.imageUrl = item.url"
                        >
                          <div class="preset-thumb">
                            <img [src]="item.url" [alt]="item.name" loading="lazy" />
                          </div>
                          <span class="preset-name">{{ item.name }}</span>
                        </div>
                      }
                    </div>
                  </div>
                </div>
              }

              <!-- TAB 4: HIGHLIGHTS & DETAILED FLOOR GUIDE -->
              @if (activeTab() === 'details') {
                <div class="form-section">
                  <div class="fs-title">
                    <h3>Descriptions &amp; Key Highlights</h3>
                    <p>Rich information displayed on product listing cards and product detail pages.</p>
                  </div>

                  <div class="form-group">
                    <div class="label-with-action">
                      <label>Short Summary (Listing Cards)</label>
                      <span class="char-counter">{{ (form.description || '').length }}/180 chars</span>
                    </div>
                    <textarea 
                      [(ngModel)]="form.description" 
                      rows="2" 
                      placeholder="A quick 1-2 sentence overview for the storefront card..."
                    ></textarea>
                  </div>

                  <!-- Key Highlights (Bullets) Manager -->
                  <div class="highlights-manager">
                    <div class="hm-header">
                      <div>
                        <h4>Key Bullet Highlights</h4>
                        <p>Displayed as bulleted selling points on the Product Detail Page.</p>
                      </div>
                      <button type="button" class="btn-add-bullet" (click)="addHighlight()">+ Add Highlight</button>
                    </div>

                    <div class="highlights-list">
                      @for (hl of form.highlights; track $index; let i = $index) {
                        <div class="highlight-row">
                          <span class="hl-number">{{ i + 1 }}</span>
                          <input 
                            type="text" 
                            [(ngModel)]="form.highlights[i]" 
                            placeholder="e.g. Paraben and sulphate free formula" 
                          />
                          <button type="button" class="btn-remove-hl" (click)="removeHighlight(i)" title="Remove highlight">✕</button>
                        </div>
                      }
                    </div>
                  </div>

                  <!-- Long Description with Template Snippets -->
                  <div class="form-group">
                    <div class="label-with-action">
                      <label>Salon Floor Long Description &amp; Instructions</label>
                      <div class="template-buttons">
                        <button type="button" class="btn-tpl" (click)="insertTemplate('directions')">+ Directions</button>
                        <button type="button" class="btn-tpl" (click)="insertTemplate('ingredients')">+ Ingredients</button>
                        <button type="button" class="btn-tpl" (click)="insertTemplate('benefits')">+ Barber Note</button>
                      </div>
                    </div>
                    <textarea 
                      [(ngModel)]="form.longDescription" 
                      rows="6" 
                      placeholder="Detailed application steps, formulation story, active ingredients, and styling advice..."
                    ></textarea>
                  </div>
                </div>
              }

            </div>

            <!-- ═══════════════════════════════════════════════════════════════
                 REAL-TIME STOREFRONT PREVIEW PANEL
                 ═══════════════════════════════════════════════════════════════ -->
            <aside class="studio-preview-panel">
              <div class="preview-panel-header">
                <span class="pp-tag">LIVE STOREFRONT PREVIEW</span>
                <span class="pp-hint">Updates in real-time</span>
              </div>

              <!-- Storefront Card Mockup -->
              <div class="storefront-card-preview">
                <div class="scp-image-container">
                  <img [src]="form.imageUrl || '/images/products/hc-shampoo.jpg'" [alt]="form.name" />
                  @if (form.badge) {
                    <span class="scp-badge {{ form.badge }}">{{ form.badge }}</span>
                  }
                  @if (discountPercent() > 0) {
                    <span class="scp-discount-badge">{{ discountPercent() }}% OFF</span>
                  }
                </div>

                <div class="scp-content">
                  <div class="scp-meta-row">
                    <span class="scp-category">{{ form.category | uppercase }}</span>
                    <span class="scp-rating">★ {{ form.rating || 5.0 }} ({{ form.reviewCount || 1 }})</span>
                  </div>

                  <h4 class="scp-name">{{ form.name || 'Sample Product Name' }}</h4>
                  <p class="scp-desc">{{ form.description || 'Short summary of the formulation and primary usage benefits.' }}</p>

                  <div class="scp-price-row">
                    <span class="scp-price">₹{{ form.price || 0 }}</span>
                    @if (form.compareAtPrice) {
                      <span class="scp-compare">₹{{ form.compareAtPrice }}</span>
                    }
                  </div>

                  <div class="scp-footer">
                    <span class="scp-stock" [class.out]="form.stock_quantity <= 0">
                      {{ form.stock_quantity <= 0 ? 'Out of Stock' : (form.stock_quantity <= 15 ? 'Only ' + form.stock_quantity + ' left' : 'In Stock') }}
                    </span>
                    @if (form.freeDelivery) {
                      <span class="scp-free-ship">Free Delivery</span>
                    }
                  </div>
                </div>
              </div>

              <!-- Live Highlights Preview -->
              @if (form.highlights && form.highlights.length > 0) {
                <div class="preview-highlights-card">
                  <h5>Storefront Highlights:</h5>
                  <ul>
                    @for (item of form.highlights; track $index) {
                      @if (item) {
                        <li>✦ {{ item }}</li>
                      }
                    }
                  </ul>
                </div>
              }
            </aside>

          </div>

        </div>
      </div>
    }
  `,
  styles: [
    `
      .studio-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(15, 23, 42, 0.65);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1.5rem;
      }

      .studio-modal {
        width: 100%;
        max-width: 1180px;
        height: 90vh;
        background: #ffffff;
        border-radius: 20px;
        box-shadow: 0 25px 60px -12px rgba(15, 23, 42, 0.25), 0 0 1px rgba(0, 0, 0, 0.2);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        animation: scaleModal 0.22s cubic-bezier(0.16, 1, 0.3, 1);
      }

      @keyframes scaleModal {
        from {
          transform: scale(0.96);
          opacity: 0;
        }
        to {
          transform: scale(1);
          opacity: 1;
        }
      }

      /* Header */
      .studio-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1.25rem 2rem;
        background: #ffffff;
        border-bottom: 1px solid #e2e8f0;
        flex-wrap: wrap;
        gap: 1rem;
      }

      .sh-badge-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 0.25rem;
      }

      .studio-mode-badge {
        font-size: 0.65rem;
        font-weight: 800;
        letter-spacing: 0.08em;
        background: #f1f5f9;
        color: #475569;
        padding: 0.2rem 0.55rem;
        border-radius: 4px;

        &.create {
          background: #ecfdf5;
          color: #047857;
        }
      }

      .discount-pill {
        background: #fef2f2;
        color: #dc2626;
        font-size: 0.65rem;
        font-weight: 800;
        padding: 0.2rem 0.55rem;
        border-radius: 4px;
      }

      .stock-pill {
        background: #ecfdf5;
        color: #047857;
        font-size: 0.65rem;
        font-weight: 700;
        padding: 0.2rem 0.55rem;
        border-radius: 4px;

        &.low {
          background: #fffbeb;
          color: #b45309;
        }

        &.out {
          background: #fef2f2;
          color: #dc2626;
        }
      }

      .sh-left h2 {
        margin: 0;
        font-size: 1.35rem;
        font-weight: 800;
        color: #0f172a;
      }

      .sh-id-tag {
        font-size: 0.75rem;
        color: #64748b;
        font-family: monospace;
      }

      .sh-actions {
        display: flex;
        align-items: center;
        gap: 0.65rem;
      }

      .btn-ghost {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        background: #f8fafc;
        border: 1px solid #cbd5e1;
        color: #334155;
        font-size: 0.8rem;
        font-weight: 600;
        padding: 0.55rem 0.95rem;
        border-radius: 8px;
        cursor: pointer;

        &:hover {
          background: #f1f5f9;
          color: #0f172a;
        }
      }

      .btn-cancel {
        background: #ffffff;
        border: 1px solid #cbd5e1;
        color: #64748b;
        font-size: 0.8rem;
        font-weight: 600;
        padding: 0.55rem 1rem;
        border-radius: 8px;
        cursor: pointer;

        &:hover {
          background: #f8fafc;
          color: #0f172a;
        }
      }

      .btn-save {
        display: inline-flex;
        align-items: center;
        gap: 0.45rem;
        background: linear-gradient(135deg, #d97706 0%, #b45309 100%);
        border: none;
        color: #ffffff;
        font-size: 0.82rem;
        font-weight: 700;
        padding: 0.55rem 1.25rem;
        border-radius: 8px;
        cursor: pointer;
        box-shadow: 0 2px 8px rgba(217, 119, 6, 0.25);
        transition: all 0.2s ease;

        &:hover {
          background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
          transform: translateY(-1px);
        }
      }

      .btn-close-modal {
        background: #f1f5f9;
        border: none;
        color: #64748b;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;

        &:hover {
          background: #e2e8f0;
          color: #0f172a;
        }
      }

      /* Nav Tabs */
      .studio-nav {
        display: flex;
        background: #f8fafc;
        border-bottom: 1px solid #e2e8f0;
        padding: 0 1.5rem;
        gap: 0.5rem;
        overflow-x: auto;
      }

      .tab-btn {
        background: none;
        border: none;
        border-bottom: 2px solid transparent;
        padding: 0.85rem 1.25rem;
        font-size: 0.82rem;
        font-weight: 600;
        color: #64748b;
        cursor: pointer;
        white-space: nowrap;
        transition: all 0.2s ease;

        &:hover {
          color: #0f172a;
        }

        &.active {
          color: #d97706;
          font-weight: 700;
          border-bottom-color: #d97706;
          background: #ffffff;
        }
      }

      /* Body Grid */
      .studio-body {
        flex: 1;
        overflow-y: auto;
        display: grid;
        grid-template-columns: 1fr 340px;
        background: #f8fafc;

        @media (max-width: 900px) {
          grid-template-columns: 1fr;
        }
      }

      .studio-form-canvas {
        padding: 2rem;
        overflow-y: auto;
        background: #ffffff;
      }

      .form-section {
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
      }

      .fs-title {
        margin-bottom: 0.5rem;
        padding-bottom: 0.75rem;
        border-bottom: 1px solid #f1f5f9;

        h3 {
          margin: 0 0 0.25rem;
          font-size: 1.15rem;
          font-weight: 800;
          color: #0f172a;
        }

        p {
          margin: 0;
          font-size: 0.82rem;
          color: #64748b;
        }
      }

      .form-group {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;

        label {
          font-size: 0.78rem;
          font-weight: 700;
          color: #334155;
        }

        input,
        select,
        textarea {
          background: #ffffff;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          padding: 0.65rem 0.85rem;
          font-size: 0.85rem;
          color: #0f172a;
          outline: none;
          box-sizing: border-box;
          transition: border-color 0.2s ease;

          &:focus {
            border-color: #d97706;
            box-shadow: 0 0 0 3px rgba(217, 119, 6, 0.12);
          }
        }
      }

      .form-row-2 {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1.25rem;

        @media (max-width: 640px) {
          grid-template-columns: 1fr;
        }
      }

      .form-row-3 {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 1.25rem;

        @media (max-width: 640px) {
          grid-template-columns: 1fr;
        }
      }

      .label-with-action {
        display: flex;
        justify-content: space-between;
        align-items: center;

        label {
          font-size: 0.78rem;
          font-weight: 700;
          color: #334155;
        }

        .btn-text-action {
          background: none;
          border: none;
          color: #d97706;
          font-size: 0.74rem;
          font-weight: 700;
          cursor: pointer;
          padding: 0;

          &:hover {
            text-decoration: underline;
          }
        }

        .char-counter {
          font-size: 0.7rem;
          color: #94a3b8;
        }

        .template-buttons {
          display: flex;
          gap: 0.4rem;

          .btn-tpl {
            background: #f1f5f9;
            border: 1px solid #cbd5e1;
            color: #334155;
            font-size: 0.68rem;
            font-weight: 600;
            padding: 0.2rem 0.45rem;
            border-radius: 4px;
            cursor: pointer;

            &:hover {
              background: #e2e8f0;
              color: #0f172a;
            }
          }
        }
      }

      .input-currency-wrap {
        display: flex;
        align-items: center;
        position: relative;

        .currency-symbol {
          position: absolute;
          left: 10px;
          color: #64748b;
          font-weight: 700;
        }

        input {
          width: 100%;
          padding-left: 1.85rem !important;
        }
      }

      .discount-calculation-card {
        display: flex;
        align-items: center;
        gap: 1rem;
        background: #fffbeb;
        border: 1px solid #fde68a;
        padding: 0.85rem 1.15rem;
        border-radius: 10px;

        .dcc-icon {
          font-size: 1.5rem;
        }

        .dcc-text {
          strong {
            font-size: 0.85rem;
            color: #92400e;
            display: block;
          }

          p {
            margin: 0;
            font-size: 0.78rem;
            color: #b45309;
          }
        }
      }

      .stock-adjust-group {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        flex-wrap: wrap;

        .stock-qty-input {
          max-width: 120px;
        }

        .quick-stock-buttons {
          display: flex;
          gap: 0.35rem;

          .btn-stock-quick {
            background: #f1f5f9;
            border: 1px solid #cbd5e1;
            color: #334155;
            font-size: 0.74rem;
            font-weight: 700;
            padding: 0.45rem 0.65rem;
            border-radius: 6px;
            cursor: pointer;

            &:hover {
              background: #e2e8f0;
              color: #0f172a;
            }
          }
        }
      }

      .custom-toggle {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        cursor: pointer;

        input {
          width: 18px;
          height: 18px;
          accent-color: #d97706;
        }

        span {
          font-size: 0.82rem;
          font-weight: 600;
          color: #334155;
        }
      }

      /* Media Presets Gallery */
      .image-input-wrap {
        display: flex;
        gap: 0.5rem;

        input {
          flex: 1;
        }

        .btn-secondary-action {
          background: #f1f5f9;
          border: 1px solid #cbd5e1;
          color: #334155;
          font-size: 0.78rem;
          font-weight: 600;
          padding: 0.55rem 0.85rem;
          border-radius: 8px;
          cursor: pointer;

          &:hover {
            background: #e2e8f0;
          }
        }
      }

      .presets-gallery-container {
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 1.25rem;
        background: #f8fafc;
        display: flex;
        flex-direction: column;
        gap: 1rem;

        .pg-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 0.5rem;

          h4 {
            margin: 0;
            font-size: 0.88rem;
            font-weight: 700;
            color: #0f172a;
          }

          .pg-filter-pills {
            display: flex;
            gap: 0.35rem;

            button {
              background: #ffffff;
              border: 1px solid #cbd5e1;
              color: #64748b;
              font-size: 0.72rem;
              font-weight: 600;
              padding: 0.25rem 0.55rem;
              border-radius: 9999px;
              cursor: pointer;

              &.active {
                background: #fef3c7;
                border-color: #d97706;
                color: #92400e;
                font-weight: 700;
              }
            }
          }
        }

        .presets-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
          gap: 0.75rem;
          max-height: 250px;
          overflow-y: auto;
          padding: 4px;

          .preset-card {
            background: #ffffff;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 0.4rem;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 0.35rem;
            cursor: pointer;
            transition: all 0.2s ease;

            &:hover {
              border-color: #d97706;
              transform: translateY(-2px);
              box-shadow: 0 4px 10px rgba(0, 0, 0, 0.08);
            }

            &.selected {
              border-color: #d97706;
              background: #fef3c7;
              box-shadow: 0 0 0 2px #d97706;
            }

            .preset-thumb {
              width: 60px;
              height: 60px;
              border-radius: 6px;
              overflow: hidden;
              background: #f8fafc;

              img {
                width: 100%;
                height: 100%;
                object-fit: contain;
              }
            }

            .preset-name {
              font-size: 0.68rem;
              color: #334155;
              text-align: center;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
              max-width: 90px;
            }
          }
        }
      }

      /* Highlights Manager */
      .highlights-manager {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 1.25rem;
        display: flex;
        flex-direction: column;
        gap: 0.85rem;

        .hm-header {
          display: flex;
          justify-content: space-between;
          align-items: center;

          h4 {
            margin: 0;
            font-size: 0.88rem;
            font-weight: 700;
            color: #0f172a;
          }

          p {
            margin: 0;
            font-size: 0.74rem;
            color: #64748b;
          }

          .btn-add-bullet {
            background: #ffffff;
            border: 1px solid #d97706;
            color: #b45309;
            font-size: 0.74rem;
            font-weight: 700;
            padding: 0.35rem 0.75rem;
            border-radius: 6px;
            cursor: pointer;

            &:hover {
              background: #fef3c7;
            }
          }
        }

        .highlights-list {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;

          .highlight-row {
            display: flex;
            align-items: center;
            gap: 0.5rem;

            .hl-number {
              font-size: 0.74rem;
              font-weight: 700;
              color: #94a3b8;
              width: 18px;
              text-align: center;
            }

            input {
              flex: 1;
              background: #ffffff;
              border: 1px solid #cbd5e1;
              border-radius: 6px;
              padding: 0.5rem 0.75rem;
              font-size: 0.82rem;
              color: #0f172a;
              outline: none;

              &:focus {
                border-color: #d97706;
              }
            }

            .btn-remove-hl {
              background: #fef2f2;
              border: 1px solid #fecaca;
              color: #dc2626;
              width: 28px;
              height: 28px;
              border-radius: 6px;
              cursor: pointer;

              &:hover {
                background: #fee2e2;
              }
            }
          }
        }
      }

      /* Preview Panel (Sticky Right Sidebar) */
      .studio-preview-panel {
        background: #f8fafc;
        border-left: 1px solid #e2e8f0;
        padding: 1.5rem;
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
        overflow-y: auto;

        .preview-panel-header {
          display: flex;
          justify-content: space-between;
          align-items: center;

          .pp-tag {
            font-size: 0.65rem;
            font-weight: 800;
            letter-spacing: 0.08em;
            color: #64748b;
          }

          .pp-hint {
            font-size: 0.68rem;
            color: #94a3b8;
          }
        }

        .storefront-card-preview {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          overflow: hidden;
          box-shadow: 0 4px 14px rgba(15, 23, 42, 0.05);

          .scp-image-container {
            width: 100%;
            height: 180px;
            background: #ffffff;
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
            border-bottom: 1px solid #f1f5f9;

            img {
              max-width: 90%;
              max-height: 90%;
              object-fit: contain;
            }

            .scp-badge {
              position: absolute;
              top: 10px;
              left: 10px;
              font-size: 0.65rem;
              font-weight: 800;
              padding: 0.2rem 0.5rem;
              border-radius: 4px;
              text-transform: uppercase;

              &.deal {
                background: #fef2f2;
                color: #dc2626;
                border: 1px solid #fecaca;
              }

              &.bestseller {
                background: #fffbeb;
                color: #b45309;
                border: 1px solid #fde68a;
              }

              &.new {
                background: #ecfdf5;
                color: #047857;
                border: 1px solid #a7f3d0;
              }
            }

            .scp-discount-badge {
              position: absolute;
              top: 10px;
              right: 10px;
              background: #dc2626;
              color: #ffffff;
              font-size: 0.65rem;
              font-weight: 800;
              padding: 0.2rem 0.5rem;
              border-radius: 4px;
            }
          }

          .scp-content {
            padding: 1.15rem;
            display: flex;
            flex-direction: column;
            gap: 0.4rem;

            .scp-meta-row {
              display: flex;
              justify-content: space-between;
              align-items: center;

              .scp-category {
                font-size: 0.65rem;
                font-weight: 700;
                color: #d97706;
              }

              .scp-rating {
                font-size: 0.7rem;
                color: #64748b;
              }
            }

            .scp-name {
              margin: 0;
              font-size: 0.95rem;
              font-weight: 700;
              color: #0f172a;
              line-height: 1.3;
            }

            .scp-desc {
              margin: 0;
              font-size: 0.76rem;
              color: #64748b;
              line-height: 1.4;
              display: -webkit-box;
              -webkit-line-clamp: 2;
              -webkit-box-orient: vertical;
              overflow: hidden;
            }

            .scp-price-row {
              display: flex;
              align-items: baseline;
              gap: 0.5rem;
              margin-top: 0.25rem;

              .scp-price {
                font-size: 1.15rem;
                font-weight: 800;
                color: #0f172a;
              }

              .scp-compare {
                font-size: 0.8rem;
                color: #94a3b8;
                text-decoration: line-through;
              }
            }

            .scp-footer {
              display: flex;
              justify-content: space-between;
              align-items: center;
              padding-top: 0.65rem;
              margin-top: 0.35rem;
              border-top: 1px solid #f1f5f9;

              .scp-stock {
                font-size: 0.7rem;
                font-weight: 700;
                color: #059669;

                &.out {
                  color: #dc2626;
                }
              }

              .scp-free-ship {
                font-size: 0.68rem;
                color: #d97706;
                font-weight: 600;
              }
            }
          }
        }

        .preview-highlights-card {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 1rem;

          h5 {
            margin: 0 0 0.5rem;
            font-size: 0.75rem;
            font-weight: 700;
            text-transform: uppercase;
            color: #64748b;
          }

          ul {
            list-style: none;
            padding: 0;
            margin: 0;
            display: flex;
            flex-direction: column;
            gap: 0.35rem;

            li {
              font-size: 0.75rem;
              color: #334155;
              line-height: 1.3;
            }
          }
        }
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
  readonly activeTab = signal<'general' | 'pricing' | 'media' | 'details'>('general');
  readonly presetFilter = signal<'hair' | 'beard' | 'skin' | 'tools' | 'services'>('hair');

  readonly discountPercent = computed(() => {
    const price = this.form.price;
    const compare = this.form.compareAtPrice;
    if (price && compare && compare > price) {
      return Math.round(((compare - price) / compare) * 100);
    }
    return 0;
  });

  readonly allPresets: ImagePreset[] = [
    // Hair Care
    { name: 'Daily Shampoo', url: '/images/products/hc-shampoo.jpg', category: 'hair' },
    { name: 'Keratin Shampoo', url: '/images/products/keratin-shampoo.svg', category: 'hair' },
    { name: 'Hydrating Conditioner', url: '/images/products/hc-conditioner.jpg', category: 'hair' },
    { name: 'Pure Argan Oil', url: '/images/products/hc-hair-oil.jpg', category: 'hair' },
    { name: 'Anti-Frizz Serum', url: '/images/products/hc-hair-serum.jpg', category: 'hair' },
    { name: 'Matte Styling Clay', url: '/images/products/hc-hair-clay.jpg', category: 'hair' },
    { name: 'Strong Hold Wax', url: '/images/products/hc-hair-wax.jpg', category: 'hair' },
    { name: 'Classic Pomade', url: '/images/products/hc-hair-pomade.jpg', category: 'hair' },
    { name: 'Styling Powder', url: '/images/products/hc-styling-powder.jpg', category: 'hair' },
    { name: 'Anti-Dandruff Tonic', url: '/images/products/hc-anti-dandruff.jpg', category: 'hair' },
    { name: 'Heat Shield Spray', url: '/images/products/hc-heat-protection.jpg', category: 'hair' },
    { name: 'Follicle Growth Tonic', url: '/images/products/hc-hair-growth.jpg', category: 'hair' },

    // Beard
    { name: 'Cedarwood Beard Oil', url: '/images/products/beard-oil.jpg', category: 'beard' },
    { name: 'Beard Conditioning Balm', url: '/images/products/beard-balm.jpg', category: 'beard' },
    { name: 'Botanical Beard Wash', url: '/images/products/beard-wash.jpg', category: 'beard' },
    { name: 'Beard Growth Serum', url: '/images/products/beard-growth-serum.jpg', category: 'beard' },
    { name: 'Beard Softener Cream', url: '/images/products/beard-softener.jpg', category: 'beard' },
    { name: 'Moustache Twist Wax', url: '/images/products/moustache-wax.jpg', category: 'beard' },
    { name: 'Complete Beard Kit', url: '/images/products/beard-kit.jpg', category: 'beard' },
    { name: 'Sheesham Beard Comb', url: '/images/products/beard-comb.jpg', category: 'beard' },
    { name: 'Boar Bristle Brush', url: '/images/products/beard-brush.jpg', category: 'beard' },
    { name: 'Thermal Straightener', url: '/images/products/beard-straightener.jpg', category: 'beard' },

    // Skin
    { name: 'Charcoal Face Wash', url: '/images/products/charcoal-face-wash.jpg', category: 'skin' },
    { name: 'De-Tan Home Recovery', url: '/images/products/detan-kit.jpg', category: 'skin' },
    { name: 'Day Glow Cream SPF 30', url: '/images/products/glow-cream.jpg', category: 'skin' },

    // Tools
    { name: 'Master Clipper Trimmer', url: '/images/products/precision-trimmer.jpg', category: 'tools' },
    { name: 'Ionic Salon Dryer', url: '/images/products/hair-dryer.jpg', category: 'tools' },
    { name: 'Ceramic Styling Iron', url: '/images/products/styling-iron.jpg', category: 'tools' },

    // Services & Gifts
    { name: "Master Barber's Cut", url: '/images/products/svc-mens-haircut.jpg', category: 'services' },
    { name: "Executive Men's SPA", url: '/images/products/svc-mens-spa.jpg', category: 'services' },
    { name: "Ladies Balayage Colour", url: '/images/products/svc-ladies-colour.jpg', category: 'services' },
    { name: '₹1,000 Gift Voucher', url: '/images/products/gift-1000.jpg', category: 'services' },
    { name: '₹2,500 Gift Voucher', url: '/images/products/gift-2500.jpg', category: 'services' },
    { name: 'Couples Retreat Voucher', url: '/images/products/couples-spa.jpg', category: 'services' },
  ];

  readonly filteredPresets = computed(() => {
    const f = this.presetFilter();
    return this.allPresets.filter((p) => p.category === f);
  });

  form: any = this.createEmptyForm();

  constructor() {
    effect(() => {
      const p = this.product();
      if (p) {
        this.isEdit.set(Boolean(p.id));
        this.form = {
          ...p,
          highlights: p.highlights && p.highlights.length > 0 ? [...p.highlights] : ['Salon Grade Formula', 'Crafted in Delhi NCR'],
          stock_quantity: p.stock_quantity ?? 100,
          compareAtPrice: p.compareAtPrice ?? null,
          freeDelivery: p.freeDelivery ?? true,
          rating: p.rating ?? 5.0,
          reviewCount: p.reviewCount ?? 1,
        };
      } else {
        this.isEdit.set(false);
        this.form = this.createEmptyForm();
      }
    });
  }

  createEmptyForm(): any {
    return {
      id: '',
      name: '',
      slug: '',
      price: 499,
      compareAtPrice: null,
      category: 'hair',
      kind: 'retail',
      vendor: 'Urban Blade Lab',
      audience: 'unisex',
      stock_quantity: 100,
      inStock: true,
      imageUrl: '/images/products/hc-shampoo.jpg',
      description: '',
      longDescription: '',
      highlights: ['Salon Grade Formulation', 'Enriched with Botanical Extracts', 'Dermatologically Tested'],
      badge: undefined,
      freeDelivery: true,
      rating: 5.0,
      reviewCount: 1,
    };
  }

  onNameChange(): void {
    if (!this.isEdit() || !this.form.slug) {
      this.generateSlug();
    }
  }

  generateSlug(): void {
    const raw = (this.form.name || '').toLowerCase();
    this.form.slug = raw
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  adjustStock(delta: number): void {
    const current = this.form.stock_quantity ?? 0;
    this.form.stock_quantity = Math.max(0, current + delta);
    this.form.inStock = this.form.stock_quantity > 0;
  }

  addHighlight(): void {
    if (!this.form.highlights) {
      this.form.highlights = [];
    }
    this.form.highlights.push('');
  }

  removeHighlight(index: number): void {
    if (this.form.highlights && this.form.highlights.length > 0) {
      this.form.highlights.splice(index, 1);
    }
  }

  insertTemplate(type: 'directions' | 'ingredients' | 'benefits'): void {
    let snippet = '';
    if (type === 'directions') {
      snippet = '\n\n**Application Directions:**\nApply a coin-sized portion evenly onto damp or towel-dried hair. Work through strands starting from roots to ends. Style as desired using a wide-toothed comb or blow dryer on low heat.';
    } else if (type === 'ingredients') {
      snippet = '\n\n**Active Formulation:**\nAqua (Purified Water), Argania Spinosa (Argan) Kernel Oil, Hydrolyzed Keratin Protein, Aloe Barbadensis Leaf Extract, Vitamin E Tocopherol, Natural Botanical Fragrance.';
    } else if (type === 'benefits') {
      snippet = '\n\n**Master Barber Note:**\nFormulated specifically for Indian hair textures exposed to urban pollution, humidity, and heat styling. Leaves zero residue and rinses off effortlessly with warm water.';
    }
    this.form.longDescription = (this.form.longDescription || '') + snippet;
  }

  duplicateItem(): void {
    this.isEdit.set(false);
    this.form.id = '';
    this.form.name = `${this.form.name} (Copy)`;
    this.generateSlug();
  }

  submitForm(): void {
    if (!this.form.name) {
      alert('Please enter a product title.');
      this.activeTab.set('general');
      return;
    }
    if (!this.form.slug) {
      this.generateSlug();
    }
    // Clean up empty highlights
    if (Array.isArray(this.form.highlights)) {
      this.form.highlights = this.form.highlights.filter((h: string) => h && h.trim().length > 0);
    }
    this.save.emit(this.form);
    this.close.emit();
  }
}
