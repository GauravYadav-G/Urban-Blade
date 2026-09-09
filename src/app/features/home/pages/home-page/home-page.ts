import { Component, DestroyRef, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Product } from '@core/models/product.model';
import { CartService } from '@core/services/cart.service';
import { CatalogService } from '@core/services/catalog.service';
import { HairCareSection } from '../../components/hair-care-section/hair-care-section';
import { ProductShelf } from '@shared/components/product-shelf/product-shelf';
import { ProductSlider } from '@shared/components/product-slider/product-slider';
import { ImgFallback } from '@shared/directives/img-fallback';
import { InrPipe } from '@shared/pipes/inr-pipe';

interface HeroSlide {
  kicker: string;
  title: string;
  terms: string;
  cta: string;
  link: string;
  query?: Record<string, string>;
  leftImage: string;
  leftAlt: string;
  offerImage: string;
  productId: string;
  categoryLabel: string;
}

@Component({
  selector: 'app-home-page',
  imports: [RouterLink, ProductShelf, ProductSlider, ImgFallback, HairCareSection, InrPipe],
  templateUrl: './home-page.html',
  styleUrl: './home-page.scss',
})
export class HomePage {
  private readonly catalog = inject(CatalogService);
  private readonly cart = inject(CartService);
  private paused = false;

  readonly deals = this.catalog.deals();
  readonly bestsellers = this.catalog.bestsellers();
  readonly hair = this.catalog.byCategory('hair');
  readonly beard = this.catalog.byCategory('beard');
  readonly services = this.catalog.byCategory('services');
  readonly relatedPicks = [
    'hc-hair-serum',
    'beard-oil',
    'detan-kit',
    'hair-dryer',
    'couples-spa',
  ]
    .map((id) => this.catalog.byId(id))
    .filter((p): p is Product => !!p);

  readonly tiles = [
    { title: 'Hair care', cat: 'hair', image: '/images/products/hc-shampoo.jpg' },
    { title: 'Beard & Moustache', cat: 'beard', image: '/images/products/beard-oil.jpg' },
    { title: 'Skin & glow', cat: 'skin', image: '/images/products/glow-cream.jpg' },
    { title: 'Salon tools', cat: 'tools', image: '/images/products/hair-dryer.jpg' },
  ];

  readonly slides: HeroSlide[] = [
    {
      kicker: 'SAVE UP TO ₹300',
      title: 'On Selected Hair Serum, Oil & Styling',
      terms: 'Terms and Condition Apply',
      cta: 'Shop Now',
      link: '/shop',
      query: { cat: 'hair' },
      leftImage: '/images/products/hc-hair-oil.jpg',
      leftAlt: 'Urban Blade hair oil',
      offerImage: '/images/heroes/slide-hair.png',
      productId: 'hc-hair-serum',
      categoryLabel: 'Hair Care',
    },
    {
      kicker: 'SAVE UP TO ₹600',
      title: 'On Beard Oil, Balm, Wax & Grooming Tools',
      terms: 'Terms and Condition Apply',
      cta: 'Shop Now',
      link: '/shop',
      query: { cat: 'beard' },
      leftImage: '/images/products/beard-oil.jpg',
      leftAlt: 'Urban Blade beard oil',
      offerImage: '/images/heroes/slide-beard.png',
      productId: 'beard-straightener',
      categoryLabel: 'Beard & Moustache',
    },
    {
      kicker: 'SAVE UP TO ₹300',
      title: 'On De-Tan, Glow Cream & Skin Care',
      terms: 'Terms and Condition Apply',
      cta: 'Shop Now',
      link: '/shop',
      query: { cat: 'skin' },
      leftImage: '/images/products/glow-cream.jpg',
      leftAlt: 'Urban Blade glow cream',
      offerImage: '/images/heroes/slide-skin.png',
      productId: 'detan-kit',
      categoryLabel: 'Skin Care',
    },
    {
      kicker: 'SAVE UP TO ₹1,000',
      title: 'On Selected Dryers, Trimmers & Salon Tools',
      terms: 'Terms and Condition Apply',
      cta: 'Shop Now',
      link: '/shop',
      query: { cat: 'tools' },
      leftImage: '/images/products/precision-trimmer.jpg',
      leftAlt: 'Urban Blade precision trimmer',
      offerImage: '/images/heroes/slide-tools.png',
      productId: 'hair-dryer',
      categoryLabel: 'Salon Tools',
    },
    {
      kicker: 'SAVE UP TO ₹1,000',
      title: 'On Gift Cards, Couples Spa & Salon Visits',
      terms: 'Terms and Condition Apply',
      cta: 'Shop Now',
      link: '/shop',
      query: { cat: 'gifts' },
      leftImage: '/images/products/gift-2500.jpg',
      leftAlt: 'Urban Blade gift card',
      offerImage: '/images/heroes/slide-gift.png',
      productId: 'couples-spa',
      categoryLabel: 'Gifts & Spa',
    },
  ];

  activeSlide = 0;

  constructor() {
    const timer = window.setInterval(() => {
      if (!this.paused) {
        this.next();
      }
    }, 5500);
    inject(DestroyRef).onDestroy(() => window.clearInterval(timer));
  }

  current(): HeroSlide {
    return this.slides[this.activeSlide];
  }

  featuredProduct(): Product | undefined {
    return this.catalog.byId(this.current().productId);
  }

  saveAmount(product: Product): number {
    return Math.max(0, (product.compareAtPrice ?? product.price) - product.price);
  }

  goTo(index: number): void {
    this.activeSlide = index;
  }

  next(): void {
    this.activeSlide = (this.activeSlide + 1) % this.slides.length;
  }

  prev(): void {
    this.activeSlide = (this.activeSlide - 1 + this.slides.length) % this.slides.length;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  addFeatured(event: Event, product: Product): void {
    event.preventDefault();
    event.stopPropagation();
    this.cart.addProduct(product);
  }
}
