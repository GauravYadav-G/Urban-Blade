import { query } from '../src/db/pool.js';

async function main() {
  const email = 'admin@urbanblade.in';
  const uRes = await query('SELECT id, name, email FROM users WHERE email ILIKE $1 LIMIT 1', [email]);
  const user = uRes.rows[0];
  console.log('User found in users table:', user);

  // Link existing Master Admin orders to user ID and add email to shipping_address
  const updateRes = await query(`
    UPDATE orders 
    SET user_id = $1,
        shipping_address = jsonb_set(
          jsonb_set(
            shipping_address::jsonb,
            '{email}',
            to_jsonb($2::text)
          ),
          '{user_id}',
          to_jsonb($1::text)
        )
    WHERE (shipping_address->>'fullName' ILIKE $3 OR user_id = $1)
  `, [user.id, email, user.name]);
  console.log('Updated orders count:', updateRes.rowCount);

  // Query orders
  const oRes = await query(`
    SELECT o.id, o.user_id, o.status, o.total_amount, o.shipping_address, o.created_at
    FROM orders o
    WHERE o.user_id = $1
       OR o.shipping_address::text ILIKE '%' || $2 || '%'
       OR o.shipping_address->>'fullName' ILIKE $3
    ORDER BY o.created_at DESC
  `, [user.id, email, user.name]);

  console.log(`Found ${oRes.rows.length} orders for ${email}:`);
  for (const o of oRes.rows) {
    console.log(` - Order #${o.id.slice(0, 8)}: ₹${o.total_amount} (${o.status}) by ${o.shipping_address?.fullName} [${o.shipping_address?.email}]`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
