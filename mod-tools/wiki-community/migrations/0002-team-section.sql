-- Existing databases only: inspect PRAGMA table_info(community_teams) first.
-- Run once when section is absent; schema.sql includes it for fresh databases.
ALTER TABLE community_teams ADD COLUMN section TEXT NOT NULL DEFAULT ''
  CHECK (section IN ('','abyss','fantasy','five-boss'));
CREATE INDEX IF NOT EXISTS community_teams_section ON community_teams(status,section,created_at DESC,id);
