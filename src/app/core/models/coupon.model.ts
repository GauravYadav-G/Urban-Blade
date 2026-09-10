export type DiscountType = 'percentage' | 'fixed';

export interface Coupon {
  id: string;
  code: string; // e.g., 'URBAN10', 'WELCOME50' (always uppercase)
  discountType: DiscountType; // '%' or '₹'
  discountValue: number; // e.g. 10 (%) or 100 (₹)
  minOrderValue: number; // Minimum cart subtotal required to apply
  maxDiscountAmount?: number; // Cap for percentage discount (e.g. max ₹200)
  isActive: boolean;
  description: string;
  usageCount: number;
  createdAt: string;
  expiresAt?: string;
}

export interface CouponValidationResult {
  valid: boolean;
  discount: number;
  reason?: string;
  coupon?: Coupon;
}
