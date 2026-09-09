-- ─── EXTENSIONS ─────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── USERS ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'customer' CHECK (role IN ('customer', 'admin', 'stylist')),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

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
  version INTEGER DEFAULT 0 NOT NULL, -- Optimistic Concurrency Control (OCC)
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ─── STYLISTS ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stylists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
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
  customer_email VARCHAR(255) NOT NULL,
  customer_phone VARCHAR(50),
  stylist_id UUID REFERENCES stylists(id) ON DELETE SET NULL,
  service_id UUID REFERENCES products(id) ON DELETE SET NULL,
  booking_date DATE NOT NULL,
  time_slot VARCHAR(20) NOT NULL,
  status VARCHAR(20) DEFAULT 'confirmed' CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed')),
  total_price NUMERIC(10, 2) NOT NULL,
  notes TEXT,
  version INTEGER DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

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
  version INTEGER DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

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
