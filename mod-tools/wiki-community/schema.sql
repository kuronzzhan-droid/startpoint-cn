PRAGMA foreign_keys = ON;
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
CREATE TABLE IF NOT EXISTS community_teams (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL, notes TEXT NOT NULL, author TEXT NOT NULL,
  team_json TEXT NOT NULL, element TEXT NOT NULL, damage_mask INTEGER NOT NULL,
  category TEXT NOT NULL DEFAULT '' CHECK (category IN ('','萌新启航','原版毕业队','MOD毕业队','最新最潮盘','玩具盘')),
  section TEXT NOT NULL DEFAULT '' CHECK (section IN ('','abyss','abyss-ex','fantasy','five-boss','original')),
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private')),
  created_by TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('approved','pending','hidden')),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  likes INTEGER NOT NULL DEFAULT 0 CHECK (likes >= 0),
  revision INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS community_teams_latest ON community_teams(status,created_at DESC,id);
CREATE INDEX IF NOT EXISTS community_teams_popular ON community_teams(status,likes DESC,created_at DESC,id);
CREATE INDEX IF NOT EXISTS community_teams_element ON community_teams(status,element,created_at DESC,id);
CREATE INDEX IF NOT EXISTS community_teams_category ON community_teams(status,category,created_at DESC,id);
CREATE INDEX IF NOT EXISTS community_teams_section ON community_teams(status,section,created_at DESC,id);
CREATE INDEX IF NOT EXISTS community_teams_visibility ON community_teams(visibility,status,created_at DESC,id);
CREATE INDEX IF NOT EXISTS community_teams_creator ON community_teams(created_by,visibility,created_at DESC,id);
CREATE TABLE IF NOT EXISTS community_likes (
  team_id TEXT NOT NULL REFERENCES community_teams(id),
  visitor_id TEXT NOT NULL, day TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (team_id,visitor_id,day)
);
CREATE TRIGGER IF NOT EXISTS community_like_count AFTER INSERT ON community_likes
BEGIN
  UPDATE community_teams SET likes=likes+1 WHERE id=NEW.team_id;
END;
CREATE TABLE IF NOT EXISTS community_limits (
  key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS community_audit (
  id TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES community_teams(id),
  actor_id TEXT NOT NULL, actor_email TEXT NOT NULL, action TEXT NOT NULL,
  before_json TEXT NOT NULL, after_json TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS community_audit_team ON community_audit(team_id,created_at DESC);
CREATE TABLE IF NOT EXISTS community_game_codes (
  code TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES community_teams(id),
  fingerprint TEXT NOT NULL, created_at INTEGER NOT NULL, revoked_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS community_game_codes_active
  ON community_game_codes(team_id,fingerprint) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS community_users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  role TEXT NOT NULL CHECK(role IN ('owner','deputy','editor')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  password_hash TEXT NOT NULL, password_version INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL CHECK(must_change_password IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  CHECK(role <> 'owner' OR enabled=1)
);
CREATE UNIQUE INDEX IF NOT EXISTS community_single_owner ON community_users(role) WHERE role='owner';
CREATE TABLE IF NOT EXISTS community_sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES community_users(id),
  password_version INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS community_sessions_user ON community_sessions(user_id);
CREATE INDEX IF NOT EXISTS community_sessions_expiry ON community_sessions(expires_at);
CREATE TABLE IF NOT EXISTS community_auth_audit (
  id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, actor_email TEXT NOT NULL,
  target_id TEXT NOT NULL, action TEXT NOT NULL, created_at INTEGER NOT NULL
);
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
CREATE TABLE IF NOT EXISTS community_character_ratings (
  character_id TEXT NOT NULL, visitor_id TEXT NOT NULL,
  score INTEGER NOT NULL CHECK(typeof(score)='integer' AND score BETWEEN 0 AND 5),
  vote_day TEXT NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY(character_id,visitor_id)
);
CREATE TABLE IF NOT EXISTS community_character_rating_claims (
  claim_key TEXT PRIMARY KEY, character_id TEXT NOT NULL, visitor_id TEXT NOT NULL,
  vote_day TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS community_character_rating_claim_day ON community_character_rating_claims(vote_day);
CREATE TABLE IF NOT EXISTS community_tier_rankings (
  visitor_id TEXT PRIMARY KEY, rows_json TEXT NOT NULL,
  vote_day TEXT NOT NULL, updated_at INTEGER NOT NULL,
  CHECK(json_valid(rows_json) AND json_type(rows_json)='object')
);
CREATE TABLE IF NOT EXISTS community_tier_ranking_claims (
  claim_key TEXT PRIMARY KEY, visitor_id TEXT NOT NULL,
  vote_day TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS community_tier_ranking_claim_day ON community_tier_ranking_claims(vote_day);
CREATE TABLE IF NOT EXISTS community_presence (
  visitor_hash TEXT PRIMARY KEY,
  last_seen INTEGER NOT NULL CHECK(typeof(last_seen)='integer' AND last_seen>=0)
);
CREATE INDEX IF NOT EXISTS community_presence_seen ON community_presence(last_seen);
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

-- Internal aggregate cache only; existing votes and accounts remain untouched.
CREATE TABLE IF NOT EXISTS community_participation_revision (
  id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0)
);
INSERT OR IGNORE INTO community_participation_revision(id,revision) VALUES(1,0);
CREATE TABLE IF NOT EXISTS community_participation_snapshots (
  catalog_hash TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT -1,
  rating_voters INTEGER, tier_voters INTEGER, total_voters INTEGER, computed_at INTEGER,
  refresh_after INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0, lease_owner TEXT,
  CHECK((computed_at IS NULL AND rating_voters IS NULL AND tier_voters IS NULL AND total_voters IS NULL) OR
    (typeof(computed_at)='integer' AND computed_at BETWEEN 0 AND 8640000000000000
      AND typeof(rating_voters)='integer' AND typeof(tier_voters)='integer' AND typeof(total_voters)='integer'
      AND rating_voters>=0 AND tier_voters>=0
      AND total_voters>=MAX(rating_voters,tier_voters) AND total_voters<=rating_voters+tier_voters))
);
CREATE TRIGGER IF NOT EXISTS community_participation_rating_insert AFTER INSERT ON community_character_ratings
BEGIN UPDATE community_participation_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS community_participation_rating_update AFTER UPDATE ON community_character_ratings
BEGIN UPDATE community_participation_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS community_participation_rating_delete AFTER DELETE ON community_character_ratings
BEGIN UPDATE community_participation_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS community_participation_tier_insert AFTER INSERT ON community_tier_rankings
BEGIN UPDATE community_participation_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS community_participation_tier_update AFTER UPDATE ON community_tier_rankings
BEGIN UPDATE community_participation_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS community_participation_tier_delete AFTER DELETE ON community_tier_rankings
BEGIN UPDATE community_participation_revision SET revision=revision+1 WHERE id=1; END;

-- Maintenance cadence only: live rate-limit counters and windows are unchanged.
CREATE TABLE IF NOT EXISTS community_maintenance (
  key TEXT PRIMARY KEY CHECK(key='limits'),
  next_run INTEGER NOT NULL CHECK(typeof(next_run)='integer' AND next_run>=0)
);
CREATE INDEX IF NOT EXISTS community_limits_expiry ON community_limits(expires_at,key);

-- Derived membership only. Visibility remains checked on the original team row.
CREATE TABLE IF NOT EXISTS community_team_characters (
  character_id TEXT NOT NULL, team_id TEXT NOT NULL REFERENCES community_teams(id) ON DELETE CASCADE,
  PRIMARY KEY(character_id,team_id)
);
CREATE INDEX IF NOT EXISTS community_team_characters_team ON community_team_characters(team_id);
INSERT OR IGNORE INTO community_team_characters(character_id,team_id)
  SELECT slot.value,t.id FROM community_teams t,json_each(t.team_json,'$.main') slot
  WHERE slot.type='text' AND slot.value<>''
  UNION SELECT slot.value,t.id FROM community_teams t,json_each(t.team_json,'$.unison') slot
  WHERE slot.type='text' AND slot.value<>'';
CREATE TRIGGER IF NOT EXISTS community_team_characters_insert AFTER INSERT ON community_teams
BEGIN
  INSERT OR IGNORE INTO community_team_characters(character_id,team_id)
    SELECT value,NEW.id FROM json_each(NEW.team_json,'$.main') WHERE type='text' AND value<>''
    UNION SELECT value,NEW.id FROM json_each(NEW.team_json,'$.unison') WHERE type='text' AND value<>'';
END;
CREATE TRIGGER IF NOT EXISTS community_team_characters_update AFTER UPDATE OF team_json ON community_teams
WHEN NEW.team_json<>OLD.team_json
BEGIN
  DELETE FROM community_team_characters WHERE team_id=OLD.id;
  INSERT OR IGNORE INTO community_team_characters(character_id,team_id)
    SELECT value,NEW.id FROM json_each(NEW.team_json,'$.main') WHERE type='text' AND value<>''
    UNION SELECT value,NEW.id FROM json_each(NEW.team_json,'$.unison') WHERE type='text' AND value<>'';
END;

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
