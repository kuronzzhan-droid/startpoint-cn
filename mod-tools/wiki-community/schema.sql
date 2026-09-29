PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS community_teams (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL, notes TEXT NOT NULL, author TEXT NOT NULL,
  team_json TEXT NOT NULL, element TEXT NOT NULL, damage_mask INTEGER NOT NULL,
  category TEXT NOT NULL DEFAULT '' CHECK (category IN ('','萌新启航','原版毕业队','MOD毕业队','最新最潮盘','玩具盘')),
  section TEXT NOT NULL DEFAULT '' CHECK (section IN ('','abyss','fantasy','five-boss','original')),
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
