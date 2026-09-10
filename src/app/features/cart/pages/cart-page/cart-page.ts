import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { CartLine } from '@core/models/cart.model';
import type { Product } from '@core/models/product.model';
import { CartService } from '@core/services/cart.service';
import { CatalogService } from '@core/services/catalog.service';
import { ProductSlider } from '@shared/components/product-slider/product-slider';
import { ImgFallback } from '@shared/directives/img-fallback';
import { InrPipe } from '@shared/pipes/inr-pipe';

import { SiteSettingsService } from '@core/services/site-settings.service';

@Component({
  selector: 'app-cart-page',
  imports: [RouterLink, InrPipe, ImgFallback, ProductSlider],
  templateUrl: './cart-page.html',
  styleUrl: './cart-page.scss',
})
export class CartPage {
  protected readonly cart = inject(CartService);
  private readonly catalog = inject(CatalogService);
  readonly siteSettings = inject(SiteSettingsService);

  readonly ecommerce = computed(() => this.siteSettings.settings().ecommerce);
  readonly freeShippingThreshold = computed(() => this.ecommerce().freeShippingThreshold);
  readonly freeShippingEnabled = computed(() => this.ecommerce().freeShippingEnabled ?? true);
  readonly remainingForFreeShip = computed(() => {
    const sub = this.cart.subtotal();
    const thresh = this.freeShippingThreshold();
    return sub < thresh ? thresh - sub : 0;
  });

  readonly related = computed(() => {
    const first = this.cart.lines()[0];
    if (!first) {
      return [];
    }
    const product = this.catalog.byId(first.productId);
    const inCart = new Set(this.cart.lines().map((line) => line.productId));
    const pool = product ? this.catalog.related(product, 12) : this.catalog.bestsellers();
    return pool.filter((item) => !inCart.has(item.id)).slice(0, 8);
  });

  productFor(line: CartLine): Product | undefined {
    return this.catalog.byId(line.productId);
  }

  descriptionFor(line: CartLine): string {
    return this.productFor(line)?.description ?? line.description ?? '';
  }

  highlightsFor(line: CartLine): string[] {
    return this.productFor(line)?.highlights.slice(0, 3) ?? [];
  }

  lineTotal(line: CartLine): number {
    return line.unitPrice * line.qty;
  }

  setQty(lineId: string, event: Event): void {
    this.cart.updateQty(lineId, Number((event.target as HTMLSelectElement).value));
  }
}
