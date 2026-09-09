import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { query, withTransaction } from '../../db/pool.js';
import { acquireLock, releaseLock } from '../../redis/lock.service.js';

// Fallback stylists
const fallbackStylists = [
  {
    id: 'stylist-vikram',
    name: 'Vikram Sharma',
    role: 'Master Barber & Stylist',
    avatar_url: '/images/stylists/vikram.jpg',
    rating: 4.95,
  },
  {
    id: 'stylist-rohan',
    name: 'Rohan Verma',
    role: 'Senior Hair Specialist',
    avatar_url: '/images/stylists/rohan.jpg',
    rating: 4.88,
  },
  {
    id: 'stylist-ayesha',
    name: 'Ayesha Khan',
    role: 'Skin & Grooming Expert',
    avatar_url: '/images/stylists/ayesha.jpg',
    rating: 4.92,
  },
];

export async function bookingsRoutes(app: FastifyInstance) {
  // ─── LIST STYLISTS ────────────────────────────────────────────────────────
  app.get('/bookings/stylists', async (request, reply) => {
    try {
      const res = await query('SELECT * FROM stylists WHERE is_active = true ORDER BY rating DESC');
      if (res.rows.length > 0) return reply.send(res.rows);
    } catch {}
    return reply.send(fallbackStylists);
  });

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
        return reply.send({ stylistId, date, availableSlots: allSlots });
      }
    }
  );

  // ─── BOOK APPOINTMENT WITH DISTRIBUTED REDIS LOCK ──────────────────────────
  app.post<{
    Body: {
      customerName: string;
      customerEmail: string;
      customerPhone: string;
      stylistId: string;
      serviceId?: string;
      serviceName?: string;
      bookingDate: string;
      timeSlot: string;
      totalPrice?: number;
      notes?: string;
    };
  }>('/bookings', async (request, reply) => {
    const {
      customerName,
      customerEmail,
      customerPhone,
      stylistId,
      serviceId,
      bookingDate,
      timeSlot,
      totalPrice = 499,
      notes,
    } = request.body;

    // Resolve Stylist UUID if slug/mock ID was provided
    let resolvedStylistId = stylistId;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stylistId);
    if (!isUuid) {
      try {
        const sRes = await query('SELECT id FROM stylists WHERE name ILIKE $1 OR role ILIKE $1 LIMIT 1', [
          `%${stylistId.replace('stylist-', '')}%`,
        ]);
        if (sRes.rows.length > 0) {
          resolvedStylistId = sRes.rows[0].id;
        } else {
          const anyS = await query('SELECT id FROM stylists LIMIT 1');
          if (anyS.rows.length > 0) resolvedStylistId = anyS.rows[0].id;
        }
      } catch {}
    }

    const resourceKey = `slot:${resolvedStylistId}:${bookingDate}:${timeSlot.replace(/\s+/g, '')}`;

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
          const conflictCheck = await client.query(
            `
            SELECT id FROM bookings 
            WHERE stylist_id = $1 AND booking_date = $2 AND time_slot = $3 AND status != 'cancelled'
            LIMIT 1 FOR UPDATE;
            `,
            [resolvedStylistId, bookingDate, timeSlot]
          );

          if (conflictCheck.rows.length > 0) {
            throw new Error('ALREADY_BOOKED');
          }

          const insertRes = await client.query(
            `
            INSERT INTO bookings (
              id, customer_name, customer_email, customer_phone, 
              stylist_id, service_id, booking_date, time_slot, 
              status, total_price, notes
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, 'confirmed', $9, $10
            ) RETURNING id;
            `,
            [
              bookingId,
              customerName,
              customerEmail,
              customerPhone,
              resolvedStylistId,
              serviceId || null,
              bookingDate,
              timeSlot,
              totalPrice,
              notes || null,
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
        customerName,
        bookingDate,
        timeSlot,
        message: 'Your salon visit has been successfully confirmed!',
      });
    } finally {
      // Always release distributed lock
      await releaseLock(lock.lockKey, lock.lockToken);
    }
  });
}
