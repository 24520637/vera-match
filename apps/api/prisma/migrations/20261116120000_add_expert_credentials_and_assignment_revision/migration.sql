BEGIN;
-- Fail without repairing legacy duplicates or inventing missing assignment actors.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "ExpertAssignment" WHERE status IN ('ASSIGNED','IN_PROGRESS','SUBMITTED') GROUP BY "videoId" HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'C031 migration blocked: duplicate active assignments require explicit remediation';
  END IF;
  IF EXISTS (SELECT 1 FROM "ExpertAssignment" a LEFT JOIN "User" u ON u.id = a."assignedById" WHERE u.id IS NULL) THEN
    RAISE EXCEPTION 'C031 migration blocked: orphan assignment actors require explicit remediation';
  END IF;
END $$;
-- CreateEnum
CREATE TYPE "ExpertCredentialStatus" AS ENUM ('PENDING', 'APPROVED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ExpertCredentialEventKind" AS ENUM ('CREATED', 'TRAINING_RECORDED', 'CONFIDENTIALITY_RECORDED', 'VERIFIED', 'APPROVED', 'REVOKED');

-- AlterTable
ALTER TABLE "ExpertAssignment" ADD COLUMN     "assignedByEvidence" JSONB,
ADD COLUMN     "credentialApprovalId" UUID,
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "revision" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "eventFromStatus" "AssignmentStatus",
ADD COLUMN     "eventTransactionId" TEXT,
ALTER COLUMN "assignedById" DROP NOT NULL;

-- Preserve known legacy actor identity without copying names/emails or asserting qualification.
CREATE TABLE "ExpertActorIdentity" (
  "userId" TEXT PRIMARY KEY REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "subjectId" UUID NOT NULL UNIQUE DEFAULT gen_random_uuid()
);
INSERT INTO "ExpertActorIdentity" ("userId") SELECT DISTINCT "assignedById" FROM "ExpertAssignment";
UPDATE "ExpertAssignment" a SET "assignedByEvidence" = jsonb_build_object(
  'subject', i."subjectId"::text, 'source', 'LEGACY_ASSIGNED_BY_ID'
) FROM "ExpertActorIdentity" i WHERE i."userId"=a."assignedById";

-- CreateTable
CREATE TABLE "ExpertCredential" (
    "userId" TEXT NOT NULL,
    "subjectId" UUID NOT NULL DEFAULT gen_random_uuid(),
    "status" "ExpertCredentialStatus" NOT NULL DEFAULT 'PENDING',
    "revision" BIGINT NOT NULL DEFAULT 0,
    "approvalId" UUID,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ExpertCredential_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "ExpertCredentialApproval" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subjectId" UUID NOT NULL,
    "trainingVersion" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "trainingEvidence" JSONB NOT NULL,
    "confidentialityEvidence" JSONB NOT NULL,
    "verifiedByEvidence" JSONB NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL,
    "approvedByEvidence" JSONB NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "ExpertCredentialApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpertCredentialEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subjectId" UUID NOT NULL,
    "revision" BIGINT NOT NULL,
    "kind" "ExpertCredentialEventKind" NOT NULL,
    "status" "ExpertCredentialStatus" NOT NULL,
    "approvalId" UUID,
    "actorEvidence" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "trainingVersion" TEXT,
    "policyVersion" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpertCredentialEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "assignmentId" TEXT NOT NULL,
    "revision" BIGINT NOT NULL,
    "fromStatus" "AssignmentStatus",
    "toStatus" "AssignmentStatus" NOT NULL,
    "credentialApprovalId" UUID,
    "actorEvidence" JSONB NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssignmentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExpertCredential_subjectId_key" ON "ExpertCredential"("subjectId");

-- CreateIndex
CREATE INDEX "ExpertCredentialApproval_subjectId_approvedAt_idx" ON "ExpertCredentialApproval"("subjectId", "approvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExpertCredentialEvent_subjectId_revision_key" ON "ExpertCredentialEvent"("subjectId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentEvent_assignmentId_revision_key" ON "AssignmentEvent"("assignmentId", "revision");

-- CreateIndex
CREATE INDEX "ExpertAssignment_assignedById_idx" ON "ExpertAssignment"("assignedById");

-- CreateIndex
CREATE INDEX "ExpertAssignment_credentialApprovalId_idx" ON "ExpertAssignment"("credentialApprovalId");

-- AddForeignKey
ALTER TABLE "ExpertAssignment" ADD CONSTRAINT "ExpertAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpertAssignment" ADD CONSTRAINT "ExpertAssignment_credentialApprovalId_fkey" FOREIGN KEY ("credentialApprovalId") REFERENCES "ExpertCredentialApproval"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpertCredential" ADD CONSTRAINT "ExpertCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpertCredential" ADD CONSTRAINT "ExpertCredential_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "ExpertCredentialApproval"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpertCredentialEvent" ADD CONSTRAINT "ExpertCredentialEvent_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "ExpertCredentialApproval"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentEvent" ADD CONSTRAINT "AssignmentEvent_credentialApprovalId_fkey" FOREIGN KEY ("credentialApprovalId") REFERENCES "ExpertCredentialApproval"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- All existing assignments are primary; no secondary-assignment feature is introduced.
CREATE UNIQUE INDEX "ExpertAssignment_one_active_video" ON "ExpertAssignment"("videoId")
  WHERE status IN ('ASSIGNED','IN_PROGRESS','SUBMITTED');

CREATE FUNCTION c031_actor(value jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(value) = 'object' AND jsonb_typeof(value->'subject') = 'string'
    AND length(trim(value->>'subject')) > 0
$$;
-- Evidence is either a private object locator or a recoverable, verifiable snapshot.
CREATE FUNCTION c031_evidence(value jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(jsonb_typeof(value) = 'object' AND CASE value->>'kind'
    WHEN 'PRIVATE_REFERENCE' THEN jsonb_typeof(value->'bucket') = 'string'
      AND value - ARRAY['kind','bucket','objectKey']::text[] = '{}'::jsonb
      AND length(trim(value->>'bucket')) > 0 AND jsonb_typeof(value->'objectKey') = 'string'
      AND length(trim(value->>'objectKey')) > 0 AND NOT (value ? 'url')
      AND NOT (value->>'bucket' ~* 'https?://') AND NOT (value->>'objectKey' ~* 'https?://')
    WHEN 'SNAPSHOT' THEN jsonb_typeof(value->'content') = 'string'
      AND value - ARRAY['kind','content','sha256']::text[] = '{}'::jsonb
      AND value->>'sha256' = encode(sha256(convert_to(value->>'content','UTF8')), 'hex')
    ELSE false END, false)
$$;
ALTER TABLE "ExpertCredentialApproval" ADD CONSTRAINT "ExpertCredentialApproval_evidence_check" CHECK (
  length(trim("trainingVersion")) > 0 AND length(trim("policyVersion")) > 0
  AND c031_evidence("trainingEvidence") AND c031_evidence("confidentialityEvidence")
  AND c031_actor("verifiedByEvidence") IS TRUE AND c031_actor("approvedByEvidence") IS TRUE
  AND "verifiedAt" <= "approvedAt" AND ("expiresAt" IS NULL OR "expiresAt" > "approvedAt")
);
ALTER TABLE "ExpertCredential" ADD CONSTRAINT "ExpertCredential_state_check" CHECK (
  revision BETWEEN 0 AND 9007199254740991 AND
  ((status = 'PENDING' AND "approvalId" IS NULL AND "revokedAt" IS NULL)
   OR (status = 'APPROVED' AND "approvalId" IS NOT NULL AND "revokedAt" IS NULL)
   OR (status = 'REVOKED' AND "revokedAt" IS NOT NULL))
);
ALTER TABLE "ExpertAssignment" ADD CONSTRAINT "ExpertAssignment_revision_check" CHECK (revision BETWEEN 0 AND 9007199254740991);
ALTER TABLE "ExpertCredentialEvent" ADD CONSTRAINT "ExpertCredentialEvent_evidence_check" CHECK (
  revision BETWEEN 0 AND 9007199254740991 AND c031_actor("actorEvidence") IS TRUE
  AND c031_evidence(evidence) AND (kind <> 'REVOKED' OR (status = 'REVOKED' AND length(trim(reason)) > 0 AND reason IS NOT NULL))
  AND (kind <> 'REVOKED' OR "revokedAt" IS NOT NULL)
  AND (kind <> 'TRAINING_RECORDED' OR ("trainingVersion" IS NOT NULL AND length(trim("trainingVersion")) > 0))
  AND (kind <> 'CONFIDENTIALITY_RECORDED' OR ("policyVersion" IS NOT NULL AND length(trim("policyVersion")) > 0))
  AND (kind <> 'VERIFIED' OR "verifiedAt" IS NOT NULL)
  AND (kind <> 'APPROVED' OR (status = 'APPROVED' AND "approvalId" IS NOT NULL))
  AND (kind <> 'CREATED' OR (status = 'PENDING' AND "approvalId" IS NULL))
);
ALTER TABLE "AssignmentEvent" ADD CONSTRAINT "AssignmentEvent_evidence_check" CHECK (
  revision BETWEEN 0 AND 9007199254740991 AND c031_actor("actorEvidence") IS TRUE AND jsonb_typeof(snapshot) = 'object'
);

CREATE FUNCTION c031_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'C031 evidence is append-only' USING ERRCODE = '23514'; END $$;
CREATE TRIGGER "ExpertCredentialApproval_immutable" BEFORE UPDATE OR DELETE ON "ExpertCredentialApproval" FOR EACH ROW EXECUTE FUNCTION c031_immutable();
CREATE TRIGGER "ExpertCredentialEvent_immutable" BEFORE UPDATE OR DELETE ON "ExpertCredentialEvent" FOR EACH ROW EXECUTE FUNCTION c031_immutable();
CREATE TRIGGER "AssignmentEvent_immutable" BEFORE UPDATE OR DELETE ON "AssignmentEvent" FOR EACH ROW EXECUTE FUNCTION c031_immutable();
CREATE TRIGGER "ExpertCredentialApproval_no_truncate" BEFORE TRUNCATE ON "ExpertCredentialApproval" FOR EACH STATEMENT EXECUTE FUNCTION c031_immutable();
CREATE TRIGGER "ExpertCredentialEvent_no_truncate" BEFORE TRUNCATE ON "ExpertCredentialEvent" FOR EACH STATEMENT EXECUTE FUNCTION c031_immutable();
CREATE TRIGGER "AssignmentEvent_no_truncate" BEFORE TRUNCATE ON "AssignmentEvent" FOR EACH STATEMENT EXECUTE FUNCTION c031_immutable();

-- Audit recording time is always database-owned, including explicit caller values.
-- clock_timestamp records insertion time, not the start of a long transaction.
CREATE FUNCTION c031_audit_recorded_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."createdAt" := clock_timestamp() AT TIME ZONE 'UTC';
  RETURN NEW;
END $$;
CREATE TRIGGER "AssignmentEvent_recorded_at" BEFORE INSERT ON "AssignmentEvent"
  FOR EACH ROW EXECUTE FUNCTION c031_audit_recorded_at();
CREATE TRIGGER "ExpertCredentialEvent_recorded_at" BEFORE INSERT ON "ExpertCredentialEvent"
  FOR EACH ROW EXECUTE FUNCTION c031_audit_recorded_at();

-- Prevent revision/identity ABA resets while leaving real account deletion cascades intact.
CREATE FUNCTION c031_live_identity_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "User" WHERE id=OLD."userId") THEN
    RAISE EXCEPTION 'C031 live identity cannot be deleted independently of its user'
      USING ERRCODE='23514', CONSTRAINT='c031_live_identity_delete';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER "ExpertCredential_delete" BEFORE DELETE ON "ExpertCredential" FOR EACH ROW EXECUTE FUNCTION c031_live_identity_delete();
CREATE TRIGGER "ExpertCredential_no_truncate" BEFORE TRUNCATE ON "ExpertCredential" FOR EACH STATEMENT EXECUTE FUNCTION c031_immutable();
CREATE TRIGGER "ExpertActorIdentity_immutable" BEFORE UPDATE ON "ExpertActorIdentity" FOR EACH ROW EXECUTE FUNCTION c031_immutable();

CREATE FUNCTION c031_credential_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.revision <> 0 OR NEW.status <> 'PENDING' THEN RAISE EXCEPTION 'Initial credential must be pending at revision zero' USING ERRCODE='23514'; END IF;
  ELSE
    IF NEW."userId" <> OLD."userId" OR NEW."subjectId" <> OLD."subjectId" OR NEW.revision <> OLD.revision + 1 THEN
      RAISE EXCEPTION 'Credential identity is immutable; revision must advance once' USING ERRCODE='23514', CONSTRAINT='c031_credential_revision';
    END IF;
    IF OLD.status = 'REVOKED' AND NEW.status = 'APPROVED' AND NEW."approvalId" IS NOT DISTINCT FROM OLD."approvalId" THEN
      RAISE EXCEPTION 'Reapproval requires a new immutable approval' USING ERRCODE='23514';
    END IF;
    IF NEW."approvalId" IS DISTINCT FROM OLD."approvalId" AND EXISTS (
      SELECT 1 FROM "ExpertCredentialEvent" WHERE "subjectId"=NEW."subjectId" AND "approvalId"=NEW."approvalId" AND kind='APPROVED'
    ) THEN RAISE EXCEPTION 'A historical approval cannot be reactivated' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW."approvalId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "ExpertCredentialApproval" WHERE id = NEW."approvalId" AND "subjectId" = NEW."subjectId"
  ) THEN RAISE EXCEPTION 'Approval belongs to another credential subject' USING ERRCODE='23514', CONSTRAINT='c031_credential_approval_subject'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ExpertCredential_write" BEFORE INSERT OR UPDATE ON "ExpertCredential" FOR EACH ROW EXECUTE FUNCTION c031_credential_write();

CREATE FUNCTION c031_assignment_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- FK SET NULL is identity minimization only, not a domain transition.
    IF OLD."assignedById" IS NOT NULL AND NEW."assignedById" IS NULL
      AND (to_jsonb(NEW) - 'assignedById') = (to_jsonb(OLD) - 'assignedById') THEN RETURN NEW; END IF;
    IF OLD.status IN ('CANCELLED','COMPLETED') THEN RAISE EXCEPTION 'Assignment is terminal' USING ERRCODE='23514', CONSTRAINT='c031_assignment_terminal'; END IF;
    IF NEW.id <> OLD.id OR NEW."videoId" <> OLD."videoId" OR NEW."expertId" <> OLD."expertId"
      OR NEW."credentialApprovalId" IS DISTINCT FROM OLD."credentialApprovalId"
      OR NEW."assignedByEvidence" IS DISTINCT FROM OLD."assignedByEvidence"
      OR NEW."assignedById" IS DISTINCT FROM OLD."assignedById"
      OR NEW."createdAt" <> OLD."createdAt" OR NEW.revision <> OLD.revision + 1 THEN
      RAISE EXCEPTION 'Assignment binding is immutable; revision must advance once' USING ERRCODE='23514', CONSTRAINT='c031_assignment_binding_revision';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
      (OLD.status = 'ASSIGNED' AND NEW.status = 'IN_PROGRESS') OR
      (OLD.status = 'IN_PROGRESS' AND NEW.status = 'SUBMITTED') OR
      (OLD.status = 'SUBMITTED' AND NEW.status IN ('IN_PROGRESS','COMPLETED')) OR NEW.status = 'CANCELLED'
    ) THEN RAISE EXCEPTION 'Invalid assignment transition' USING ERRCODE='23514', CONSTRAINT='c031_assignment_transition'; END IF;
    NEW."eventFromStatus" := OLD.status;
  ELSE
    NEW."eventFromStatus" := NULL;
    IF NEW.status <> 'ASSIGNED' OR NEW.revision <> 0 OR NEW."credentialApprovalId" IS NULL
      OR c031_actor(NEW."assignedByEvidence") IS NOT TRUE THEN
      RAISE EXCEPTION 'New assignment requires initial state, approval and retained actor evidence' USING ERRCODE='23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "ExpertCredential" WHERE "userId"=NEW."expertId" AND "approvalId"=NEW."credentialApprovalId") THEN
      RAISE EXCEPTION 'Assignment approval must belong to the expert' USING ERRCODE='23514';
    END IF;
  END IF;
  NEW."eventTransactionId" := pg_current_xact_id()::text;
  IF (NEW.status = 'CANCELLED') <> (NEW."cancelledAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'Cancellation timestamp must match state' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ExpertAssignment_write" BEFORE INSERT OR UPDATE ON "ExpertAssignment" FOR EACH ROW EXECUTE FUNCTION c031_assignment_write();

-- Writers first mutate current state, then append evidence, before committing.
CREATE FUNCTION c031_event_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='ExpertCredentialEvent' THEN
    IF NOT EXISTS (SELECT 1 FROM "ExpertCredential" WHERE "subjectId"=NEW."subjectId"
      AND revision=NEW.revision AND status=NEW.status AND "approvalId" IS NOT DISTINCT FROM NEW."approvalId"
      AND "revokedAt" IS NOT DISTINCT FROM NEW."revokedAt") THEN
      RAISE EXCEPTION 'Credential event must match live transaction state' USING ERRCODE='23514';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM "ExpertAssignment" a WHERE id=NEW."assignmentId" AND revision=NEW.revision
      AND status=NEW."toStatus" AND "credentialApprovalId" IS NOT DISTINCT FROM NEW."credentialApprovalId"
      AND "eventTransactionId"=pg_current_xact_id()::text
      AND "eventFromStatus" IS NOT DISTINCT FROM NEW."fromStatus"
      AND (to_jsonb(a)-ARRAY['assignedById','expertId','eventFromStatus','eventTransactionId']::text[])=NEW.snapshot) THEN
      RAISE EXCEPTION 'Assignment event requires the matching mutation in this transaction' USING ERRCODE='23514', CONSTRAINT='c031_assignment_event_mutation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ExpertCredentialEvent_binding" BEFORE INSERT ON "ExpertCredentialEvent" FOR EACH ROW EXECUTE FUNCTION c031_event_binding();
CREATE TRIGGER "AssignmentEvent_binding" BEFORE INSERT ON "AssignmentEvent" FOR EACH ROW EXECUTE FUNCTION c031_event_binding();

-- Deferred checks require state and matching event to commit in the same transaction.
-- Legacy rows receive no fabricated history; their first future mutation has revision 1.
CREATE FUNCTION c031_credential_event_required() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "ExpertCredentialEvent" WHERE "subjectId"=NEW."subjectId"
    AND revision=NEW.revision AND status=NEW.status AND "approvalId" IS NOT DISTINCT FROM NEW."approvalId"
    AND "revokedAt" IS NOT DISTINCT FROM NEW."revokedAt") THEN
    RAISE EXCEPTION 'Matching credential event required in transaction' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND NEW.status='REVOKED' AND (OLD.status<>'REVOKED' OR NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt")
    AND NOT EXISTS (SELECT 1 FROM "ExpertCredentialEvent" WHERE "subjectId"=NEW."subjectId" AND revision=NEW.revision AND kind='REVOKED') THEN
    RAISE EXCEPTION 'Revocation transition requires revocation evidence' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND EXISTS (SELECT 1 FROM "ExpertCredentialEvent" WHERE "subjectId"=NEW."subjectId"
    AND revision=NEW.revision AND kind='APPROVED') AND NEW."approvalId" IS NOT DISTINCT FROM OLD."approvalId" THEN
    RAISE EXCEPTION 'Reapproval must create a new approval instance' USING ERRCODE='23514';
  END IF;
  IF (TG_OP='INSERT' AND NEW.status='PENDING' AND NOT EXISTS (SELECT 1 FROM "ExpertCredentialEvent"
    WHERE "subjectId"=NEW."subjectId" AND revision=NEW.revision AND kind='CREATED')) THEN
    RAISE EXCEPTION 'Initial pending credential requires creation evidence' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND (NEW."approvalId" IS DISTINCT FROM OLD."approvalId" OR (NEW.status='APPROVED' AND OLD.status<>'APPROVED'))
    AND NOT EXISTS (SELECT 1 FROM "ExpertCredentialEvent" WHERE "subjectId"=NEW."subjectId" AND revision=NEW.revision AND kind='APPROVED') THEN
    RAISE EXCEPTION 'Approval transition requires approval event' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "ExpertCredential_event_required" AFTER INSERT OR UPDATE ON "ExpertCredential"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION c031_credential_event_required();

CREATE FUNCTION c031_assignment_event_required() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous "AssignmentStatus";
BEGIN
  IF TG_OP='UPDATE' THEN
    IF OLD."assignedById" IS NOT NULL AND NEW."assignedById" IS NULL AND
      (to_jsonb(NEW)-'assignedById')=(to_jsonb(OLD)-'assignedById') THEN RETURN NULL; END IF;
    previous := OLD.status;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "AssignmentEvent" WHERE "assignmentId"=NEW.id AND revision=NEW.revision
    AND "fromStatus" IS NOT DISTINCT FROM previous AND "toStatus"=NEW.status
    AND "credentialApprovalId" IS NOT DISTINCT FROM NEW."credentialApprovalId"
    AND snapshot=(to_jsonb(NEW)-ARRAY['assignedById','expertId','eventFromStatus','eventTransactionId']::text[])) THEN
    RAISE EXCEPTION 'Matching assignment event required in transaction' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "ExpertAssignment_event_required" AFTER INSERT OR UPDATE ON "ExpertAssignment"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION c031_assignment_event_required();
COMMIT;
