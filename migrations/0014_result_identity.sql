CREATE TABLE discord_identities (user_id TEXT PRIMARY KEY, display_name TEXT, username TEXT);
ALTER TABLE draws ADD COLUMN winner_display_name TEXT;
