ALTER TABLE activities ADD COLUMN candidate_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE activities ADD COLUMN candidate_updated_at TEXT;
CREATE TRIGGER candidate_registration_insert AFTER INSERT ON registrations WHEN NEW.status='registered' BEGIN
 UPDATE activities SET candidate_revision=candidate_revision+1,candidate_updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.activity_id AND owner_id=NEW.owner_id AND status IN ('open','paused');
END;
CREATE TRIGGER candidate_registration_delete AFTER DELETE ON registrations WHEN OLD.status='registered' BEGIN
 UPDATE activities SET candidate_revision=candidate_revision+1,candidate_updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=OLD.activity_id AND owner_id=OLD.owner_id AND status IN ('open','paused');
END;
CREATE TRIGGER candidate_registration_update AFTER UPDATE ON registrations WHEN (OLD.status='registered' OR NEW.status='registered') AND (OLD.status<>NEW.status OR OLD.activity_id<>NEW.activity_id OR OLD.owner_id<>NEW.owner_id OR OLD.viewer_id<>NEW.viewer_id OR OLD.ordinal<>NEW.ordinal) BEGIN
 UPDATE activities SET candidate_revision=candidate_revision+1,candidate_updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE status IN ('open','paused') AND ((OLD.status='registered' AND id=OLD.activity_id AND owner_id=OLD.owner_id) OR (NEW.status='registered' AND id=NEW.activity_id AND owner_id=NEW.owner_id));
END;
CREATE TRIGGER candidate_score_insert AFTER INSERT ON viewer_scores WHEN NEW.score<>0 BEGIN
 UPDATE activities SET candidate_revision=candidate_revision+1,candidate_updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE status IN ('open','paused') AND owner_id=NEW.owner_id AND EXISTS (SELECT 1 FROM registrations r WHERE r.activity_id=activities.id AND r.owner_id=NEW.owner_id AND r.viewer_id=NEW.viewer_id AND r.status='registered');
END;
CREATE TRIGGER candidate_score_delete AFTER DELETE ON viewer_scores WHEN OLD.score<>0 BEGIN
 UPDATE activities SET candidate_revision=candidate_revision+1,candidate_updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE status IN ('open','paused') AND owner_id=OLD.owner_id AND EXISTS (SELECT 1 FROM registrations r WHERE r.activity_id=activities.id AND r.owner_id=OLD.owner_id AND r.viewer_id=OLD.viewer_id AND r.status='registered');
END;
CREATE TRIGGER candidate_score_update AFTER UPDATE ON viewer_scores WHEN OLD.score<>NEW.score OR OLD.owner_id<>NEW.owner_id OR OLD.viewer_id<>NEW.viewer_id BEGIN
 UPDATE activities SET candidate_revision=candidate_revision+1,candidate_updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE status IN ('open','paused') AND EXISTS (SELECT 1 FROM registrations r WHERE r.activity_id=activities.id AND r.status='registered' AND ((OLD.score<>0 AND r.owner_id=OLD.owner_id AND r.viewer_id=OLD.viewer_id) OR (NEW.score<>0 AND r.owner_id=NEW.owner_id AND r.viewer_id=NEW.viewer_id)));
END;
CREATE TRIGGER candidate_settling AFTER UPDATE OF status ON activities WHEN OLD.status IN ('open','paused') AND NEW.status='settling' BEGIN
 UPDATE activities SET candidate_revision=candidate_revision+1,candidate_updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.id AND owner_id=NEW.owner_id;
END;
