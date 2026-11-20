BEGIN;

-- PA2 stores explicit metadata grants only. No creator/global/legacy backfill.
CREATE TYPE "AssignmentModeratorGrantKind" AS ENUM ('GRANTED', 'REVOKED');
CREATE TABLE "AssignmentModeratorScope" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "assignmentId" TEXT NOT NULL REFERENCES "ExpertAssignmentIdentity"("assignmentId") ON DELETE RESTRICT ON UPDATE NO ACTION,
  "moderatorSubjectId" UUID NOT NULL,
  revision BIGINT NOT NULL DEFAULT 0 CHECK (revision BETWEEN 0 AND 9007199254740991),
  "currentGrantId" UUID UNIQUE,
  "eventFromGrantId" UUID,
  "eventTransactionId" TEXT,
  UNIQUE ("assignmentId", "moderatorSubjectId")
);
CREATE INDEX "AssignmentModeratorScope_moderatorSubjectId_assignmentId_idx"
  ON "AssignmentModeratorScope" ("moderatorSubjectId", "assignmentId");
CREATE TABLE "AssignmentModeratorGrantEvent" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "scopeId" UUID NOT NULL REFERENCES "AssignmentModeratorScope"(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  revision BIGINT NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  kind "AssignmentModeratorGrantKind" NOT NULL,
  "grantId" UUID NOT NULL REFERENCES "AssignmentModeratorGrantEvent"(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  "fromGrantId" UUID,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL CHECK (isfinite("expiresAt")),
  "actorEvidence" JSONB NOT NULL CHECK (c031_actor("actorEvidence") IS TRUE),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  UNIQUE ("scopeId", revision)
);
CREATE INDEX "AssignmentModeratorGrantEvent_grantId_kind_idx" ON "AssignmentModeratorGrantEvent" ("grantId", kind);
ALTER TABLE "AssignmentModeratorScope" ADD CONSTRAINT "AssignmentModeratorScope_currentGrantId_fkey"
  FOREIGN KEY ("currentGrantId") REFERENCES "AssignmentModeratorGrantEvent"(id)
  ON DELETE RESTRICT ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION c035_scope_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous_expiry TIMESTAMPTZ;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.revision <> 0 OR NEW."currentGrantId" IS NOT NULL THEN
      RAISE EXCEPTION 'Scope must initialize without authority at revision zero' USING ERRCODE='23514';
    END IF;
    NEW."eventFromGrantId" := NULL;
    NEW."eventTransactionId" := NULL;
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW."assignmentId" <> OLD."assignmentId"
    OR NEW."moderatorSubjectId" <> OLD."moderatorSubjectId" OR NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'Scope identity is immutable; revision must advance once' USING ERRCODE='23514';
  END IF;
  IF NEW."currentGrantId" IS NOT DISTINCT FROM OLD."currentGrantId" THEN
    RAISE EXCEPTION 'A scope mutation must grant or revoke a lifecycle' USING ERRCODE='23514';
  END IF;
  IF NEW."currentGrantId" IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM "AssignmentModeratorGrantEvent" WHERE id=NEW."currentGrantId") THEN
      RAISE EXCEPTION 'Historical grants cannot be reactivated' USING ERRCODE='23514';
    END IF;
    IF OLD."currentGrantId" IS NOT NULL THEN
      SELECT "expiresAt" INTO previous_expiry FROM "AssignmentModeratorGrantEvent" WHERE id=OLD."currentGrantId";
      IF previous_expiry IS NULL OR previous_expiry > clock_timestamp() THEN
        RAISE EXCEPTION 'Revoke an unexpired grant before a new lifecycle' USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  NEW."eventFromGrantId" := OLD."currentGrantId";
  NEW."eventTransactionId" := pg_current_xact_id()::text;
  RETURN NEW;
END $$;
CREATE TRIGGER "AssignmentModeratorScope_mutation" BEFORE INSERT OR UPDATE ON "AssignmentModeratorScope"
  FOR EACH ROW EXECUTE FUNCTION c035_scope_mutation();

CREATE FUNCTION c035_grant_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s "AssignmentModeratorScope"; origin "AssignmentModeratorGrantEvent";
BEGIN
  SELECT * INTO s FROM "AssignmentModeratorScope" WHERE id=NEW."scopeId" FOR UPDATE;
  IF NOT FOUND OR s.revision <> NEW.revision OR s."eventTransactionId" IS DISTINCT FROM pg_current_xact_id()::text
    OR NEW."fromGrantId" IS DISTINCT FROM s."eventFromGrantId" THEN
    RAISE EXCEPTION 'Grant event requires a matching scope mutation in this transaction' USING ERRCODE='23514';
  END IF;
  NEW."createdAt" := clock_timestamp();
  IF NEW.kind='GRANTED' THEN
    IF NEW.id <> NEW."grantId" OR s."currentGrantId" IS DISTINCT FROM NEW.id
      OR NEW."expiresAt" <= clock_timestamp() THEN
      RAISE EXCEPTION 'New grant requires a new lifecycle and future database expiry' USING ERRCODE='23514';
    END IF;
  ELSE
    SELECT * INTO origin FROM "AssignmentModeratorGrantEvent" WHERE id=NEW."grantId";
    IF s."currentGrantId" IS NOT NULL OR NEW."grantId" IS DISTINCT FROM s."eventFromGrantId"
      OR origin.id IS NULL OR origin.kind <> 'GRANTED' OR origin."scopeId" <> NEW."scopeId"
      OR origin."expiresAt" IS DISTINCT FROM NEW."expiresAt" THEN
      RAISE EXCEPTION 'Revocation must retain the original lifecycle and expiry' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "AssignmentModeratorGrantEvent_binding" BEFORE INSERT ON "AssignmentModeratorGrantEvent"
  FOR EACH ROW EXECUTE FUNCTION c035_grant_event();

CREATE FUNCTION c035_scope_event_required() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.revision > 0 AND NOT EXISTS (SELECT 1 FROM "AssignmentModeratorGrantEvent" e
    WHERE e."scopeId"=NEW.id AND e.revision=NEW.revision AND e."fromGrantId" IS NOT DISTINCT FROM NEW."eventFromGrantId"
      AND ((e.kind='GRANTED' AND e.id=NEW."currentGrantId")
        OR (e.kind='REVOKED' AND NEW."currentGrantId" IS NULL AND e."grantId"=NEW."eventFromGrantId"))) THEN
    RAISE EXCEPTION 'Matching grant event required at commit' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "AssignmentModeratorScope_event_required" AFTER INSERT OR UPDATE ON "AssignmentModeratorScope"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION c035_scope_event_required();
CREATE TRIGGER "AssignmentModeratorScope_no_delete" BEFORE DELETE ON "AssignmentModeratorScope"
  FOR EACH ROW EXECUTE FUNCTION c031_immutable();
CREATE TRIGGER "AssignmentModeratorScope_no_truncate" BEFORE TRUNCATE ON "AssignmentModeratorScope"
  FOR EACH STATEMENT EXECUTE FUNCTION c031_immutable();
CREATE TRIGGER "AssignmentModeratorGrantEvent_immutable" BEFORE UPDATE OR DELETE ON "AssignmentModeratorGrantEvent"
  FOR EACH ROW EXECUTE FUNCTION c031_immutable();
CREATE TRIGGER "AssignmentModeratorGrantEvent_no_truncate" BEFORE TRUNCATE ON "AssignmentModeratorGrantEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION c031_immutable();
COMMIT;
