import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getCacheKey, setCacheKey, delCacheKey } from '../../redis/client.js';
import { query } from '../../db/pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const seedProducts: any[] = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../db/products.seed.json'), 'utf-8')
);

export interface CartItem {
  lineId: string;
  productId: string;
  name: string;
  imageUrl: string;
  unitPrice: number;
  qty: number;
  currency: string;
}

export async function cartRoutes(app: FastifyInstance) {
  // Helper to extract session or generate isolated guest session
  function getCartSession(request: any, reply: any): string {
    let sessionId = request.headers['x-session-id'] as string;
    if (!sessionId || sessionId === 'guest-session' || sessionId.length < 8) {
      sessionId = `sess_${crypto.randomUUID()}`;
      reply.header('x-session-id', sessionId);
    }
    return sessionId;
  }

  // ─── GET CART (SUB-1MS ISOLATED REDIS FETCH) ──────────────────────────────
  app.get('/cart', async (request, reply) => {
    const sessionId = getCartSession(request, reply);
    const cartKey = `cart:${sessionId}`;
    const raw = await getCacheKey(cartKey);
    const items: CartItem[] = raw ? JSON.parse(raw) : [];

    const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.qty, 0);
    const itemCount = items.reduce((sum, item) => sum + item.qty, 0);

    return reply.send({
      sessionId,
      items,
      subtotal,
      itemCount,
      currency: 'INR',
    });
  });

  // ─── ADD ITEM TO CART (WITH AUTHORITATIVE CATALOG PRICING & VALIDATION) ───
  app.post<{ Body: CartItem }>('/cart/items', async (request, reply) => {
    const sessionId = getCartSession(request, reply);
    const cartKey = `cart:${sessionId}`;
    const newItem = request.body;

    if (!newItem.productId) {
      return reply.status(400).send({ error: 'MISSING_PRODUCT_ID', message: 'Product ID is required.' });
    }

    const qty = parseInt(String(newItem.qty || 1), 10);
    if (isNaN(qty) || qty < 1 || qty > 50) {
      return reply.status(400).send({
        error: 'INVALID_QUANTITY',
        message: 'Quantity must be a positive integer between 1 and 50.',
      });
    }

    // Authoritative catalog price verification from PostgreSQL
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(newItem.productId);
    const cleanSlug = newItem.productId.replace(/^(hc|bd|sk|tl|gf|sv)-/, '');

    let authoritativeProduct: any = null;
    try {
      const prodRes = await query(
        `SELECT id, name, price, image_url, in_stock FROM products WHERE ${
          isUUID ? 'id = $1' : 'slug = $1 OR slug = $2 OR name ILIKE $2'
        } LIMIT 1`,
        isUUID ? [newItem.productId] : [newItem.productId, cleanSlug]
      );
      if (prodRes.rows.length > 0) {
        authoritativeProduct = prodRes.rows[0];
      }
    } catch {}

    if (!authoritativeProduct) {
      authoritativeProduct = seedProducts.find((p) => p.id === newItem.productId || p.slug === cleanSlug);
    }

    if (!authoritativeProduct) {
      return reply.status(404).send({
        error: 'PRODUCT_NOT_FOUND',
        message: `Product "${newItem.productId}" does not exist in catalog.`,
      });
    }

    const unitPrice = parseFloat(authoritativeProduct.price);
    const name = authoritativeProduct.name;
    const imageUrl = authoritativeProduct.image_url || authoritativeProduct.imageUrl || newItem.imageUrl;

    const raw = await getCacheKey(cartKey);
    let items: CartItem[] = raw ? JSON.parse(raw) : [];

    const existingIndex = items.findIndex((i) => i.productId === authoritativeProduct.id || i.productId === newItem.productId);
    if (existingIndex > -1) {
      items[existingIndex].qty = Math.min(50, items[existingIndex].qty + qty);
      items[existingIndex].unitPrice = unitPrice; // Keep price authoritative
    } else {
      items.push({
        lineId: newItem.lineId || `line-${authoritativeProduct.id}-${Date.now()}`,
        productId: authoritativeProduct.id,
        name,
        imageUrl,
        unitPrice,
        qty,
        currency: 'INR',
      });
    }

    // Save back to Redis / Memory with 14-day rolling TTL
    await setCacheKey(cartKey, JSON.stringify(items), 14 * 86400);

    const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.qty, 0);
    const itemCount = items.reduce((sum, item) => sum + item.qty, 0);

    return reply.status(200).send({
      sessionId,
      items,
      subtotal,
      itemCount,
      currency: 'INR',
    });
  });

  // ─── UPDATE ITEM QUANTITY (VALIDATED) ─────────────────────────────────────
  app.put<{ Params: { lineId: string }; Body: { qty: number } }>(
    '/cart/items/:lineId',
    async (request, reply) => {
      const sessionId = getCartSession(request, reply);
      const cartKey = `cart:${sessionId}`;
      const { lineId } = request.params;
      const { qty } = request.body;

      const raw = await getCacheKey(cartKey);
      let items: CartItem[] = raw ? JSON.parse(raw) : [];

      if (qty <= 0) {
        items = items.filter((i) => i.lineId !== lineId);
      } else {
        const validatedQty = Math.min(50, Math.max(1, parseInt(String(qty), 10) || 1));
        const item = items.find((i) => i.lineId === lineId);
        if (item) item.qty = validatedQty;
      }

      await setCacheKey(cartKey, JSON.stringify(items), 14 * 86400);

      const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.qty, 0);
      const itemCount = items.reduce((sum, item) => sum + item.qty, 0);

      return reply.send({ sessionId, items, subtotal, itemCount, currency: 'INR' });
    }
  );

  // ─── CLEAR CART ───────────────────────────────────────────────────────────
  app.delete('/cart', async (request, reply) => {
    const sessionId = getCartSession(request, reply);
    const cartKey = `cart:${sessionId}`;
    await delCacheKey(cartKey);
    return reply.send({ sessionId, items: [], subtotal: 0, itemCount: 0, currency: 'INR' });
  });
}
