import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { requireAdmin } from '../../core/auth.middleware.js';
import { getSiteSettings } from './commerce.service.js';
const couponSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,40}$/),
  discountType: z.enum(['percentage', 'fixed']), discountValue: z.number().positive().max(100000),
  minOrderValue: z.number().min(0).max(1000000), maxDiscountAmount: z.number().positive().max(100000).nullish(),
  isActive: z.boolean(), description: z.string().max(500), expiresAt: z.string().datetime().nullish(),
}).refine(c => c.discountType !== 'percentage' || c.discountValue <= 100, 'Percentage cannot exceed 100');
const fields = `id, code, discount_type AS "discountType", discount_value::float AS "discountValue",
 min_order_value::float AS "minOrderValue", max_discount_amount::float AS "maxDiscountAmount",
 is_active AS "isActive", description, created_at AS "createdAt", expires_at AS "expiresAt"`;
export async function commerceRoutes(app: FastifyInstance) {
  app.get('/settings', async () => getSiteSettings());
  app.put('/settings', { preHandler: requireAdmin }, async (req, reply) => {
    const schema = z.object({
      ecommerce: z.object({ freeShippingEnabled: z.boolean(), freeShippingThreshold: z.number().min(0).max(1000000),
        standardShippingFee: z.number().min(0).max(10000), taxEnabled: z.boolean(), taxInclusive: z.boolean(),
        taxRatePercent: z.number().min(0).max(100), currency: z.literal('INR') }),
      announcement: z.object({ enabled: z.boolean(), badge: z.string().max(100), text: z.string().max(1000), linkText: z.string().max(100), linkUrl: z.string().max(500) }),
      business: z.record(z.string().max(1000)),
      operations: z.object({ chairCount: z.number().int().min(1).max(1000), acceptingOrders: z.boolean(), emergencyNotice: z.string().max(1000) }),
    }).safeParse(req.body);
    if (!schema.success) return reply.code(400).send({ error: 'INVALID_SETTINGS' });
    await query("INSERT INTO site_settings(id,value) VALUES ('main',$1) ON CONFLICT(id) DO UPDATE SET value = EXCLUDED.value", [JSON.stringify(schema.data)]);
    return schema.data;
  });
  app.get('/coupons', async () => ({ data: (await query(`SELECT ${fields}, 0 AS "usageCount" FROM coupons WHERE is_active = TRUE AND (expires_at IS NULL OR expires_at > NOW()) ORDER BY created_at DESC`)).rows }));
  app.get('/admin/coupons', { preHandler: requireAdmin }, async () => ({ data: (await query(`SELECT ${fields},
    (SELECT COUNT(*)::int FROM coupon_usages u JOIN orders o ON o.id = u.order_id WHERE u.coupon_code = coupons.code AND o.status <> 'cancelled') AS "usageCount" FROM coupons ORDER BY created_at DESC`)).rows }));
  for (const method of ['POST', 'PUT'] as const) {
    app.route({ method, url: method === 'POST' ? '/admin/coupons' : '/admin/coupons/:id', preHandler: requireAdmin, handler: async (req, reply) => {
      const parsed = couponSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'INVALID_COUPON', message: parsed.error.issues[0].message });
      const c = parsed.data;
      const values = [c.code,c.discountType,c.discountValue,c.minOrderValue,c.maxDiscountAmount ?? null,c.isActive,c.description,c.expiresAt || null];
      try {
        const result = method === 'POST'
          ? await query(`INSERT INTO coupons(code,discount_type,discount_value,min_order_value,max_discount_amount,is_active,description,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${fields}`, values)
          : await query(`UPDATE coupons SET code=$1,discount_type=$2,discount_value=$3,min_order_value=$4,max_discount_amount=$5,is_active=$6,description=$7,expires_at=$8 WHERE id::text=$9 RETURNING ${fields}`, [...values,(req.params as any).id]);
        if (!result.rows.length) return reply.code(404).send({ error: 'NOT_FOUND' });
        return { ...result.rows[0], usageCount: 0 };
      } catch (err: any) { if (err.code === '23505') return reply.code(409).send({ error: 'DUPLICATE_CODE' }); throw err; }
    }});
  }
  app.delete('/admin/coupons/:id', { preHandler: requireAdmin }, async req => {
    await query('DELETE FROM coupons WHERE id::text=$1', [(req.params as any).id]); return { success: true };
  });
}
