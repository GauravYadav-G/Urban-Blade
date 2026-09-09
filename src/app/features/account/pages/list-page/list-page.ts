import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ListService } from '@core/services/list.service';
import { ProductCard } from '@shared/components/product-card/product-card';

@Component({
  selector: 'app-list-page',
  imports: [RouterLink, ProductCard],
  templateUrl: './list-page.html',
  styleUrl: './list-page.scss',
})
export class ListPage {
  protected readonly list = inject(ListService);
}
