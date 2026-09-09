import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Product } from '@core/models/product.model';
import { ProductCard } from '@shared/components/product-card/product-card';

@Component({
  selector: 'app-hair-care-section',
  imports: [RouterLink, ProductCard],
  templateUrl: './hair-care-section.html',
  styleUrl: './hair-care-section.scss',
})
export class HairCareSection {
  readonly products = input.required<Product[]>();
  readonly title = input('Hair Care');
  readonly kicker = input('Salon shelf');
  readonly lede = input(
    'Shampoo to heat protection — the same line our stylists use at Urban Blade, Ghaziabad.',
  );
  readonly category = input('hair');
  readonly seeAllLabel = input('See all Hair Care');
  readonly sectionId = input('hair-care');
}
