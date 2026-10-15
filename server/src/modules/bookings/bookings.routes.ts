import { FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import crypto from 'crypto';
import { query, withTransaction } from '../../db/pool.js';
import { acquireLock, releaseLock } from '../../redis/lock.service.js';
import { requireAuth, optionalAuth } from '../../core/auth.middleware.js';
import { z } from 'zod';

const customerSlots = ['09:00 AM', '10:00 AM', '11:00 AM', '12:00 PM',
  '02:00 PM', '03:00 PM', '04:00 PM', '05:00 PM', '06:00 PM', '07:00 PM'] as const;
const scheduleDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
function futureSlot(date: string, slot: string): boolean {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(slot);
  if (!match) return false;
  const hour = Number(match[1]) % 12 + (match[3].toUpperCase() === 'PM' ? 12 : 0);
  return Date.parse(`${date}T${String(hour).padStart(2, '0')}:${match[2]}:00+05:30`) > Date.now();
}
async function customerScheduleOnly(request: FastifyRequest, reply: FastifyReply) {
  if (request.user.role !== 'customer') {
    return reply.code(403).send({ error: 'FORBIDDEN', message: 'Use the customer account that owns this appointment.' });
  }
}
const ownedBookingSql = `SELECT id, status, stylist_id,
  to_char(booking_date, 'YYYY-MM-DD') AS booking_date, time_slot
  FROM bookings WHERE id = $1 AND LOWER(customer_email) = LOWER($2)`;

export async function bookingsRoutes(app: FastifyInstance) {
  // ─── LIST STYLISTS ────────────────────────────────────────────────────────
  // Assignment is internal; do not expose the staff directory to customers.
  app.get('/bookings/stylists', async () => []);

  // ─── GET AVAILABLE TIME SLOTS ─────────────────────────────────────────────
  app.get<{ Querystring: { stylistId: string; date: string } }>(
    '/bookings/available-slots',
    async (request, reply) => {
      const { stylistId, date } = request.query;
      const allSlots = [
        '09:00 AM', '10:00 AM', '11:00 AM', '12:00 PM', 
        '02:00 PM', '03:00 PM', '04:00 PM', '05:00 PM', '06:00 PM', '07:00 PM'
      ];

      try {
        const res = await query(
          `
          SELECT time_slot 
          FROM bookings 
          WHERE stylist_id = $1 AND booking_date = $2 AND status != 'cancelled'
          `,
          [stylistId, date]
        );

        const bookedSlots = new Set(res.rows.map((r) => r.time_slot));
        const available = allSlots.filter((slot) => !bookedSlots.has(slot));
        return reply.send({ stylistId, date, availableSlots: available });
      } catch {
        return reply.code(503).send({ error: 'AVAILABILITY_UNAVAILABLE', message: 'Availability could not be checked. Please retry.' });
      }
    }
  );

  app.get<{ Params: { id: string }; Querystring: { date: string } }>(
    '/bookings/:id/available-slots', { preHandler: [requireAuth, customerScheduleOnly] },
    async (request, reply) => {
      const parsed = z.object({ date: scheduleDate }).strict().safeParse(request.query);
      if (!parsed.success || !z.string().uuid().safeParse(request.params.id).success) {
        return reply.code(400).send({ error: 'INVALID_SCHEDULE', message: 'Choose a valid appointment and date.' });
      }
      try {
        const booking = (await query(ownedBookingSql, [request.params.id, request.user.email])).rows[0];
        if (!booking) return reply.code(404).send({ message: 'Appointment not found in your account.' });
        if (booking.status !== 'confirmed' || !futureSlot(booking.booking_date, booking.time_slot)) {
          return reply.code(409).send({ message: 'Only upcoming confirmed appointments can be rescheduled.' });
        }
        const taken = booking.stylist_id ? (await query(
          `SELECT time_slot FROM bookings WHERE stylist_id=$1 AND booking_date=$2 AND id<>$3 AND status!='cancelled'`,
          [booking.stylist_id, parsed.data.date, request.params.id])).rows : [];
        const blocked = new Set(taken.map(row => row.time_slot));
        return { date: parsed.data.date, availableSlots: customerSlots.filter(slot =>
          futureSlot(parsed.data.date, slot) && !blocked.has(slot)) };
      } catch (error) {
        request.log.warn({ err: error }, 'Customer reschedule availability failed');
        return reply.code(503).send({ message: 'Availability could not be checked. Please retry.' });
      }
    });

  app.put<{ Params: { id: string } }>('/bookings/:id/schedule',
    { preHandler: [requireAuth, customerScheduleOnly] }, async (request, reply) => {
      const parsed = z.object({ bookingDate: scheduleDate, timeSlot: z.enum(customerSlots),
        expectedDate: scheduleDate, expectedTimeSlot: z.string().min(4).max(20) }).strict().safeParse(request.body);
      if (!parsed.success || !z.string().uuid().safeParse(request.params.id).success ||
          !futureSlot(parsed.data.bookingDate, parsed.data.timeSlot)) {
        return reply.code(400).send({ error: 'INVALID_SCHEDULE', message: 'Choose an available future date and time.' });
      }
      try {
        const result = await withTransaction(async client => {
          const booking = (await client.query(`${ownedBookingSql} FOR UPDATE`, [request.params.id, request.user.email])).rows[0];
          if (!booking) return { kind: 'missing' } as const;
          if (booking.status !== 'confirmed' || !futureSlot(booking.booking_date, booking.time_slot)) return { kind: 'closed' } as const;
          if (booking.booking_date !== parsed.data.expectedDate || booking.time_slot !== parsed.data.expectedTimeSlot) return { kind: 'stale' } as const;
          if (booking.stylist_id) {
            const conflict = await client.query(`SELECT id FROM bookings WHERE stylist_id=$1 AND booking_date=$2
              AND time_slot=$3 AND id<>$4 AND status!='cancelled'`,
              [booking.stylist_id, parsed.data.bookingDate, parsed.data.timeSlot, request.params.id]);
            if (conflict.rows.length) return { kind: 'conflict' } as const;
          }
          // Ownership, price, visit address and salon staff assignment are preserved.
          // The existing unique active-stylist index also arbitrates concurrent moves.
          const saved = await client.query(`UPDATE bookings SET booking_date=$2, time_slot=$3, version=version+1
            WHERE id=$1 RETURNING id, customer_name, customer_email, customer_phone,
              to_char(booking_date,'YYYY-MM-DD') AS booking_date, time_slot, status,
              total_price, notes, visit_type, service_address, created_at`,
            [request.params.id, parsed.data.bookingDate, parsed.data.timeSlot]);
          return { kind: 'saved', booking: saved.rows[0] } as const;
        });
        if (result.kind === 'missing') return reply.code(404).send({ message: 'Appointment not found in your account.' });
        if (result.kind !== 'saved') return reply.code(409).send({ message: result.kind === 'closed'
          ? 'Only upcoming confirmed appointments can be rescheduled.' : result.kind === 'stale'
            ? 'This appointment changed on another device. Refresh before rescheduling.'
            : 'This time is no longer available. Choose another slot.' });
        return result.booking;
      } catch (error) {
        request.log.warn({ err: error }, 'Customer reschedule failed');
        const conflict = typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
        return reply.code(conflict ? 409 : 503).send({ message: conflict
          ? 'This time was just booked. Choose another slot.' : 'The appointment could not be changed. Please retry.' });
      }
    });

  // ─── BOOK APPOINTMENT WITH DISTRIBUTED REDIS LOCK ──────────────────────────
  app.post<{
    Body: {
      customerName?: string;
      customer_name?: string;
      customerEmail?: string;
      customer_email?: string;
      customerPhone?: string;
      customer_phone?: string;
      serviceId?: string;
      service_id?: string;
      serviceName?: string;
      bookingDate?: string;
      booking_date?: string;
      timeSlot?: string;
      time_slot?: string;
      totalPrice?: number;
      total_price?: number;
      notes?: string;
      visitType?: 'salon' | 'home';
      visit_type?: 'salon' | 'home';
      serviceAddress?: string;
      service_address?: string;
    };
  }>('/bookings', async (request, reply) => {
    const b = request.body || {};
    if (['stylistId','stylist_id','stylistName','stylist_name'].some(key => Boolean((b as Record<string, unknown>)[key]))) {
      return reply.code(400).send({error:'ADMIN_ASSIGNMENT_ONLY',message:'Staff assignments are managed by the salon.'});
    }
    const parsed = z.object({
      customerName: z.string().trim().min(2).max(255),
      customerEmail: z.union([z.string().email().max(255), z.literal('')]).optional(),
      customerPhone: z.string().trim().regex(/^[0-9+ -]{10,18}$/),
      serviceId: z.string().uuid().nullable().optional(),
      bookingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      timeSlot: z.string().trim().min(4).max(20),
      totalPrice: z.number().finite().min(0).max(1000000),
      notes: z.string().trim().min(2).max(500),
      visitType: z.enum(['salon', 'home']),
      serviceAddress: z.string().trim().max(500).nullable().optional(),
    }).safeParse({
      customerName: b.customerName || b.customer_name,
      customerEmail: b.customerEmail || b.customer_email || '',
      customerPhone: b.customerPhone || b.customer_phone,
      serviceId: b.serviceId || b.service_id || null,
      bookingDate: b.bookingDate || b.booking_date,
      timeSlot: b.timeSlot || b.time_slot,
      totalPrice: Number(b.totalPrice ?? b.total_price),
      notes: b.notes || b.serviceName || (b as any).service_name,
      visitType: b.visitType || b.visit_type || 'salon',
      serviceAddress: b.serviceAddress || b.service_address || null,
    });
    if (!parsed.success || (parsed.data.visitType === 'home' && !parsed.data.serviceAddress)) {
      return reply.code(400).send({ error: 'INVALID_BOOKING', message: 'Complete the customer, service, schedule, visit type, and home address where required.' });
    }

    const booking = parsed.data;
    const service=(await query("SELECT id,name,price FROM products WHERE kind='service' AND in_stock=true AND (($1::uuid IS NOT NULL AND id=$1) OR ($1::uuid IS NULL AND name=$2)) ORDER BY id LIMIT 1",[booking.serviceId || null, b.serviceName || booking.notes])).rows[0];
    if(!service) return reply.code(400).send({error:'SERVICE_UNAVAILABLE',message:'Choose an available salon service.'});
    booking.serviceId=service.id;
    booking.totalPrice=Number(service.price);
    booking.notes=service.name;
    const resourceKey = `visit:${booking.visitType}:${booking.bookingDate}:${booking.timeSlot.replace(/\s+/g, '')}`;

    // 1. Acquire Atomic Distributed Lock to prevent race conditions
    const lock = await acquireLock(resourceKey, 30000);
    if (!lock.acquired) {
      return reply.status(409).send({
        error: 'SLOT_ALREADY_RESERVED',
        message: 'This time slot was just selected by another client. Please select another slot.',
      });
    }

    try {
      // 2. Double-check inside transaction that slot wasn't committed yet
      let bookingId = crypto.randomUUID();

      try {
        await withTransaction(async (client) => {
          const insertRes = await client.query(
            `
            INSERT INTO bookings (
              id, customer_name, customer_email, customer_phone, 
              service_id, booking_date, time_slot, visit_type, service_address,
              status, total_price, notes
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, 'confirmed', $10, $11
            ) RETURNING id;
            `,
            [
              bookingId,
              booking.customerName,
              booking.customerEmail || null,
              booking.customerPhone,
              booking.serviceId || null,
              booking.bookingDate,
              booking.timeSlot,
              booking.visitType,
              booking.serviceAddress || null,
              booking.totalPrice,
              booking.notes,
            ]
          );
          bookingId = insertRes.rows[0].id;
        });
      } catch (err: any) {
        if (err.message === 'ALREADY_BOOKED' || err.code === '23505') {
          return reply.status(409).send({
            error: 'SLOT_CONFIRMED_BY_OTHER',
            message: 'This slot was just booked by another customer.',
          });
        }
        return reply.status(500).send({ error: 'BOOKING_FAILED', message: err.message });
      }

      return reply.status(201).send({
        id: bookingId,
        status: 'confirmed',
        customerName: booking.customerName,
        customer_name: booking.customerName,
        customer_email: booking.customerEmail || '',
        customer_phone: booking.customerPhone,
        bookingDate: booking.bookingDate,
        booking_date: booking.bookingDate,
        timeSlot: booking.timeSlot,
        time_slot: booking.timeSlot,
        visit_type: booking.visitType,
        service_address: booking.serviceAddress || null,
        total_price: booking.totalPrice,
        notes: booking.notes,
        message: 'Your appointment has been confirmed.',
      });
    } finally {
      // Always release distributed lock
      await releaseLock(lock.lockKey, lock.lockToken);
    }
  });

  // ─── GET USER BOOKINGS HISTORY ────────────────────────────────────────────
  app.get<{ Querystring: { email?: string } }>(
    '/bookings',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { email } = request.query || {};
      const user = request.user;
      const scopedEmail = user?.role === 'admin' ? email : user?.email;

      if (user?.role === 'vendor') {
        return reply.status(403).send({
          error: 'FORBIDDEN',
          message: 'Vendor accounts cannot access customer salon bookings.',
        });
      }

      if (!scopedEmail && user?.role !== 'admin') {
        return reply.status(401).send({
          error: 'AUTHENTICATION_REQUIRED',
          message: 'Please sign in or provide your booking email.',
        });
      }

      try {
        let sql = `
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
          b.created_at,
          b.visit_type,
          b.service_address,
          CASE WHEN b.visit_type='home' THEN s.name ELSE NULL END as stylist_name
        FROM bookings b
        LEFT JOIN stylists s ON s.id = b.stylist_id
      `;
        const params: any[] = [];
        if (scopedEmail) {
          sql += ` WHERE LOWER(b.customer_email) = $1 `;
          params.push(scopedEmail.trim().toLowerCase());
        }
        sql += ` ORDER BY b.booking_date DESC, b.created_at DESC LIMIT 50; `;
        const res = await query(sql, params);
        return reply.send(res.rows);
      } catch (err: any) {
        request.log.error(err, 'Failed to fetch user bookings');
        return reply.code(503).send({ error: 'HISTORY_UNAVAILABLE', message: 'Appointments could not be loaded. Please retry.' });
      }
    }
  );
}
