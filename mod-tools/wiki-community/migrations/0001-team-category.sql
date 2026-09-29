-- Existing databases only: inspect PRAGMA table_info(community_teams) first.
-- Run once when category is absent; schema.sql already includes it for fresh databases.
ALTER TABLE community_teams ADD COLUMN category TEXT NOT NULL DEFAULT ''
  CHECK (category IN ('','萌新启航','原版毕业队','MOD毕业队','最新最潮盘','玩具盘'));
CREATE INDEX IF NOT EXISTS community_teams_category ON community_teams(status,category,created_at DESC,id);
