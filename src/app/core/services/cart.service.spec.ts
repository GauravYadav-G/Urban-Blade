import { TestBed } from '@angular/core/testing';
import { CartService, MAX_CART_QTY } from './cart.service';
import { lineFromProduct } from '../models/cart.model';
import { ecommerceProduct } from '../testing/ecommerce-fixtures';

// Adapted ecommerce scenarios; see docs/ecommerce-test-report.md for sources.
describe('Standard ecommerce cart scenarios', () => {
  let cart: CartService;
  const product = ecommerceProduct();
  beforeEach(() => { localStorage.removeItem('urban-blade-cart'); cart = TestBed.inject(CartService); });
  afterEach(() => { cart.dismissToast(); localStorage.removeItem('urban-blade-cart'); });

  it('CART-01 starts empty with zero totals', () => {
    expect(cart.lines()).toEqual([]); expect(cart.itemCount()).toBe(0); expect(cart.subtotal()).toBe(0);
  });
  it('CART-02 adds a product and calculates its line total', () => {
    cart.addProduct(product, 2); expect(cart.lines().length).toBe(1);
    expect(cart.itemCount()).toBe(2); expect(cart.subtotal()).toBe(1000);
  });
  it('CART-03 combines repeated additions into one line', () => {
    cart.addProduct(product); cart.addProduct(product, 2);
    expect(cart.lines().length).toBe(1); expect(cart.itemCount()).toBe(3);
  });
  it('CART-04 recalculates totals when quantities change', () => {
    cart.addProduct(product); cart.updateQty(cart.lines()[0].lineId, 3); expect(cart.subtotal()).toBe(1500);
  });
  it('CART-05 removes lines and clears the cart', () => {
    cart.addProduct(product); cart.removeLine(cart.lines()[0].lineId); expect(cart.itemCount()).toBe(0);
    cart.addProduct(product); cart.clear(); expect(cart.lines()).toEqual([]);
    expect(JSON.parse(localStorage.getItem('urban-blade-cart')!)).toEqual([]);
  });
  it('CART-06 enforces the maximum quantity', () => {
    cart.addProduct(product, 100); cart.addProduct(product, 100); expect(cart.itemCount()).toBe(MAX_CART_QTY);
  });
  it('CART-07 rejects fractional quantities and unavailable stock', () => {
    cart.addProduct(product, 1.5); cart.addProduct({ ...product, inStock: false });
    cart.addProduct({ ...product, stock_quantity: 0 }); expect(cart.lines()).toEqual([]);
  });
  it('CART-08 keeps appointment services out of the product cart', () => {
    cart.addProduct({ ...product, kind: 'service' }); expect(cart.lines()).toEqual([]);
  });
  it('CART-09 restores valid saved carts on reload', () => {
    cart.addProduct(product, 2); const restored = new CartService();
    expect(restored.itemCount()).toBe(2); expect(restored.subtotal()).toBe(1000);
  });
  it('CART-10 rejects fractional quantities in persisted cart data', () => {
    localStorage.setItem('urban-blade-cart', JSON.stringify([{ ...lineFromProduct(product), qty: 1.5 }]));
    const restored = new CartService(); expect(restored.lines().every(line => Number.isInteger(line.qty))).toBeTrue();
  });
  it('CART-11 discards malformed entries without losing valid saved items', () => {
    localStorage.setItem('urban-blade-cart', JSON.stringify([null, lineFromProduct(product)]));
    const restored = new CartService(); expect(restored.itemCount()).toBe(1);
  });
  it('CART-12 rejects negative prices during server-cart merge', () => {
    cart.mergeServerCart([{ ...lineFromProduct(product), unitPrice: -500 }]);
    expect(cart.lines()).toEqual([]); expect(cart.subtotal()).toBe(0);
  });
});
