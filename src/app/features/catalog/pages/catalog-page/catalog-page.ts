import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { CatalogService, type CatalogQuery } from '@core/services/catalog.service';
import { ProductCard } from '@shared/components/product-card/product-card';

@Component({
  selector: 'app-catalog-page',
  imports: [RouterLink, ProductCard],
  templateUrl: './catalog-page.html',
  styleUrl: './catalog-page.scss',
})
export class CatalogPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly catalog = inject(CatalogService);

  readonly categories = this.catalog.categories;
  readonly params = toSignal(this.route.queryParamMap.pipe(map((q) => q)), {
    initialValue: this.route.snapshot.queryParamMap,
  });

  readonly query = computed<CatalogQuery>(() => {
    const q = this.params();
    return {
      q: q.get('q') ?? undefined,
      cat: q.get('cat') ?? undefined,
      deals: q.get('deals') === '1',
      audience: q.get('audience') ?? undefined,
      sort: (q.get('sort') as CatalogQuery['sort']) ?? 'featured',
    };
  });

  readonly products = computed(() => this.catalog.search(this.query()));

  readonly heading = computed(() => {
    const q = this.query();
    if (q.q) {
      return `Results for “${q.q}”`;
    }
    if (q.deals) {
      return "Today's deals";
    }
    const cat = this.categories.find((c) => c.slug === q.cat);
    return cat?.label ?? 'All products';
  });

  setFilter(key: string, value: string | null): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [key]: value || null },
      queryParamsHandling: 'merge',
    });
  }
}
