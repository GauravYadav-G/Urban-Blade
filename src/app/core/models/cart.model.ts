import type { Product } from './product.model';

export interface CartLine {
  lineId: string;
  productId: string;
  name: string;
  imageUrl: string;
  unitPrice: number;
  compareAtPrice?: number;
  currency: 'INR';
  qty: number;
  kind: Product['kind'];
  description?: string;
}

export function lineFromProduct(product: Product, qty = 1): CartLine {
  return {
    lineId: `line-${product.id}`,
    productId: product.id,
    name: product.name,
    imageUrl: product.imageUrl,
    unitPrice: product.price,
    compareAtPrice: product.compareAtPrice,
    currency: product.currency,
    qty,
    kind: product.kind,
    description: product.description,
  };
}
