ALTER TABLE activities ADD COLUMN status_version INTEGER NOT NULL DEFAULT 0 CHECK(status_version>=0);
