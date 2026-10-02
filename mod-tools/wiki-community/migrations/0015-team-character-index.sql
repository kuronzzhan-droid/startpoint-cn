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
