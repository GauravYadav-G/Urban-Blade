import { query } from '../../db/pool.js';

export const defaultCommerceRules = {
  freeShippingEnabled: true, freeShippingThreshold: 999, standardShippingFee: 99,
  taxEnabled: true, taxInclusive: true, taxRatePercent: 18, currency: 'INR',
};
export async function getSiteSettings() {
  let result;
  try { result = await query("SELECT value FROM site_settings WHERE id = 'main'"); }
  catch (err: any) {
    if (err.code !== '42P01') throw err;
    // An older deployment can serve checkout defaults while startup migration runs.
    return { ecommerce: { ...defaultCommerceRules } };
  }
  const settings = result.rows[0]?.value || {};
  return { ...settings, ecommerce: { ...defaultCommerceRules, ...settings.ecommerce } };
}
export function calculateTotals(subtotal: number, discount: number, rules: typeof defaultCommerceRules) {
  const round = (n: number) => Math.round(n * 100) / 100;
  const taxable = Math.max(0, round(subtotal - discount));
  const shippingFee = rules.freeShippingEnabled && subtotal >= rules.freeShippingThreshold ? 0 : rules.standardShippingFee;
  const taxAmount = !rules.taxEnabled ? 0 : round(rules.taxInclusive
    ? taxable - taxable / (1 + rules.taxRatePercent / 100) : taxable * rules.taxRatePercent / 100);
  return { subtotal: round(subtotal), discountAmount: round(discount), shippingFee, taxAmount,
    taxInclusive: rules.taxInclusive, taxRatePercent: rules.taxRatePercent,
    totalAmount: round(taxable + shippingFee + (rules.taxInclusive ? 0 : taxAmount)) };
}
export async function couponDiscount(code: string | undefined, subtotal: number) {
  if (!code) return { couponCode: '', discount: 0 };
  if (typeof code !== 'string' || code.length > 100) throw new Error('INVALID_COUPON');
  const clean = code.trim().toUpperCase();
  const result = await query('SELECT * FROM coupons WHERE code = $1 AND is_active = TRUE AND (expires_at IS NULL OR expires_at > NOW())', [clean]);
  const c = result.rows[0];
  if (!c || subtotal < Number(c.min_order_value)) throw new Error('INVALID_COUPON: Code is unavailable or its minimum order value has not been reached.');
  const amount = c.discount_type === 'percentage' ? subtotal * Number(c.discount_value) / 100 : Number(c.discount_value);
  return { couponCode: clean, discount: Math.round(Math.min(subtotal, amount, c.max_discount_amount == null ? Infinity : Number(c.max_discount_amount)) * 100) / 100 };
}
