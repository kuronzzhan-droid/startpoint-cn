-- Additive only: cumulative totals survive expiry of anonymous deduplication records.
CREATE TABLE IF NOT EXISTS community_character_views (
  character_id TEXT PRIMARY KEY,
  views INTEGER NOT NULL DEFAULT 0 CHECK(typeof(views)='integer' AND views BETWEEN 0 AND 9007199254740991)
);
CREATE TABLE IF NOT EXISTS community_character_view_visitors (
  character_id TEXT NOT NULL, visitor_hash TEXT NOT NULL,
  last_counted_at INTEGER NOT NULL CHECK(typeof(last_counted_at)='integer' AND last_counted_at>=0),
  PRIMARY KEY(character_id,visitor_hash)
);
CREATE INDEX IF NOT EXISTS community_character_view_expiry ON community_character_view_visitors(last_counted_at);
