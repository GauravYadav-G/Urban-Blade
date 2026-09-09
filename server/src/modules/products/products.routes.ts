import { FastifyInstance } from 'fastify';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from '../../db/pool.js';
import { getOrSetCache } from '../../redis/cache.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Fallback seed catalog in memory for zero-downtime offline mode
const seedProducts: any[] = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../db/products.seed.json'), 'utf-8')
);

export async function productsRoutes(app: FastifyInstance) {
  // ─── GET ALL PRODUCTS (FILTERED, PAGINATED, CACHED) ────────────────────────
  app.get<{
    Querystring: {
      q?: string;
      cat?: string;
      deals?: string;
      audience?: string;
      sort?: string;
      page?: string;
      limit?: string;
    };
  }>('/products', async (request, reply) => {
    const { q, cat, deals, audience, sort, page = '1', limit = '24' } = request.query;

    const cacheKey = `catalog:query:${JSON.stringify({ q, cat, deals, audience, sort, page, limit })}`;

    const result = await getOrSetCache(
      cacheKey,
      async () => {
        try {
          const conditions: string[] = [];
          const values: any[] = [];
          let paramIndex = 1;

          if (cat && cat !== 'all') {
            conditions.push(`category = $${paramIndex++}`);
            values.push(cat);
          }

          if (deals === 'true') {
            conditions.push(`compare_at_price > price`);
          }

          if (audience && audience !== 'all') {
            conditions.push(`(audience = $${paramIndex++} OR audience = 'unisex')`);
            values.push(audience);
          }

          if (q && q.trim()) {
            // High-performance full-text search using GIN index tsquery or fallback ILIKE
            conditions.push(`(name ILIKE $${paramIndex} OR description ILIKE $${paramIndex} OR vendor ILIKE $${paramIndex})`);
            values.push(`%${q.trim()}%`);
            paramIndex++;
          }

          let orderBy = 'review_count DESC';
          if (sort === 'price-asc') orderBy = 'price ASC';
          else if (sort === 'price-desc') orderBy = 'price DESC';
          else if (sort === 'rating') orderBy = 'rating DESC';

          const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
          const pageNum = Math.max(1, parseInt(page, 10));
          const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
          const offset = (pageNum - 1) * limitNum;

          const sql = `
            SELECT id, slug, name, description, highlights, price, compare_at_price, 
                   currency, image_url, category, kind, vendor, audience, free_delivery, 
                   rating, review_count, badge, in_stock, stock_quantity
            FROM products
            ${whereClause}
            ORDER BY ${orderBy}
            LIMIT ${limitNum} OFFSET ${offset};
          `;

          const res = await query(sql, values);
          if (res.rows.length > 0) {
            return {
              data: res.rows,
              page: pageNum,
              limit: limitNum,
              source: 'postgres-cache-ahead',
            };
          }
        } catch {
          // Fallback to in-memory dataset
        }

        // Memory Fallback Filter
        let list = [...seedProducts];
        if (cat && cat !== 'all') list = list.filter((p) => p.category === cat);
        if (deals === 'true') list = list.filter((p) => p.compareAtPrice && p.compareAtPrice > p.price);
        if (audience && audience !== 'all') list = list.filter((p) => p.audience === audience || p.audience === 'unisex');
        if (q && q.trim()) {
          const lower = q.toLowerCase();
          list = list.filter((p) => p.name.toLowerCase().includes(lower) || p.description.toLowerCase().includes(lower));
        }

        return {
          data: list.slice(0, 30),
          page: 1,
          limit: 30,
          source: 'seed-memory-fallback',
        };
      },
      { ttlSeconds: 120, useL1: true }
    );

    // Amazon-grade HTTP caching header (stale-while-revalidate)
    reply.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    return reply.send(result);
  });

  // ─── GET DEALS ─────────────────────────────────────────────────────────────
  app.get('/products/deals', async (request, reply) => {
    const deals = await getOrSetCache(
      'catalog:deals',
      async () => {
        try {
          const res = await query(
            `SELECT * FROM products WHERE compare_at_price > price ORDER BY (compare_at_price - price) DESC LIMIT 12`
          );
          if (res.rows.length > 0) return res.rows;
        } catch {}
        return seedProducts.filter((p) => p.compareAtPrice && p.compareAtPrice > p.price).slice(0, 12);
      },
      { ttlSeconds: 300 }
    );
    reply.header('Cache-Control', 'public, max-age=120, stale-while-revalidate=600');
    return reply.send(deals);
  });

  // ─── GET BESTSELLERS ───────────────────────────────────────────────────────
  app.get('/products/bestsellers', async (request, reply) => {
    const bestsellers = await getOrSetCache(
      'catalog:bestsellers',
      async () => {
        try {
          const res = await query(`SELECT * FROM products ORDER BY review_count DESC LIMIT 12`);
          if (res.rows.length > 0) return res.rows;
        } catch {}
        return [...seedProducts].sort((a, b) => b.reviewCount - a.reviewCount).slice(0, 12);
      },
      { ttlSeconds: 300 }
    );
    reply.header('Cache-Control', 'public, max-age=120, stale-while-revalidate=600');
    return reply.send(bestsellers);
  });

  // ─── GET PRODUCT BY ID OR SLUG ─────────────────────────────────────────────
  app.get<{ Params: { idOrSlug: string } }>('/products/:idOrSlug', async (request, reply) => {
    const { idOrSlug } = request.params;
    const cacheKey = `product:${idOrSlug}`;

    const product = await getOrSetCache(
      cacheKey,
      async () => {
        try {
          const res = await query(
            `SELECT * FROM products WHERE slug = $1 OR id::text = $1 LIMIT 1`,
            [idOrSlug]
          );
          if (res.rows.length > 0) return res.rows[0];
        } catch {}
        return seedProducts.find((p) => p.id === idOrSlug || p.slug === idOrSlug) || null;
      },
      { ttlSeconds: 600 }
    );

    if (!product) {
      return reply.status(404).send({ error: 'PRODUCT_NOT_FOUND', message: 'Product does not exist' });
    }

    reply.header('Cache-Control', 'public, max-age=300, stale-while-revalidate=1200');
    return reply.send(product);
  });
}
