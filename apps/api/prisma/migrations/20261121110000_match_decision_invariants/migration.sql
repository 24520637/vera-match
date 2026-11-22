BEGIN;

-- Keep historical rows intact. Legacy rows lacking consent stamps cannot authorize an interaction.
ALTER TABLE "MatchPair"
  ADD COLUMN "lowConsentSubjectId" UUID,
  ADD COLUMN "lowConsentVersion" BIGINT,
  ADD COLUMN "highConsentSubjectId" UUID,
  ADD COLUMN "highConsentVersion" BIGINT,
  ADD COLUMN "invalidatedAt" TIMESTAMP(3);

-- Existing malformed pairs remain available for remediation without rewriting their choices.
-- Enforce order at insertion so a safety invalidation can still update a legacy row.
CREATE FUNCTION match_pair_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW."createdAt", NEW."userLowId", NEW."userHighId", NEW."lowConsentSubjectId", NEW."lowConsentVersion",
        NEW."highConsentSubjectId", NEW."highConsentVersion") IS DISTINCT FROM
       (OLD.id, OLD."createdAt", OLD."userLowId", OLD."userHighId", OLD."lowConsentSubjectId", OLD."lowConsentVersion",
        OLD."highConsentSubjectId", OLD."highConsentVersion")
       OR (OLD."invalidatedAt" IS NOT NULL AND NEW."invalidatedAt" IS DISTINCT FROM OLD."invalidatedAt")
    THEN RAISE EXCEPTION 'Matching authorization identity is immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."userLowId" COLLATE "C" >= NEW."userHighId" COLLATE "C"
     OR EXISTS (SELECT 1 FROM "MatchPair" WHERE
          "userLowId" = NEW."userHighId" AND "userHighId" = NEW."userLowId")
     OR NEW."lowConsentSubjectId" IS NULL OR NEW."highConsentSubjectId" IS NULL
     OR NEW."lowConsentVersion" IS NULL OR NEW."highConsentVersion" IS NULL
     OR NEW."lowConsentVersion" < 0 OR NEW."highConsentVersion" < 0
  THEN RAISE EXCEPTION 'Invalid matching pair' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "MatchPair_identity_guard" BEFORE INSERT OR UPDATE ON "MatchPair"
FOR EACH ROW EXECUTE FUNCTION match_pair_identity_guard();

CREATE FUNCTION match_decision_actor_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW IS DISTINCT FROM OLD
    THEN RAISE EXCEPTION 'Matching decisions cannot be changed' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM "MatchPair" WHERE id = NEW."pairId"
      AND "invalidatedAt" IS NULL AND "lowConsentSubjectId" IS NOT NULL
      AND NEW."actorUserId" IN ("userLowId", "userHighId"))
  THEN RAISE EXCEPTION 'Matching decision requires a participant' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "MatchDecision_actor_guard" BEFORE INSERT OR UPDATE ON "MatchDecision"
FOR EACH ROW EXECUTE FUNCTION match_decision_actor_guard();

CREATE INDEX "MatchDecision_actorUserId_createdAt_id_idx" ON "MatchDecision"("actorUserId", "createdAt", id);

-- Block creation and invalidation take effect together under the safety participant locks.
-- Removing the block cannot restore an acceptance from before it.
CREATE FUNCTION match_pair_invalidate_on_block() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  low_id TEXT := least(NEW."blockerId" COLLATE "C", NEW."blockedId" COLLATE "C");
  high_id TEXT := greatest(NEW."blockerId" COLLATE "C", NEW."blockedId" COLLATE "C");
BEGIN
  UPDATE "MatchPair" SET "invalidatedAt" = clock_timestamp() AT TIME ZONE 'UTC'
    WHERE "userLowId" = low_id AND "userHighId" = high_id AND "invalidatedAt" IS NULL;
  RETURN NEW;
END $$;

CREATE TRIGGER "Block_match_pair_invalidation" AFTER INSERT ON "Block"
FOR EACH ROW EXECUTE FUNCTION match_pair_invalidate_on_block();

CREATE FUNCTION match_decision_audit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.action = 'MATCH_DECISION_RECORDED' THEN
      PERFORM 1 FROM "MatchDecision" d JOIN "ConsentLedger" l ON l."userId" = d."actorUserId"
        WHERE d.id = NEW."subjectId" AND l."subjectId"::text = NEW."actorId" FOR UPDATE OF d;
      IF NOT FOUND OR NEW."subjectType" <> 'MatchDecision' OR EXISTS (
        SELECT 1 FROM "AuditLog" WHERE action = NEW.action AND "subjectId" = NEW."subjectId"
      ) THEN RAISE EXCEPTION 'Invalid or duplicate matching audit evidence' USING ERRCODE = '23514';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.action = 'MATCH_DECISION_RECORDED' OR (TG_OP = 'UPDATE' AND NEW.action = 'MATCH_DECISION_RECORDED')
  THEN RAISE EXCEPTION 'Matching audit is append-only' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN RETURN NEW; END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER "AuditLog_match_decision_guard" BEFORE INSERT OR UPDATE OR DELETE ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION match_decision_audit_guard();

CREATE INDEX "AuditLog_matching_subject_idx" ON "AuditLog"("subjectId") WHERE action = 'MATCH_DECISION_RECORDED';

COMMIT;
