BEGIN;

-- Keep the backfill and trigger installation atomic with respect to audit writes.
LOCK TABLE "AuditLog" IN SHARE ROW EXCLUSIVE MODE;

INSERT INTO "ExpertActorIdentity" ("userId")
SELECT DISTINCT u.id FROM "User" u JOIN "AuditLog" a ON a."actorId" = u.id
WHERE starts_with(a.action, 'REVIEW_CLAIM_') OR starts_with(a.action, 'REVIEW_DISPUTE_')
  OR a.action = 'REVIEW_CLAIMS_APPROVED'
ON CONFLICT ("userId") DO NOTHING;

-- Remove old raw account IDs. An actor whose account is gone has no reliable
-- mapping; keep the event with a null actor without inventing an identity.
UPDATE "AuditLog" a SET "actorId" = (
  SELECT i."subjectId"::text FROM "ExpertActorIdentity" i WHERE i."userId" = a."actorId"
)
WHERE (starts_with(a.action, 'REVIEW_CLAIM_') OR starts_with(a.action, 'REVIEW_DISPUTE_')
    OR a.action = 'REVIEW_CLAIMS_APPROVED')
  AND a."actorId" IS NOT NULL;

CREATE TRIGGER "AuditLog_t12_actor_subject" BEFORE INSERT ON "AuditLog"
  FOR EACH ROW WHEN (NEW."actorId" IS NOT NULL
    AND (starts_with(NEW.action, 'REVIEW_CLAIM_') OR starts_with(NEW.action, 'REVIEW_DISPUTE_')
      OR NEW.action = 'REVIEW_CLAIMS_APPROVED'))
  EXECUTE FUNCTION t10_review_audit_actor();

CREATE TRIGGER "AuditLog_t12_update" BEFORE UPDATE ON "AuditLog"
  FOR EACH ROW WHEN (starts_with(OLD.action, 'REVIEW_CLAIM_') OR starts_with(OLD.action, 'REVIEW_DISPUTE_')
    OR starts_with(NEW.action, 'REVIEW_CLAIM_') OR starts_with(NEW.action, 'REVIEW_DISPUTE_')
    OR OLD.action = 'REVIEW_CLAIMS_APPROVED' OR NEW.action = 'REVIEW_CLAIMS_APPROVED')
  EXECUTE FUNCTION c031_immutable();

CREATE TRIGGER "AuditLog_t12_delete" BEFORE DELETE ON "AuditLog"
  FOR EACH ROW WHEN (starts_with(OLD.action, 'REVIEW_CLAIM_') OR starts_with(OLD.action, 'REVIEW_DISPUTE_')
    OR OLD.action = 'REVIEW_CLAIMS_APPROVED')
  EXECUTE FUNCTION c031_immutable();

COMMIT;
