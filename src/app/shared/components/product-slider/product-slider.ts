import { Component, ElementRef, input, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Product } from '@core/models/product.model';
import { ProductCard } from '@shared/components/product-card/product-card';

@Component({
  selector: 'app-product-slider',
  imports: [ProductCard, RouterLink],
  templateUrl: './product-slider.html',
  styleUrl: './product-slider.scss',
})
export class ProductSlider {
  readonly title = input.required<string>();
  readonly products = input.required<Product[]>();
  readonly seeAllLink = input<string | undefined>(undefined);
  readonly seeAllQuery = input<Record<string, string>>({});
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  prev(): void {
    this.scroll(-1);
  }

  next(): void {
    this.scroll(1);
  }

  private scroll(direction: number): void {
    const el = this.scroller()?.nativeElement;
    if (!el) {
      return;
    }
    const item = el.querySelector<HTMLElement>('.product-slider__item');
    const step = item ? item.getBoundingClientRect().width + 16 : el.clientWidth * 0.8;
    el.scrollBy({ left: direction * step, behavior: 'smooth' });
  }
}
