ALTER TABLE registrations ADD COLUMN display_name_snapshot TEXT;
ALTER TABLE registrations ADD COLUMN name_source TEXT;
ALTER TABLE guild_membership_proofs ADD COLUMN nickname TEXT;
CREATE TABLE session_display_names (session_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, global_name TEXT, masked_username TEXT, expires INTEGER NOT NULL);
