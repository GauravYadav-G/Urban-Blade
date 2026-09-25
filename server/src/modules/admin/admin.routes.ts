import { FastifyInstance } from 'fastify';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from '../../db/pool.js';
import { invalidateCatalog, getOrSetCache } from '../../redis/cache.service.js';
import { checkDbHealth } from '../../db/pool.js';
import { checkRedisHealth } from '../../redis/client.js';
import { getEventLoopLag, getMemoryUsage } from '../../core/circuit-breaker.js';
import { syncOrderFromCarrierWebsite } from '../orders/carrier-portal.service.js';
import { generateAiReply } from '../support/support.routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read seed catalog for fallback
const seedProducts: any[] = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../db/products.seed.json'), 'utf-8')
);

export async function adminRoutes(app: FastifyInstance) {
  // ─── 1. DYNAMIC EXECUTIVE DASHBOARD KPI METRICS ────────────────────────────
  app.get('/admin/metrics', async (request, reply) => {
    try {
      // 1. Revenue aggregations (Today, Week, Month)
      const revRes = await query(`
        SELECT 
          COALESCE(SUM(CASE WHEN created_at >= CURRENT_DATE THEN total_amount ELSE 0 END), 0)::numeric as today_rev,
          COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL '7 days' THEN total_amount ELSE 0 END), 0)::numeric as week_rev,
          COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL '14 days' AND created_at < NOW() - INTERVAL '7 days' THEN total_amount ELSE 0 END), 0)::numeric as prev_week_rev,
          COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN total_amount ELSE 0 END), 0)::numeric as month_rev,
          COALESCE(SUM(total_amount), 0)::numeric as total_rev
        FROM orders
        WHERE status != 'cancelled';
      `);

      // 2. Order stage status counts (including confirmed orders in accepted/new queue)
      const orderCountsRes = await query(`
        SELECT 
          COUNT(*)::int as total,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int as week_orders,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '14 days' AND created_at < NOW() - INTERVAL '7 days')::int as prev_week_orders,
          COUNT(*) FILTER (WHERE status IN ('accepted', 'confirmed', 'pending'))::int as accepted,
          COUNT(*) FILTER (WHERE status = 'processing')::int as processing,
          COUNT(*) FILTER (WHERE status = 'shipped')::int as shipped,
          COUNT(*) FILTER (WHERE status = 'delivered')::int as delivered,
          COUNT(*) FILTER (WHERE status = 'cancelled')::int as cancelled
        FROM orders;
      `);

      // 3. Booking occupancy & counts
      const bookRes = await query(`
        SELECT 
          COUNT(*)::int as total,
          COUNT(*) FILTER (WHERE booking_date = CURRENT_DATE AND status != 'cancelled')::int as today,
          COUNT(*) FILTER (WHERE booking_date >= CURRENT_DATE - 7 AND booking_date <= CURRENT_DATE AND status != 'cancelled')::int as week_bookings,
          COUNT(*) FILTER (WHERE booking_date >= CURRENT_DATE - 14 AND booking_date < CURRENT_DATE - 7 AND status != 'cancelled')::int as prev_week_bookings,
          COUNT(*) FILTER (WHERE status = 'confirmed')::int as confirmed,
          COUNT(*) FILTER (WHERE status = 'completed')::int as completed
        FROM bookings;
      `);

      // 4. Product inventory stats
      const stockRes = await query(`
        SELECT 
          COUNT(*)::int as total,
          COUNT(*) FILTER (WHERE stock_quantity <= 15 AND stock_quantity > 0)::int as low_stock,
          COUNT(*) FILTER (WHERE stock_quantity = 0 OR in_stock = false)::int as out_of_stock
        FROM products;
      `);

      const rev = revRes.rows[0] || {};
      const orders = orderCountsRes.rows[0] || {};
      const bookings = bookRes.rows[0] || {};
      const stock = stockRes.rows[0] || {};

      // Dynamic occupancy calculation based on 3 chairs * 8 slots = 24 max daily slots
      const todayBookings = Number(bookings.today) || 0;
      const occupancyRate = todayBookings > 0 ? Math.min(100, Math.round((todayBookings / 24) * 100)) : 0;

      const weekRev = Number(rev.week_rev) || 0;
      const prevWeekRev = Number(rev.prev_week_rev) || 0;
      const revTrend = prevWeekRev > 0 ? Number((((weekRev - prevWeekRev) / prevWeekRev) * 100).toFixed(1)) : (weekRev > 0 ? 10.0 : 0.0);

      const weekOrders = Number(orders.week_orders) || 0;
      const prevWeekOrders = Number(orders.prev_week_orders) || 0;
      const orderTrend = prevWeekOrders > 0 ? Number((((weekOrders - prevWeekOrders) / prevWeekOrders) * 100).toFixed(1)) : (weekOrders > 0 ? 5.0 : 0.0);

      const weekBookings = Number(bookings.week_bookings) || 0;
      const prevWeekBookings = Number(bookings.prev_week_bookings) || 0;
      const bookTrend = prevWeekBookings > 0 ? Number((((weekBookings - prevWeekBookings) / prevWeekBookings) * 100).toFixed(1)) : (weekBookings > 0 ? 5.0 : 0.0);

      return reply.send({
        revenue: {
          today: Number(rev.today_rev) || 0,
          week: weekRev,
          month: Number(rev.month_rev) || Number(rev.total_rev) || 0,
          trendPercent: revTrend,
        },
        orders: {
          total: Number(orders.total) || 0,
          accepted: Number(orders.accepted) || 0,
          processing: Number(orders.processing) || 0,
          shipped: Number(orders.shipped) || 0,
          delivered: Number(orders.delivered) || 0,
          trendPercent: orderTrend,
        },
        bookings: {
          total: Number(bookings.total) || 0,
          today: todayBookings,
          occupancyRate,
          trendPercent: bookTrend,
        },
        inventory: {
          totalProducts: Number(stock.total) || seedProducts.length || 0,
          lowStock: Number(stock.low_stock) || 0,
          outOfStock: Number(stock.out_of_stock) || 0,
        },
      });
    } catch (err: any) {
      return reply.send({
        revenue: { today: 0, week: 0, month: 0, trendPercent: 0 },
        orders: { total: 0, accepted: 0, processing: 0, shipped: 0, delivered: 0, trendPercent: 0 },
        bookings: { total: 0, today: 0, occupancyRate: 0, trendPercent: 0 },
        inventory: { totalProducts: seedProducts.length || 0, lowStock: 0, outOfStock: 0 },
      });
    }
  });

  // ─── 1B. 7-DAY REVENUE & ORDERS TIME-SERIES (FOR INTERACTIVE SPLINE CHART) ──
  app.get('/admin/metrics/daily', async (request, reply) => {
    try {
      const res = await query(`
        WITH days AS (
          SELECT generate_series(
            CURRENT_DATE - INTERVAL '6 days',
            CURRENT_DATE,
            '1 day'::interval
          )::date AS day
        )
        SELECT 
          to_char(d.day, 'YYYY-MM-DD') as date,
          to_char(d.day, 'Dy') as day_label,
          COALESCE(SUM(o.total_amount), 0)::numeric as revenue,
          COUNT(o.id)::int as orders
        FROM days d
        LEFT JOIN orders o ON DATE(o.created_at) = d.day AND o.status != 'cancelled'
        GROUP BY d.day
        ORDER BY d.day ASC;
      `);

      return reply.send({
        data: res.rows.map((r) => ({
          date: r.date,
          dayLabel: r.day_label,
          revenue: Number(r.revenue),
          orders: Number(r.orders),
        })),
      });
    } catch (err: any) {
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const fallback = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        fallback.push({
          date: d.toISOString().split('T')[0],
          dayLabel: days[d.getDay()],
          revenue: 0,
          orders: 0,
        });
      }
      return reply.send({ data: fallback });
    }
  });

  function formatProductRow(p: any) {
    const stockQty = Number(p.stock_quantity ?? p.stockQuantity ?? 100);
    const inStockVal = Boolean(p.in_stock ?? p.inStock ?? (stockQty > 0));
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
      createdAt: p.created_at,
      created_at: p.created_at,
    };
  }

  // ─── 2. FULL PRODUCT INVENTORY & CRUD ─────────────────────────────────────
  app.get<{ Querystring: { vendor?: string } }>('/admin/products', async (request, reply) => {
    const { vendor } = request.query || {};
    try {
      let sql = `
        SELECT id, slug, name, description, long_description, highlights, price, compare_at_price, 
               currency, image_url, category, kind, vendor, audience, free_delivery, 
               rating, review_count, badge, in_stock, stock_quantity, created_at
        FROM products
      `;
      const params: any[] = [];
      if (vendor) {
        params.push(vendor);
        sql += ` WHERE vendor ILIKE $1 `;
      }
      sql += ` ORDER BY created_at DESC `;

      const res = await query(sql, params);
      if (res.rows.length > 0) {
        return reply.send({ data: res.rows.map(formatProductRow) });
      }
    } catch {}

    const list = seedProducts.filter((p) => !vendor || p.vendor?.toLowerCase().includes(vendor.toLowerCase()));
    return reply.send({
      data: list.map(formatProductRow),
    });
  });

  // Create Product
  app.post<{
    Body: {
      name: string;
      slug?: string;
      description: string;
      longDescription?: string;
      long_description?: string;
      price: number;
      compareAtPrice?: number;
      compare_at_price?: number;
      category: string;
      kind?: string;
      vendor?: string;
      audience?: string;
      imageUrl?: string;
      image_url?: string;
      stockQuantity?: number;
      stock_quantity?: number;
      badge?: string;
      highlights?: string[];
    };
  }>('/admin/products', async (request, reply) => {
    const p = request.body;
    const slug = p.slug || p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const stockQty = Number(p.stockQuantity ?? p.stock_quantity ?? 100);
    const inStock = stockQty > 0;
    const compareAt = p.compareAtPrice !== undefined ? p.compareAtPrice : (p.compare_at_price !== undefined ? p.compare_at_price : null);
    const imgUrl = p.imageUrl || p.image_url || '/images/products/hc-shampoo.jpg';
    const longDesc = p.longDescription || p.long_description || p.description || '';

    try {
      const res = await query(
        `
        INSERT INTO products (
          name, slug, description, long_description, price, compare_at_price,
          category, kind, vendor, audience, image_url, stock_quantity, badge,
          highlights, in_stock, rating, review_count
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 5.0, 1
        )
        ON CONFLICT (slug) DO UPDATE SET
          name = EXCLUDED.name,
          price = EXCLUDED.price,
          compare_at_price = EXCLUDED.compare_at_price,
          stock_quantity = EXCLUDED.stock_quantity,
          in_stock = EXCLUDED.in_stock,
          image_url = EXCLUDED.image_url,
          description = EXCLUDED.description,
          long_description = EXCLUDED.long_description,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *;
        `,
        [
          p.name,
          slug,
          p.description || '',
          longDesc,
          p.price,
          compareAt,
          p.category || 'hair',
          p.kind || 'retail',
          p.vendor || 'Urban Blade Lab',
          p.audience || 'unisex',
          imgUrl,
          stockQty,
          p.badge || null,
          JSON.stringify(p.highlights || ['Salon Grade', 'Premium Formula']),
          inStock,
        ]
      );

      await invalidateCatalog();
      return reply.status(201).send(formatProductRow(res.rows[0]));
    } catch (err: any) {
      return reply.status(500).send({ error: 'FAILED_TO_CREATE_PRODUCT', message: err.message });
    }
  });

  // Update Product
  app.put<{
    Params: { id: string };
    Body: {
      name?: string;
      price?: number;
      compareAtPrice?: number;
      compare_at_price?: number;
      stockQuantity?: number;
      stock_quantity?: number;
      inStock?: boolean;
      in_stock?: boolean;
      badge?: string;
      category?: string;
      description?: string;
      longDescription?: string;
      long_description?: string;
      imageUrl?: string;
      image_url?: string;
    };
  }>('/admin/products/:id', async (request, reply) => {
    const { id } = request.params;
    const b = request.body;
    const stockQty = b.stockQuantity !== undefined ? b.stockQuantity : b.stock_quantity;
    const inStock = b.inStock !== undefined ? b.inStock : (b.in_stock !== undefined ? b.in_stock : (stockQty !== undefined ? stockQty > 0 : undefined));
    const compareAt = b.compareAtPrice !== undefined ? b.compareAtPrice : b.compare_at_price;
    const imgUrl = b.imageUrl || b.image_url;
    const longDesc = b.longDescription || b.long_description;

    try {
      const cleanId = id.replace(/^(hc|bd|sk|tl|gf|sv)-/, '');
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
          updated_at = CURRENT_TIMESTAMP
        WHERE id::text = $11 OR slug = $11 OR slug = $12 OR slug ILIKE ('%' || $12 || '%')
        RETURNING *;
        `,
        [
          b.name,
          b.price,
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

      await invalidateCatalog();

      if (res.rows.length > 0) {
        return reply.send(formatProductRow(res.rows[0]));
      }
    } catch {}

    await invalidateCatalog();
    return reply.status(404).send({ error: 'PRODUCT_NOT_FOUND' });
  });

  // Delete Product
  app.delete<{ Params: { id: string } }>('/admin/products/:id', async (request, reply) => {
    const { id } = request.params;
    try {
      await query('DELETE FROM products WHERE id::text = $1 OR slug = $1', [id]);
    } catch {}

    await invalidateCatalog();
    return reply.send({ success: true, message: 'Product removed' });
  });

  // ─── 3. ORDERS LIFECYCLE MANAGEMENT ───────────────────────────────────────
  app.get<{ Querystring: { vendor?: string } }>('/admin/orders', async (request, reply) => {
    const { vendor } = request.query || {};
    try {
      let sql = `
        SELECT 
          o.id, 
          o.user_id,
          o.status, 
          o.subtotal::numeric, 
          o.total_amount::numeric, 
          o.discount_amount::numeric,
          o.coupon_code,
          o.tracking_number,
          o.currency,
          o.payment_method, 
          o.payment_status, 
          o.transaction_id,
          o.shipping_address, 
          o.created_at,
          o.updated_at,
          COALESCE(
            json_agg(
              json_build_object(
                'id', oi.id,
                'product_id', oi.product_id,
                'product_name', oi.product_name,
                'unit_price', oi.unit_price::numeric,
                'quantity', oi.quantity,
                'image_url', oi.image_url,
                'vendor', p.vendor
              )
            ) FILTER (WHERE oi.id IS NOT NULL), '[]'
          ) as items
        FROM orders o
        LEFT JOIN order_items oi ON oi.order_id = o.id
        LEFT JOIN products p ON p.id = oi.product_id
      `;

      const params: any[] = [];
      if (vendor) {
        params.push(vendor);
        sql += `
          WHERE EXISTS (
            SELECT 1 FROM order_items oi2 
            LEFT JOIN products p2 ON p2.id = oi2.product_id 
            WHERE oi2.order_id = o.id AND (p2.vendor ILIKE $1 OR oi2.product_name ILIKE '%' || $1 || '%')
          )
        `;
      }

      sql += `
        GROUP BY o.id
        ORDER BY o.created_at DESC
        LIMIT 250;
      `;

      const res = await query(sql, params);
      return reply.send({ data: res.rows });
    } catch (err: any) {
      request.log.error(err, 'Failed to fetch admin orders');
      return reply.send({ data: [] });
    }
  });

  // Direct Order Ingestion (from client checkout or direct POS)
  app.post<{
    Body: {
      id?: string;
      status?: string;
      subtotal: number;
      total_amount: number;
      currency?: string;
      payment_method?: string;
      payment_status?: string;
      transaction_id?: string;
      shipping_address: any;
      items?: Array<{
        product_name: string;
        unit_price: number;
        quantity: number;
        image_url?: string;
      }>;
    };
  }>('/admin/orders', async (request, reply) => {
    const b = request.body;
    try {
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(b.id || '');
      const orderId = isUUID ? b.id! : (await query('SELECT gen_random_uuid() as id')).rows[0].id;

      const insertRes = await query(
        `
        INSERT INTO orders (id, status, subtotal, total_amount, currency, payment_method, payment_status, transaction_id, shipping_address)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status,
          payment_status = EXCLUDED.payment_status,
          transaction_id = COALESCE(EXCLUDED.transaction_id, orders.transaction_id),
          updated_at = CURRENT_TIMESTAMP
        RETURNING *;
        `,
        [
          orderId,
          b.status || 'confirmed',
          b.subtotal || b.total_amount,
          b.total_amount,
          b.currency || 'INR',
          b.payment_method || 'UPI',
          b.payment_status || 'captured',
          b.transaction_id || `pos_tx_${Date.now()}`,
          JSON.stringify(b.shipping_address || {}),
        ]
      );

      if (b.items && b.items.length > 0) {
        // Prevent duplicate item ingestion if order items already exist
        const existingItems = await query('SELECT count(*)::int as count FROM order_items WHERE order_id = $1', [orderId]);
        if ((existingItems.rows[0]?.count || 0) === 0) {
          for (const it of b.items) {
            await query(
              `INSERT INTO order_items (order_id, product_name, unit_price, quantity, image_url)
               VALUES ($1, $2, $3, $4, $5)`,
              [orderId, it.product_name, it.unit_price, it.quantity, it.image_url || '']
            );
          }
        }
      }

      return reply.status(201).send({ ok: true, order: insertRes.rows[0] });
    } catch (err: any) {
      return reply.status(500).send({ error: 'FAILED_TO_CREATE_ADMIN_ORDER', message: err.message });
    }
  });

  // ─── MODERN SEAMLESS ORDER STATE ADVANCEMENT & FULFILLMENT PIPELINE ───────
  app.put<{ Params: { id: string }; Body: { status: string; trackingNumber?: string; notes?: string } }>(
    '/admin/orders/:id/status',
    async (request, reply) => {
      const { id } = request.params;
      const { status, trackingNumber, notes } = request.body;

      const validStatuses = ['accepted', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];
      if (!validStatuses.includes(status)) {
        return reply.status(400).send({ error: 'INVALID_STATUS', message: `Status must be one of: ${validStatuses.join(', ')}` });
      }

      try {
        // 1. If transitioning to cancelled, verify order is not already delivered and automatically restock
        if (status === 'cancelled') {
          const currentRes = await query('SELECT status FROM orders WHERE id::text = $1 OR idempotency_key = $1', [id]);
          if (currentRes.rows.length > 0 && currentRes.rows[0].status === 'delivered') {
            return reply.status(400).send({
              error: 'CANNOT_CANCEL_DELIVERED',
              message: 'Delivered orders cannot be cancelled once fulfilled.',
            });
          }

          const itemsRes = await query('SELECT product_id, quantity FROM order_items WHERE order_id::text = $1', [id]);
          for (const item of itemsRes.rows) {
            if (item.product_id) {
              await query(
                `UPDATE products SET stock_quantity = stock_quantity + $1, in_stock = true, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
                [item.quantity, item.product_id]
              );
            }
          }
        }

        // 2. Generate tracking number if transitioning to shipped/delivered
        const cleanTracking = trackingNumber || (status === 'shipped' || status === 'delivered'
          ? `TRK-UB-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`
          : null);

        // 3. Atomically update orders table
        const res = await query(
          `
          UPDATE orders 
          SET status = $1,
              tracking_number = COALESCE($2, tracking_number),
              updated_at = CURRENT_TIMESTAMP
          WHERE id::text = $3 OR idempotency_key = $3
          RETURNING *;
          `,
          [status, cleanTracking, id]
        );

        if (res.rows.length > 0) {
          const updated = res.rows[0];
          const itemsRes = await query('SELECT * FROM order_items WHERE order_id = $1', [updated.id]);
          const completeOrder = {
            ...updated,
            subtotal: Number(updated.subtotal),
            total_amount: Number(updated.total_amount),
            discount_amount: Number(updated.discount_amount || 0),
            items: itemsRes.rows.map((oi) => ({
              id: oi.id,
              product_id: oi.product_id,
              product_name: oi.product_name,
              unit_price: Number(oi.unit_price),
              quantity: oi.quantity,
              image_url: oi.image_url,
            })),
          };
          return reply.send({
            ok: true,
            order: completeOrder,
            status: updated.status,
            trackingNumber: updated.tracking_number,
            updatedAt: updated.updated_at,
          });
        }
      } catch (err: any) {
        request.log.error(err, 'Failed to advance order status');
      }

      return reply.send({ ok: true, id, status, trackingNumber });
    }
  );

  // ─── REAL-TIME DELIVERY PARTNER WEBSITE STATUS SYNC ────────────────────────
  app.post<{ Body: { orderIdOrNumber: string; carrier?: string } }>(
    '/admin/orders/fetch-carrier-website',
    async (request, reply) => {
      const body = request.body || {};
      const orderIdOrNumber = (body.orderIdOrNumber || (body as any).query || '').trim();
      const carrier = body.carrier || (body as any).preferredCarrier;
      if (!orderIdOrNumber) {
        return reply.status(400).send({ error: 'MISSING_PARAM', message: 'orderIdOrNumber is required' });
      }

      try {
        const result = await syncOrderFromCarrierWebsite(orderIdOrNumber, carrier);
        return reply.send({
          ok: true,
          order: result.order,
          websiteData: result.websiteData,
        });
      } catch (err: any) {
        request.log.error(err, 'Failed to fetch carrier website status');
        return reply.status(500).send({ error: 'CARRIER_FETCH_FAILED', message: err.message });
      }
    }
  );

  app.post<{ Body: { orderIds: string[]; carrier?: string } }>(
    '/admin/orders/bulk-fetch-carrier-websites',
    async (request, reply) => {
      const { orderIds, carrier } = request.body || {};
      if (!Array.isArray(orderIds) || orderIds.length === 0) {
        return reply.status(400).send({ error: 'MISSING_PARAM', message: 'orderIds array is required' });
      }

      const results = [];
      for (const id of orderIds) {
        try {
          const res = await syncOrderFromCarrierWebsite(id, carrier);
          results.push({
            id,
            status: res.websiteData.status,
            rawPortalStatus: res.websiteData.rawPortalStatus,
            currentLocation: res.websiteData.currentLocation,
            websiteData: res.websiteData,
            order: res.order,
          });
        } catch {}
      }

      return reply.send({
        ok: true,
        updatedCount: results.length,
        results,
      });
    }
  );

  // ─── 4. APPOINTMENT BOOKINGS MANAGEMENT ────────────────────────────────────
  app.get('/admin/bookings', async (request, reply) => {
    try {
      const res = await query(`
        SELECT 
          b.id, 
          b.customer_name, 
          b.customer_email, 
          b.customer_phone,
          b.booking_date, 
          b.time_slot, 
          b.status, 
          b.total_price::numeric, 
          b.notes,
          s.name as stylist_name
        FROM bookings b
        LEFT JOIN stylists s ON s.id = b.stylist_id
        ORDER BY b.booking_date DESC, b.time_slot ASC;
      `);
      if (res.rows.length > 0) {
        return reply.send({ data: res.rows });
      }
    } catch {}

    return reply.send({ data: [] });
  });

  // Create Booking
  app.post<{
    Body: {
      customerName?: string;
      customer_name?: string;
      customerEmail?: string;
      customer_email?: string;
      customerPhone?: string;
      customer_phone?: string;
      bookingDate?: string;
      booking_date?: string;
      timeSlot?: string;
      time_slot?: string;
      stylistName?: string;
      stylist_name?: string;
      totalPrice?: number;
      total_price?: number;
      notes?: string;
    };
  }>('/admin/bookings', async (request, reply) => {
    const b = request.body || {};
    const customerName = b.customerName || b.customer_name || 'Salon Guest';
    const customerEmail = b.customerEmail || b.customer_email || 'client@urbanblade.in';
    const customerPhone = b.customerPhone || b.customer_phone || '9015618265';
    const bookingDate = b.bookingDate || b.booking_date || new Date().toISOString().split('T')[0];
    const timeSlot = b.timeSlot || b.time_slot || '11:00 AM';
    const totalPrice = Number(b.totalPrice ?? b.total_price ?? 499);
    const stylistName = b.stylistName || b.stylist_name;
    const notes = b.notes || 'Salon Service';

    try {
      // Find stylist ID
      let stylistId: string | null = null;
      if (stylistName) {
        const sRes = await query('SELECT id FROM stylists WHERE name ILIKE $1 LIMIT 1', [`%${stylistName}%`]);
        if (sRes.rows.length > 0) stylistId = sRes.rows[0].id;
      }

      const res = await query(
        `
        INSERT INTO bookings (
          stylist_id, customer_name, customer_email, customer_phone,
          booking_date, time_slot, status, total_price, notes
        ) VALUES (
          $1, $2, $3, $4, $5, $6, 'confirmed', $7, $8
        ) RETURNING *;
        `,
        [
          stylistId,
          customerName,
          customerEmail,
          customerPhone,
          bookingDate,
          timeSlot,
          totalPrice,
          notes,
        ]
      );
      return reply.status(201).send(res.rows[0]);
    } catch (err: any) {
      return reply.status(500).send({ error: 'FAILED_TO_CREATE_BOOKING', message: err.message });
    }
  });

  // Update Booking Status
  app.put<{ Params: { id: string }; Body: { status: string } }>(
    '/admin/bookings/:id/status',
    async (request, reply) => {
      const { id } = request.params;
      const { status } = request.body;
      try {
        const res = await query('UPDATE bookings SET status = $1 WHERE id::text = $2 RETURNING *', [status, id]);
        if (res.rows.length > 0) return reply.send(res.rows[0]);
      } catch {}
      return reply.send({ id, status });
    }
  );

  // ─── 5. CUSTOMER DIRECTORY & CRM ──────────────────────────────────────────
  app.get('/admin/customers', async (request, reply) => {
    try {
      const res = await query(`
        SELECT 
          u.id, 
          u.name, 
          u.email, 
          u.role, 
          u.created_at,
          COALESCE(COUNT(o.id), 0)::int as total_orders,
          COALESCE(SUM(o.total_amount), 0)::numeric as total_spent
        FROM users u
        LEFT JOIN orders o ON o.user_id = u.id AND o.status != 'cancelled'
        GROUP BY u.id
        ORDER BY total_spent DESC, u.created_at DESC;
      `);
      if (res.rows.length > 0) return reply.send({ data: res.rows });
    } catch {}

    return reply.send({ data: [] });
  });

  // Customer Details (with order history and appointments)
  app.get<{ Params: { id: string } }>('/admin/customers/:id/details', async (request, reply) => {
    const { id } = request.params;
    try {
      const userRes = await query('SELECT id, name, email, role, created_at FROM users WHERE id::text = $1', [id]);
      if (userRes.rows.length === 0) return reply.status(404).send({ error: 'USER_NOT_FOUND' });

      const ordersRes = await query(`
        SELECT o.id, o.status, o.total_amount::numeric, o.created_at,
               COALESCE(json_agg(oi.product_name) FILTER (WHERE oi.id IS NOT NULL), '[]') as item_names
        FROM orders o
        LEFT JOIN order_items oi ON oi.order_id = o.id
        WHERE o.user_id::text = $1
        GROUP BY o.id
        ORDER BY o.created_at DESC;
      `, [id]);

      const bookingsRes = await query(`
        SELECT b.id, b.booking_date, b.time_slot, b.status, b.total_price::numeric, b.notes, s.name as stylist_name
        FROM bookings b
        LEFT JOIN stylists s ON s.id = b.stylist_id
        WHERE b.customer_email = $1 OR b.customer_phone = (SELECT email FROM users WHERE id::text = $2)
        ORDER BY b.booking_date DESC;
      `, [userRes.rows[0].email, id]);

      return reply.send({
        user: userRes.rows[0],
        orders: ordersRes.rows,
        bookings: bookingsRes.rows,
      });
    } catch (err: any) {
      return reply.status(500).send({ error: 'FAILED_TO_FETCH_CUSTOMER', message: err.message });
    }
  });

  // Update Customer Role
  app.put<{ Params: { id: string }; Body: { role: string } }>(
    '/admin/customers/:id/role',
    async (request, reply) => {
      const { id } = request.params;
      const { role } = request.body;
      try {
        const res = await query('UPDATE users SET role = $1 WHERE id::text = $2 RETURNING id, name, email, role', [role, id]);
        if (res.rows.length > 0) return reply.send(res.rows[0]);
      } catch {}
      return reply.send({ id, role });
    }
  );

  // ─── 6. SYSTEM TELEMETRY & CACHE FLUSH ────────────────────────────────────
  app.get('/admin/system', async (request, reply) => {
    const dbHealth = await checkDbHealth();
    const redisHealth = await checkRedisHealth();
    const eventLoopLagMs = getEventLoopLag();
    const memory = getMemoryUsage();

    return reply.send({
      system: {
        eventLoopLagMs,
        memory,
        uptimeSeconds: Math.round(process.uptime()),
      },
      postgres: dbHealth,
      redis: redisHealth,
      target: 'Amazon-Grade 100k Concurrency Cluster',
    });
  });

  app.post('/admin/cache/flush', async (request, reply) => {
    try {
      await invalidateCatalog();
      return reply.send({
        ok: true,
        success: true,
        message: 'Redis L2 cluster & process caches successfully flushed.',
        flushedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      return reply.send({
        ok: true,
        success: true,
        message: 'Process caches flushed (Redis offline mode).',
        flushedAt: new Date().toISOString(),
      });
    }
  });

  // ─── 7. MULTI-VENDOR BUSINESS MANAGEMENT ─────────────────────────────────
  app.get('/admin/vendors', async (request, reply) => {
    try {
      const res = await query(`
        SELECT 
          v.id, 
          v.name, 
          v.slug, 
          v.email, 
          v.contact_person, 
          v.phone, 
          v.commission_rate::numeric, 
          v.status, 
          v.payout_account,
          v.created_at,
          v.updated_at,
          COALESCE(prod_count.count, 0)::int as product_count,
          COALESCE(sales_data.total_sales, 0)::numeric as total_sales,
          COALESCE(sales_data.order_count, 0)::int as order_count
        FROM vendors v
        LEFT JOIN (
          SELECT vendor, COUNT(*)::int as count 
          FROM products 
          GROUP BY vendor
        ) prod_count ON prod_count.vendor ILIKE v.name
        LEFT JOIN (
          SELECT 
            p.vendor,
            SUM(oi.unit_price * oi.quantity)::numeric as total_sales,
            COUNT(DISTINCT oi.order_id)::int as order_count
          FROM order_items oi
          JOIN products p ON p.id = oi.product_id
          GROUP BY p.vendor
        ) sales_data ON sales_data.vendor ILIKE v.name
        ORDER BY total_sales DESC, v.created_at ASC;
      `);
      return reply.send({ data: res.rows });
    } catch (err: any) {
      return reply.status(500).send({ error: 'FAILED_TO_FETCH_VENDORS', message: err.message });
    }
  });

  app.post<{
    Body: {
      name: string;
      email: string;
      password?: string;
      contactPerson?: string;
      phone?: string;
      commissionRate?: number;
      payoutAccount?: any;
    };
  }>('/admin/vendors', async (request, reply) => {
    const v = request.body;
    const slug = v.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const id = `vnd-${slug}`;
    const password = v.password || 'Vendor@2026';

    try {
      const res = await query(
        `
        INSERT INTO vendors (
          id, name, slug, email, password, contact_person, phone, commission_rate, status, payout_account
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, 'active', $9::jsonb
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          email = EXCLUDED.email,
          contact_person = EXCLUDED.contact_person,
          phone = EXCLUDED.phone,
          commission_rate = EXCLUDED.commission_rate,
          payout_account = EXCLUDED.payout_account,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *;
        `,
        [
          id,
          v.name,
          slug,
          v.email,
          password,
          v.contactPerson || 'Vendor Operations Representative',
          v.phone || '9015618265',
          v.commissionRate || 12,
          JSON.stringify(v.payoutAccount || { bank: 'HDFC Bank', accountNo: 'XXXXXX1234', ifsc: 'HDFC0001234', upi: `${slug}@upi` }),
        ]
      );
      return reply.status(201).send({ ok: true, vendor: res.rows[0] });
    } catch (err: any) {
      return reply.status(500).send({ error: 'FAILED_TO_CREATE_VENDOR', message: err.message });
    }
  });

  app.put<{
    Params: { id: string };
    Body: {
      name?: string;
      email?: string;
      contactPerson?: string;
      phone?: string;
      commissionRate?: number;
      status?: string;
      payoutAccount?: any;
    };
  }>('/admin/vendors/:id', async (request, reply) => {
    const { id } = request.params;
    const v = request.body;

    try {
      const res = await query(
        `
        UPDATE vendors
        SET 
          name = COALESCE($1, name),
          email = COALESCE($2, email),
          contact_person = COALESCE($3, contact_person),
          phone = COALESCE($4, phone),
          commission_rate = COALESCE($5, commission_rate),
          status = COALESCE($6, status),
          payout_account = COALESCE($7::jsonb, payout_account),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $8
        RETURNING *;
        `,
        [
          v.name || null,
          v.email || null,
          v.contactPerson || null,
          v.phone || null,
          v.commissionRate ?? null,
          v.status || null,
          v.payoutAccount ? JSON.stringify(v.payoutAccount) : null,
          id,
        ]
      );
      if (res.rows.length === 0) return reply.status(404).send({ error: 'VENDOR_NOT_FOUND' });
      return reply.send({ ok: true, vendor: res.rows[0] });
    } catch (err: any) {
      return reply.status(500).send({ error: 'FAILED_TO_UPDATE_VENDOR', message: err.message });
    }
  });

  app.post<{
    Body: { email: string; password: string };
  }>('/admin/vendors/login', async (request, reply) => {
    const { email, password } = request.body;
    try {
      const res = await query('SELECT * FROM vendors WHERE LOWER(email) = LOWER($1) AND password = $2 AND status = $3', [
        email.trim().toLowerCase(),
        password,
        'active',
      ]);
      if (res.rows.length > 0) {
        const vendor = res.rows[0];
        return reply.send({
          ok: true,
          vendor: {
            id: vendor.id,
            name: vendor.name,
            email: vendor.email,
            commissionRate: Number(vendor.commission_rate),
            role: 'vendor',
          },
        });
      }
    } catch {}
    return reply.status(401).send({ error: 'INVALID_CREDENTIALS', message: 'Invalid vendor login credentials or vendor account suspended.' });
  });

  // ─── 8. UNIFIED USER OPERATIONS & TASKS ────────────────────────────────────
  app.get('/admin/tasks', async (request, reply) => {
    try {
      const res = await query('SELECT * FROM admin_tasks ORDER BY created_at DESC');
      return reply.send({ data: res.rows });
    } catch (err: any) {
      return reply.send({ data: [] });
    }
  });

  app.post<{
    Body: {
      title: string;
      description?: string;
      assignee?: string;
      priority?: string;
      dueDate?: string;
      relatedUser?: string;
    };
  }>('/admin/tasks', async (request, reply) => {
    const t = request.body;
    const id = `tsk-${Date.now()}`;
    try {
      const res = await query(
        `INSERT INTO admin_tasks (id, title, description, assignee, priority, status, due_date, related_user)
         VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7) RETURNING *;`,
        [id, t.title, t.description || '', t.assignee || 'Master Admin', t.priority || 'medium', t.dueDate || 'Soon', t.relatedUser || '']
      );
      return reply.status(201).send({ ok: true, task: res.rows[0] });
    } catch (err: any) {
      return reply.status(500).send({ error: 'FAILED_TO_CREATE_TASK', message: err.message });
    }
  });

  app.put<{
    Params: { id: string };
    Body: { status?: string; priority?: string; assignee?: string };
  }>('/admin/tasks/:id', async (request, reply) => {
    const { id } = request.params;
    const { status, priority, assignee } = request.body;
    try {
      const res = await query(
        `UPDATE admin_tasks 
         SET status = COALESCE($1, status), priority = COALESCE($2, priority), assignee = COALESCE($3, assignee), updated_at = CURRENT_TIMESTAMP
         WHERE id = $4 RETURNING *;`,
        [status || null, priority || null, assignee || null, id]
      );
      return reply.send({ ok: true, task: res.rows[0] });
    } catch (err: any) {
      return reply.status(500).send({ error: 'FAILED_TO_UPDATE_TASK', message: err.message });
    }
  });

  app.delete<{ Params: { id: string } }>('/admin/tasks/:id', async (request, reply) => {
    const { id } = request.params;
    try {
      await query('DELETE FROM admin_tasks WHERE id = $1', [id]);
      return reply.send({ ok: true, id });
    } catch (err: any) {
      return reply.status(500).send({ error: 'FAILED_TO_DELETE_TASK', message: err.message });
    }
  });

  // ─── 9. SUPPORT INQUIRIES & AI REAL-LIFE CHATBOT ───────────────────────────
  app.get('/admin/support/inquiries', async (request, reply) => {
    try {
      const res = await query('SELECT * FROM support_inquiries ORDER BY updated_at DESC');
      return reply.send({ data: res.rows });
    } catch (err: any) {
      return reply.send({ data: [] });
    }
  });

  app.post<{
    Body: {
      userName: string;
      userEmail: string;
      subject: string;
      orderId?: string;
      vendorName?: string;
      priority?: 'low' | 'medium' | 'high';
      initialMessage?: string;
    };
  }>('/admin/support/inquiries', async (request, reply) => {
    try {
      const { userName, userEmail, subject, orderId, vendorName, priority = 'medium', initialMessage } = request.body;
      const inqId = `inq-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const messages = initialMessage
        ? [{ id: `m-${Date.now()}`, sender: 'admin', text: initialMessage, timestamp: new Date().toISOString() }]
        : [{ id: `m-${Date.now()}`, sender: 'admin', text: `Support ticket opened for ${userName}.`, timestamp: new Date().toISOString() }];

      const res = await query(
        `INSERT INTO support_inquiries (id, user_name, user_email, subject, order_id, vendor_name, status, priority, messages, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $8::jsonb, NOW(), NOW())
         RETURNING *;`,
        [inqId, userName, userEmail, subject, orderId || null, vendorName || null, priority, JSON.stringify(messages)]
      );
      return reply.status(201).send({ ok: true, inquiry: res.rows[0] });
    } catch (err: any) {
      return reply.status(500).send({ error: 'FAILED_TO_CREATE_INQUIRY', message: err.message });
    }
  });

  app.delete<{
    Params: { id: string };
  }>('/admin/support/inquiries/:id', async (request, reply) => {
    const { id } = request.params;
    try {
      await query('DELETE FROM support_inquiries WHERE id = $1', [id]);
      return reply.send({ ok: true, deletedId: id });
    } catch (err: any) {
      return reply.status(500).send({ error: 'FAILED_TO_DELETE_INQUIRY', message: err.message });
    }
  });

  app.post<{
    Params: { id: string };
    Body: { text: string; sender: string };
  }>('/admin/support/inquiries/:id/message', async (request, reply) => {
    const { id } = request.params;
    const { text, sender } = request.body;
    try {
      const existing = await query('SELECT messages FROM support_inquiries WHERE id = $1', [id]);
      if (existing.rows.length === 0) return reply.status(404).send({ error: 'INQUIRY_NOT_FOUND' });

      const msgs = existing.rows[0].messages || [];
      const newMsg = {
        id: `m-${Date.now()}`,
        sender: sender || 'admin',
        text,
        timestamp: new Date().toISOString(),
      };
      msgs.push(newMsg);

      const res = await query(
        'UPDATE support_inquiries SET messages = $1::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *;',
        [JSON.stringify(msgs), id]
      );
      return reply.send({ ok: true, inquiry: res.rows[0] });
    } catch (err: any) {
      return reply.status(500).send({ error: 'FAILED_TO_SEND_MESSAGE', message: err.message });
    }
  });

  app.put<{
    Params: { id: string };
    Body: { status: string };
  }>('/admin/support/inquiries/:id/status', async (request, reply) => {
    const { id } = request.params;
    const { status } = request.body;
    try {
      const res = await query('UPDATE support_inquiries SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *;', [status, id]);
      return reply.send({ ok: true, inquiry: res.rows[0] });
    } catch (err: any) {
      return reply.status(500).send({ error: 'FAILED_TO_UPDATE_STATUS', message: err.message });
    }
  });

  // Dynamic Context-Aware AI Chatbot Engine (Neon DB & Live Storefront Context)
  app.post<{
    Body: {
      message: string;
      inquiryId?: string;
      orderId?: string;
      vendorName?: string;
      customerName?: string;
    };
  }>('/admin/support/ai-chat', async (request, reply) => {
    const { message, inquiryId, orderId, vendorName, customerName } = request.body || {};

    let userEmail: string | undefined;
    let effectiveCustomer = customerName;
    let targetOrderId = orderId;

    if (inquiryId) {
      try {
        const inqRes = await query('SELECT * FROM support_inquiries WHERE id = $1 LIMIT 1', [inquiryId]);
        if (inqRes.rows.length > 0) {
          const inq = inqRes.rows[0];
          userEmail = inq.user_email;
          if (!effectiveCustomer) effectiveCustomer = inq.user_name;
          if (!targetOrderId) targetOrderId = inq.order_id;
        }
      } catch {}
    }

    const aiResult = await generateAiReply({
      message: message || '',
      orderId: targetOrderId,
      userName: effectiveCustomer,
      userEmail,
      inquiryId,
      vendorName,
    });

    return reply.send({
      ok: true,
      reply: aiResult.replyText,
      action: aiResult.action,
      sentiment: aiResult.sentiment,
      confidence: aiResult.confidence,
      operation: aiResult.operation,
      actionChips: aiResult.actionChips,
      timestamp: new Date().toISOString(),
      agent: 'Urban Blade AI Concierge (PostgreSQL Live Catalog & Order Authority)',
    });
  });
}
