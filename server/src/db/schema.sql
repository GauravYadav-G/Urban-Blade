-- ─── EXTENSIONS ─────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── USERS ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  role VARCHAR(50) DEFAULT 'customer' CHECK (role IN ('customer', 'admin', 'stylist', 'vendor')),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ─── VENDOR BUSINESS ACCOUNTS ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vendors (
  id VARCHAR(120) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password TEXT NOT NULL,
  contact_person VARCHAR(255) NOT NULL,
  phone VARCHAR(50) NOT NULL,
  commission_rate NUMERIC(5, 2) NOT NULL DEFAULT 12 CHECK (commission_rate >= 0 AND commission_rate <= 100),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  payout_account JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ─── CARTS ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS carts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  version INTEGER DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_carts_user_id ON carts(user_id);

-- ─── ADDRESSES ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  full_name VARCHAR(255) NOT NULL,
  street1 VARCHAR(255) NOT NULL,
  street2 VARCHAR(255),
  city VARCHAR(100) NOT NULL,
  state VARCHAR(100) NOT NULL,
  postal_code VARCHAR(20) NOT NULL,
  phone VARCHAR(50) NOT NULL,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ─── PRODUCTS & SERVICES ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  long_description TEXT,
  highlights JSONB DEFAULT '[]'::jsonb,
  price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
  compare_at_price NUMERIC(10, 2) CHECK (compare_at_price IS NULL OR compare_at_price >= price),
  currency VARCHAR(5) DEFAULT 'INR',
  image_url TEXT NOT NULL,
  category VARCHAR(50) NOT NULL CHECK (category IN ('hair', 'beard', 'skin', 'tools', 'gifts', 'services')),
  kind VARCHAR(50) NOT NULL CHECK (kind IN ('retail', 'service', 'gift')),
  vendor VARCHAR(255) NOT NULL,
  audience VARCHAR(50) NOT NULL CHECK (audience IN ('men', 'ladies', 'unisex')),
  free_delivery BOOLEAN DEFAULT false,
  rating NUMERIC(3, 2) DEFAULT 4.5 CHECK (rating >= 0 AND rating <= 5),
  review_count INTEGER DEFAULT 0 CHECK (review_count >= 0),
  badge VARCHAR(50) CHECK (badge IS NULL OR badge IN ('deal', 'bestseller', 'new')),
  in_stock BOOLEAN DEFAULT true,
  stock_quantity INTEGER DEFAULT 100 CHECK (stock_quantity >= 0),
  stock_reserved INTEGER DEFAULT 0 CHECK (stock_reserved >= 0),
  version INTEGER DEFAULT 0 NOT NULL, -- Optimistic Concurrency Control (OCC)
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ─── STYLISTS ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stylists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  role VARCHAR(100) NOT NULL,
  avatar_url TEXT NOT NULL,
  bio TEXT,
  rating NUMERIC(3, 2) DEFAULT 4.9,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ─── BOOKINGS (SALON APPOINTMENTS) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  customer_name VARCHAR(255) NOT NULL,
  customer_email VARCHAR(255),
  customer_phone VARCHAR(50),
  stylist_id UUID REFERENCES stylists(id) ON DELETE SET NULL,
  service_id UUID REFERENCES products(id) ON DELETE SET NULL,
  visit_type VARCHAR(20) NOT NULL DEFAULT 'salon' CHECK (visit_type IN ('salon', 'home')),
  service_address TEXT,
  booking_date DATE NOT NULL,
  time_slot VARCHAR(20) NOT NULL,
  status VARCHAR(20) DEFAULT 'confirmed' CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed')),
  total_price NUMERIC(10, 2) NOT NULL,
  notes TEXT,
  version INTEGER DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS visit_type VARCHAR(20) NOT NULL DEFAULT 'salon';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS service_address TEXT;
ALTER TABLE bookings ALTER COLUMN customer_email DROP NOT NULL;

-- ─── ORDERS (ACID ASYNC SAGA) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  idempotency_key VARCHAR(100) UNIQUE,
  status VARCHAR(30) DEFAULT 'accepted' CHECK (status IN ('accepted', 'processing', 'confirmed', 'shipped', 'delivered', 'cancelled')),
  subtotal NUMERIC(10, 2) NOT NULL,
  shipping_fee NUMERIC(10, 2) DEFAULT 0,
  total_amount NUMERIC(10, 2) NOT NULL,
  currency VARCHAR(5) DEFAULT 'INR',
  shipping_address JSONB NOT NULL,
  payment_method VARCHAR(50) DEFAULT 'cash_on_delivery',
  payment_status VARCHAR(30) DEFAULT 'pending' CHECK (payment_status IN ('pending', 'captured', 'refunded', 'failed')),
  transaction_id VARCHAR(255),
  razorpay_payment_id VARCHAR(255),
  razorpay_signature VARCHAR(255),
  payment_verification_started_at TIMESTAMPTZ,
  refund_status VARCHAR(30),
  refund_id VARCHAR(255),
  refund_receipt VARCHAR(100),
  refund_amount NUMERIC(10, 2),
  refund_reason TEXT,
  refund_requested_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  refund_failure_reason TEXT,
  coupon_code VARCHAR(100),
  discount_amount NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  tracking_number VARCHAR(255),
  carrier VARCHAR(120),
  notes TEXT,
  version INTEGER DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Index for idempotency key lookups
CREATE INDEX IF NOT EXISTS idx_orders_idempotency_key ON orders(idempotency_key);


-- ─── STOCK RESERVATION LEDGER (PAYMENT-FIRST TTL SOURCE OF TRUTH) ────────────
-- One row per (order, product) unit hold. products.stock_reserved is the
-- aggregate; this table is the authoritative per-reservation record that the
-- TTL reaper and the commit/release paths consume. Status transitions are
-- one-way (active -> committed | released), which makes every stock mutation
-- idempotent: re-running a release or a commit matches zero rows and is a no-op.
CREATE TABLE IF NOT EXISTS stock_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'committed', 'released')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMPTZ,
  UNIQUE (order_id, product_id)
);

-- Drives the TTL sweep: only live holds, ordered by age.
CREATE INDEX IF NOT EXISTS idx_stock_reservations_active_created
  ON stock_reservations (created_at)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_stock_reservations_order_status
  ON stock_reservations (order_id, status);
CREATE INDEX IF NOT EXISTS idx_stock_reservations_product
  ON stock_reservations (product_id)
  WHERE status = 'active';

-- ─── IDEMPOTENT COMPAT MIGRATIONS (ADDITIVE ONLY) ────────────────────────────
-- CREATE TABLE IF NOT EXISTS is a no-op against a pre-existing table, so columns
-- introduced later MUST be added with ALTER ... ADD COLUMN IF NOT EXISTS, or they
-- silently never exist on already-provisioned databases.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS transaction_id VARCHAR(255);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(100);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_number VARCHAR(255);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS carrier VARCHAR(120);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS razorpay_payment_id VARCHAR(255);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS razorpay_signature VARCHAR(255);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_verification_started_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_status VARCHAR(30);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_id VARCHAR(255);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_receipt VARCHAR(100);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_amount NUMERIC(10, 2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_reason TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_requested_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_failure_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_orders_razorpay_payment_id ON orders(razorpay_payment_id);

-- Contact number a customer saves on their profile (used for carrier OTP and
-- appointment reminders). Provisioned databases created before this column must
-- receive it too, otherwise PATCH /auth/profile fails and every account silently
-- falls back to whatever placeholder the UI happens to render.
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20);

-- Payment-first inventory hold counter. Referenced by every order path, so it
-- must exist on databases provisioned before the column was introduced.
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_reserved INTEGER NOT NULL DEFAULT 0;

-- ADD CONSTRAINT has no IF NOT EXISTS form; swallow the duplicate error so the
-- migration stays re-runnable.
DO $$
BEGIN
  ALTER TABLE products
    ADD CONSTRAINT products_stock_reserved_check CHECK (stock_reserved >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;

-- Support index for the reservation-aware product availability lookup.
CREATE INDEX IF NOT EXISTS idx_products_availability ON products (stock_quantity, stock_reserved);

-- ─── ORDER ITEMS ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  product_name VARCHAR(255) NOT NULL,
  unit_price NUMERIC(10, 2) NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  image_url TEXT
);

-- ─── MARKETPLACE PRICE COMPARISON ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketplace_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  marketplace VARCHAR(50) NOT NULL CHECK (marketplace IN ('amazon', 'flipkart', 'nykaa', 'purplle', 'meesho', 'jiomart', 'bigbasket', 'blinkit', 'zepto', 'other')),
  url TEXT NOT NULL,
  price NUMERIC(10, 2),
  currency VARCHAR(5) DEFAULT 'INR',
  last_checked TIMESTAMPTZ,
  check_status VARCHAR(20) DEFAULT 'pending' CHECK (check_status IN ('pending', 'success', 'failed', 'rate_limited')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, marketplace)
);

CREATE INDEX IF NOT EXISTS idx_marketplace_links_product_id ON marketplace_links(product_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_links_marketplace ON marketplace_links(marketplace);
CREATE INDEX IF NOT EXISTS idx_marketplace_links_last_checked ON marketplace_links(last_checked);

-- ─── COUPON USAGES ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coupon_usages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_code VARCHAR(100) NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  discount_amount NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_coupon_usages_coupon_code ON coupon_usages(coupon_code);
CREATE INDEX IF NOT EXISTS idx_coupon_usages_user_id ON coupon_usages(user_id);
CREATE INDEX IF NOT EXISTS idx_coupon_usages_order_id ON coupon_usages(order_id);

-- ─── DB MIGRATIONS TRACKING ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(50) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  applied_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  checksum VARCHAR(64)
);

-- Initial migration record
INSERT INTO schema_migrations (version, name, checksum)
VALUES ('1.0.0', 'initial_schema', 'initial')
ON CONFLICT (version) DO NOTHING;

-- Authentication requires one rotating refresh token per account.
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS revoked_access_tokens (
  token_hash CHAR(64) PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revoked_access_expiry ON revoked_access_tokens(expires_at);

-- Shared, server-authoritative checkout settings and coupon definitions.
CREATE TABLE IF NOT EXISTS site_settings (id TEXT PRIMARY KEY, value JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), code VARCHAR(100) NOT NULL UNIQUE,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percentage','fixed')),
  discount_value NUMERIC(12,2) NOT NULL CHECK (discount_value > 0),
  min_order_value NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (min_order_value >= 0),
  max_discount_amount NUMERIC(12,2), is_active BOOLEAN NOT NULL DEFAULT TRUE,
  description TEXT NOT NULL DEFAULT '', expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_inclusive BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_rate_percent NUMERIC(5,2) NOT NULL DEFAULT 0;
-- A restored reservation records a cancelled sale; manual orders have no ledger.
ALTER TABLE stock_reservations DROP CONSTRAINT IF EXISTS stock_reservations_status_check;
ALTER TABLE stock_reservations ADD CONSTRAINT stock_reservations_status_check CHECK (status IN ('active','committed','released','restored'));

CREATE TABLE IF NOT EXISTS checkout_requests (
  key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, status INTEGER NOT NULL,
  body JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS support_inquiries (
  id TEXT PRIMARY KEY, user_name TEXT NOT NULL, user_email TEXT NOT NULL,
  subject TEXT NOT NULL, order_id TEXT, vendor_name TEXT,
  status TEXT NOT NULL DEFAULT 'open', priority TEXT NOT NULL DEFAULT 'medium',
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_support_inquiries_owner ON support_inquiries(LOWER(user_email));
CREATE TABLE IF NOT EXISTS admin_tasks (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  assignee TEXT, priority TEXT DEFAULT 'medium', status TEXT DEFAULT 'pending',
  due_date TEXT, related_user TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Full-order returns are reviewed and physically received before reimbursement.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS return_status VARCHAR(20)
  CHECK (return_status IN ('requested', 'approved', 'rejected', 'received'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS return_reason TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS return_review_note TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS return_requested_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS return_received_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_external_reference VARCHAR(150);
CREATE TABLE IF NOT EXISTS vendor_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id VARCHAR(120) NOT NULL REFERENCES vendors(id),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  reference VARCHAR(150) NOT NULL UNIQUE,
  notes TEXT NOT NULL DEFAULT '',
  recorded_by UUID NOT NULL REFERENCES users(id),
  provider VARCHAR(40) NOT NULL DEFAULT 'manual',
  provider_transfer_id VARCHAR(150),
  provider_status VARCHAR(30) NOT NULL DEFAULT 'manual_recorded',
  failure_reason TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE vendor_payouts ADD COLUMN IF NOT EXISTS provider VARCHAR(40) NOT NULL DEFAULT 'manual';
ALTER TABLE vendor_payouts ADD COLUMN IF NOT EXISTS provider_transfer_id VARCHAR(150);
ALTER TABLE vendor_payouts ADD COLUMN IF NOT EXISTS provider_status VARCHAR(30) NOT NULL DEFAULT 'manual_recorded';
ALTER TABLE vendor_payouts ADD COLUMN IF NOT EXISTS failure_reason TEXT;
ALTER TABLE vendor_payouts ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_payouts_provider_transfer_id
  ON vendor_payouts(provider_transfer_id) WHERE provider_transfer_id IS NOT NULL;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_reconciliation_error TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_checked_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS gateway_payments (
  id VARCHAR(100) PRIMARY KEY,
  gateway_order_id VARCHAR(100),
  status VARCHAR(30) NOT NULL,
  amount_paise BIGINT NOT NULL CHECK (amount_paise >= 0),
  refunded_paise BIGINT NOT NULL DEFAULT 0 CHECK (refunded_paise >= 0),
  currency VARCHAR(5) NOT NULL,
  fee_paise BIGINT,
  tax_paise BIGINT,
  method VARCHAR(50),
  provider_created_at TIMESTAMPTZ NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS gateway_payments_order_idx ON gateway_payments(gateway_order_id);
CREATE INDEX IF NOT EXISTS gateway_payments_created_idx ON gateway_payments(provider_created_at);
CREATE TABLE IF NOT EXISTS stock_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id),
  actor_id UUID NOT NULL REFERENCES users(id),
  delta INTEGER NOT NULL,
  quantity_before INTEGER NOT NULL,
  quantity_after INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Durable fulfilment observations and operator changes; never a payment ledger.
CREATE TABLE IF NOT EXISTS order_fulfilment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (source IN ('admin','carrier_api')),
  previous_status TEXT NOT NULL,
  resulting_status TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fulfilment_events_order ON order_fulfilment_events(order_id,created_at DESC);

-- Verified carrier snapshots and durable scheduling shared by all API workers.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_data JSONB;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_checked_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_next_check_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_error TEXT;
CREATE INDEX IF NOT EXISTS idx_orders_tracking_due ON orders(tracking_next_check_at)
  WHERE tracking_number IS NOT NULL AND status IN ('processing', 'shipped');

CREATE OR REPLACE FUNCTION reset_order_tracking() RETURNS trigger AS $$
BEGIN
  IF NEW.tracking_number IS DISTINCT FROM OLD.tracking_number OR NEW.carrier IS DISTINCT FROM OLD.carrier THEN
    NEW.tracking_data := NULL;
    NEW.tracking_checked_at := NULL;
    NEW.tracking_next_check_at := NOW();
    NEW.tracking_failures := 0;
    NEW.tracking_error := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS reset_order_tracking ON orders;
CREATE TRIGGER reset_order_tracking BEFORE UPDATE OF tracking_number, carrier ON orders
  FOR EACH ROW EXECUTE FUNCTION reset_order_tracking();

-- Tokens submitted through the admin UI are encrypted with an environment-owned key.
CREATE TABLE IF NOT EXISTS carrier_connections (
  carrier TEXT PRIMARY KEY CHECK (carrier = 'delhivery'),
  token_ciphertext TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  auto_assign BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE carrier_connections ADD COLUMN IF NOT EXISTS booking_settings JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipment_booking_state TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipment_booking_error TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipment_booking_started_at TIMESTAMPTZ;
