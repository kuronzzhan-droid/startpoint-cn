-- Run when the section CHECK does not yet allow 'abyss-ex', in one transaction.
-- Existing labels are copied verbatim: never guess which old abyss teams are EX.
-- Keep the parent table and foreign keys in place, as in migration 0006.
DROP INDEX IF EXISTS community_teams_section;
ALTER TABLE community_teams RENAME COLUMN section TO section_previous;
ALTER TABLE community_teams ADD COLUMN section TEXT NOT NULL DEFAULT ''
  CHECK(section IN ('','abyss','abyss-ex','fantasy','five-boss','original'));
UPDATE community_teams SET section=section_previous;
ALTER TABLE community_teams DROP COLUMN section_previous;
CREATE INDEX community_teams_section ON community_teams(status,section,created_at DESC,id);
