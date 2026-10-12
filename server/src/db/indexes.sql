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
CREATE INDEX IF NOT EXISTS idx_bookings_visit_schedule
  ON bookings(visit_type, booking_date, status, time_slot);

-- ─── ORDER LOOKUPS & USER HISTORY ───────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_tracking_number ON orders(tracking_number) WHERE tracking_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_expired_payment_holds
  ON orders(created_at, payment_verification_started_at)
  WHERE status = 'accepted' AND payment_status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_refund_id
  ON orders(refund_id) WHERE refund_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_pending_refunds
  ON orders(refund_requested_at) WHERE refund_status = 'pending';
CREATE INDEX IF NOT EXISTS idx_products_vendor_lower ON products(LOWER(vendor));
CREATE INDEX IF NOT EXISTS idx_vendors_email_lower ON vendors(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_orders_idempotency ON orders(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stylists_name_unique ON stylists(LOWER(TRIM(name)));
