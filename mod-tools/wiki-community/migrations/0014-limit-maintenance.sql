-- Maintenance cadence only: live rate-limit counters and windows are unchanged.
CREATE TABLE IF NOT EXISTS community_maintenance (
  key TEXT PRIMARY KEY CHECK(key='limits'),
  next_run INTEGER NOT NULL CHECK(typeof(next_run)='integer' AND next_run>=0)
);
CREATE INDEX IF NOT EXISTS community_limits_expiry ON community_limits(expires_at,key);
