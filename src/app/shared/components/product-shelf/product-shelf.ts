import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Product } from '@core/models/product.model';
import { ProductCard } from '@shared/components/product-card/product-card';

@Component({
  selector: 'app-product-shelf',
  imports: [RouterLink, ProductCard],
  template: `
    <section class="shelf">
      <header class="shelf__head">
        <h2>{{ title() }}</h2>
        @if (seeAllLink()) {
          <a [routerLink]="seeAllLink()" [queryParams]="seeAllQuery()">See all</a>
        }
      </header>
      <div class="shelf__grid">
        @for (product of products(); track product.id) {
          <app-product-card [product]="product" />
        }
      </div>
    </section>
  `,
  styles: `
    .shelf {
      margin: 1.25rem 0;
      padding: 1.1rem clamp(0.75rem, 2vw, 1.5rem) 1.4rem;
      background: var(--surface);
      border-radius: var(--radius-md);
      width: 100%;
    }
    .shelf__head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 1rem;
      margin-bottom: 0.9rem;
    }
    h2 {
      margin: 0;
      font-size: 1.25rem;
    }
    a {
      color: var(--link);
      text-decoration: none;
      font-size: 0.9rem;
    }
    .shelf__grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 1.1rem;
    }
  `,
})
export class ProductShelf {
  readonly title = input.required<string>();
  readonly products = input.required<Product[]>();
  readonly seeAllLink = input<string | undefined>(undefined);
  readonly seeAllQuery = input<Record<string, string>>({});
}
