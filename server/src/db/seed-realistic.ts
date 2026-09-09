import bcrypt from 'bcryptjs';
import { pool, checkDbHealth } from './pool.js';

export async function seedRealisticData(): Promise<boolean> {
  console.log('🔄 Checking database connection before realistic seeding...');
  const health = await checkDbHealth();
  if (!health.ok) {
    console.error('❌ Cannot connect to PostgreSQL:', health.error);
    return false;
  }

  const client = await pool.connect();
  try {
    console.log('🌱 Starting Realistic Production Database Seeding...');

    // ─── 1. FETCH STYLISTS & PRODUCTS ──────────────────────────────────────────
    const prodRes = await client.query('SELECT id, name, price, image_url, slug FROM products LIMIT 30');
    const products = prodRes.rows;
    if (products.length === 0) {
      console.error('❌ No products found in database. Run base seed first.');
      return false;
    }

    const stylistRes = await client.query('SELECT id, name FROM stylists');
    const stylists = stylistRes.rows;

    // ─── 2. SEED REALISTIC USERS ──────────────────────────────────────────────
    const demoPasswordHash = await bcrypt.hash('Blade@123', 10);
    const usersToSeed = [
      { name: 'Demo Guest', email: 'demo@urbanblade.in', role: 'admin', phone: '9015618265' },
      { name: 'Vikram Sharma', email: 'vikram@urbanblade.in', role: 'stylist', phone: '9811002233' },
      { name: 'Rohan Verma', email: 'rohan@urbanblade.in', role: 'stylist', phone: '9822114455' },
      { name: 'Ayesha Khan', email: 'ayesha@urbanblade.in', role: 'stylist', phone: '9833225566' },
      { name: 'Rahul Mehra', email: 'rahul.mehra@gmail.com', role: 'customer', phone: '9876543210' },
      { name: 'Pooja Verma', email: 'pooja.verma@outlook.com', role: 'customer', phone: '9811223344' },
      { name: 'Aman Dixit', email: 'aman.dixit@gmail.com', role: 'customer', phone: '9015618265' },
      { name: 'Sneha Kapoor', email: 'sneha.k@yahoo.com', role: 'customer', phone: '9988776655' },
      { name: 'Karan Singhal', email: 'karan.s@gmail.com', role: 'customer', phone: '9765432109' },
      { name: 'Neha Sharma', email: 'neha.sharma@gmail.com', role: 'customer', phone: '9654321098' },
      { name: 'Arjun Das', email: 'arjun.das@live.com', role: 'customer', phone: '9543210987' },
      { name: 'Divya Iyer', email: 'divya.iyer@gmail.com', role: 'customer', phone: '9432109876' },
      { name: 'Rajat Nair', email: 'rajat.nair@hotmail.com', role: 'customer', phone: '9321098765' },
      { name: 'Simran Kaur', email: 'simran.kaur@gmail.com', role: 'customer', phone: '9210987654' },
    ];

    const seededUsers: Record<string, string> = {};
    for (const u of usersToSeed) {
      const res = await client.query(
        `
        INSERT INTO users (email, password_hash, name, role)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role
        RETURNING id, email;
        `,
        [u.email, demoPasswordHash, u.name, u.role]
      );
      seededUsers[u.email] = res.rows[0].id;
    }
    console.log(`✅ ${usersToSeed.length} users seeded / verified.`);

    // ─── 3. SEED REALISTIC ORDERS & ITEMS ─────────────────────────────────────
    // Clear old test orders to avoid duplicates
    await client.query('DELETE FROM order_items');
    await client.query('DELETE FROM orders');

    const indianAddresses = [
      { fullName: 'Aman Dixit', street: 'Flat 402, Lotus Isle, Sector 12', city: 'Noida', postalCode: '201301', phone: '9015618265' },
      { fullName: 'Pooja Verma', street: 'B-14 DLF Phase 1', city: 'Gurugram', postalCode: '122002', phone: '9811223344' },
      { fullName: 'Rahul Mehra', street: 'Flat 12B, Regency Park', city: 'South Delhi', postalCode: '110048', phone: '9876543210' },
      { fullName: 'Sneha Kapoor', street: '104 Raheja Classique, Andheri West', city: 'Mumbai', postalCode: '400053', phone: '9988776655' },
      { fullName: 'Karan Singhal', street: 'Villa 8, Prestige Silver Oak, Whitefield', city: 'Bengaluru', postalCode: '560066', phone: '9765432109' },
      { fullName: 'Neha Sharma', street: 'Tower C, Jaypee Greens, Wishtown', city: 'Noida', postalCode: '201304', phone: '9654321098' },
      { fullName: 'Arjun Das', street: 'Plot 45, Jubilee Hills', city: 'Hyderabad', postalCode: '500033', phone: '9543210987' },
      { fullName: 'Divya Iyer', street: 'A-201 Sobha Malachite, Jayanagar', city: 'Bengaluru', postalCode: '560011', phone: '9432109876' },
      { fullName: 'Rajat Nair', street: 'Penthouse 16, Blue Ridge, Hinjawadi', city: 'Pune', postalCode: '411057', phone: '9321098765' },
      { fullName: 'Simran Kaur', street: 'Block M, Greater Kailash II', city: 'New Delhi', postalCode: '110048', phone: '9210987654' },
    ];

    const orderStages: Array<'accepted' | 'processing' | 'shipped' | 'delivered' | 'cancelled'> = [
      'accepted', 'accepted', 'accepted',
      'processing', 'processing', 'processing', 'processing',
      'shipped', 'shipped', 'shipped', 'shipped', 'shipped',
      'delivered', 'delivered', 'delivered', 'delivered', 'delivered', 'delivered', 'delivered', 'delivered',
      'cancelled'
    ];

    const paymentMethods = ['upi', 'upi', 'card', 'card', 'cash_on_delivery'];

    console.log('📦 Seeding 32 realistic customer orders spanning 14 days...');

    // Generate 32 realistic orders across the past 14 days
    for (let i = 0; i < 32; i++) {
      const addr = indianAddresses[i % indianAddresses.length];
      const customerEmail = usersToSeed[4 + (i % (usersToSeed.length - 4))].email;
      const userId = seededUsers[customerEmail];
      const status = orderStages[i % orderStages.length];
      const paymentMethod = paymentMethods[i % paymentMethods.length];
      const paymentStatus = status === 'cancelled' ? 'refunded' : paymentMethod === 'cash_on_delivery' && status !== 'delivered' ? 'pending' : 'captured';

      // Distribute creation time: first 6 today, next 8 yesterday, others over last 14 days
      let hoursAgo = i < 6 ? i * 2 : i < 14 ? 24 + (i - 6) * 3 : (i - 10) * 16;
      const createdAt = new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString();

      // Pick 1 to 3 products for this order
      const prod1 = products[i % products.length];
      const prod2 = products[(i + 3) % products.length];
      const hasSecondItem = i % 2 === 0;

      const qty1 = (i % 2) + 1;
      const qty2 = hasSecondItem ? 1 : 0;
      const subtotal = (prod1.price * qty1) + (hasSecondItem ? prod2.price * qty2 : 0);
      const totalAmount = subtotal;

      const orderRes = await client.query(
        `
        INSERT INTO orders (
          user_id, status, subtotal, total_amount, currency,
          payment_method, payment_status, shipping_address, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, 'INR', $5, $6, $7, $8, $8
        )
        RETURNING id;
        `,
        [
          userId,
          status,
          subtotal,
          totalAmount,
          paymentMethod,
          paymentStatus,
          JSON.stringify(addr),
          createdAt,
        ]
      );
      const orderId = orderRes.rows[0].id;

      // Insert Order Item 1
      await client.query(
        `
        INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, image_url)
        VALUES ($1, $2, $3, $4, $5, $6);
        `,
        [orderId, prod1.id, prod1.name, prod1.price, qty1, prod1.image_url]
      );

      // Insert Order Item 2 if applicable
      if (hasSecondItem) {
        await client.query(
          `
          INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, image_url)
          VALUES ($1, $2, $3, $4, $5, $6);
          `,
          [orderId, prod2.id, prod2.name, prod2.price, qty2, prod2.image_url]
        );
      }
    }
    console.log('✅ 32 realistic orders & line items seeded into PostgreSQL.');

    // ─── 4. SEED REALISTIC APPOINTMENTS / BOOKINGS ───────────────────────────
    await client.query('DELETE FROM bookings');

    const appointmentTemplates = [
      { service: 'Skin-Fade Haircut & Beard Lineup', duration: 45, price: 499 },
      { service: 'Charcoal Detox Facial & Hot Towel Shave', duration: 60, price: 999 },
      { service: 'Organic Moroccan Hair Spa & Scalp Detox', duration: 60, price: 1299 },
      { service: 'Royal Grooming Package (Hair, Beard & Face Glow)', duration: 90, price: 1999 },
      { service: 'Executive Beard Sculpting & Razor Edge', duration: 30, price: 399 },
      { service: 'Deep Conditioning & Scalp Massage', duration: 45, price: 699 },
    ];

    const timeSlots = [
      '10:00 AM', '11:00 AM', '12:00 PM', '02:00 PM', 
      '03:30 PM', '04:30 PM', '05:30 PM', '07:00 PM'
    ];

    console.log('💈 Seeding 18 realistic appointments...');

    for (let j = 0; j < 18; j++) {
      const stylist = stylists[j % stylists.length];
      const template = appointmentTemplates[j % appointmentTemplates.length];
      const timeSlot = timeSlots[j % timeSlots.length];
      const customer = usersToSeed[4 + (j % (usersToSeed.length - 4))];

      // Schedule: first 6 today, next 6 tomorrow, rest past
      const dayOffset = j < 6 ? 0 : j < 12 ? 1 : -(j - 11);
      const bookingDate = new Date(Date.now() + dayOffset * 86400 * 1000).toISOString().split('T')[0];

      let bookingStatus: 'confirmed' | 'completed' | 'cancelled' = 'confirmed';
      if (dayOffset < 0) {
        bookingStatus = j % 5 === 0 ? 'cancelled' : 'completed';
      }

      await client.query(
        `
        INSERT INTO bookings (
          stylist_id, customer_name, customer_email, customer_phone,
          booking_date, time_slot, status, total_price, notes
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9
        );
        `,
        [
          stylist.id,
          customer.name,
          customer.email,
          customer.phone,
          bookingDate,
          timeSlot,
          bookingStatus,
          template.price,
          template.service,
        ]
      );
    }
    console.log('✅ 18 salon appointments seeded with real stylists and services.');

    console.log('🎉 Realistic Production Database Seeding Complete!');
    return true;
  } catch (err: any) {
    console.error('❌ Realistic database seeding failed:', err.message);
    return false;
  } finally {
    client.release();
  }
}

if (process.argv[1]?.includes('seed-realistic')) {
  seedRealisticData()
    .then((ok) => {
      pool.end();
      process.exit(ok ? 0 : 1);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
