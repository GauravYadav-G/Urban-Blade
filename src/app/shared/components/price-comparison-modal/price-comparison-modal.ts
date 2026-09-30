import { Component, input, output, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { InrPipe } from '@shared/pipes/inr-pipe';
import type { PriceComparison, MarketplacePrice } from '@core/models/product.model';

interface MarketplaceInfo {
  key: string;
  name: string;
  icon: string;
  color: string;
  domain: string;
}

const MARKETPLACE_INFO: Record<string, MarketplaceInfo> = {
  amazon: { key: 'amazon', name: 'Amazon', icon: '📦', color: '#FF9900', domain: 'amazon.in' },
  flipkart: { key: 'flipkart', name: 'Flipkart', icon: '🛒', color: '#2874F0', domain: 'flipkart.com' },
  nykaa: { key: 'nykaa', name: 'Nykaa', icon: '💄', color: '#FF3E97', domain: 'nykaa.com' },
  purplle: { key: 'purplle', name: 'Purplle', icon: '✨', color: '#8B5CF6', domain: 'purplle.com' },
  meesho: { key: 'meesho', name: 'Meesho', icon: '🏷️', color: '#EF4444', domain: 'meesho.com' },
  jiomart: { key: 'jiomart', name: 'JioMart', icon: '🏪', color: '#0077B6', domain: 'jiomart.com' },
  bigbasket: { key: 'bigbasket', name: 'BigBasket', icon: '🥬', color: '#059669', domain: 'bigbasket.com' },
  blinkit: { key: 'blinkit', name: 'Blinkit', icon: '⚡', color: '#F59E0B', domain: 'blinkit.com' },
  zepto: { key: 'zepto', name: 'Zepto', icon: '🚀', color: '#8B5CF6', domain: 'zepto.com' },
  other: { key: 'other', name: 'Other', icon: '🔗', color: '#64748B', domain: '' },
};

@Component({
  selector: 'app-price-comparison-modal',
  standalone: true,
  imports: [CommonModule, InrPipe],
  templateUrl: './price-comparison-modal.html',
  styleUrl: './price-comparison-modal.scss',
})
export class PriceComparisonModal {
  readonly comparison = input.required<PriceComparison | null>();
  readonly productName = input.required<string>();
  readonly productImage = input.required<string>();
  readonly close = output<void>();

  readonly sortedPrices = computed(() => {
    const comp = this.comparison();
    if (!comp) return [];
    
    // Sort: our price first, then marketplace prices by price (lowest first)
    const prices: Array<{ source: 'us' | 'marketplace'; data: MarketplacePrice | { price: number; compareAtPrice: number | null } }> = [
      { 
        source: 'us', 
        data: { 
          price: comp.ourPrice, 
          compareAtPrice: comp.ourCompareAtPrice 
        } 
      },
      ...comp.marketplacePrices
        .filter(m => m.price !== null)
        .sort((a, b) => (a.price || Infinity) - (b.price || Infinity))
        .map(m => ({ source: 'marketplace' as const, data: m })),
      ...comp.marketplacePrices
        .filter(m => m.price === null)
        .map(m => ({ source: 'marketplace' as const, data: m })),
    ];
    return prices;
  });

  readonly bestPrice = computed(() => {
    const comp = this.comparison();
    if (!comp) return null;
    
    const allPrices = [
      { source: 'Urban Blade', price: comp.ourPrice, url: null },
      ...comp.marketplacePrices
        .filter(m => m.price !== null && m.status === 'success')
        .map(m => ({ 
          source: this.getMarketplaceName(m.marketplace), 
          price: m.price!, 
          url: m.url 
        }))
    ];
    
    if (allPrices.length === 0) return null;
    return allPrices.reduce((best, curr) => curr.price < best.price ? curr : best);
  });

  readonly savings = computed(() => {
    const comp = this.comparison();
    if (!comp) return 0;
    const best = this.bestPrice();
    if (!best || best.source === 'Urban Blade') return 0;
    return comp.ourPrice - best.price;
  });

  getMarketplaceInfo(marketplace: string): MarketplaceInfo {
    return MARKETPLACE_INFO[marketplace] || MARKETPLACE_INFO['other'];
  }

  getMarketplaceName(marketplace: string): string {
    return MARKETPLACE_INFO[marketplace]?.name || marketplace;
  }

  openMarketplace(url: string): void {
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close.emit();
    }
  }

  formatLastChecked(dateString: string | null): string {
    if (!dateString) return 'Never checked';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }

  getStatusClass(status: string): string {
    switch (status) {
      case 'success': return 'status-success';
      case 'pending': return 'status-pending';
      case 'rate_limited': return 'status-rate-limited';
      case 'failed': return 'status-failed';
      default: return '';
    }
  }

  getStatusLabel(status: string): string {
    switch (status) {
      case 'success': return 'Price fetched';
      case 'pending': return 'Pending';
      case 'rate_limited': return 'Rate limited';
      case 'failed': return 'Failed';
      default: return 'Unknown';
    }
  }
}