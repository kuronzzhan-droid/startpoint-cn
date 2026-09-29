-- Existing databases only: run once when visibility/created_by are absent.
-- Old hidden rows retain moderation status; ownership is never inferred from display names.
ALTER TABLE community_teams ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'
  CHECK (visibility IN ('public','private'));
ALTER TABLE community_teams ADD COLUMN created_by TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS community_teams_visibility ON community_teams(visibility,status,created_at DESC,id);
CREATE INDEX IF NOT EXISTS community_teams_creator ON community_teams(created_by,visibility,created_at DESC,id);
