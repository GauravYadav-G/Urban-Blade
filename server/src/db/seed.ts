import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { pool, checkDbHealth } from './pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function seedDatabase(): Promise<boolean> {
  console.log('🔄 Checking database connection before seeding...');
  const health = await checkDbHealth();
  if (!health.ok) {
    console.error('❌ Cannot connect to PostgreSQL:', health.error);
    return false;
  }

  const client = await pool.connect();
  try {
    console.log('🌱 Starting database seeding...');

    // 1. Seed Demo & Master Admin Users
    const demoPasswordHash = await bcrypt.hash('Blade@123', 10);
    await client.query(
      `
      INSERT INTO users (email, password_hash, name, role)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (email) 
      DO UPDATE SET password_hash = EXCLUDED.password_hash, name = EXCLUDED.name, role = EXCLUDED.role
      RETURNING id, email, name;
      `,
      ['demo@urbanblade.in', demoPasswordHash, 'Demo Guest', 'customer']
    );
    console.log('✅ Demo user seeded: demo@urbanblade.in / Blade@123');

    const adminPasswordHash = await bcrypt.hash('Admin@2026', 10);
    await client.query(
      `
      INSERT INTO users (email, password_hash, name, role)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (email) 
      DO UPDATE SET password_hash = EXCLUDED.password_hash, name = EXCLUDED.name, role = EXCLUDED.role
      RETURNING id, email, name;
      `,
      ['admin@urbanblade.in', adminPasswordHash, 'Master Admin', 'admin']
    );
    console.log('✅ Admin user seeded: admin@urbanblade.in / Admin@2026');

    // 2. Seed Stylists
    const stylists = [
      {
        name: 'Vikram Sharma',
        role: 'Master Barber & Stylist',
        avatar_url: '/images/stylists/vikram.jpg',
        bio: 'Over 12 years of luxury salon styling and beard sculpting expertise.',
        rating: 4.95,
      },
      {
        name: 'Rohan Verma',
        role: 'Senior Hair Specialist',
        avatar_url: '/images/stylists/rohan.jpg',
        bio: 'Specialist in modern fades, precision cuts, and scalp treatments.',
        rating: 4.88,
      },
      {
        name: 'Ayesha Khan',
        role: 'Skin & Grooming Expert',
        avatar_url: '/images/stylists/ayesha.jpg',
        bio: 'Certified esthetician focusing on detox facials, beard spas, and skin repair.',
        rating: 4.92,
      },
    ];

    for (const s of stylists) {
      await client.query(
        `
        INSERT INTO stylists (name, role, avatar_url, bio, rating)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT DO NOTHING;
        `,
        [s.name, s.role, s.avatar_url, s.bio, s.rating]
      );
    }
    console.log(`✅ ${stylists.length} salon stylists seeded.`);

    // 3. Seed Products
    const productsRaw = fs.readFileSync(path.resolve(__dirname, 'products.seed.json'), 'utf-8');
    const products = JSON.parse(productsRaw);

    for (const p of products) {
      await client.query(
        `
        INSERT INTO products (
          slug, name, description, long_description, highlights, 
          price, compare_at_price, currency, image_url, category, 
          kind, vendor, audience, free_delivery, rating, review_count, 
          badge, in_stock, stock_quantity, version
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 
          $11, $12, $13, $14, $15, $16, $17, $18, $19, 0
        )
        ON CONFLICT (slug) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          long_description = EXCLUDED.long_description,
          highlights = EXCLUDED.highlights,
          price = EXCLUDED.price,
          compare_at_price = EXCLUDED.compare_at_price,
          image_url = EXCLUDED.image_url,
          category = EXCLUDED.category,
          kind = EXCLUDED.kind,
          vendor = EXCLUDED.vendor,
          audience = EXCLUDED.audience,
          free_delivery = EXCLUDED.free_delivery,
          rating = EXCLUDED.rating,
          review_count = EXCLUDED.review_count,
          badge = EXCLUDED.badge,
          in_stock = EXCLUDED.in_stock,
          stock_quantity = EXCLUDED.stock_quantity;
        `,
        [
          p.slug || p.id,
          p.name,
          p.description,
          p.longDescription || p.description,
          JSON.stringify(p.highlights || []),
          p.price,
          p.compareAtPrice || null,
          p.currency || 'INR',
          p.imageUrl,
          p.category,
          p.kind || 'retail',
          p.vendor || 'Urban Blade',
          p.audience || 'unisex',
          p.freeDelivery ?? true,
          p.rating || 4.5,
          p.reviewCount || 10,
          p.badge || null,
          p.inStock ?? true,
          100, // Stock quantity
        ]
      );
    }
    console.log(`✅ ${products.length} products & services seeded successfully.`);

    return true;
  } catch (err: any) {
    console.error('❌ Database seeding failed:', err.message);
    return false;
  } finally {
    client.release();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seedDatabase()
    .then((ok) => {
      pool.end();
      process.exit(ok ? 0 : 1);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
