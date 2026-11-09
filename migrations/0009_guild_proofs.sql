ALTER TABLE viewer_oauth_context ADD COLUMN guild_id TEXT;
CREATE TABLE guild_membership_proofs (session_hash TEXT NOT NULL, user_id TEXT NOT NULL, owner_id TEXT NOT NULL, activity_id TEXT NOT NULL, rule_version INTEGER NOT NULL, guild_id TEXT NOT NULL, status TEXT NOT NULL, retry_after REAL, expires INTEGER NOT NULL, PRIMARY KEY(session_hash,activity_id,rule_version));
