CREATE SCHEMA IF NOT EXISTS openstream_sync;
REVOKE ALL ON SCHEMA openstream_sync FROM PUBLIC;
CREATE TABLE IF NOT EXISTS openstream_sync.budget (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  space_count integer NOT NULL DEFAULT 0 CHECK(space_count BETWEEN 0 AND 2000),
  record_count integer NOT NULL DEFAULT 0 CHECK(record_count BETWEEN 0 AND 20000),
  payload_bytes bigint NOT NULL DEFAULT 0 CHECK(payload_bytes BETWEEN 0 AND 20971520),
  next_cleanup timestamptz NOT NULL DEFAULT now()
);
INSERT INTO openstream_sync.budget(singleton) VALUES(true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS openstream_sync.spaces (
  id uuid PRIMARY KEY,
  recovery_hash text NOT NULL UNIQUE,
  slots integer NOT NULL DEFAULT 0 CHECK(slots BETWEEN 0 AND 2000),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS openstream_sync.devices (
  id uuid PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES openstream_sync.spaces(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  slot smallint CHECK(slot BETWEEN 1 AND 10),
  approved_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sync_devices_slot ON openstream_sync.devices(space_id,slot) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS sync_devices_space ON openstream_sync.devices(space_id);
CREATE TABLE IF NOT EXISTS openstream_sync.pairings (
  id uuid PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES openstream_sync.spaces(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES openstream_sync.devices(id),
  secret_hash text NOT NULL,
  join_id uuid REFERENCES openstream_sync.devices(id),
  match_code text,
  slot smallint NOT NULL CHECK(slot BETWEEN 1 AND 2),
  state text NOT NULL DEFAULT 'waiting' CHECK(state IN ('waiting','claimed','approved','cancelled')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sync_pairings_slot ON openstream_sync.pairings(space_id,slot) WHERE state IN ('waiting','claimed');
CREATE INDEX IF NOT EXISTS sync_pairings_expiry ON openstream_sync.pairings(expires_at);
CREATE TABLE IF NOT EXISTS openstream_sync.works (
  space_id uuid NOT NULL REFERENCES openstream_sync.spaces(id) ON DELETE CASCADE,
  key text NOT NULL,
  slot smallint NOT NULL CHECK(slot BETWEEN 1 AND 500),
  PRIMARY KEY(space_id,key),
  UNIQUE(space_id,slot)
);
CREATE TABLE IF NOT EXISTS openstream_sync.records (
  space_id uuid NOT NULL REFERENCES openstream_sync.spaces(id) ON DELETE CASCADE,
  bucket text NOT NULL CHECK(bucket IN ('favorite','progress','skip','preferences')),
  key text NOT NULL CHECK(length(key) BETWEEN 1 AND 160),
  slot smallint NOT NULL CHECK(slot BETWEEN 1 AND 2000),
  data jsonb,
  deleted boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  writer_id uuid NOT NULL REFERENCES openstream_sync.devices(id),
  request_id uuid,
  request_hash text,
  active_session text,
  session_owner uuid,
  last_sequence integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(space_id,slot),
  PRIMARY KEY(space_id,bucket,key)
);
CREATE TABLE IF NOT EXISTS openstream_sync.requests (
  device_id uuid NOT NULL REFERENCES openstream_sync.devices(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  request_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(device_id,request_id)
);
CREATE TABLE IF NOT EXISTS openstream_sync.rate_limits (
  key text PRIMARY KEY,
  window_at timestamptz NOT NULL,
  count integer NOT NULL
);
REVOKE ALL ON ALL TABLES IN SCHEMA openstream_sync FROM PUBLIC;
CREATE INDEX IF NOT EXISTS sync_receipts_expiry ON openstream_sync.requests(created_at);
CREATE INDEX IF NOT EXISTS sync_rate_expiry ON openstream_sync.rate_limits(window_at);
CREATE INDEX IF NOT EXISTS sync_pending_devices_expiry ON openstream_sync.devices(created_at) WHERE approved_at IS NULL;
