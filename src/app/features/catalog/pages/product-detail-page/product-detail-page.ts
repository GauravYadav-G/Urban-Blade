import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { CartService } from '@core/services/cart.service';
import { CatalogService } from '@core/services/catalog.service';
import { ListService } from '@core/services/list.service';
import { RecentService } from '@core/services/recent.service';
import { ProductSlider } from '@shared/components/product-slider/product-slider';
import { RatingStars } from '@shared/components/rating-stars/rating-stars';
import { ImgFallback } from '@shared/directives/img-fallback';
import { InrPipe } from '@shared/pipes/inr-pipe';

@Component({
  selector: 'app-product-detail-page',
  imports: [RouterLink, FormsModule, InrPipe, RatingStars, ProductSlider, ImgFallback],
  templateUrl: './product-detail-page.html',
  styleUrl: './product-detail-page.scss',
})
export class ProductDetailPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly catalog = inject(CatalogService);
  private readonly cart = inject(CartService);
  private readonly recent = inject(RecentService);
  protected readonly list = inject(ListService);

  readonly id = toSignal(this.route.paramMap.pipe(map((p) => p.get('productId') ?? '')), {
    initialValue: this.route.snapshot.paramMap.get('productId') ?? '',
  });

  readonly product = computed(() => this.catalog.byId(this.id()));
  readonly related = computed(() => {
    const p = this.product();
    return p ? this.catalog.related(p) : [];
  });
  readonly savedOnList = computed(() => {
    const id = this.id();
    return id ? this.list.products().some((item) => item.id === id) : false;
  });

  readonly zoomActive = signal(false);
  readonly lensX = signal(0);
  readonly lensY = signal(0);
  readonly lensW = signal(160);
  readonly lensH = signal(160);
  readonly zoomPos = signal('50% 50%');
  private readonly zoomScale = 2.5;

  qty = 1;

  constructor() {
    effect(() => {
      const id = this.id();
      this.zoomActive.set(false);
      if (id && this.catalog.byId(id)) {
        this.recent.record(id);
      }
    });
  }

  toggleList(): void {
    const id = this.id();
    if (id) {
      this.list.toggle(id);
    }
  }

  addToCart(): void {
    const p = this.product();
    if (p) {
      this.cart.addProduct(p, this.qty);
    }
  }

  buyNow(): void {
    this.addToCart();
    void this.router.navigate(['/checkout']);
  }

  onZoomEnter(event: MouseEvent): void {
    if (!this.canHoverZoom()) {
      return;
    }
    this.zoomActive.set(true);
    this.onZoomMove(event);
  }

  onZoomLeave(): void {
    this.zoomActive.set(false);
  }

  onZoomMove(event: MouseEvent): void {
    if (!this.canHoverZoom()) {
      this.zoomActive.set(false);
      return;
    }

    const wrap = event.currentTarget as HTMLElement;
    const img = wrap.querySelector('img');
    if (!img?.naturalWidth) {
      return;
    }

    const wrapRect = wrap.getBoundingClientRect();
    const imgBox = img.getBoundingClientRect();
    const shown = this.containedImageRect(img, imgBox);
    if (shown.width < 40 || shown.height < 40) {
      return;
    }

    const lensW = Math.max(88, shown.width / this.zoomScale);
    const lensH = Math.max(88, shown.height / this.zoomScale);
    const x = event.clientX - shown.left;
    const y = event.clientY - shown.top;
    const lx = Math.max(0, Math.min(x - lensW / 2, shown.width - lensW));
    const ly = Math.max(0, Math.min(y - lensH / 2, shown.height - lensH));

    this.lensW.set(lensW);
    this.lensH.set(lensH);
    this.lensX.set(lx + (shown.left - wrapRect.left));
    this.lensY.set(ly + (shown.top - wrapRect.top));
    this.zoomPos.set(`${((lx + lensW / 2) / shown.width) * 100}% ${((ly + lensH / 2) / shown.height) * 100}%`);
    this.zoomActive.set(true);
  }

  private canHoverZoom(): boolean {
    return window.matchMedia('(hover: hover) and (pointer: fine) and (min-width: 900px)').matches;
  }

  private containedImageRect(
    img: HTMLImageElement,
    wrapRect: DOMRect,
  ): { left: number; top: number; width: number; height: number } {
    const scale = Math.min(wrapRect.width / img.naturalWidth, wrapRect.height / img.naturalHeight);
    const width = img.naturalWidth * scale;
    const height = img.naturalHeight * scale;
    return {
      width,
      height,
      left: wrapRect.left + (wrapRect.width - width) / 2,
      top: wrapRect.top + (wrapRect.height - height) / 2,
    };
  }
}
