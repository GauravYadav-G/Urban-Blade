export type ProductKind = 'retail' | 'service' | 'gift';
export type ProductCategory = 'hair' | 'beard' | 'skin' | 'tools' | 'gifts' | 'services';
export type ProductAudience = 'men' | 'ladies' | 'unisex';

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
}
