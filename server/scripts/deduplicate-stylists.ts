import { pool } from '../src/db/pool.js';

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Fetch all stylists grouped by normalized name
    const res = await client.query(`
      SELECT 
        s.id, 
        s.name, 
        s.role, 
        s.rating, 
        s.avatar_url,
        s.bio,
        s.is_active, 
        s.created_at,
        COUNT(b.id) as booking_count
      FROM stylists s
      LEFT JOIN bookings b ON b.stylist_id = s.id
      GROUP BY s.id, s.name, s.role, s.rating, s.avatar_url, s.bio, s.is_active, s.created_at
      ORDER BY LOWER(TRIM(s.name)), booking_count DESC, s.is_active DESC, s.created_at ASC
    `);

    // Group by lower trimmed name
    const groups = new Map<string, typeof res.rows>();
    for (const row of res.rows) {
      const key = row.name.trim().toLowerCase();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }

    let remappedBookings = 0;
    let deletedStylists = 0;

    for (const [name, rows] of groups.entries()) {
      if (rows.length <= 1) continue;

      // The canonical stylist is the first one (most bookings, active, oldest created)
      const canonical = rows[0];
      const duplicates = rows.slice(1);
      const duplicateIds = duplicates.map((d) => d.id);

      console.log(`\nProcessing "${canonical.name}": canonical ID ${canonical.id} (keeps ${canonical.booking_count} bookings). Duplicates: ${duplicateIds.length}`);

      // Remap bookings
      const remapRes = await client.query(
        `UPDATE bookings SET stylist_id = $1 WHERE stylist_id = ANY($2::uuid[])`,
        [canonical.id, duplicateIds]
      );
      remappedBookings += remapRes.rowCount || 0;
      console.log(`  -> Remapped ${remapRes.rowCount} bookings to canonical ID.`);

      // Delete duplicate stylists
      const deleteRes = await client.query(
        `DELETE FROM stylists WHERE id = ANY($1::uuid[])`,
        [duplicateIds]
      );
      deletedStylists += deleteRes.rowCount || 0;
      console.log(`  -> Deleted ${deleteRes.rowCount} duplicate stylist records.`);
    }

    // 2. Add unique constraint or index so duplicates can never happen again
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_stylists_name_unique 
      ON stylists (LOWER(TRIM(name)));
    `);
    console.log(`\nCreated UNIQUE INDEX idx_stylists_name_unique on stylists(LOWER(TRIM(name))).`);

    await client.query('COMMIT');

    console.log(`\nSUCCESS:`);
    console.log(`- Remapped bookings: ${remappedBookings}`);
    console.log(`- Deleted duplicate stylists: ${deletedStylists}`);

    // Verify remaining stylists
    const remaining = await client.query(`
      SELECT s.id, s.name, s.role, s.is_active, COUNT(b.id) as booking_count
      FROM stylists s
      LEFT JOIN bookings b ON b.stylist_id = s.id
      GROUP BY s.id, s.name, s.role, s.is_active
      ORDER BY s.name
    `);
    console.log(`- Remaining stylists count: ${remaining.rows.length}`);
    console.table(remaining.rows);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error during deduplication:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
