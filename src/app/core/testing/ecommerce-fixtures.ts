import type { Product } from '../models/product.model';

export function ecommerceProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'serum', slug: 'serum', name: 'Hair Serum', description: 'Salon hair treatment',
    longDescription: 'Salon hair treatment', highlights: ['Salon grade'], price: 500,
    currency: 'INR', imageUrl: '/images/placeholder.svg', category: 'hair', kind: 'retail',
    vendor: 'Urban Blade Lab', audience: 'unisex', rating: 4.5, reviewCount: 10,
    inStock: true, stock_quantity: 10, ...overrides,
  };
}
