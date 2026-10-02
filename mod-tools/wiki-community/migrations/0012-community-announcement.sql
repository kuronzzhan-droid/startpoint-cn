-- Additive and repeatable: existing teams, accounts and codes are untouched.
CREATE TABLE IF NOT EXISTS community_announcement (
  id INTEGER PRIMARY KEY CHECK(id=1),
  text TEXT NOT NULL CHECK(length(text)<=500),
  revision INTEGER NOT NULL CHECK(revision>=1),
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS community_announcement_audit (
  id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, actor_email TEXT NOT NULL,
  before_json TEXT NOT NULL, after_json TEXT NOT NULL, created_at INTEGER NOT NULL
);
