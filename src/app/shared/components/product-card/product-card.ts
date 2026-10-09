import { Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Product } from '@core/models/product.model';
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
  readonly product = input.required<Product>();
  readonly largeMedia = input(false);

  isOutOfStock(): boolean {
    const p = this.product();
    return !p.inStock || (p.stock_quantity !== undefined && p.stock_quantity <= 0);
  }

  add(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.isOutOfStock()) return;
    this.cart.addProduct(this.product());
  }
}
