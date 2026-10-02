-- Published rankings refresh once per Beijing day; votes remain in their source tables.
CREATE TABLE IF NOT EXISTS community_daily_ranking_snapshots (
  catalog_hash TEXT PRIMARY KEY,
  refresh_day TEXT,
  payload_json TEXT CHECK(payload_json IS NULL OR json_valid(payload_json)),
  computed_at INTEGER CHECK(computed_at IS NULL OR
    (typeof(computed_at)='integer' AND computed_at BETWEEN 0 AND 8640000000000000)),
  refresh_after INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT
);
