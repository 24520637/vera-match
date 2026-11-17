BEGIN;
ALTER TABLE "ExpertAssignment"
  ADD COLUMN "reviewConsentSubjectId" UUID,
  ADD COLUMN "reviewConsentVersion" BIGINT;
ALTER TABLE "ExpertAssignment" ADD CONSTRAINT "ExpertAssignment_review_generation_check" CHECK (
  ("reviewConsentSubjectId" IS NULL AND "reviewConsentVersion" IS NULL) OR
  ("reviewConsentSubjectId" IS NOT NULL AND "reviewConsentVersion" IS NOT NULL
    AND "reviewConsentVersion" BETWEEN 0 AND 9007199254740991)
);
ALTER TABLE "ExpertAssignment" ADD CONSTRAINT "ExpertAssignment_review_subject_fkey"
  FOREIGN KEY ("reviewConsentSubjectId") REFERENCES "ConsentSubject"(id) ON DELETE RESTRICT;
-- Preserve legacy NULLs without inventing consent. Future lifecycle writes may
-- not rebind a committed assignment to a later grant after withdrawal.
CREATE FUNCTION c033_immutable_review_generation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."reviewConsentSubjectId" IS DISTINCT FROM OLD."reviewConsentSubjectId"
    OR NEW."reviewConsentVersion" IS DISTINCT FROM OLD."reviewConsentVersion" THEN
    RAISE EXCEPTION 'Assignment review consent binding is immutable'
      USING ERRCODE='23514', CONSTRAINT='c033_review_generation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ExpertAssignment_review_generation" BEFORE UPDATE ON "ExpertAssignment"
  FOR EACH ROW EXECUTE FUNCTION c033_immutable_review_generation();

CREATE TABLE "AssignmentIdempotency" (
  "actorSubjectId" UUID NOT NULL,
  operation TEXT NOT NULL,
  "keyHash" TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  response JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssignmentIdempotency_pkey" PRIMARY KEY ("actorSubjectId", operation, "keyHash"),
  CONSTRAINT "AssignmentIdempotency_hash_check" CHECK (
    operation='CREATE_ASSIGNMENT' AND "keyHash" ~ '^[a-f0-9]{64}$' AND fingerprint ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "AssignmentIdempotency_identity_fkey" FOREIGN KEY ("assignmentId")
    REFERENCES "ExpertAssignmentIdentity"("assignmentId") ON DELETE RESTRICT
);
CREATE INDEX "AssignmentIdempotency_assignmentId_idx" ON "AssignmentIdempotency"("assignmentId");
CREATE TRIGGER "AssignmentIdempotency_immutable" BEFORE UPDATE OR DELETE ON "AssignmentIdempotency"
  FOR EACH ROW EXECUTE FUNCTION c031_immutable();
CREATE TRIGGER "AssignmentIdempotency_no_truncate" BEFORE TRUNCATE ON "AssignmentIdempotency"
  FOR EACH STATEMENT EXECUTE FUNCTION c031_immutable();
COMMIT;
