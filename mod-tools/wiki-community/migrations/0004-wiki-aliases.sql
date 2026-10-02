-- Additive and safe to reapply; creates no prefilled aliases.
CREATE TABLE IF NOT EXISTS community_aliases (
  kind TEXT NOT NULL CHECK(kind IN ('character','weapon')),
  entity_id TEXT NOT NULL, aliases_json TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 1), updated_at INTEGER NOT NULL,
  PRIMARY KEY(kind,entity_id)
);
CREATE TABLE IF NOT EXISTS community_alias_audit (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, entity_id TEXT NOT NULL,
  actor_id TEXT NOT NULL, actor_email TEXT NOT NULL,
  before_json TEXT NOT NULL, after_json TEXT NOT NULL, created_at INTEGER NOT NULL,
  FOREIGN KEY(kind,entity_id) REFERENCES community_aliases(kind,entity_id)
);
CREATE INDEX IF NOT EXISTS community_alias_audit_target ON community_alias_audit(kind,entity_id,created_at DESC);
