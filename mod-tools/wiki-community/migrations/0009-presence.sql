-- Additive only: retain all existing votes, teams, accounts and game codes.
CREATE TABLE IF NOT EXISTS community_presence (
  visitor_hash TEXT PRIMARY KEY,
  last_seen INTEGER NOT NULL CHECK(typeof(last_seen)='integer' AND last_seen>=0)
);
CREATE INDEX IF NOT EXISTS community_presence_seen ON community_presence(last_seen);
