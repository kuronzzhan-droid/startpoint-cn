-- Optional, disabled-by-default creative. No impression or click accounting.
CREATE TABLE IF NOT EXISTS community_sponsorship (
  id INTEGER PRIMARY KEY CHECK(id=1),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  title TEXT NOT NULL CHECK(length(title)<=60),
  description TEXT NOT NULL CHECK(length(description)<=160),
  image_url TEXT NOT NULL CHECK(length(image_url)<=2048),
  target_url TEXT NOT NULL CHECK(length(target_url)<=2048),
  revision INTEGER NOT NULL CHECK(revision>=1),
  updated_at INTEGER NOT NULL,
  CHECK(enabled=0 OR (length(title)>0 AND length(target_url)>0))
);
CREATE TABLE IF NOT EXISTS community_sponsorship_audit (
  id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, actor_email TEXT NOT NULL,
  before_json TEXT NOT NULL, after_json TEXT NOT NULL, created_at INTEGER NOT NULL
);
