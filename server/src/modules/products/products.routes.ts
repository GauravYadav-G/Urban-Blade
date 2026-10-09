import { FastifyInstance } from 'fastify';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from '../../db/pool.js';
import { getOrSetCache, invalidateCatalog } from '../../redis/cache.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Fallback seed catalog in memory for zero-downtime offline mode
const seedProducts: any[] = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../db/products.seed.json'), 'utf-8')
);

function formatProduct(p: any) {
  const defaultStock = Boolean(p.in_stock ?? p.inStock ?? true) ? 100 : 0;
  const rawQty = p.stock_quantity ?? p.stockQuantity;
  const baseStock = rawQty !== undefined && rawQty !== null ? Number(rawQty) : defaultStock;
  const stockQty = Math.max(0, baseStock - Number(p.stock_reserved ?? 0));
  const inStockVal = Boolean(p.in_stock ?? p.inStock ?? true) && stockQty > 0;
  const compareAt = p.compare_at_price != null ? Number(p.compare_at_price) : (p.compareAtPrice != null ? Number(p.compareAtPrice) : null);
  const img = p.image_url || p.imageUrl || '/images/products/hc-shampoo.jpg';
  const freeDel = p.free_delivery ?? p.freeDelivery ?? true;
  const reviews = Number(p.review_count ?? p.reviewCount ?? 0);
  const rate = Number(p.rating ?? 5.0);

  return {
    ...p,
    id: p.id,
    name: p.name,
    slug: p.slug,
    description: p.description,
    longDescription: p.long_description || p.longDescription || p.description || '',
    long_description: p.long_description || p.longDescription || p.description || '',
    highlights: Array.isArray(p.highlights)
      ? p.highlights
      : (typeof p.highlights === 'string' ? JSON.parse(p.highlights) : ['Salon Grade', 'Premium Formula']),
    price: Number(p.price),
    compareAtPrice: compareAt,
    compare_at_price: compareAt,
    currency: p.currency || 'INR',
    imageUrl: img,
    image_url: img,
    category: p.category || 'hair',
    kind: p.kind || 'retail',
    vendor: p.vendor || 'Urban Blade Lab',
    audience: p.audience || 'unisex',
    freeDelivery: freeDel,
    free_delivery: freeDel,
    rating: rate,
    reviewCount: reviews,
    review_count: reviews,
    badge: p.badge,
    inStock: inStockVal,
    in_stock: inStockVal,
    stockQuantity: stockQty,
    stock_quantity: stockQty,
  };
}

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
      t?: string;
      nocache?: string;
    };
  }>('/products', async (request, reply) => {
    const { q, cat, deals, audience, sort, page = '1', limit = '24', t, nocache } = request.query;

    const cacheKey = `catalog:query:${JSON.stringify({ q, cat, deals, audience, sort, page, limit })}`;

    const fetchFromDb = async () => {
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
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 30));
        const offset = (pageNum - 1) * limitNum;

        const sql = `
          SELECT id, slug, name, description, highlights, price, compare_at_price,
                 currency, image_url, category, kind, vendor, audience, free_delivery,
                 rating, review_count, badge, in_stock, stock_quantity, stock_reserved
          FROM products
          ${whereClause}
          ORDER BY ${orderBy}
          LIMIT ${limitNum} OFFSET ${offset};
        `;

        const res = await query(sql, values);
        return { data: res.rows.map(formatProduct), page: pageNum, limit: limitNum, source: 'database' };
      } catch (err) {
        request.log.error(err, 'Catalog unavailable');
        throw Object.assign(new Error('Catalog temporarily unavailable'), { statusCode: 503 });
      }
    };

    let result;
    if (t || nocache) {
      result = await fetchFromDb();
    } else {
      result = await getOrSetCache(cacheKey, fetchFromDb, { ttlSeconds: 15, useL1: true });
    }

    reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    reply.header('Pragma', 'no-cache');
    reply.header('Expires', '0');
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
          if (res.rows.length > 0) return res.rows.map(formatProduct);
        } catch {}
        return seedProducts.filter((p) => (p.compare_at_price || p.compareAtPrice) && (p.compare_at_price || p.compareAtPrice) > p.price).slice(0, 12).map(formatProduct);
      },
      { ttlSeconds: 30 }
    );
    reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    return reply.send(deals);
  });

  // ─── GET BESTSELLERS ───────────────────────────────────────────────────────
  app.get('/products/bestsellers', async (request, reply) => {
    const bestsellers = await getOrSetCache(
      'catalog:bestsellers',
      async () => {
        try {
          const res = await query(`SELECT * FROM products ORDER BY review_count DESC LIMIT 12`);
          if (res.rows.length > 0) return res.rows.map(formatProduct);
        } catch {}
        return [...seedProducts].sort((a, b) => (b.review_count || b.reviewCount || 0) - (a.review_count || a.reviewCount || 0)).slice(0, 12).map(formatProduct);
      },
      { ttlSeconds: 30 }
    );
    reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    return reply.send(bestsellers);
  });

  // ─── GET PRODUCT BY ID OR SLUG ─────────────────────────────────────────────
  app.get<{ Params: { idOrSlug: string }; Querystring: { t?: string; nocache?: string } }>('/products/:idOrSlug', async (request, reply) => {
    const { idOrSlug } = request.params;
    const { t, nocache } = request.query || {};
    const cleanSlug = idOrSlug.replace(/^(hc|bd|sk|tl|gf|sv)-/, '');
    const cacheKey = `product:${idOrSlug}`;

    const fetchDetail = async () => {
      try {
        const res = await query(
          `SELECT * FROM products WHERE slug = $1 OR slug = $2 OR id::text = $1 LIMIT 1`,
          [idOrSlug, cleanSlug]
        );
        if (res.rows.length > 0) return formatProduct(res.rows[0]);
      } catch {}
      const match = seedProducts.find((p) => p.id === idOrSlug || p.slug === idOrSlug || p.id === cleanSlug || p.slug === cleanSlug);
      return match ? formatProduct(match) : null;
    };

    let product;
    if (t || nocache) {
      product = await fetchDetail();
    } else {
      product = await getOrSetCache(cacheKey, fetchDetail, { ttlSeconds: 15 });
    }

    if (!product) {
      return reply.status(404).send({ error: 'PRODUCT_NOT_FOUND', message: 'Product does not exist' });
    }

    reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    reply.header('Pragma', 'no-cache');
    reply.header('Expires', '0');
    return reply.send(product);
  });

  // ─── GET MARKETPLACE PRICE COMPARISON FOR A PRODUCT ────────────────────────────
  app.get<{ Params: { idOrSlug: string } }>('/products/:idOrSlug/compare', async (request, reply) => {
    const { idOrSlug } = request.params;
    const cacheKey = `product:compare:${idOrSlug}`;

    const comparison = await getOrSetCache(
      cacheKey,
      async () => {
        // First, resolve the product ID
        let productId: string | null = null;
        try {
          const res = await query(`SELECT id FROM products WHERE slug = $1 OR id::text = $1 LIMIT 1`, [idOrSlug]);
          if (res.rows.length > 0) productId = res.rows[0].id;
        } catch {}

        if (!productId) {
          const match = seedProducts.find((p) => p.id === idOrSlug || p.slug === idOrSlug);
          if (match) productId = match.id;
        }

        if (!productId) return null;

        // Fetch marketplace links for this product
        try {
          const linksRes = await query(
            `SELECT marketplace, url, price, currency, last_checked, check_status, error_message, updated_at
             FROM marketplace_links WHERE product_id = $1 ORDER BY
               CASE marketplace
                 WHEN 'amazon' THEN 1
                 WHEN 'flipkart' THEN 2
                 WHEN 'nykaa' THEN 3
                 WHEN 'purplle' THEN 4
                 ELSE 5
               END`,
            [productId]
          );

          const marketplacePrices = linksRes.rows.map((row) => ({
            marketplace: row.marketplace,
            url: row.url,
            price: row.price ? Number(row.price) : null,
            currency: row.currency,
            lastChecked: row.last_checked,
            status: row.check_status,
            error: row.error_message,
            updatedAt: row.updated_at,
          }));

          // Also get the product's own price for comparison
          let ourPrice = 0;
          let ourCompareAt = null;
          try {
            const pRes = await query(`SELECT price, compare_at_price FROM products WHERE id = $1`, [productId]);
            if (pRes.rows.length > 0) {
              ourPrice = Number(pRes.rows[0].price);
              ourCompareAt = pRes.rows[0].compare_at_price ? Number(pRes.rows[0].compare_at_price) : null;
            }
          } catch {}

          return {
            productId,
            ourPrice,
            ourCompareAtPrice: ourCompareAt,
            marketplacePrices,
            bestMarketplacePrice: marketplacePrices
              .filter((m) => m.price !== null && m.status === 'success')
              .sort((a, b) => (a.price || Infinity) - (b.price || Infinity))[0] || null,
            lastRefreshed: marketplacePrices.length > 0
              ? marketplacePrices.reduce((latest, m) =>
                  new Date(m.updatedAt) > new Date(latest.updatedAt) ? m : latest
                ).updatedAt
              : null,
          };
        } catch (err) {
          request.log.error(err, 'Failed to fetch marketplace prices');
          return {
            productId,
            ourPrice: 0,
            ourCompareAtPrice: null,
            marketplacePrices: [],
            bestMarketplacePrice: null,
            lastRefreshed: null,
            error: 'Failed to fetch marketplace prices',
          };
        }
      },
      { ttlSeconds: 300 }
    );

    if (!comparison) {
      return reply.status(404).send({ error: 'PRODUCT_NOT_FOUND', message: 'Product does not exist' });
    }

    reply.header('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
    return reply.send(comparison);
  });

  // ─── UPDATE PRODUCT / INVENTORY (DIRECT OR STAFF) ──────────────────────────
  app.put<{
    Params: { id: string };
    Body: any;
  }>('/products/:id', async (request, reply) => {
    const { id } = request.params;
    const b: any = request.body || {};
    const cleanId = id.replace(/^(hc|bd|sk|tl|gf|sv)-/, '');

    const rawStock = b.stockQuantity !== undefined ? b.stockQuantity : b.stock_quantity;
    const stockQty = rawStock !== undefined && rawStock !== null && rawStock !== '' ? Math.max(0, Math.floor(Number(rawStock))) : undefined;
    if (stockQty !== undefined && isNaN(stockQty)) {
      return reply.code(400).send({ error: 'INVALID_STOCK' });
    }
    let inStock = b.inStock !== undefined ? Boolean(b.inStock) : (b.in_stock !== undefined ? Boolean(b.in_stock) : undefined);
    if (stockQty !== undefined && inStock === undefined) {
      inStock = stockQty > 0;
    } else if (stockQty !== undefined && stockQty === 0) {
      inStock = false;
    } else if (stockQty !== undefined && stockQty > 0) {
      inStock = true;
    }

    const compareAt = b.compareAtPrice !== undefined ? b.compareAtPrice : b.compare_at_price;
    const imgUrl = b.imageUrl || b.image_url;
    const longDesc = b.longDescription || b.long_description;

    try {
      const res = await query(
        `
        UPDATE products SET
          name = COALESCE($1, name),
          price = COALESCE($2, price),
          compare_at_price = COALESCE($3, compare_at_price),
          stock_quantity = COALESCE($4, stock_quantity),
          in_stock = COALESCE($5, in_stock),
          badge = $6,
          category = COALESCE($7, category),
          description = COALESCE($8, description),
          image_url = COALESCE($9, image_url),
          long_description = COALESCE($10, long_description),
          stock_reserved = CASE WHEN $4::integer IS NOT NULL AND $4::integer = 0 THEN 0 ELSE stock_reserved END,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = (SELECT id FROM products WHERE id::text = $11 OR slug = $11 OR slug = $12 ORDER BY (id::text = $11) DESC LIMIT 1)
        RETURNING *;
        `,
        [
          b.name,
          b.price !== undefined ? Number(b.price) : null,
          compareAt,
          stockQty,
          inStock,
          b.badge,
          b.category,
          b.description,
          imgUrl,
          longDesc,
          id,
          cleanId,
        ]
      );

      const sp = seedProducts.find((p) => p.id === id || p.slug === id || p.id === cleanId || p.slug === cleanId);
      if (sp) {
        if (stockQty !== undefined) sp.stock_quantity = stockQty;
        if (inStock !== undefined) sp.inStock = inStock;
        if (b.name) sp.name = b.name;
        if (b.price !== undefined) sp.price = Number(b.price);
      }

      await invalidateCatalog();

      if (res.rows.length > 0) {
        return reply.send(formatProduct(res.rows[0]));
      }
      if (sp) {
        return reply.send(formatProduct(sp));
      }
    } catch (err: any) {
      request.log.error({ err }, 'Product update failed');
      return reply.code(500).send({ error: 'PRODUCT_UPDATE_FAILED', message: err.message });
    }

    await invalidateCatalog();
    return reply.status(404).send({ error: 'PRODUCT_NOT_FOUND' });
  });
}
