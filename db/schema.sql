CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  client_name TEXT NOT NULL DEFAULT '',
  client_address TEXT NOT NULL DEFAULT '',
  client_email TEXT NOT NULL DEFAULT '',
  client_phone TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rooms (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS items (
  id SERIAL PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'Other',
  item TEXT NOT NULL DEFAULT '',
  vendor TEXT NOT NULL DEFAULT '',
  sku TEXT NOT NULL DEFAULT '',
  finish TEXT NOT NULL DEFAULT '',
  dims TEXT NOT NULL DEFAULT '',
  qty NUMERIC NOT NULL DEFAULT 1,
  trade_cost NUMERIC NOT NULL DEFAULT 0,
  markup_pct NUMERIC NOT NULL DEFAULT 0,
  markup_amt NUMERIC NOT NULL DEFAULT 0,
  trade_tax_pct NUMERIC NOT NULL DEFAULT 0,
  client_tax_pct NUMERIC NOT NULL DEFAULT 0,
  shipping_cost NUMERIC NOT NULL DEFAULT 0,
  shipping_markup_pct NUMERIC NOT NULL DEFAULT 0,
  shipping_markup_amt NUMERIC NOT NULL DEFAULT 0,
  receiving_cost NUMERIC NOT NULL DEFAULT 0,
  receiving_markup_pct NUMERIC NOT NULL DEFAULT 0,
  lead_time TEXT NOT NULL DEFAULT 'TBD',
  status TEXT NOT NULL DEFAULT 'Considering',
  image_url TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  include_on_invoice BOOLEAN NOT NULL DEFAULT false,
  invoiced_id TEXT NOT NULL DEFAULT '',
  po_id TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL,
  date TEXT NOT NULL,
  total NUMERIC NOT NULL DEFAULT 0,
  item_count INTEGER NOT NULL DEFAULT 0,
  paid_amount NUMERIC NOT NULL DEFAULT 0,
  paid_at TIMESTAMPTZ,
  qb_invoice_id TEXT,
  qb_customer_id TEXT,
  qb_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_amount NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS qb_invoice_id TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS qb_customer_id TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS qb_synced_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS purchase_orders (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  po_number TEXT NOT NULL,
  vendor TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  total NUMERIC NOT NULL DEFAULT 0,
  item_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finance_entries (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  date TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS budget_buckets (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  percentage NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A tear sheet share is a snapshot (not a live link to items) so what the client
-- sees and signs stays stable even if the schedule changes afterward — same
-- reasoning as invoices/POs stamping their own totals at creation time.
CREATE TABLE IF NOT EXISTS tear_sheet_shares (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  token TEXT NOT NULL UNIQUE,
  project_name TEXT NOT NULL DEFAULT '',
  items JSONB NOT NULL DEFAULT '[]',
  signer_name TEXT NOT NULL DEFAULT '',
  signature TEXT NOT NULL DEFAULT '',
  signed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Single-row-in-practice: this app connects to exactly one QuickBooks company at a
-- time (matches the single-user model). A fresh connect replaces the row entirely.
CREATE TABLE IF NOT EXISTS quickbooks_connection (
  id SERIAL PRIMARY KEY,
  realm_id TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  access_token_expires_at TIMESTAMPTZ NOT NULL,
  company_name TEXT NOT NULL DEFAULT '',
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rooms_project_id ON rooms(project_id);
CREATE INDEX IF NOT EXISTS idx_items_room_id ON items(room_id);
CREATE INDEX IF NOT EXISTS idx_invoices_project_id ON invoices(project_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_project_id ON purchase_orders(project_id);
CREATE INDEX IF NOT EXISTS idx_finance_entries_project_id ON finance_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_tear_sheet_shares_token ON tear_sheet_shares(token);
CREATE INDEX IF NOT EXISTS idx_tear_sheet_shares_project_id ON tear_sheet_shares(project_id);
