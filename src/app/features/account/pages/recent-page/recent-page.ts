import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RecentService } from '@core/services/recent.service';
import { ProductCard } from '@shared/components/product-card/product-card';

@Component({
  selector: 'app-recent-page',
  imports: [RouterLink, ProductCard],
  templateUrl: './recent-page.html',
  styleUrl: './recent-page.scss',
})
export class RecentPage {
  protected readonly recent = inject(RecentService);
}
