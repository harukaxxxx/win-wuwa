CREATE TABLE registrations (
 activity_id TEXT NOT NULL,
 owner_id TEXT NOT NULL,
 viewer_id TEXT NOT NULL,
 ordinal INTEGER NOT NULL CHECK(ordinal >= 1),
 status TEXT NOT NULL DEFAULT 'registered' CHECK(status IN ('registered','withdrawn','winner')),
 PRIMARY KEY(activity_id,viewer_id),
 UNIQUE(activity_id,ordinal),
 FOREIGN KEY(activity_id,owner_id) REFERENCES activities(id,owner_id)
);
