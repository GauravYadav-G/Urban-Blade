import { Component, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { isServiceProduct, type Product } from '@core/models/product.model';
import { CartService } from '@core/services/cart.service';
import { RatingStars } from '@shared/components/rating-stars/rating-stars';
import { ImgFallback } from '@shared/directives/img-fallback';
import { InrPipe } from '@shared/pipes/inr-pipe';

@Component({
  selector: 'app-product-card',
  imports: [RouterLink, RatingStars, InrPipe, ImgFallback],
  templateUrl: './product-card.html',
  styleUrl: './product-card.scss',
})
export class ProductCard {
  private readonly cart = inject(CartService);
  private readonly router = inject(Router);
  readonly product = input.required<Product>();
  readonly largeMedia = input(false);

  isOutOfStock(): boolean {
    const p = this.product();
    if (isServiceProduct(p)) return false;
    return !p.inStock || (p.stock_quantity !== undefined && p.stock_quantity <= 0);
  }

  isService(): boolean {
    return isServiceProduct(this.product());
  }

  detailsLink(): readonly string[] {
    return this.isService() ? ['/book'] : ['/shop', this.product().id];
  }

  add(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.isService()) {
      void this.router.navigate(['/book'], { queryParams: { service: this.product().id } });
      return;
    }
    if (this.isOutOfStock()) return;
    this.cart.addProduct(this.product());
  }
}
