-- ─── FULL-TEXT SEARCH GIN INDEX (SUB-5MS TEXT SEARCH) ──────────────────────
CREATE INDEX IF NOT EXISTS idx_products_fts ON products USING gin(
  to_tsvector('english', name || ' ' || description || ' ' || vendor || ' ' || category)
);

-- ─── COMPOSITE B-TREE INDEXES FOR CATALOG FILTERING & SORTING ───────────────
CREATE INDEX IF NOT EXISTS idx_products_cat_price ON products(category, price ASC);
CREATE INDEX IF NOT EXISTS idx_products_cat_rating ON products(category, rating DESC);
CREATE INDEX IF NOT EXISTS idx_products_audience ON products(audience);
CREATE INDEX IF NOT EXISTS idx_products_slug ON products(slug);

-- ─── PARTIAL INDEX FOR DEALS & BESTSELLERS (TINY MEMORY FOOTPRINT) ──────────
CREATE INDEX IF NOT EXISTS idx_products_deals ON products(price ASC) 
  WHERE compare_at_price IS NOT NULL AND compare_at_price > price;

CREATE INDEX IF NOT EXISTS idx_products_bestseller ON products(review_count DESC)
  WHERE badge = 'bestseller';

-- ─── PREVENT DOUBLE-BOOKING AT THE DATABASE LEVEL ───────────────────────────
-- Ensures a stylist can never have two active appointments at the same date & time slot
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_booking 
  ON bookings(stylist_id, booking_date, time_slot) 
  WHERE status != 'cancelled';

-- ─── ORDER LOOKUPS & USER HISTORY ───────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_idempotency ON orders(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
