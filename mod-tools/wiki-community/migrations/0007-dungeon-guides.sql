-- Additive migration; existing teams, accounts, codes, likes and private spaces remain untouched.
CREATE TABLE IF NOT EXISTS community_dungeon_guides (
  id TEXT PRIMARY KEY, text TEXT NOT NULL,
  team_ids_json TEXT NOT NULL DEFAULT '[]', image_ids_json TEXT NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL CHECK(revision>=1), updated_at INTEGER NOT NULL,
  CHECK(json_valid(team_ids_json) AND json_type(team_ids_json)='array'),
  CHECK(json_valid(image_ids_json) AND json_type(image_ids_json)='array')
);
CREATE TABLE IF NOT EXISTS community_dungeon_images (
  id TEXT PRIMARY KEY, dungeon_id TEXT NOT NULL,
  mime TEXT NOT NULL CHECK(mime IN ('image/png','image/jpeg','image/webp')),
  data BLOB NOT NULL, bytes INTEGER NOT NULL CHECK(bytes>0 AND bytes<=524288 AND bytes=length(data)),
  width INTEGER NOT NULL CHECK(width>0 AND width<=4096), height INTEGER NOT NULL CHECK(height>0 AND height<=4096),
  created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
  CHECK(width*height<=12582912)
);
CREATE INDEX IF NOT EXISTS community_dungeon_images_actor ON community_dungeon_images(created_by);
CREATE INDEX IF NOT EXISTS community_dungeon_images_target ON community_dungeon_images(dungeon_id,created_at);
CREATE TABLE IF NOT EXISTS community_dungeon_audit (
  id TEXT PRIMARY KEY, dungeon_id TEXT NOT NULL, actor_id TEXT NOT NULL, actor_email TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('guide_update','image_upload','image_delete')),
  before_json TEXT NOT NULL, after_json TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS community_dungeon_audit_target ON community_dungeon_audit(dungeon_id,created_at DESC);
CREATE INDEX IF NOT EXISTS community_dungeon_audit_uploads ON community_dungeon_audit(actor_id,action,created_at);
