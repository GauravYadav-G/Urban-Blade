import { createHash } from 'node:crypto';
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
            password: { type: 'string', minLength: 1, maxLength: 72 },
          },
        },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body;
      const normalizedEmail = email.trim().toLowerCase();

      try {
        let res = await query('SELECT * FROM users WHERE email = $1 LIMIT 1', [normalizedEmail]);
        let vendorRecord: any = null;

        try {
          const vendorRes = await query(
            `SELECT id, name, email, password, status
             FROM vendors
             WHERE LOWER(email) = $1
             LIMIT 1`,
            [normalizedEmail]
          );
          vendorRecord = vendorRes.rows[0] || null;
        } catch {
          // Older installations may not have the vendors table yet.
        }

        if (vendorRecord?.status === 'suspended') {
          return reply.status(403).send({
            error: 'VENDOR_SUSPENDED',
            message: 'This vendor account is suspended. Contact the administrator.',
          });
        }

        // Vendor accounts created in the admin panel must also be able to use
        // the shared staff login. Provision their user row on first login.
        // Use bcrypt to verify the vendor password (stored as hash in vendors table)
        if (vendorRecord && vendorRecord.password) {
          const isValidPassword = await bcrypt.compare(password, vendorRecord.password);
          if (isValidPassword) {
            const hash = await bcrypt.hash(password, 10);
            res = await query(
              `INSERT INTO users (name, email, password_hash, role)
               VALUES ($1, $2, $3, 'vendor')
               ON CONFLICT (email) DO UPDATE SET
                 name = EXCLUDED.name,
                 password_hash = EXCLUDED.password_hash,
                 role = 'vendor',
                 updated_at = CURRENT_TIMESTAMP
               RETURNING id, name, email, password_hash, role;`,
              [vendorRecord.name, normalizedEmail, hash]
            );
          }
        }

        if (res.rows.length > 0) {
          const user = res.rows[0];
          const isValid = await bcrypt.compare(password, user.password_hash);
          if (!isValid) {
            return reply.status(401).send({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
          }

          const vInfo = DEFAULT_VENDORS[normalizedEmail];
          if (user.role === 'vendor' && !vendorRecord && !vInfo) {
            return reply.status(403).send({
              error: 'VENDOR_NOT_FOUND',
              message: 'This vendor login is no longer linked to an active vendor account.',
            });
          }
          const tokenPayload: any = {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            phone: user.phone || null,
          };
          if (vInfo || vendorRecord || user.role === 'vendor') {
            tokenPayload.vendorId = vendorRecord?.id || vInfo?.id || `vnd-${user.id.slice(0, 8)}`;
            tokenPayload.vendorName = vendorRecord?.name || vInfo?.name || user.name;
          }

          const token = app.jwt.sign(tokenPayload, { expiresIn: '24h' });

          // Store refresh token in database with expiration
          const refreshToken = crypto.randomUUID();
          const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
          await query(
            `INSERT INTO refresh_tokens (token, user_id, expires_at)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id) DO UPDATE SET
               token = EXCLUDED.token,
               expires_at = EXCLUDED.expires_at,
               revoked = FALSE;`,
            [refreshToken, user.id, refreshExpiresAt]
          );

          // Server-side cart sync: merge localStorage cart with server cart
          let serverCartItems: any[] = [];
          try {
            const cartRes = await query('SELECT items FROM carts WHERE user_id = $1', [user.id]);
            if (cartRes.rows.length > 0) {
              serverCartItems = cartRes.rows[0].items || [];
            }
          } catch {
            // carts table may not exist in older installations
          }

          return reply.send({
            token,
            refreshToken,
            user: {
              id: user.id,
              email: user.email,
              name: user.name,
              role: user.role,
              phone: user.phone || null,
              vendorId: tokenPayload.vendorId,
              vendorName: tokenPayload.vendorName,
            },
            serverCart: serverCartItems,
          });
        }
      } catch (err: any) {
        request.log.error(err, 'Login error');
        // Removed hardcoded demo/admin fallback - these should be proper database accounts
      }

      return reply.status(401).send({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
    }
  );

  // ─── REGISTER ─────────────────────────────────────────────────────────────
  app.post<{ Body: { name: string; email: string; password: string; phone?: string } }>(
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
            password: { type: 'string', minLength: 10, maxLength: 72 },
            phone: { type: 'string', maxLength: 20 },
          },
        },
      },
    },
    async (request, reply) => {
      const { name, email, password, phone } = request.body;
      const normalizedEmail = email.trim().toLowerCase();
      const cleanPhone = phone ? phone.trim() : null;

      try {
        const existing = await query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
        if (existing.rows.length > 0) {
          return reply.status(409).send({ error: 'USER_EXISTS', message: 'Email is already registered.' });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        // Force new self-registrations to 'customer' role strictly (prevents privilege escalation)
        const res = await query(
          `
          INSERT INTO users (name, email, password_hash, role, phone)
          VALUES ($1, $2, $3, 'customer', $4)
          RETURNING id, name, email, role, phone;
          `,
          [name.trim(), normalizedEmail, passwordHash, cleanPhone]
        );

        const newUser = res.rows[0];
        const token = app.jwt.sign(
          { id: newUser.id, email: newUser.email, name: newUser.name, role: newUser.role, phone: newUser.phone || null },
          { expiresIn: '24h' }
        );

        // Generate refresh token for new user
        const refreshToken = crypto.randomUUID();
        const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
        await query(
          `INSERT INTO refresh_tokens (token, user_id, expires_at) VALUES ($1, $2, $3)`,
          [refreshToken, newUser.id, refreshExpiresAt]
        );

        return reply.status(201).send({ token, refreshToken, user: newUser });
      } catch (err: any) {
        request.log.error(err, 'Registration failed');
        return reply.status(err.code === '23505' ? 409 : 500).send({ error: 'REGISTRATION_FAILED', message: 'Unable to create account. Please try again or sign in.' });
      }
    }
  );

  // ─── GET CURRENT USER ─────────────────────────────────────────────────────
  app.get(
    '/auth/me',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const jwtUser = request.user as any;
      try {
        const userRes = await query('SELECT id, name, email, role, phone FROM users WHERE id = $1', [jwtUser.id]);
        if (userRes.rows.length > 0) {
          return reply.send({ user: userRes.rows[0] });
        }
      } catch {
        // fallback to token payload
      }
      return reply.send({ user: jwtUser });
    }
  );

  // ─── UPDATE USER PROFILE ───────────────────────────────────────────────────
  app.patch<{ Body: { name?: string; phone?: string } }>(
    '/auth/profile',
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 255 },
            phone: { type: 'string', maxLength: 20 },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.user as any;
      const { name, phone } = request.body;

      try {
        const cleanName = name !== undefined ? name.trim() : null;
        const cleanPhone = phone !== undefined ? phone.trim() : null;

        const res = await query(
          `UPDATE users
           SET
             name = COALESCE($1, name),
             phone = CASE WHEN $2::text IS NOT NULL THEN $2 ELSE phone END,
             updated_at = CURRENT_TIMESTAMP
           WHERE id = $3
           RETURNING id, name, email, role, phone;`,
          [cleanName, cleanPhone, user.id]
        );

        if (res.rows.length === 0) {
          return reply.status(404).send({ error: 'USER_NOT_FOUND', message: 'User not found' });
        }

        const updatedUser = res.rows[0];
        return reply.send({ ok: true, user: updatedUser });
      } catch (err: any) {
        request.log.error(err, 'Failed to update profile');
        return reply.status(500).send({ error: 'PROFILE_UPDATE_FAILED', message: 'Could not update profile' });
      }
    }
  );

  // ─── REFRESH TOKEN ────────────────────────────────────────────────────────────
  app.post<{ Body: { refreshToken: string } }>(
    '/auth/refresh',
    async (request, reply) => {
      const { refreshToken } = request.body;

      if (!refreshToken) {
        return reply.status(400).send({ error: 'REFRESH_TOKEN_REQUIRED', message: 'Refresh token is required' });
      }

      // Check if refresh token exists and is valid in database
      const tokenRes = await query(
        'SELECT * FROM refresh_tokens WHERE token = $1 AND revoked = FALSE AND expires_at > NOW()',
        [refreshToken]
      );

      if (tokenRes.rows.length === 0) {
        return reply.status(401).send({ error: 'INVALID_REFRESH_TOKEN', message: 'Refresh token is invalid or expired' });
      }

      const tokenRecord = tokenRes.rows[0];

      // Get user details
      const userRes = await query('SELECT id, name, email, role, phone FROM users WHERE id = $1', [tokenRecord.user_id]);
      if (userRes.rows.length === 0) {
        return reply.status(401).send({ error: 'USER_NOT_FOUND', message: 'User not found' });
      }

      const user = userRes.rows[0];

      // Rotate refresh token - revoke old one and create new one
      const newRefreshToken = crypto.randomUUID();
      const newRefreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      const rotated = await query(
        `UPDATE refresh_tokens SET token = $2, expires_at = $3
         WHERE token = $1 AND revoked = FALSE AND expires_at > NOW() RETURNING user_id`,
        [refreshToken, newRefreshToken, newRefreshExpiresAt]
      );
      if (!rotated.rowCount) return reply.code(401).send({ error: 'INVALID_REFRESH_TOKEN' });

      // Generate new access token
      const newAccessToken = app.jwt.sign(
        { id: user.id, email: user.email, name: user.name, role: user.role, phone: user.phone || null },
        { expiresIn: '24h' }
      );

      return reply.send({
        token: newAccessToken,
        refreshToken: newRefreshToken,
        user: { id: user.id, email: user.email, name: user.name, role: user.role, phone: user.phone || null }
      });
    }
  );

  // ─── LOGOUT (TOKEN REVOCATION VIA REDIS / MEMORY + DATABASE) ─────────────────────────
  app.post(
    '/auth/logout',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const authHeader = request.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.replace('Bearer ', '').trim();
        // Revoke in Redis/memory
        await setCacheKey(`revoked:${token}`, 'true', 86400); // 24h expiration matching JWT lifetime
        await query('INSERT INTO revoked_access_tokens (token_hash, expires_at) VALUES ($1, $2) ON CONFLICT DO NOTHING', [createHash('sha256').update(token).digest('hex'), new Date((request.user as any).exp * 1000)]);
        // Also revoke in database
        await query('UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1', [request.user.id]);
      }
      return reply.send({ ok: true, message: 'Logged out successfully.' });
    }
  );

  // ─── CART SYNC ─────────────────────────────────────────────────────────────
  // Pull server cart
  app.get(
    '/auth/cart',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const user = request.user as any;
      try {
        const cartRes = await query('SELECT items FROM carts WHERE user_id = $1', [user.id]);
        if (cartRes.rows.length > 0) {
          return reply.send({ items: cartRes.rows[0].items || [] });
        }
        return reply.send({ items: [] });
      } catch {
        return reply.send({ items: [] });
      }
    }
  );

  // Push/merge cart from client to server
  app.post<{ Body: { items: any[] } }>(
    '/auth/cart',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const user = request.user as any;
      const { items } = request.body;
      if (!Array.isArray(items)) {
        return reply.status(400).send({ error: 'INVALID_CART', message: 'Items must be an array' });
      }
      try {
        await query(
          `INSERT INTO carts (user_id, items, version, updated_at)
             VALUES ($1, $2, 1, CURRENT_TIMESTAMP)
             ON CONFLICT (user_id) DO UPDATE SET
               items = EXCLUDED.items,
               version = carts.version + 1,
               updated_at = CURRENT_TIMESTAMP`,
          [user.id, JSON.stringify(items)]
        );
        return reply.send({ ok: true });
      } catch (err: any) {
        request.log.error(err, 'Cart sync error');
        return reply.status(500).send({ error: 'CART_SYNC_FAILED', message: 'Could not sync cart' });
      }
    }
  );
}
