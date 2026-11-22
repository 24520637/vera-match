BEGIN;

-- Keep decisions and their backfill consistent with concurrent review and source writes.
LOCK TABLE "Video", "ExpertReview", "ReviewDecision", "AuditLog" IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE "ReviewDecisionEvidence" (
  "assignmentId" TEXT NOT NULL REFERENCES "ExpertAssignmentIdentity"("assignmentId") ON DELETE RESTRICT ON UPDATE NO ACTION,
  "reviewId" TEXT NOT NULL,
  "version" INTEGER NOT NULL CHECK ("version" >= 2),
  "status" "ReviewStatus" NOT NULL CHECK ("status" IN ('RETURNED', 'APPROVED')),
  "moderatorSubjectId" UUID,
  "decidedAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("assignmentId", "reviewId", "version")
);

-- Keep only the metadata needed to prove a decision. Older decisions whose
-- moderator mapping is already gone keep a null subject, without inventing one.
INSERT INTO "ReviewDecisionEvidence"
  ("assignmentId", "reviewId", "version", "status", "moderatorSubjectId", "decidedAt")
SELECT r."assignmentId", d."reviewId", d."version", d."status", i."subjectId", d."decidedAt"
FROM "ReviewDecision" d
JOIN "ExpertReview" r ON r.id = d."reviewId"
LEFT JOIN "ExpertActorIdentity" i ON i."userId" = d."moderatorId";

CREATE TRIGGER "ReviewDecisionEvidence_immutable" BEFORE UPDATE OR DELETE ON "ReviewDecisionEvidence"
  FOR EACH ROW EXECUTE FUNCTION c031_immutable();
CREATE TRIGGER "ReviewDecisionEvidence_no_truncate" BEFORE TRUNCATE ON "ReviewDecisionEvidence"
  FOR EACH STATEMENT EXECUTE FUNCTION c031_immutable();

CREATE FUNCTION t10_record_review_decision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "ReviewDecisionEvidence"
    ("assignmentId", "reviewId", "version", "status", "moderatorSubjectId", "decidedAt")
  SELECT r."assignmentId", NEW."reviewId", NEW."version", NEW."status", i."subjectId", NEW."decidedAt"
  FROM "ExpertReview" r
  JOIN "ExpertActorIdentity" i ON i."userId" = NEW."moderatorId"
  WHERE r.id = NEW."reviewId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'QA decision requires an actor subject and a live review' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "ReviewDecision_record_evidence" AFTER INSERT ON "ReviewDecision"
  FOR EACH ROW EXECUTE FUNCTION t10_record_review_decision();
CREATE TRIGGER "ReviewDecision_immutable" BEFORE UPDATE ON "ReviewDecision"
  FOR EACH ROW EXECUTE FUNCTION c031_immutable();
CREATE TRIGGER "ReviewDecision_no_truncate" BEFORE TRUNCATE ON "ReviewDecision"
  FOR EACH STATEMENT EXECUTE FUNCTION c031_immutable();

CREATE FUNCTION t10_guard_live_review_decision_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "ExpertReview" r
    JOIN "ExpertAssignment" a ON a.id = r."assignmentId"
    JOIN "Video" v ON v.id = a."videoId"
    WHERE r.id = OLD."reviewId" AND v.status <> 'DELETED' AND v."deletedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'Live QA decisions are append-only' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER "ReviewDecision_guard_delete" BEFORE DELETE ON "ReviewDecision"
  FOR EACH ROW EXECUTE FUNCTION t10_guard_live_review_decision_delete();

CREATE FUNCTION t10_remove_live_qa_details() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM "ReviewDecision" d USING "ExpertReview" r, "ExpertAssignment" a
  WHERE d."reviewId" = r.id AND r."assignmentId" = a.id AND a."videoId" = NEW.id;
  UPDATE "ExpertReview" r SET "qaFeedback" = NULL, "qaById" = NULL
  FROM "ExpertAssignment" a
  WHERE r."assignmentId" = a.id AND a."videoId" = NEW.id
    AND (r."qaFeedback" IS NOT NULL OR r."qaById" IS NOT NULL);
  RETURN NEW;
END $$;

CREATE TRIGGER "Video_remove_live_qa_details" AFTER UPDATE OF status, "deletedAt" ON "Video"
  FOR EACH ROW WHEN (
    (NEW.status = 'DELETED' OR NEW."deletedAt" IS NOT NULL)
    AND (OLD.status IS DISTINCT FROM NEW.status OR OLD."deletedAt" IS DISTINCT FROM NEW."deletedAt")
  ) EXECUTE FUNCTION t10_remove_live_qa_details();

-- Apply the same minimization to any sources already tombstoned before deploy.
DELETE FROM "ReviewDecision" d USING "ExpertReview" r, "ExpertAssignment" a, "Video" v
WHERE d."reviewId" = r.id AND r."assignmentId" = a.id AND a."videoId" = v.id
  AND (v.status = 'DELETED' OR v."deletedAt" IS NOT NULL);
UPDATE "ExpertReview" r SET "qaFeedback" = NULL, "qaById" = NULL
FROM "ExpertAssignment" a JOIN "Video" v ON v.id = a."videoId"
WHERE r."assignmentId" = a.id AND (v.status = 'DELETED' OR v."deletedAt" IS NOT NULL)
  AND (r."qaFeedback" IS NOT NULL OR r."qaById" IS NOT NULL);

-- T10 uses the same opaque actor mapping as assignment evidence. Other audit
-- actions retain their existing behavior and AuditLog already blocks TRUNCATE.
INSERT INTO "ExpertActorIdentity" ("userId")
SELECT DISTINCT u.id FROM "User" u JOIN "AuditLog" a ON a."actorId" = u.id
WHERE starts_with(a.action, 'EXPERT_REVIEW_')
ON CONFLICT ("userId") DO NOTHING;

UPDATE "AuditLog" a SET "actorId" = (
  SELECT i."subjectId"::text FROM "ExpertActorIdentity" i WHERE i."userId" = a."actorId"
)
WHERE starts_with(a.action, 'EXPERT_REVIEW_') AND a."actorId" IS NOT NULL;

CREATE FUNCTION t10_review_audit_actor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "ExpertActorIdentity" WHERE "userId" = NEW."actorId") THEN
    INSERT INTO "ExpertActorIdentity" ("userId") VALUES (NEW."actorId")
    ON CONFLICT ("userId") DO NOTHING;
  END IF;
  SELECT "subjectId"::text INTO STRICT NEW."actorId"
  FROM "ExpertActorIdentity" WHERE "userId" = NEW."actorId";
  RETURN NEW;
END $$;

CREATE TRIGGER "AuditLog_t10_actor_subject" BEFORE INSERT ON "AuditLog"
  FOR EACH ROW WHEN (starts_with(NEW.action, 'EXPERT_REVIEW_') AND NEW."actorId" IS NOT NULL)
  EXECUTE FUNCTION t10_review_audit_actor();

CREATE TRIGGER "AuditLog_t10_update" BEFORE UPDATE ON "AuditLog"
  FOR EACH ROW WHEN (starts_with(OLD.action, 'EXPERT_REVIEW_') OR starts_with(NEW.action, 'EXPERT_REVIEW_'))
  EXECUTE FUNCTION c031_immutable();
CREATE TRIGGER "AuditLog_t10_delete" BEFORE DELETE ON "AuditLog"
  FOR EACH ROW WHEN (starts_with(OLD.action, 'EXPERT_REVIEW_'))
  EXECUTE FUNCTION c031_immutable();

COMMIT;
