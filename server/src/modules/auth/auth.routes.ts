import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { query } from '../../db/pool.js';
import { setCacheKey, getCacheKey } from '../../redis/client.js';

export async function authRoutes(app: FastifyInstance) {
  // ─── LOGIN ────────────────────────────────────────────────────────────────
  app.post<{ Body: { email: string; password: string } }>(
    '/auth/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 4 },
          },
        },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body;
      const normalizedEmail = email.trim().toLowerCase();

      try {
        const res = await query('SELECT * FROM users WHERE email = $1 LIMIT 1', [normalizedEmail]);
        if (res.rows.length > 0) {
          const user = res.rows[0];
          const isValid = await bcrypt.compare(password, user.password_hash);
          if (!isValid) {
            return reply.status(401).send({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
          }

          const token = app.jwt.sign(
            { id: user.id, email: user.email, name: user.name, role: user.role },
            { expiresIn: '15m' }
          );

          return reply.send({
            token,
            user: { id: user.id, email: user.email, name: user.name, role: user.role },
          });
        }
      } catch (err) {
        // Fallback for demo account if DB is unavailable
        if (normalizedEmail === 'demo@urbanblade.in' && password === 'Blade@123') {
          const demoUser = { id: 'demo-guest-id', email: 'demo@urbanblade.in', name: 'Demo Guest', role: 'customer' };
          const token = app.jwt.sign(demoUser, { expiresIn: '15m' });
          return reply.send({ token, user: demoUser });
        }
      }

      return reply.status(401).send({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
    }
  );

  // ─── REGISTER ─────────────────────────────────────────────────────────────
  app.post<{ Body: { name: string; email: string; password: string } }>(
    '/auth/register',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name', 'email', 'password'],
          properties: {
            name: { type: 'string', minLength: 2 },
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 6 },
          },
        },
      },
    },
    async (request, reply) => {
      const { name, email, password } = request.body;
      const normalizedEmail = email.trim().toLowerCase();

      try {
        const existing = await query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
        if (existing.rows.length > 0) {
          return reply.status(409).send({ error: 'USER_EXISTS', message: 'Email is already registered.' });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const res = await query(
          `
          INSERT INTO users (name, email, password_hash, role)
          VALUES ($1, $2, $3, 'customer')
          RETURNING id, name, email, role;
          `,
          [name, normalizedEmail, passwordHash]
        );

        const newUser = res.rows[0];
        const token = app.jwt.sign(
          { id: newUser.id, email: newUser.email, name: newUser.name, role: newUser.role },
          { expiresIn: '15m' }
        );

        return reply.status(201).send({ token, user: newUser });
      } catch (err: any) {
        return reply.status(500).send({ error: 'REGISTRATION_FAILED', message: err.message });
      }
    }
  );

  // ─── GET CURRENT USER ─────────────────────────────────────────────────────
  app.get(
    '/auth/me',
    {
      onRequest: [async (request, reply) => {
        try {
          await request.jwtVerify();
        } catch (err) {
          reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Token missing or invalid' });
        }
      }],
    },
    async (request) => {
      const user = (request as any).user;
      return { user };
    }
  );

  // ─── LOGOUT (TOKEN REVOCATION VIA REDIS) ──────────────────────────────────
  app.post(
    '/auth/logout',
    {
      onRequest: [async (request, reply) => {
        try {
          await request.jwtVerify();
        } catch {
          // Allow logout even if token expired
        }
      }],
    },
    async (request, reply) => {
      const authHeader = request.headers.authorization;
      if (authHeader) {
        const token = authHeader.replace('Bearer ', '');
        await setCacheKey(`revoked:${token}`, 'true', 900); // 15m expiration
      }
      return reply.send({ ok: true, message: 'Logged out successfully.' });
    }
  );
}
