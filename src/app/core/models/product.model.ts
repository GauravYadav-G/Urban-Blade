export type ProductKind = 'retail' | 'service' | 'gift';
export type ProductCategory = 'hair' | 'beard' | 'skin' | 'tools' | 'gifts' | 'services';
export type ProductAudience = 'men' | 'ladies' | 'unisex';

export type Marketplace = 'amazon' | 'flipkart' | 'nykaa' | 'purplle' | 'meesho' | 'jiomart' | 'bigbasket' | 'blinkit' | 'zepto' | 'other';

export interface MarketplacePrice {
  marketplace: Marketplace;
  url: string;
  price: number | null;
  currency: string;
  lastChecked: string | null;
  status: 'pending' | 'success' | 'failed' | 'rate_limited';
  error?: string;
  updatedAt: string;
}

export interface PriceComparison {
  productId: string;
  ourPrice: number;
  ourCompareAtPrice: number | null;
  marketplacePrices: MarketplacePrice[];
  bestMarketplacePrice: MarketplacePrice | null;
  lastRefreshed: string | null;
  error?: string;
}

export interface Product {
  id: string;
  name: string;
  slug: string;
  description: string;
  longDescription: string;
  highlights: string[];
  price: number;
  compareAtPrice?: number;
  currency: 'INR';
  imageUrl: string;
  category: ProductCategory;
  kind: ProductKind;
  vendor: string;
  audience: ProductAudience;
  freeDelivery?: boolean;
  rating: number;
  reviewCount: number;
  badge?: 'deal' | 'bestseller' | 'new';
  inStock: boolean;
  marketplacePrices?: MarketplacePrice[];
  priceComparison?: PriceComparison;
}
