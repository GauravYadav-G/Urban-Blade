import { FastifyInstance } from 'fastify';
import { getCacheKey, setCacheKey, delCacheKey } from '../../redis/client.js';

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
  // Helper to extract session or user ID
  function getCartKey(request: any): string {
    const sessionId = (request.headers['x-session-id'] as string) || 'guest-session';
    return `cart:${sessionId}`;
  }

  // ─── GET CART (SUB-1MS REDIS FETCH) ────────────────────────────────────────
  app.get('/cart', async (request, reply) => {
    const cartKey = getCartKey(request);
    const raw = await getCacheKey(cartKey);
    const items: CartItem[] = raw ? JSON.parse(raw) : [];

    const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.qty, 0);
    const itemCount = items.reduce((sum, item) => sum + item.qty, 0);

    return reply.send({
      items,
      subtotal,
      itemCount,
      currency: 'INR',
    });
  });

  // ─── ADD ITEM TO CART ─────────────────────────────────────────────────────
  app.post<{ Body: CartItem }>('/cart/items', async (request, reply) => {
    const cartKey = getCartKey(request);
    const newItem = request.body;

    const raw = await getCacheKey(cartKey);
    let items: CartItem[] = raw ? JSON.parse(raw) : [];

    const existingIndex = items.findIndex((i) => i.productId === newItem.productId);
    if (existingIndex > -1) {
      items[existingIndex].qty += newItem.qty || 1;
    } else {
      items.push({
        ...newItem,
        lineId: newItem.lineId || `line-${newItem.productId}`,
        qty: newItem.qty || 1,
      });
    }

    // Save back to Redis with 14-day rolling TTL
    await setCacheKey(cartKey, JSON.stringify(items), 14 * 86400);

    const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.qty, 0);
    const itemCount = items.reduce((sum, item) => sum + item.qty, 0);

    return reply.status(200).send({
      items,
      subtotal,
      itemCount,
      currency: 'INR',
    });
  });

  // ─── UPDATE ITEM QUANTITY ─────────────────────────────────────────────────
  app.put<{ Params: { lineId: string }; Body: { qty: number } }>(
    '/cart/items/:lineId',
    async (request, reply) => {
      const cartKey = getCartKey(request);
      const { lineId } = request.params;
      const { qty } = request.body;

      const raw = await getCacheKey(cartKey);
      let items: CartItem[] = raw ? JSON.parse(raw) : [];

      if (qty <= 0) {
        items = items.filter((i) => i.lineId !== lineId);
      } else {
        const item = items.find((i) => i.lineId === lineId);
        if (item) item.qty = qty;
      }

      await setCacheKey(cartKey, JSON.stringify(items), 14 * 86400);

      const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.qty, 0);
      const itemCount = items.reduce((sum, item) => sum + item.qty, 0);

      return reply.send({ items, subtotal, itemCount, currency: 'INR' });
    }
  );

  // ─── CLEAR CART ───────────────────────────────────────────────────────────
  app.delete('/cart', async (request, reply) => {
    const cartKey = getCartKey(request);
    await delCacheKey(cartKey);
    return reply.send({ items: [], subtotal: 0, itemCount: 0, currency: 'INR' });
  });
}
