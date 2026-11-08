CREATE TABLE oauth_states (state_hash TEXT PRIMARY KEY, expires INTEGER NOT NULL, verifier TEXT NOT NULL);
CREATE TABLE sessions (session_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, csrf_hash TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE approved_streamers (user_id TEXT PRIMARY KEY);
CREATE TABLE environments (owner_id TEXT PRIMARY KEY REFERENCES approved_streamers(user_id), value TEXT NOT NULL, version INTEGER NOT NULL CHECK(version >= 1));
