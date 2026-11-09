CREATE TABLE activity_cancellations (activity_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, cursor TEXT NOT NULL DEFAULT '', completed_at INTEGER, FOREIGN KEY(activity_id,owner_id) REFERENCES activities(id,owner_id));
CREATE INDEX cancellation_winner_cursor ON draws(activity_id,owner_id,winner_id);
