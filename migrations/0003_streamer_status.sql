ALTER TABLE approved_streamers ADD COLUMN status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('approved','disabled'));
ALTER TABLE approved_streamers ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1);
