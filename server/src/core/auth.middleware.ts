import { FastifyRequest, FastifyReply } from 'fastify';
import { getCacheKey } from '../redis/client.js';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'customer' | 'stylist' | 'vendor';
  vendorId?: string;
  vendorName?: string;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthUser;
    user: AuthUser;
  }
}

/**
 * Strict authentication guard: requires valid, unrevoked JWT
 */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  try {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({
        error: 'UNAUTHORIZED',
        message: 'Authentication token is required to access this resource.',
      });
    }

    const token = authHeader.substring(7).trim();

    // Check token revocation blacklist (Redis or in-memory fallback)
    const isRevoked = await getCacheKey(`revoked:${token}`);
    if (isRevoked) {
      return reply.status(401).send({
        error: 'TOKEN_REVOKED',
        message: 'This session has been logged out. Please sign in again.',
      });
    }

    await request.jwtVerify();
  } catch (err: any) {
    return reply.status(401).send({
      error: 'INVALID_TOKEN',
      message: 'Authentication token is invalid or has expired.',
    });
  }
}

/**
 * Optional authentication: attaches user to request if valid token exists,
 * but allows unauthenticated access if no token is provided.
 */
export async function optionalAuth(request: FastifyRequest, _reply: FastifyReply) {
  try {
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();
      const isRevoked = await getCacheKey(`revoked:${token}`);
      if (!isRevoked) {
        await request.jwtVerify();
      }
    }
  } catch {
    // Gracefully ignore invalid token for optional auth
  }
}

/**
 * Strict Admin-only authorization guard
 */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  await requireAuth(request, reply);
  if (reply.sent) return;

  const user = request.user;
  if (!user || user.role !== 'admin') {
    return reply.status(403).send({
      error: 'FORBIDDEN_ADMIN_ONLY',
      message: 'Access denied: Master Administrator privileges required.',
    });
  }
}

/**
 * Staff authorization guard: allows either Master Admin or Vendor
 */
export async function requireStaff(request: FastifyRequest, reply: FastifyReply) {
  // Allow public vendor login endpoint without pre-existing token
  if (request.url.includes('/admin/vendors/login')) {
    return;
  }

  await requireAuth(request, reply);
  if (reply.sent) return;

  const user = request.user;
  if (!user || (user.role !== 'admin' && user.role !== 'vendor')) {
    return reply.status(403).send({
      error: 'FORBIDDEN_STAFF_ONLY',
      message: 'Access denied: Administrator or Vendor privileges required.',
    });
  }
}
