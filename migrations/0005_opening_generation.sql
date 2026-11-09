ALTER TABLE activities ADD COLUMN expected_generation INTEGER NOT NULL DEFAULT 0 CHECK(expected_generation BETWEEN 0 AND 9007199254740990);
CREATE TABLE activity_opening_generations (owner_id TEXT PRIMARY KEY REFERENCES approved_streamers(user_id), generation INTEGER NOT NULL CHECK(generation BETWEEN 0 AND 9007199254740991));
INSERT INTO activity_opening_generations(owner_id,generation) SELECT owner_id,COUNT(*) FROM activities GROUP BY owner_id;
