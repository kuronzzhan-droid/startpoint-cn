-- Run once when the section CHECK does not yet allow 'original'.
-- Execute atomically. The parent table and its referenced IDs remain in place.
DROP INDEX IF EXISTS community_teams_section;
ALTER TABLE community_teams RENAME COLUMN section TO section_previous;
ALTER TABLE community_teams ADD COLUMN section TEXT NOT NULL DEFAULT ''
  CHECK(section IN ('','abyss','fantasy','five-boss','original'));
UPDATE community_teams SET section=section_previous;
ALTER TABLE community_teams DROP COLUMN section_previous;
CREATE INDEX community_teams_section ON community_teams(status,section,created_at DESC,id);
