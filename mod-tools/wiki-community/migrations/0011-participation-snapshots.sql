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
