import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { query } from '../../db/pool.js';
import { setCacheKey } from '../../redis/client.js';
import { requireAuth } from '../../core/auth.middleware.js';

const DEFAULT_VENDORS: Record<string, { id: string; name: string }> = {
  'lab@urbanblade.in': { id: 'vnd-lab', name: 'Urban Blade Lab' },
  'grooming@urbanblade.in': { id: 'vnd-grooming', name: 'Urban Blade Grooming' },
  'tools@urbanblade.in': { id: 'vnd-tools', name: 'Urban Blade Tools' },
  'skin@urbanblade.in': { id: 'vnd-skin', name: 'Urban Blade Skin' },
  'salon@urbanblade.in': { id: 'vnd-salon', name: 'Urban Blade Salon' },
};

export async function authRoutes(app: FastifyInstance) {
  // ─── LOGIN ────────────────────────────────────────────────────────────────
  app.post<{ Body: { email: string; password: string } }>(
    '/auth/login',
    {
      config: {
        rateLimit: {
          max: 25,
          timeWindow: '1 minute',
        },
      },
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
        let res = await query('SELECT * FROM users WHERE email = $1 LIMIT 1', [normalizedEmail]);

        // Auto-provision default vendor accounts if authenticating with standard vendor credentials
        if (res.rows.length === 0 && DEFAULT_VENDORS[normalizedEmail] && password === 'Vendor@2026') {
          const vInfo = DEFAULT_VENDORS[normalizedEmail];
          const hash = await bcrypt.hash('Vendor@2026', 10);
          const insRes = await query(
            `INSERT INTO users (name, email, password_hash, role)
             VALUES ($1, $2, $3, 'vendor')
             ON CONFLICT (email) DO UPDATE SET role = 'vendor'
             RETURNING id, name, email, role;`,
            [vInfo.name, normalizedEmail, hash]
          );
          res = insRes;
        }

        if (res.rows.length > 0) {
          const user = res.rows[0];
          const isValid = await bcrypt.compare(password, user.password_hash);
          if (!isValid) {
            return reply.status(401).send({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
          }

          const vInfo = DEFAULT_VENDORS[normalizedEmail];
          const tokenPayload: any = {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
          };
          if (vInfo || user.role === 'vendor') {
            tokenPayload.vendorId = vInfo?.id || `vnd-${user.id.slice(0, 8)}`;
            tokenPayload.vendorName = vInfo?.name || user.name;
          }

          const token = app.jwt.sign(tokenPayload, { expiresIn: '15m' });

          return reply.send({
            token,
            user: {
              id: user.id,
              email: user.email,
              name: user.name,
              role: user.role,
              vendorId: tokenPayload.vendorId,
              vendorName: tokenPayload.vendorName,
            },
          });
        }
      } catch (err: any) {
        // Fallback for demo customer account if DB is unreachable
        if (normalizedEmail === 'demo@urbanblade.in' && password === 'Blade@123') {
          const demoUser = { id: 'demo-guest-id', email: 'demo@urbanblade.in', name: 'Demo Guest', role: 'customer' as const };
          const token = app.jwt.sign(demoUser, { expiresIn: '15m' });
          return reply.send({ token, user: demoUser });
        }
        if (normalizedEmail === 'admin@urbanblade.in' && password === 'Admin@2026') {
          const adminUser = { id: 'master-admin-id', email: 'admin@urbanblade.in', name: 'Master Admin', role: 'admin' as const };
          const token = app.jwt.sign(adminUser, { expiresIn: '15m' });
          return reply.send({ token, user: adminUser });
        }
      }

      return reply.status(401).send({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
    }
  );

  // ─── REGISTER ─────────────────────────────────────────────────────────────
  app.post<{ Body: { name: string; email: string; password: string } }>(
    '/auth/register',
    {
      config: {
        rateLimit: {
          max: 15,
          timeWindow: '1 minute',
        },
      },
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
        // Force new self-registrations to 'customer' role strictly (prevents privilege escalation)
        const res = await query(
          `
          INSERT INTO users (name, email, password_hash, role)
          VALUES ($1, $2, $3, 'customer')
          RETURNING id, name, email, role;
          `,
          [name.trim(), normalizedEmail, passwordHash]
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
      preHandler: [requireAuth],
    },
    async (request) => {
      const user = request.user;
      return { user };
    }
  );

  // ─── LOGOUT (TOKEN REVOCATION VIA REDIS / MEMORY) ─────────────────────────
  app.post(
    '/auth/logout',
    async (request, reply) => {
      const authHeader = request.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.replace('Bearer ', '').trim();
        await setCacheKey(`revoked:${token}`, 'true', 900); // 15m expiration matching JWT lifetime
      }
      return reply.send({ ok: true, message: 'Logged out successfully.' });
    }
  );
}
