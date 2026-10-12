import { reconcileOrderPayment } from '../orders/payment-reconciliation.service.js';
import { vendorBalances } from './vendor-finance.service.js';
import bcrypt from 'bcryptjs';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, withTransaction } from '../../db/pool.js';
import { invalidateCatalog, getOrSetCache } from '../../redis/cache.service.js';
import { checkDbHealth } from '../../db/pool.js';
import { checkRedisHealth } from '../../redis/client.js';
import { getEventLoopLag, getMemoryUsage } from '../../core/circuit-breaker.js';
import { syncOrderFromCarrierWebsite, carrierCapabilities } from '../orders/carrier-portal.service.js';
import { paymentGateway, settleCapturedPayment } from '../orders/payment-settlement.service.js';
import { initiateOrderRefund } from '../orders/refund.service.js';
import { reserveStock, commitStockReservation, cancelOrderAndReleaseStock } from '../orders/stock-reservation.service.js';
import { generateAiReply } from '../support/support.routes.js';
import { requireAdmin, requireStaff } from '../../core/auth.middleware.js';

export async function adminRoutes(app: FastifyInstance) {
  // ─── AUTHENTICATION & RBAC (OWASP TOP 10 ACCESS CONTROL GUARD) ───────────
  // Protect ALL admin operations: reject unauthenticated or non-staff callers
  app.addHook('preHandler', requireStaff);
  app.addHook('preHandler', async (request, reply) => {
    if (reply.sent || request.user?.role !== 'vendor') return;
    const route = request.url.split('?')[0];
    const allowed = (route === '/api/admin/products' && ['GET', 'POST'].includes(request.method))
      || (/^\/api\/admin\/products\/[^/]+$/.test(route) && ['PUT', 'DELETE'].includes(request.method))
      || (route === '/api/admin/orders' && request.method === 'GET')
      || (route === '/api/admin/overview' && request.method === 'GET');
    if (!allowed) return reply.code(403).send({ error: 'FORBIDDEN_ADMIN_ONLY' });
  });

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
        WHERE status != 'cancelled' AND payment_status = 'captured' AND COALESCE(refund_status, '') = '';
      `);

      // 2. Order stage status counts (including confirmed orders in accepted/new queue)
      const orderCountsRes = await query(`
        SELECT
          COUNT(*)::int as total,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int as week_orders,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '14 days' AND created_at < NOW() - INTERVAL '7 days')::int as prev_week_orders,
          COUNT(*) FILTER (WHERE status IN ('accepted', 'confirmed', 'pending') AND (payment_method IN ('cash_on_delivery', 'Cash on Delivery') OR payment_status = 'captured'))::int as accepted,
          COUNT(*) FILTER (WHERE COALESCE(payment_method, '') NOT IN ('cash_on_delivery', 'Cash on Delivery') AND COALESCE(payment_status, '') != 'captured' AND COALESCE(status, '') != 'cancelled')::int as incomplete_payment,
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
          COUNT(*) FILTER (WHERE stock_quantity - stock_reserved <= 15 AND stock_quantity - stock_reserved > 0)::int as low_stock,
          COUNT(*) FILTER (WHERE stock_quantity - stock_reserved <= 0 OR in_stock = false)::int as out_of_stock
        FROM products;
      `);

      const rev = revRes.rows[0] || {};
      const orders = orderCountsRes.rows[0] || {};
      const bookings = bookRes.rows[0] || {};
      const stock = stockRes.rows[0] || {};

      // Dynamic occupancy calculation based on 3 chairs * 8 slots = 24 max daily slots
      const todayBookings = Number(bookings.today) || 0;
      const occupancyRate = null;

      const weekRev = Number(rev.week_rev) || 0;
      const prevWeekRev = Number(rev.prev_week_rev) || 0;
      const revTrend = prevWeekRev > 0 ? Number((((weekRev - prevWeekRev) / prevWeekRev) * 100).toFixed(1)) : null;

      const weekOrders = Number(orders.week_orders) || 0;
      const prevWeekOrders = Number(orders.prev_week_orders) || 0;
      const orderTrend = prevWeekOrders > 0 ? Number((((weekOrders - prevWeekOrders) / prevWeekOrders) * 100).toFixed(1)) : null;

      const weekBookings = Number(bookings.week_bookings) || 0;
      const prevWeekBookings = Number(bookings.prev_week_bookings) || 0;
      const bookTrend = prevWeekBookings > 0 ? Number((((weekBookings - prevWeekBookings) / prevWeekBookings) * 100).toFixed(1)) : null;

      return reply.send({
        revenue: {
          today: Number(rev.today_rev) || 0,
          week: weekRev,
          month: Number(rev.month_rev) || 0,
          trendPercent: revTrend,
        },
        orders: {
          total: Number(orders.total) || 0,
          accepted: Number(orders.accepted) || 0,
          incompletePayment: Number(orders.incomplete_payment) || 0,
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
          totalProducts: Number(stock.total) || 0,
          lowStock: Number(stock.low_stock) || 0,
          outOfStock: Number(stock.out_of_stock) || 0,
        },
      });
    } catch (err: any) {
      request.log.error({ err }, 'Metrics unavailable');
      return reply.code(503).send({ error: 'METRICS_UNAVAILABLE' });
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
        LEFT JOIN orders o ON DATE(o.created_at) = d.day AND o.status != 'cancelled' AND o.payment_status = 'captured' AND COALESCE(o.refund_status, '') = ''
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
      request.log.error({ err }, 'Daily metrics unavailable');
      return reply.code(503).send({ error: 'METRICS_UNAVAILABLE' });
    }
  });

  function formatProductRow(p: any) {
    const stockQty = Number(p.stock_quantity ?? p.stockQuantity ?? 0);
    const availableQty = Math.max(0, stockQty - Number(p.stock_reserved || 0));
    const inStockVal = Boolean(p.in_stock ?? p.inStock ?? true) && availableQty > 0;
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
      enabled: Boolean(p.in_stock),
      version: Number(p.version),
      inStock: inStockVal,
      in_stock: inStockVal,
      stockQuantity: stockQty,
      stock_quantity: stockQty,
      stock_reserved: Number(p.stock_reserved || 0),
      availableQuantity: availableQty,
      createdAt: p.created_at,
      created_at: p.created_at,
    };
  }

  // ─── 2. FULL PRODUCT INVENTORY & CRUD ─────────────────────────────────────
  app.get<{ Querystring: { vendor?: string; limit?: string; offset?: string } }>('/admin/products', async (request, reply) => {
    const { limit = '50', offset = '0' } = request.query || {};
    const vendor = request.user.role === 'vendor' ? request.user.vendorName : request.query.vendor;
    const limitNum = Math.max(1, Math.min(parseInt(limit, 10) || 50, 200));
    const offsetNum = Math.max(0, parseInt(offset, 10) || 0);
    try {
      let sql = `
        SELECT id, slug, name, description, long_description, highlights, price, compare_at_price,
               currency, image_url, category, kind, vendor, audience, free_delivery,
               rating, review_count, badge, in_stock, stock_quantity, stock_reserved, version, created_at
        FROM products
      `;
      const params: any[] = [];
      if (vendor) {
        params.push(vendor);
        sql += ` WHERE LOWER(vendor) = LOWER($1) `;
      }
      sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2} `;
      params.push(limitNum, offsetNum);

      const res = await query(sql, params);
      return reply.send({ data: res.rows.map(formatProductRow) });
    } catch (err) {
      request.log.error({ err }, 'Inventory unavailable');
      return reply.code(503).send({ error: 'INVENTORY_UNAVAILABLE' });
    }
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
    const user = request.user;

    const allowedCategories = ['hair', 'beard', 'skin', 'tools', 'gifts', 'services'];
    const allowedKinds = ['retail', 'service', 'gift'];
    const allowedAudiences = ['men', 'ladies', 'unisex'];
    const allowedBadges = [null, undefined, '', 'deal', 'bestseller', 'new'];

    if (p.category && !allowedCategories.includes(p.category)) {
      return reply.status(400).send({
        error: 'INVALID_CATEGORY',
        message: `Category must be one of: ${allowedCategories.join(', ')}`,
      });
    }
    if (p.kind && !allowedKinds.includes(p.kind)) {
      return reply.status(400).send({
        error: 'INVALID_KIND',
        message: `Kind must be one of: ${allowedKinds.join(', ')}`,
      });
    }
    if (p.audience && !allowedAudiences.includes(p.audience)) {
      return reply.status(400).send({
        error: 'INVALID_AUDIENCE',
        message: `Audience must be one of: ${allowedAudiences.join(', ')}`,
      });
    }
    if (p.badge && !allowedBadges.includes(p.badge)) {
      return reply.status(400).send({
        error: 'INVALID_BADGE',
        message: `Badge must be one of: deal, bestseller, new, or null`,
      });
    }
    if (p.price !== undefined && (isNaN(Number(p.price)) || Number(p.price) < 0)) {
      return reply.status(400).send({
        error: 'INVALID_PRICE',
        message: 'Product price must be a non-negative number.',
      });
    }

    const effectiveVendor = user?.role === 'vendor' ? (user.vendorName || user.name) : (p.vendor || 'Urban Blade Lab');
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
          effectiveVendor,
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
    const user = request.user;

    if (b.price !== undefined && (isNaN(Number(b.price)) || Number(b.price) < 0)) {
      return reply.status(400).send({
        error: 'INVALID_PRICE',
        message: 'Product price must be a non-negative number.',
      });
    }

    // Allow-list for updatable fields (mass-assignment protection)
    const allowedUpdateFields = new Set([
      'name', 'price', 'compareAtPrice', 'compare_at_price',
      'stockQuantity', 'stock_quantity', 'inStock', 'in_stock',
      'badge', 'category', 'description', 'longDescription', 'long_description',
      'imageUrl', 'image_url', 'id', 'slug', 'highlights', 'currency', 'kind',
      'vendor', 'audience', 'freeDelivery', 'free_delivery', 'rating',
      'reviewCount', 'review_count', 'expectedVersion'
    ]);
    const providedFields = Object.keys(b);
    const invalidFields = providedFields.filter(f => !allowedUpdateFields.has(f));
    if (invalidFields.length > 0) {
      return reply.status(400).send({
        error: 'INVALID_FIELDS',
        message: `Cannot update fields: ${invalidFields.join(', ')}`
      });
    }

    const cleanId = id.replace(/^(hc|bd|sk|tl|gf|sv)-/, '');

    // Vendor authorization boundary
    if (user?.role === 'vendor') {
      const prodCheck = await query('SELECT vendor FROM products WHERE id::text = $1 OR slug = $1 OR slug = $2 ORDER BY (id::text = $1) DESC LIMIT 1', [id, cleanId]);
      if (prodCheck.rows.length > 0) {
        const prodVendor = prodCheck.rows[0].vendor;
        if (!prodVendor || prodVendor.trim().toLowerCase() !== (user.vendorName || user.name).trim().toLowerCase()) {
          return reply.status(403).send({ error: 'FORBIDDEN', message: 'You do not have permission to modify another vendor product.' });
        }
      }
    }

    const expectedVersion = (b as { expectedVersion?: number }).expectedVersion;
    const rawStock = b.stockQuantity !== undefined ? b.stockQuantity : b.stock_quantity;
    const stockQty = rawStock === undefined ? undefined : Number(rawStock);
    if (stockQty !== undefined && (!Number.isInteger(stockQty) || stockQty < 0)) return reply.code(400).send({ error: 'INVALID_STOCK' });
    if (stockQty !== undefined && !Number.isInteger(expectedVersion)) return reply.code(409).send({ error: 'STOCK_VERSION_REQUIRED', message: 'Refresh inventory before changing quantities.' });
    const inStock = b.inStock !== undefined ? b.inStock : b.in_stock;
    if (inStock !== undefined && typeof inStock !== 'boolean') return reply.code(400).send({ error: 'INVALID_AVAILABILITY' });
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
          version = version + 1,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = (SELECT id FROM products WHERE id::text = $11 OR slug = $11 OR slug = $12 ORDER BY (id::text = $11) DESC LIMIT 1)
          AND ($4::integer IS NULL OR ($4::integer >= stock_reserved AND version = $13 AND stock_reserved = (SELECT COALESCE(SUM(quantity),0) FROM stock_reservations WHERE product_id=products.id AND status='active')))
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
          expectedVersion,
        ]
      );

      if (!res.rowCount) return reply.code(409).send({ error: 'PRODUCT_UPDATE_REJECTED', message: 'Product must exist and stock cannot be less than reserved units.' });
      await invalidateCatalog();
      return reply.send(formatProductRow(res.rows[0]));
    } catch (err) {
      request.log.error({ err }, 'Product update failed');
      return reply.code(500).send({ error: 'PRODUCT_UPDATE_FAILED' });
    }

    await invalidateCatalog();
    return reply.status(404).send({ error: 'PRODUCT_NOT_FOUND' });
  });

  // Delete Product
  app.delete<{ Params: { id: string } }>('/admin/products/:id', async (request, reply) => {
    const { id } = request.params;
    const user = request.user;
    const cleanId = id.replace(/^(hc|bd|sk|tl|gf|sv)-/, '');

    // Vendor authorization boundary
    if (user?.role === 'vendor') {
      const prodCheck = await query('SELECT vendor FROM products WHERE id::text = $1 OR slug = $1 OR slug = $2 ORDER BY (id::text = $1) DESC LIMIT 1', [id, cleanId]);
      if (prodCheck.rows.length > 0) {
        const prodVendor = prodCheck.rows[0].vendor;
        if (!prodVendor || prodVendor.trim().toLowerCase() !== (user.vendorName || user.name).trim().toLowerCase()) {
          return reply.status(403).send({ error: 'FORBIDDEN', message: 'You do not have permission to delete another vendor product.' });
        }
      }
    }

    try {
      const deleted = await query('DELETE FROM products WHERE id = (SELECT id FROM products WHERE id::text = $1 OR slug = $1 OR slug = $2 ORDER BY (id::text = $1) DESC LIMIT 1) AND NOT EXISTS (SELECT 1 FROM order_items WHERE product_id = products.id) AND NOT EXISTS (SELECT 1 FROM stock_reservations WHERE product_id = products.id) RETURNING id', [id, cleanId]);
      if (!deleted.rowCount) return reply.code(409).send({ error: 'PRODUCT_DELETE_REJECTED', message: 'Products linked to orders cannot be deleted. Mark the product unavailable instead.' });
    } catch (err) {
      request.log.error({ err }, 'Product deletion failed');
      return reply.code(409).send({ error: 'PRODUCT_DELETE_FAILED' });
    }

    await invalidateCatalog();
    return reply.send({ success: true, message: 'Product removed' });
  });

  // ─── 3. ORDERS LIFECYCLE MANAGEMENT ───────────────────────────────────────
  app.get<{ Querystring: { vendor?: string } }>('/admin/orders', async (request, reply) => {
    const user = request.user;
    let { vendor } = request.query || {};
    if (user?.role === 'vendor') {
      vendor = user.vendorName || user.name;
    }
    try {
      let sql = `
        SELECT
          o.id,
          o.user_id,
          o.status,
          ${vendor ? 'COALESCE(SUM(oi.unit_price * oi.quantity), 0)' : 'o.subtotal'}::numeric AS subtotal,
          ${vendor ? 'COALESCE(SUM(oi.unit_price * oi.quantity), 0)' : 'o.total_amount'}::numeric AS total_amount,
          o.discount_amount::numeric,
          o.coupon_code,
          o.shipping_fee::numeric,
          o.tax_amount::numeric,
          o.tax_rate_percent::numeric,
          o.tax_inclusive,
          o.tracking_number,
          o.currency,
          o.payment_method,
          o.payment_status, o.payment_reconciliation_error, o.payment_checked_at,
          o.return_status, o.return_reason, o.return_review_note, o.return_requested_at,
          o.refund_status,
          o.refund_id,
          o.refund_amount::numeric,
          o.refund_reason,
          o.refund_requested_at,
          o.refunded_at,
          o.refund_failure_reason,
          o.transaction_id,
          o.razorpay_payment_id,
          o.idempotency_key as gateway_order_id,
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
          WHERE LOWER(p.vendor) = LOWER($1) AND EXISTS (
            SELECT 1 FROM order_items oi2
            LEFT JOIN products p2 ON p2.id = oi2.product_id
            WHERE oi2.order_id = o.id AND (LOWER(p2.vendor) = LOWER($1))
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
      return reply.code(503).send({ error: 'ORDERS_UNAVAILABLE', message: 'Orders could not be loaded. Please retry.' });
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
    const parsed = z.object({
      id: z.string().uuid().optional(), status: z.enum(['accepted', 'confirmed']).default('accepted'),
      total_amount: z.number().finite().positive(), subtotal: z.number().finite().positive().optional(),
      currency: z.literal('INR').default('INR'),
      payment_method: z.enum(['UPI', 'Cash', 'Card', 'Cash on Delivery', 'cash_on_delivery']).default('Cash'),
      payment_status: z.enum(['pending', 'captured', 'paid']).default('pending'),
      transaction_id: z.string().trim().max(150).optional(),
      shipping_address: z.object({ fullName: z.string().trim().min(2).max(100), phone: z.string().regex(/^[0-9]{10}$/) }).passthrough(),
      items: z.array(z.object({ product_id: z.string().uuid().optional(), product_name: z.string().trim().min(1).max(255), unit_price: z.number().finite().positive(), quantity: z.number().int().min(1).max(100), image_url: z.string().max(2000).optional() })).min(1).max(100),
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_POS_ORDER', message: 'Enter valid customer details, payment method and whole-number item quantities.' });
    const b = parsed.data;
    try {
      const order = await withTransaction(async client => {
        let subtotal = 0;
        const ids = new Set<string>();
        for (const item of b.items) {
          if (item.product_id) {
            if (ids.has(item.product_id)) throw new Error('DUPLICATE_PRODUCT');
            ids.add(item.product_id);
            const product = (await client.query('SELECT name, price FROM products WHERE id = $1', [item.product_id])).rows[0];
            if (!product || Number(product.price) !== item.unit_price) throw new Error('PRICE_CHANGED');
            item.product_name = product.name;
          }
          subtotal += item.unit_price * item.quantity;
        }
        subtotal = Math.round(subtotal * 100) / 100;
        if (Math.round(b.total_amount * 100) !== Math.round(subtotal * 100)) throw new Error('TOTAL_MISMATCH');
        const inserted = await client.query(`INSERT INTO orders(id, status, subtotal, total_amount, currency, payment_method, payment_status, transaction_id, shipping_address)
          VALUES(COALESCE($1::uuid, gen_random_uuid()), $2, $3, $3, $4, $5, $6, $7, $8) RETURNING *`,
          [b.id || null, b.status, subtotal, b.currency, b.payment_method, b.payment_status === 'paid' ? 'captured' : b.payment_status, b.transaction_id || null, JSON.stringify(b.shipping_address)]);
        const saved = inserted.rows[0];
        const lines = b.items.filter(item => item.product_id).map(item => ({ productId: item.product_id!, quantity: item.quantity }));
        if (lines.length) {
          await reserveStock(client, saved.id, lines);
          const committed = await commitStockReservation(client, saved.id);
          if (committed.unapplied.length) throw new Error('STOCK_COMMIT_FAILED');
        }
        for (const item of b.items) {
          await client.query(`INSERT INTO order_items(order_id, product_id, product_name, unit_price, quantity, image_url)
            VALUES($1, $2, $3, $4, $5, $6)`, [saved.id, item.product_id || null, item.product_name, item.unit_price, item.quantity, item.image_url || '']);
        }
        return saved;
      });
      await invalidateCatalog().catch(() => { });
      return reply.code(201).send({ ok: true, order });
    } catch (error) {
      request.log.warn({ error }, 'POS order rejected');
      return reply.code(409).send({ error: 'POS_ORDER_REJECTED', message: 'Check prices and available inventory. If retrying, refresh orders to check whether it was already saved.' });
    }
  });

  // ─── MODERN SEAMLESS ORDER STATE ADVANCEMENT & FULFILLMENT PIPELINE ───────
  app.put<{ Params: { id: string }; Body: { status: string; trackingNumber?: string } }>(
    '/admin/orders/:id/status', { preHandler: [requireAdmin] }, async (request, reply) => {
      const { id } = request.params;
      const parsed = z.object({ status: z.enum(['accepted', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled']), trackingNumber: z.string().trim().max(100).optional(), carrier: z.string().trim().max(100).optional(), notes: z.string().trim().max(2000).optional() }).strict().safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'INVALID_ORDER_STATUS' });
      const { status, trackingNumber, carrier, notes } = parsed.data;
      try {
        const order = await withTransaction(async client => {
          const result = await client.query('SELECT * FROM orders WHERE id::text = $1 FOR UPDATE', [id]);
          const current = result.rows[0];
          if (!current) throw new Error('ORDER_NOT_FOUND');
          if (current.status === status && !trackingNumber && !carrier && notes === undefined) return current;
          if (current.payment_reconciliation_error) throw new Error('INVENTORY_RECONCILIATION_REQUIRED');
          if (current.refund_status === 'pending' || current.refund_status === 'processed') throw new Error('REFUND_IN_PROGRESS');
          const transitions: Record<string, string[]> = {
            accepted: ['processing', 'confirmed', 'cancelled'],
            confirmed: ['processing', 'cancelled'],
            pending: ['processing', 'confirmed', 'cancelled'],
            processing: ['shipped', 'cancelled'],
            shipped: ['delivered'],
          };
          if (current.status !== status && !transitions[current.status]?.includes(status)) throw new Error('INVALID_STATUS_TRANSITION');
          if (status === 'cancelled') {
            if (current.payment_status === 'captured') throw new Error('REFUND_REQUIRED_BEFORE_CANCELLATION');
            const cancelled = await cancelOrderAndReleaseStock(client, current.id, {
              allowedStatuses: ['accepted', 'confirmed', 'pending', 'processing'],
            });
            if (!cancelled.cancelled) throw new Error('ORDER_NOT_CANCELLABLE');
            return (await client.query('SELECT * FROM orders WHERE id = $1', [current.id])).rows[0];
          }
          if (current.payment_method === 'Razorpay' && current.payment_status !== 'captured') throw new Error('PAYMENT_NOT_CAPTURED');
          if (status === 'shipped' && !(trackingNumber?.trim() || current.tracking_number)) throw new Error('TRACKING_NUMBER_REQUIRED');
          if (status === 'shipped' && !(carrier?.trim() || current.carrier)) throw new Error('CARRIER_REQUIRED');
          if (['shipped', 'delivered', 'cancelled'].includes(current.status) && ((trackingNumber && trackingNumber !== current.tracking_number) || (carrier && carrier !== current.carrier))) throw new Error('DISPATCH_DETAILS_LOCKED');
          if (trackingNumber) {
            const duplicate = await client.query('SELECT id FROM orders WHERE tracking_number=$1 AND id<>$2 LIMIT 1', [trackingNumber, current.id]);
            if (duplicate.rowCount) throw new Error('TRACKING_NUMBER_IN_USE');
          }
          const updated = await client.query(`UPDATE orders SET status = $2,
            tracking_number = COALESCE($3, tracking_number), carrier = COALESCE($4, carrier), notes = COALESCE($5, notes), updated_at = NOW(), version = version + 1
            WHERE id = $1 RETURNING *`, [current.id, status, trackingNumber?.trim() || null, carrier || null, notes ?? null]);
          await client.query(`INSERT INTO order_fulfilment_events(order_id,actor_id,source,previous_status,resulting_status,details) VALUES($1,$2,'admin',$3,$4,$5::jsonb)`, [current.id, request.user!.id, current.status, status, JSON.stringify({ trackingNumber: updated.rows[0].tracking_number, carrier: updated.rows[0].carrier, notes: notes || null })]);
          return updated.rows[0];
        });
        const items = await query('SELECT * FROM order_items WHERE order_id = $1', [order.id]);
        return { ok: true, order: { ...order, items: items.rows }, status: order.status, trackingNumber: order.tracking_number };
      } catch (err: any) {
        request.log.warn({ err }, 'Order status update rejected');
        return reply.code(err.message === 'ORDER_NOT_FOUND' ? 404 : 409).send({ error: err.message, message: 'Order update could not be completed: ' + err.message });
      }
    }
  );

  const refundRequestSchema = z.object({
    reason: z.string().trim().min(3).max(300),
  }).strict();

  app.post<{ Params: { id: string }; Body: { reason: string } }>(
    '/admin/orders/:id/refund',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const parsed = refundRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'INVALID_REFUND_REQUEST', message: 'Provide a refund reason between 3 and 300 characters.' });
      }
      try {
        const order = await initiateOrderRefund(request.params.id, parsed.data.reason);
        const items = await query('SELECT * FROM order_items WHERE order_id = $1', [order.id]);
        return reply.send({
          ok: true,
          order: { ...order, items: items.rows },
          refundStatus: order.refund_status,
          message: order.refund_status === 'processed'
            ? 'Refund processed and inventory restored.'
            : order.refund_status === 'failed' ? 'The gateway reported a refund failure. Review the refund before retrying.' : 'Refund is pending gateway confirmation. Check its status before taking further action.',
        });
      } catch (error: any) {
        const code = String(error?.message || 'REFUND_FAILED');
        const status = code === 'ORDER_NOT_FOUND' ? 404
          : ['PAYMENT_NOT_CAPTURED', 'ONLINE_REFUND_ONLY', 'ORDER_ALREADY_FULFILLED', 'REFUND_PAYMENT_MISMATCH', 'REFUND_AMOUNT_MISMATCH'].includes(code) ? 409
            : code === 'PAYMENT_UNAVAILABLE' ? 503 : 502;
        request.log.error({ error, orderId: request.params.id }, 'Order refund failed');
        return reply.code(status).send({ error: code, message: `Refund could not be completed: ${code.replaceAll('_', ' ').toLowerCase()}.` });
      }
    }
  );

  // ─── REAL-TIME RAZORPAY PAYMENT GATEWAY RECONCILIATION ───────────────────
  app.post<{ Params: { id: string } }>(
    '/admin/orders/:id/reconcile-payment',
    { preHandler: [requireStaff] },
    async (request, reply) => {
      const { id } = request.params;
      try {
        const order = await reconcileOrderPayment(id);
        const items = await query('SELECT * FROM order_items WHERE order_id = $1', [order.id]);
        return {
          ok: true, updated: true, paymentStatus: order.payment_status,
          order: { ...order, items: items.rows },
          message: order.payment_reconciliation_error
            ? 'Payment captured. Inventory needs reconciliation before dispatch.'
            : `Gateway checked. Payment is ${order.payment_status}.`
        };

      } catch (err: any) {
        request.log.error(err, 'Payment reconciliation error');
        return reply.status(500).send({
          error: 'RECONCILIATION_ERROR',
          message: err.message || 'Failed to reconcile payment with Razorpay.',
        });
      }
    }
  );

  // ─── REAL-TIME DELIVERY PARTNER WEBSITE STATUS SYNC ────────────────────────
  const carrierRequest = z.object({ orderIdOrNumber: z.string().trim().min(1).max(100), carrier: z.string().trim().max(100).optional(), trackingNumber: z.string().trim().max(100).optional() }).strict();
  const carrierErrors: Record<string, string> = {
    ORDER_NOT_FOUND: 'No order matches this full order ID or saved AWB.',
    TRACKING_NUMBER_REQUIRED: 'Save the courier-issued AWB on the order before checking tracking.',
    CARRIER_REQUIRED: 'Assign the carrier on the order first.',
    CARRIER_NOT_CONFIGURED: 'Delhivery tracking is not connected. Configure the server courier token or use the official portal.',
    CARRIER_PORTAL_ONLY: 'Automatic tracking is not available for this carrier. Verify on its portal and record fulfilment manually.',
    CARRIER_AUTH_FAILED: 'The courier rejected the configured credentials. Check the courier account connection.',
    CARRIER_RATE_LIMITED: 'The courier rate limit was reached. Wait before retrying.',
    CARRIER_MISMATCH: 'The selected carrier differs from the saved shipment carrier.',
    CARRIER_SHIPMENT_MISMATCH: 'The carrier response did not match the saved AWB. No update was applied.',
    SHIPMENT_CHANGED_RETRY: 'Shipment details changed during lookup. Refresh and retry.',
  };
  app.get('/admin/carriers', async () => ({ data: carrierCapabilities() }));
  app.get<{ Params: { id: string } }>('/admin/orders/:id/fulfilment-history', async (request, reply) => {
    if (!z.string().uuid().safeParse(request.params.id).success) return reply.code(400).send({ error: 'INVALID_ORDER_ID' });
    return { data: (await query('SELECT id,source,previous_status,resulting_status,details,created_at FROM order_fulfilment_events WHERE order_id=$1 ORDER BY created_at DESC LIMIT 100', [request.params.id])).rows };
  });
  app.post('/admin/orders/fetch-carrier-website', async (request, reply) => {
    const parsed = carrierRequest.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_LOOKUP', message: 'Enter the full order ID or saved AWB.' });
    try { return { ok: true, ...await syncOrderFromCarrierWebsite(parsed.data.orderIdOrNumber, parsed.data.carrier) }; }
    catch (error) { const code = error instanceof Error ? error.message : 'CARRIER_STATUS_UNAVAILABLE'; return reply.code(code === 'ORDER_NOT_FOUND' ? 404 : 409).send({ error: code, message: carrierErrors[code] || 'Tracking could not be verified. No fulfilment update was applied.' }); }
  });
  app.post('/admin/orders/bulk-fetch-carrier-websites', async (request, reply) => {
    const parsed = z.object({ orderIds: z.array(z.string().uuid()).min(1).max(25), carrier: z.string().max(100).optional() }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_BATCH', message: 'Select between 1 and 25 orders.' });
    const results = [];
    for (const id of [...new Set(parsed.data.orderIds)]) {
      try { results.push({ id, ok: true, ...await syncOrderFromCarrierWebsite(id, parsed.data.carrier) }); }
      catch (error) { const code = error instanceof Error ? error.message : 'CARRIER_STATUS_UNAVAILABLE'; results.push({ id, ok: false, error: code, message: carrierErrors[code] || 'Tracking unavailable; order unchanged.' }); }
    }
    return { ok: true, updatedCount: results.filter(r => 'applied' in r && r.applied).length, checkedCount: results.filter(r => r.ok).length, failedCount: results.filter(r => !r.ok).length, results };
  });

  // ─── 4. APPOINTMENT BOOKINGS MANAGEMENT ────────────────────────────────────
  app.get('/admin/bookings', async (request, reply) => {
    try {
      const res = await query(`
        SELECT
          b.id,
          b.customer_name,
          b.customer_email,
          b.customer_phone,
          to_char(b.booking_date, 'YYYY-MM-DD') as booking_date,
          b.time_slot,
          b.status,
          b.total_price::numeric,
          b.notes,
          b.visit_type,
          b.service_address,
          s.name as stylist_name,
          s.id as stylist_id
        FROM bookings b
        LEFT JOIN stylists s ON s.id = b.stylist_id
        ORDER BY b.booking_date DESC, b.time_slot ASC;
      `);
      if (res.rows.length > 0) {
        return reply.send({ data: res.rows });
      }
    } catch (error) {
      request.log.error({ error }, 'Bookings unavailable');
      return reply.code(503).send({ error: 'BOOKINGS_UNAVAILABLE' });
    }

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
      stylistId?: string;
      stylist_id?: string;
      stylistName?: string;
      stylist_name?: string;
      bookingDate?: string;
      booking_date?: string;
      timeSlot?: string;
      time_slot?: string;
      visitType?: 'salon' | 'home';
      visit_type?: 'salon' | 'home';
      serviceAddress?: string;
      service_address?: string;
      totalPrice?: number;
      total_price?: number;
      notes?: string;
    };
  }>('/admin/bookings', async (request, reply) => {
    const b = request.body || {};
    const payload = {
      customerName: b.customerName || b.customer_name,
      customerEmail: b.customerEmail || b.customer_email || null,
      customerPhone: b.customerPhone || b.customer_phone,
      bookingDate: b.bookingDate || b.booking_date,
      timeSlot: b.timeSlot || b.time_slot,
      visitType: b.visitType || b.visit_type || 'salon',
      serviceAddress: b.serviceAddress || b.service_address || null,
      totalPrice: Number(b.totalPrice ?? b.total_price),
      notes: b.notes,
    };
    const parsed = z.object({
      customerName: z.string().trim().min(2).max(255),
      customerEmail: z.string().email().max(255).nullable(),
      customerPhone: z.string().trim().regex(/^[0-9+ -]{10,18}$/),
      bookingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      timeSlot: z.string().trim().min(4).max(20),
      visitType: z.enum(['salon', 'home']),
      serviceAddress: z.string().trim().max(500).nullable(),
      totalPrice: z.number().finite().min(0).max(1000000),
      notes: z.string().trim().min(2).max(500),
    }).safeParse(payload);
    if (!parsed.success || (parsed.data.visitType === 'home' && !parsed.data.serviceAddress)) {
      return reply.code(400).send({ error: 'INVALID_BOOKING', message: 'Complete the customer, schedule, service, visit type, and home address where required.' });
    }

    try {
      let stylistId: string | null = null;
      let stylistName: string | null = null;
      const rawStylist = b.stylistId || b.stylist_id;
      if (rawStylist) {
        if (!z.string().uuid().safeParse(rawStylist).success) return reply.code(400).send({ error: 'INVALID_STYLIST' });
        const stylist = (await query('SELECT id,name FROM stylists WHERE id=$1 AND is_active=true', [rawStylist])).rows[0];
        if (!stylist) return reply.code(400).send({ error: 'STYLIST_UNAVAILABLE' });
        stylistId = stylist.id; stylistName = stylist.name;
      }

      const res = await query(
        `
        INSERT INTO bookings (
          customer_name, customer_email, customer_phone, stylist_id, booking_date, time_slot,
          visit_type, service_address, status, total_price, notes
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, 'confirmed', $9, $10
        ) RETURNING *, to_char(booking_date, 'YYYY-MM-DD') as booking_date;
        `,
        [
          parsed.data.customerName,
          parsed.data.customerEmail,
          parsed.data.customerPhone,
          stylistId,
          parsed.data.bookingDate,
          parsed.data.timeSlot,
          parsed.data.visitType,
          parsed.data.serviceAddress,
          parsed.data.totalPrice,
          parsed.data.notes,
        ]
      );
      return reply.status(201).send({ ...res.rows[0], stylist_name: stylistName });
    } catch (err: any) {
      return reply.status(err.code === '23505' ? 409 : 500).send({ error: 'FAILED_TO_CREATE_BOOKING', message: 'Could not save booking. Check the stylist schedule and retry.' });
    }
  });

  // Update Booking Status
  app.put<{ Params: { id: string }; Body: { status: string } }>(
    '/admin/bookings/:id/status',
    async (request, reply) => {
      const { id } = request.params;
      const parsed = z.object({ status: z.enum(['pending', 'confirmed', 'cancelled', 'completed']) }).strict().safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'INVALID_STATUS' });
      try {
        const result = await query("UPDATE bookings SET status=$2,version=version+1 WHERE id::text=$1 RETURNING *,to_char(booking_date,'YYYY-MM-DD') AS booking_date", [id, parsed.data.status]);
        if (!result.rowCount) return reply.code(404).send({ error: 'BOOKING_NOT_FOUND' });
        return result.rows[0];
      } catch (error) { return reply.code(409).send({ error: 'STATUS_NOT_SAVED', message: 'Check the booking and stylist schedule before retrying.' }); }

    }
  );

  app.put<{ Params: { id: string }; Body: { bookingDate?: string; timeSlot?: string; visitType?: 'salon' | 'home'; serviceAddress?: string | null; stylistName?: string; stylistId?: string } }>(
    '/admin/bookings/:id/schedule',
    async (request, reply) => {
      const parsed = z.object({
        bookingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        timeSlot: z.string().trim().min(4).max(20),
        visitType: z.enum(['salon', 'home']),
        serviceAddress: z.string().trim().max(500).nullable(),
      }).safeParse(request.body);
      if (!parsed.success || (parsed.data.visitType === 'home' && !parsed.data.serviceAddress)) {
        return reply.code(400).send({ error: 'INVALID_SCHEDULE', message: 'Provide a valid date, time, visit type, and home address where required.' });
      }

      let stylistId: string | null = null;
      let stylistName: string | null = null;
      const rawStylist = request.body.stylistId;
      if (rawStylist) {
        if (!z.string().uuid().safeParse(rawStylist).success) return reply.code(400).send({ error: 'INVALID_STYLIST' });
        const stylist = (await query('SELECT id,name FROM stylists WHERE id=$1 AND is_active=true', [rawStylist])).rows[0];
        if (!stylist) return reply.code(400).send({ error: 'STYLIST_UNAVAILABLE' });
        stylistId = stylist.id; stylistName = stylist.name;
      }
      try {
        const updated = await query(
          `UPDATE bookings
         SET booking_date = $2, time_slot = $3, visit_type = $4,
             service_address = $5, stylist_id = $6, version = version + 1
         WHERE id::text = $1
         RETURNING *, to_char(booking_date, 'YYYY-MM-DD') as booking_date`,
          [request.params.id, parsed.data.bookingDate, parsed.data.timeSlot, parsed.data.visitType, parsed.data.serviceAddress, stylistId]
        );
        if (!updated.rowCount) return reply.code(404).send({ error: 'BOOKING_NOT_FOUND' });
        return reply.send({ ...updated.rows[0], stylist_name: stylistName });
      } catch (error: any) {
        return reply.code(error.code === '23505' ? 409 : 503).send({ error: 'SCHEDULE_NOT_SAVED', message: 'The stylist may already be booked for this slot. Refresh and choose another time or stylist.' });
      }
    }
  );

  // ─── 5. CUSTOMER DIRECTORY & CRM (ADMIN-ONLY) ─────────────────────────────
  app.get('/admin/customers', { preHandler: [requireAdmin] }, async (request, reply) => {
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
        LEFT JOIN orders o ON o.user_id = u.id AND o.payment_status = 'captured' AND COALESCE(o.refund_amount,0)=0
        GROUP BY u.id
        ORDER BY total_spent DESC, u.created_at DESC;
      `);
      if (res.rows.length > 0) return reply.send({ data: res.rows });
    } catch (error) { return reply.code(503).send({ error: 'RECORDS_UNAVAILABLE' }); }

    return reply.send({ data: [] });
  });

  // Customer Details (with order history and appointments)
  app.get<{ Params: { id: string } }>(
    '/admin/customers/:id/details',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
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
          SELECT b.id, b.booking_date, b.time_slot, b.status, b.total_price::numeric,
                 b.notes, b.visit_type, b.service_address
          FROM bookings b
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
    }
  );

  // Update Customer Role (Admin-Only, Privilege Escalation Guarded)
  app.put<{ Params: { id: string }; Body: { role: string } }>(
    '/admin/customers/:id/role',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const { id } = request.params;
      const { role } = request.body;
      const allowedRoles = ['customer', 'admin', 'stylist', 'vendor'];
      if (!role || !allowedRoles.includes(role)) {
        return reply.status(400).send({
          error: 'INVALID_ROLE',
          message: `Role must be one of: ${allowedRoles.join(', ')}`,
        });
      }

      // Master Admin cannot be demoted
      if (id === 'cf32923e-e498-407c-93d5-8d8cef913979' && role !== 'admin') {
        return reply.status(400).send({
          error: 'CANNOT_DEMOTE_MASTER_ADMIN',
          message: 'The Master Administrator account role cannot be altered.',
        });
      }

      try {
        const res = await query(
          'UPDATE users SET role = $1, updated_at = CURRENT_TIMESTAMP WHERE id::text = $2 RETURNING id, name, email, role',
          [role, id]
        );
        if (res.rows.length > 0) return reply.send(res.rows[0]);
      } catch { }
      return reply.send({ id, role });
    }
  );

  // ─── 6. SYSTEM TELEMETRY & CACHE FLUSH (ADMIN-ONLY) ──────────────────────
  app.get('/admin/system', { preHandler: [requireAdmin] }, async (request, reply) => {
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

  app.post('/admin/cache/flush', { preHandler: [requireAdmin] }, async (request, reply) => {
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

  const vendorSchema = z.object({
    name: z.string().trim().min(2).max(150), email: z.string().trim().email().max(255).transform(value => value.toLowerCase()),
    password: z.string().min(10).refine(value => Buffer.byteLength(value) <= 72).optional(),
    contactPerson: z.string().trim().max(150).optional(), contact_person: z.string().trim().max(150).optional(),
    phone: z.string().trim().max(50).optional(), commissionRate: z.number().min(0).max(100).optional(), commission_rate: z.number().min(0).max(100).optional(),
    status: z.enum(['active', 'suspended']).optional(),
    payoutAccount: z.record(z.string().max(200)).optional(), payout_account: z.record(z.string().max(200)).optional(),
  });

  // ─── 7. MULTI-VENDOR BUSINESS MANAGEMENT (ADMIN-ONLY) ─────────────────────
  app.get('/admin/vendors', { preHandler: [requireAdmin] }, async (request, reply) => {
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
          JOIN orders o ON o.id = oi.order_id
          WHERE o.status != 'cancelled' AND o.payment_status = 'captured' AND COALESCE(o.refund_status, '') = ''
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
  }>('/admin/vendors', { preHandler: [requireAdmin] }, async (request, reply) => {
    const parsed = vendorSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_VENDOR', message: 'Enter a valid vendor name, email and commission rate.' });
    const v = parsed.data;
    const slug = v.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const id = `vnd-${slug}`;
    if (!v.password || v.password.length < 10 || Buffer.byteLength(v.password) > 72) return reply.code(400).send({ error: 'STRONG_PASSWORD_REQUIRED' });
    const password = await bcrypt.hash(v.password, 12);

    try {
      const res = await query(
        `
        INSERT INTO vendors (
          id, name, slug, email, password, contact_person, phone, commission_rate, status, payout_account
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, 'active', $9::jsonb
        )
        RETURNING *;
        `,
        [
          id,
          v.name,
          slug,
          v.email,
          password,
          (v as any).contactPerson || (v as any).contact_person || 'Vendor Operations Representative',
          v.phone || '',
          (v as any).commissionRate ?? (v as any).commission_rate ?? 12,
          JSON.stringify((v as any).payoutAccount || (v as any).payout_account || {}),
        ]
      );
      return reply.status(201).send({ ok: true, vendor: { ...res.rows[0], password: undefined } });
    } catch (err: any) {
      return reply.status(err.code === '23505' ? 409 : 503).send({ error: 'FAILED_TO_CREATE_VENDOR', message: 'Vendor name or email may already exist. Check the details and retry.' });
    }
  });

  app.put<{
    Params: { id: string };
    Body: {
      name?: string;
      email?: string;
      contactPerson?: string;
      contact_person?: string;
      phone?: string;
      commissionRate?: number;
      commission_rate?: number;
      status?: string;
      payoutAccount?: any;
      payout_account?: any;
    };
  }>('/admin/vendors/:id', { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params;
    const parsed = vendorSchema.omit({ password: true }).partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_VENDOR' });
    const v = parsed.data;

    try {
      const payout = v.payoutAccount || v.payout_account;
      const res = await withTransaction(async client => {
        const old = (await client.query('SELECT name, email FROM vendors WHERE id = $1 FOR UPDATE', [id])).rows[0];
        const result = await client.query(
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
            v.contactPerson || v.contact_person || null,
            v.phone || null,
            v.commissionRate ?? v.commission_rate ?? null,
            v.status || null,
            payout ? JSON.stringify(payout) : null,
            id,
          ]
        );
        if (old && result.rowCount) {
          if (v.name) await client.query('UPDATE products SET vendor = $1 WHERE LOWER(vendor) = LOWER($2)', [v.name, old.name]);
          await client.query("UPDATE users SET name = COALESCE($1, name), email = COALESCE($2, email) WHERE LOWER(email) = LOWER($3) AND role = 'vendor'", [v.name, v.email, old.email]);
        }
        return result;
      });
      if (res.rows.length === 0) return reply.status(404).send({ error: 'VENDOR_NOT_FOUND' });
      return reply.send({ ok: true, vendor: { ...res.rows[0], password: undefined } });
    } catch (err: any) {
      return reply.status(500).send({ error: 'FAILED_TO_UPDATE_VENDOR', message: err.message });
    }
  });

  // Keep legacy clients on the same user identity and refresh-token flow.
  app.post('/admin/vendors/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const result = await app.inject({ method: 'POST', url: '/api/auth/login', payload: request.body as any });
    const body = result.json();
    if (result.statusCode === 200 && body.user?.role !== 'vendor') return reply.code(403).send({ error: 'VENDOR_ONLY' });
    return reply.code(result.statusCode).send(result.statusCode === 200 ? { ...body, vendor: body.user } : body);
  });

  // ─── 8. UNIFIED USER OPERATIONS & TASKS ────────────────────────────────────
  app.get('/admin/tasks', async (request, reply) => {
    try {
      const res = await query('SELECT * FROM admin_tasks ORDER BY created_at DESC');
      return reply.send({ data: res.rows });
    } catch (err: any) {
      return reply.code(503).send({ error: 'RECORDS_UNAVAILABLE' });
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
      return reply.code(503).send({ error: 'RECORDS_UNAVAILABLE' });
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
      } catch { }
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

  // ─── 13. COMPREHENSIVE FINANCIAL MANAGEMENT & AUDIT TELEMETRY ──────────
  app.get('/admin/finance/summary', async (request, reply) => {
    try {
      // 1. Product-level Financial Economics
      const productFinancialsRes = await query(`
        SELECT
          p.id,
          p.name,
          p.category,
          p.vendor,
          p.price::numeric as unit_price,
          p.stock_quantity::int as stock_quantity,
          COALESCE(SUM(oi.quantity), 0)::int as units_sold,
          COALESCE(SUM(oi.unit_price * oi.quantity), 0)::numeric as gross_revenue,
          NULL::numeric as platform_margin,
          NULL::numeric as vendor_payout
        FROM products p
        LEFT JOIN order_items oi ON oi.product_id = p.id AND EXISTS (SELECT 1 FROM orders paid WHERE paid.id = oi.order_id AND paid.status != 'cancelled' AND paid.payment_status = 'captured' AND COALESCE(paid.refund_status, '') = '')
        GROUP BY p.id, p.name, p.category, p.vendor, p.price, p.stock_quantity
        ORDER BY gross_revenue DESC, p.name ASC;
      `);

      // 2. Booking Financial Breakdown: Home Visit vs Salon Floor
      const bookingFinancialsRes = await query(`
        SELECT
          COALESCE(visit_type, 'salon') as visit_type,
          COUNT(*)::int as total_bookings,
          COUNT(*) FILTER (WHERE status = 'completed')::int as completed_bookings,
          COUNT(*) FILTER (WHERE status = 'cancelled')::int as cancelled_bookings,
          COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total_price ELSE 0 END), 0)::numeric as quoted_value, NULL::numeric as gross_revenue,
          ROUND(COALESCE(AVG(CASE WHEN status != 'cancelled' THEN total_price ELSE NULL END), 0), 2)::numeric as avg_ticket_size,
          NULL::numeric as travel_surcharge_collected
        FROM bookings
        GROUP BY visit_type;
      `);

      // 3. Payment Gateway & Collection Channels Breakdown
      const paymentBreakdownRes = await query(`
        SELECT
          COALESCE(payment_method, 'cash_on_delivery') as payment_method,
          COALESCE(payment_status, 'pending') as payment_status,
          COUNT(*)::int as count,
          COALESCE(SUM(total_amount), 0)::numeric as total_amount
        FROM orders
        WHERE status != 'cancelled'
        GROUP BY payment_method, payment_status;
      `);

      // 4. Vendor Payout Balances & Settlement Liabilities
      const vendorSettlementsRes = await vendorBalances();

      // 5. Aggregate Macro Totals
      const totalOrderRevRes = await query(`
        SELECT
          COALESCE(SUM(total_amount), 0)::numeric as total_order_rev,
          COALESCE(SUM(discount_amount), 0)::numeric as total_discounts,
          COUNT(*)::int as total_orders
        FROM orders WHERE status != 'cancelled' AND payment_status = 'captured' AND COALESCE(refund_status, '') = '';
      `);

      const totalBookingRevRes = await query(`
        SELECT
          COALESCE(SUM(total_price), 0)::numeric as total_booking_rev,
          COUNT(*)::int as total_bookings
        FROM bookings WHERE status != 'cancelled';
      `);

      const orderMacro = totalOrderRevRes.rows[0] || {};
      const bookingMacro = totalBookingRevRes.rows[0] || {};

      const totalGross = Number(orderMacro.total_order_rev || 0);

      return reply.send({
        ok: true,
        macro: {
          totalGrossRevenue: totalGross,
          totalProductRetailRevenue: Number(orderMacro.total_order_rev || 0),
          totalSalonServicesRevenue: null,
          totalBookingQuotedValue: Number(bookingMacro.total_booking_rev || 0),
          totalDiscountsGiven: Number(orderMacro.total_discounts || 0),
          totalOrdersCount: Number(orderMacro.total_orders || 0),
          totalBookingsCount: Number(bookingMacro.total_bookings || 0),
          netPlatformEstimatedMargin: null,
          payoutLiabilityPayable: vendorSettlementsRes.rows.reduce((sum, row) => sum + Number(row.payable_amount), 0)
        },
        productFinancials: productFinancialsRes.rows,
        bookingFinancials: bookingFinancialsRes.rows,
        paymentBreakdown: paymentBreakdownRes.rows,
        vendorSettlements: vendorSettlementsRes.rows
      });
    } catch (err: any) {
      return reply.status(500).send({ error: 'FAILED_TO_LOAD_FINANCIAL_SUMMARY', message: err.message });
    }
  });

  app.post<{
    Body: { vendorId: string; amount: number; reference: string; notes?: string };
  }>('/admin/finance/process-payout', { preHandler: [requireAdmin] }, async (request, reply) => {
    const parsed = z.object({ vendorId: z.string().trim().min(1).max(120), amount: z.number().finite().positive().multipleOf(0.01), reference: z.string().trim().min(3).max(150), notes: z.string().trim().max(1000).optional() }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_PAYOUT', message: 'Provide a vendor, positive amount, and the completed bank transfer reference.' });
    const { vendorId, amount, reference, notes } = parsed.data;
    try {
      const payout = await withTransaction(async client => {
        const vendor = (await client.query("SELECT id FROM vendors WHERE id = $1 AND status = 'active' FOR UPDATE", [vendorId])).rows[0];
        if (!vendor) throw new Error('VENDOR_NOT_FOUND');
        const existing = (await client.query('SELECT * FROM vendor_payouts WHERE reference = $1', [reference])).rows[0];
        if (existing) {
          if (existing.vendor_id !== vendorId || Number(existing.amount) !== amount) throw new Error('PAYOUT_REFERENCE_CONFLICT');
          return existing;
        }
        const balances = await vendorBalances(client);
        const balance = balances.rows.find(row => row.id === vendorId);
        if (!balance || amount > Number(balance.payable_amount)) throw new Error('PAYOUT_EXCEEDS_BALANCE');
        return (await client.query(`INSERT INTO vendor_payouts(vendor_id, amount, reference, notes, recorded_by)
          VALUES($1, $2, $3, $4, $5) RETURNING *`, [vendorId, amount, reference, notes || '', request.user.id])).rows[0];
      });
      return { ok: true, recorded: true, disbursed: false, payout, message: 'External payment recorded. This application did not transfer funds.' };
    } catch (error) {
      request.log.warn({ error }, 'Payout record rejected');
      return reply.code(409).send({ error: 'PAYOUT_RECORD_REJECTED', message: 'Check the available vendor balance and use a unique bank transfer reference.' });
    }
  });
}
