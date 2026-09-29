-- Additive and safe to reapply. Each visitor has one current score per character.
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
