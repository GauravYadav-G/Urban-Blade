import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { query, withTransaction } from '../../db/pool.js';
import { requireAuth } from '../../core/auth.middleware.js';

const addressSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  mobile: z.string().regex(/^[6-9]\d{9}$/),
  house: z.string().trim().max(255).default(''),
  street: z.string().trim().min(1).max(500),
  landmark: z.string().trim().max(255).default(''),
  pinCode: z.string().regex(/^[1-9]\d{5}$/),
  city: z.string().trim().min(2).max(100),
  state: z.string().trim().min(1).max(100),
  isDefault: z.boolean().default(false),
  location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), label: z.string().max(500) }).nullable().default(null),
}).strict();
const createSchema = addressSchema.extend({ id: z.string().uuid().optional() });
const idSchema = z.string().uuid();
const columns = `id, full_name AS "fullName", phone AS mobile, house, street1 AS street,
  landmark, postal_code AS "pinCode", city, state, is_default AS "isDefault", location`;

async function list(client: PoolClient, userId: string) {
  return (await client.query(`SELECT ${columns} FROM addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at, id`, [userId])).rows;
}
async function ensureDefault(client: PoolClient, userId: string) {
  await client.query(`UPDATE addresses SET is_default = true
    WHERE id = (SELECT id FROM addresses WHERE user_id = $1 ORDER BY created_at, id LIMIT 1)
      AND NOT EXISTS (SELECT 1 FROM addresses WHERE user_id = $1 AND is_default = true)`, [userId]);
}

export async function addressesRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/account/addresses', async (request, reply) => {
    try {
      const result = await query(`SELECT ${columns} FROM addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at, id`, [request.user.id]);
      return reply.send(result.rows);
    } catch (err) {
      request.log.error({ err }, 'Address book load failed');
      return reply.code(503).send({ message: 'Your saved addresses are temporarily unavailable. Please retry.' });
    }
  });

  for (const method of ['POST', 'PUT'] as const) {
    app.route<{ Params: { id?: string }; Body: unknown }>({
      method, url: method === 'POST' ? '/account/addresses' : '/account/addresses/:id',
      handler: async (request, reply) => {
        const parsed = (method === 'POST' ? createSchema : addressSchema).safeParse(request.body);
        const requestedId = method === 'PUT' ? request.params.id : (parsed.success && 'id' in parsed.data ? parsed.data.id : undefined);
        if (!parsed.success || (requestedId !== undefined && !idSchema.safeParse(requestedId).success)) {
          return reply.code(400).send({ message: 'Check the name, mobile number, PIN code, and required address fields.' });
        }
        const address = parsed.data;
        const userId = request.user.id;
        try {
          const result = await withTransaction(async client => {
            // Serializes default changes and creates for the same customer across devices.
            const user = await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
            if (!user.rows.length) return null;
            if (requestedId) {
              const existing = await client.query('SELECT user_id FROM addresses WHERE id = $1', [requestedId]);
              if (existing.rows.length) {
                if (existing.rows[0].user_id !== userId) return null;
                // Legacy import retries must not overwrite a newer server edit.
                if (method === 'POST') return list(client, userId);
              } else if (method === 'PUT') return null;
            }
            if (address.isDefault) await client.query('UPDATE addresses SET is_default = false WHERE user_id = $1', [userId]);
            const values = [userId, address.fullName, address.mobile, address.house, address.street,
              address.landmark, address.pinCode, address.city, address.state, address.isDefault, address.location ? JSON.stringify(address.location) : null];
            if (method === 'PUT') {
              await client.query(`UPDATE addresses SET full_name=$2, phone=$3, house=$4, street1=$5,
                landmark=$6, postal_code=$7, city=$8, state=$9, is_default=$10, location=$11
                WHERE user_id=$1 AND id=$12`, [...values, requestedId]);
            } else {
              await client.query(`INSERT INTO addresses(user_id,full_name,phone,house,street1,landmark,postal_code,city,state,is_default,location,id)
                VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12::uuid,gen_random_uuid()))`, [...values, requestedId || null]);
            }
            await ensureDefault(client, userId);
            return list(client, userId);
          });
          return result ? reply.code(method === 'POST' ? 201 : 200).send(result) : reply.code(404).send({ message: 'Address not found in your account.' });
        } catch (err) {
          request.log.error({ err }, 'Address save failed');
          return reply.code(503).send({ message: 'Your address could not be saved. Please retry.' });
        }
      },
    });
  }

  for (const method of ['DELETE', 'PATCH'] as const) {
    app.route<{ Params: { id: string } }>({
      method, url: `/account/addresses/:id${method === 'PATCH' ? '/default' : ''}`,
      handler: async (request, reply) => {
        if (!idSchema.safeParse(request.params.id).success) return reply.code(400).send({ message: 'Invalid address ID.' });
        try {
          const result = await withTransaction(async client => {
            await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [request.user.id]);
            const owned = await client.query('SELECT id FROM addresses WHERE id = $1 AND user_id = $2', [request.params.id, request.user.id]);
            if (!owned.rows.length) return null;
            if (method === 'DELETE') {
              await client.query('DELETE FROM addresses WHERE id = $1 AND user_id = $2', [request.params.id, request.user.id]);
            } else {
              await client.query('UPDATE addresses SET is_default = false WHERE user_id = $1', [request.user.id]);
              await client.query('UPDATE addresses SET is_default = true WHERE id = $1 AND user_id = $2', [request.params.id, request.user.id]);
            }
            await ensureDefault(client, request.user.id);
            return list(client, request.user.id);
          });
          return result ? reply.send(result) : reply.code(404).send({ message: 'Address not found in your account.' });
        } catch (err) {
          request.log.error({ err }, 'Address change failed');
          return reply.code(503).send({ message: 'Your address could not be changed. Please retry.' });
        }
      },
    });
  }
}
