CREATE TABLE draw_candidates_compact (draw_id TEXT NOT NULL REFERENCES draws(id), viewer_id TEXT NOT NULL, ordinal INTEGER NOT NULL, score INTEGER NOT NULL CHECK(score BETWEEN 0 AND 10), weight REAL NOT NULL, probability REAL NOT NULL, PRIMARY KEY(draw_id,viewer_id)) WITHOUT ROWID;
INSERT INTO draw_candidates_compact SELECT draw_id,viewer_id,ordinal,score,weight,probability FROM draw_candidates;
DROP TABLE draw_candidates;
ALTER TABLE draw_candidates_compact RENAME TO draw_candidates;
