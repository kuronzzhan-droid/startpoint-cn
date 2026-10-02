-- Additive: ranking votes are independent of existing per-character ratings.
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
