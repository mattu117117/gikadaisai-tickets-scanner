CREATE SEQUENCE IF NOT EXISTS session_number_seq START 1;

CREATE TABLE IF NOT EXISTS stores (
  store_id text PRIMARY KEY,
  store_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS staff (
  staff_id text PRIMARY KEY,
  staff_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS sessions (
  process_id text PRIMARY KEY,
  store_id text NOT NULL REFERENCES stores(store_id),
  store_name text NOT NULL,
  staff_name text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  ticket_count integer NOT NULL DEFAULT 0,
  total_amount integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT '処理中' CHECK (status IN ('処理中', '完了', '取消'))
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_session_per_store
  ON sessions(store_id) WHERE status = '処理中';

CREATE TABLE IF NOT EXISTS tickets (
  management_id text PRIMARY KEY,
  category text NOT NULL,
  source_id text NOT NULL,
  serial_no text NOT NULL,
  recipient text NOT NULL DEFAULT '',
  amount integer NOT NULL CHECK (amount >= 0),
  status text NOT NULL DEFAULT '未使用' CHECK (status IN ('未使用', '使用済み')),
  used_store text,
  used_at timestamptz,
  confirmed_by text,
  process_id text REFERENCES sessions(process_id)
);

CREATE TABLE IF NOT EXISTS usage_logs (
  id bigserial PRIMARY KEY,
  used_at timestamptz NOT NULL DEFAULT now(),
  management_id text NOT NULL REFERENCES tickets(management_id),
  amount integer NOT NULL,
  store_name text NOT NULL,
  confirmed_by text NOT NULL,
  process_id text NOT NULL REFERENCES sessions(process_id)
);

CREATE INDEX IF NOT EXISTS usage_logs_management_id_idx ON usage_logs(management_id);
CREATE INDEX IF NOT EXISTS usage_logs_process_id_idx ON usage_logs(process_id);

CREATE TABLE IF NOT EXISTS cancellations (
  id bigserial PRIMARY KEY,
  cancelled_at timestamptz NOT NULL DEFAULT now(),
  management_id text NOT NULL,
  amount integer NOT NULL,
  original_store text NOT NULL,
  original_used_at timestamptz,
  original_confirmed_by text NOT NULL,
  original_process_id text NOT NULL,
  cancelled_by text NOT NULL,
  reason text NOT NULL
);
