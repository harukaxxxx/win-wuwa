CREATE TABLE viewer_oauth_context (state_hash TEXT PRIMARY KEY, owner_id TEXT NOT NULL, activity_id TEXT NOT NULL, rule_version INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE viewer_login_intents (intent_hash TEXT PRIMARY KEY, session_hash TEXT NOT NULL, owner_id TEXT NOT NULL, activity_id TEXT NOT NULL, rule_version INTEGER NOT NULL, expires INTEGER NOT NULL);
