import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { MAIN_NAV, PAGES_NAV, SALON, SEARCH_CATEGORIES } from '@core/constants/salon.constants';
import { CartService } from '@core/services/cart.service';
import { CatalogService } from '@core/services/catalog.service';
import { ImgFallback } from '@shared/directives/img-fallback';
import { InrPipe } from '@shared/pipes/inr-pipe';
import { SiteSettingsService } from '@core/services/site-settings.service';
import { DepartmentDrawer } from '../department-drawer/department-drawer';
import { StoreLogo } from '../store-logo/store-logo';
import { ThemeToggle } from '../theme-toggle/theme-toggle';

@Component({
  selector: 'app-store-header',
  imports: [RouterLink, RouterLinkActive, FormsModule, DepartmentDrawer, ImgFallback, InrPipe, StoreLogo, ThemeToggle],
  templateUrl: './store-header.html',
  styleUrl: './store-header.scss',
})
export class StoreHeader {
  private readonly router = inject(Router);
  private readonly catalog = inject(CatalogService);
  private readonly cart = inject(CartService);
  readonly siteSettings = inject(SiteSettingsService);

  readonly salon = SALON;
  readonly settings = this.siteSettings.settings;
  readonly categories = SEARCH_CATEGORIES;
  readonly navLinks = MAIN_NAV;
  readonly pagesNav = PAGES_NAV;
  readonly itemCount = this.cart.itemCount;
  readonly subtotal = this.cart.subtotal;
  readonly menuOpen = signal(false);
  readonly pagesOpen = signal(false);
  readonly query = signal('');
  readonly category = signal('all');
  readonly suggestionsOpen = signal(false);

  suggestions(): ReturnType<CatalogService['suggestions']> {
    return this.catalog.suggestions(this.query());
  }

  toggleMenu(): void {
    this.menuOpen.update((open) => !open);
    this.pagesOpen.set(false);
  }

  closeMenu(): void {
    this.menuOpen.set(false);
  }

  togglePages(): void {
    this.pagesOpen.update((open) => !open);
  }

  closePages(): void {
    this.pagesOpen.set(false);
  }

  onSearch(event: Event): void {
    event.preventDefault();
    this.suggestionsOpen.set(false);
    const cat = this.category();
    void this.router.navigate(['/shop'], {
      queryParams: {
        q: this.query().trim() || null,
        cat: cat === 'all' ? null : cat,
      },
    });
  }

  goToProduct(id: string): void {
    this.suggestionsOpen.set(false);
    void this.router.navigate(['/shop', id]);
  }
}
