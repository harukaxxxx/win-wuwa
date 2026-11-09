-- The activity UUID itself is a permanent replay fence, without a participant roster.
CREATE TABLE activity_tombstones (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL REFERENCES approved_streamers(user_id),
 status TEXT NOT NULL CHECK(status IN ('settled','cancelled')),
 completed_at INTEGER NOT NULL
);
CREATE TRIGGER tombstone_blocks_activity_insert BEFORE INSERT ON activities WHEN EXISTS (SELECT 1 FROM activity_tombstones WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'retired activity'); END;
CREATE TRIGGER tombstone_blocks_proof_insert BEFORE INSERT ON guild_membership_proofs WHEN EXISTS (SELECT 1 FROM activity_tombstones WHERE id=NEW.activity_id) BEGIN SELECT RAISE(ABORT,'retired activity'); END;
CREATE TRIGGER tombstone_blocks_proof_update BEFORE UPDATE ON guild_membership_proofs WHEN EXISTS (SELECT 1 FROM activity_tombstones WHERE id=NEW.activity_id) BEGIN SELECT RAISE(ABORT,'retired activity'); END;
CREATE TRIGGER tombstone_blocks_intent_insert BEFORE INSERT ON viewer_login_intents WHEN EXISTS (SELECT 1 FROM activity_tombstones WHERE id=NEW.activity_id) BEGIN SELECT RAISE(ABORT,'retired activity'); END;
CREATE TRIGGER tombstone_blocks_intent_update BEFORE UPDATE ON viewer_login_intents WHEN EXISTS (SELECT 1 FROM activity_tombstones WHERE id=NEW.activity_id) BEGIN SELECT RAISE(ABORT,'retired activity'); END;
CREATE TRIGGER tombstone_blocks_context_insert BEFORE INSERT ON viewer_oauth_context WHEN EXISTS (SELECT 1 FROM activity_tombstones WHERE id=NEW.activity_id) BEGIN SELECT RAISE(ABORT,'retired activity'); END;
CREATE TRIGGER tombstone_blocks_context_update BEFORE UPDATE ON viewer_oauth_context WHEN EXISTS (SELECT 1 FROM activity_tombstones WHERE id=NEW.activity_id) BEGIN SELECT RAISE(ABORT,'retired activity'); END;
CREATE INDEX retention_settlement_completed ON activity_settlements(owner_id,completed_at);
CREATE INDEX retention_cancellation_completed ON activity_cancellations(owner_id,completed_at);
