BEGIN;
CREATE TYPE "AssignmentCancellationReason" AS ENUM ('VIDEO_DELETED','VIDEO_STORAGE_WITHDRAWN','EXPERT_VIDEO_REVIEW_WITHDRAWN');
CREATE TABLE "AssignmentCancellationContext" (
 "eventId" UUID PRIMARY KEY REFERENCES "AssignmentEvent"(id) ON DELETE RESTRICT,
 reason "AssignmentCancellationReason" NOT NULL,
 "sourceTaskId" UUID REFERENCES "ConsentWithdrawalTask"(id) ON DELETE RESTRICT,
 "initiatorEvidence" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "AssignmentCancellationContext_source_check" CHECK ((reason='VIDEO_DELETED' AND "sourceTaskId" IS NULL) OR (reason<>'VIDEO_DELETED' AND "sourceTaskId" IS NOT NULL)),
 CONSTRAINT "AssignmentCancellationContext_initiator_check" CHECK (COALESCE((
  "initiatorEvidence"='{"kind":"UNKNOWN"}'::jsonb OR
  (jsonb_typeof("initiatorEvidence")='object' AND "initiatorEvidence"->>'kind' IN ('ACCOUNT','CONSENT_SUBJECT')
   AND "initiatorEvidence" ? 'subject' AND jsonb_typeof("initiatorEvidence"->'subject')='string'
   AND length(trim("initiatorEvidence"->>'subject'))>0 AND "initiatorEvidence"-ARRAY['kind','subject']::text[]='{}'::jsonb)),false))
);
CREATE INDEX "AssignmentCancellationContext_sourceTaskId_idx" ON "AssignmentCancellationContext"("sourceTaskId");
CREATE TABLE "AssignmentWithdrawalReceipt" (
 "withdrawalTaskId" UUID PRIMARY KEY REFERENCES "ConsentWithdrawalTask"(id) ON DELETE RESTRICT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE FUNCTION c051_context_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e "AssignmentEvent"; a "ExpertAssignment"; v "Video"; t "ConsentWithdrawalTask"; c "ConsentEvent";
BEGIN
 SELECT * INTO e FROM "AssignmentEvent" WHERE id=NEW."eventId";
 SELECT * INTO a FROM "ExpertAssignment" WHERE id=e."assignmentId";
 IF e.id IS NULL OR a.id IS NULL OR e."toStatus"<>'CANCELLED' OR a.status<>'CANCELLED'
   OR e.revision<>a.revision OR a."eventTransactionId" IS DISTINCT FROM pg_current_xact_id()::text THEN
  RAISE EXCEPTION 'Cancellation context requires its own transactional transition' USING ERRCODE='23514';
 END IF;
 SELECT * INTO v FROM "Video" WHERE id=a."videoId";
 IF NEW.reason='VIDEO_DELETED' THEN
  IF v.status<>'DELETED' THEN RAISE EXCEPTION 'Deleted video required' USING ERRCODE='23514'; END IF;
  IF NEW."initiatorEvidence"->>'kind'='ACCOUNT' THEN
   IF e."actorEvidence"->>'subject' IS DISTINCT FROM NEW."initiatorEvidence"->>'subject' OR NOT EXISTS
    (SELECT 1 FROM "ExpertActorIdentity" WHERE "userId"=v."ownerId" AND "subjectId"::text=NEW."initiatorEvidence"->>'subject') THEN
     RAISE EXCEPTION 'Owner actor binding required' USING ERRCODE='23514'; END IF;
  ELSIF NEW."initiatorEvidence"<>'{"kind":"UNKNOWN"}'::jsonb OR e."actorEvidence"->>'subject'<>'system:assignment-cancellation:v1' THEN
   RAISE EXCEPTION 'System actor binding required' USING ERRCODE='23514';
  END IF;
 ELSE
  SELECT * INTO t FROM "ConsentWithdrawalTask" WHERE id=NEW."sourceTaskId";
  SELECT * INTO c FROM "ConsentEvent" WHERE id=t."eventId";
  IF t.id IS NULL OR c.id IS NULL OR c."newGranted" OR c."subjectId"<>t."subjectId" OR c.purpose<>t.purpose OR c."nextVersion"<>t.version
    OR NEW.reason::text<>(t.purpose::text || '_WITHDRAWN')
    OR e."actorEvidence"->>'subject'<>'system:assignment-cancellation:v1'
    OR NEW."initiatorEvidence"<>jsonb_build_object('kind','CONSENT_SUBJECT','subject',t."subjectId"::text) THEN
   RAISE EXCEPTION 'Withdrawal source binding required' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "ConsentLedger" WHERE "subjectId"=t."subjectId" AND "userId"=v."ownerId") THEN
   RAISE EXCEPTION 'Withdrawal owner binding required' USING ERRCODE='23514'; END IF;
  IF t.purpose='EXPERT_VIDEO_REVIEW' THEN
   IF ((a."reviewConsentSubjectId"=t."subjectId" AND a."reviewConsentVersion"<t.version) OR
     (a."reviewConsentSubjectId" IS NULL AND a."reviewConsentVersion" IS NULL)) IS NOT TRUE THEN
    RAISE EXCEPTION 'Withdrawal review generation required' USING ERRCODE='23514'; END IF;
  END IF;
  IF t.purpose='VIDEO_STORAGE' THEN
   IF (v."storageConsentVersion"<t.version OR v."storageConsentVersion" IS NULL) IS NOT TRUE THEN
    RAISE EXCEPTION 'Withdrawal storage generation required' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "AssignmentCancellationContext_binding" BEFORE INSERT ON "AssignmentCancellationContext" FOR EACH ROW EXECUTE FUNCTION c051_context_binding();
CREATE TRIGGER "AssignmentCancellationContext_recorded_at" BEFORE INSERT ON "AssignmentCancellationContext" FOR EACH ROW EXECUTE FUNCTION c031_audit_recorded_at();
CREATE TRIGGER "AssignmentWithdrawalReceipt_recorded_at" BEFORE INSERT ON "AssignmentWithdrawalReceipt" FOR EACH ROW EXECUTE FUNCTION c031_audit_recorded_at();
CREATE TRIGGER "AssignmentCancellationContext_immutable" BEFORE UPDATE OR DELETE ON "AssignmentCancellationContext" FOR EACH ROW EXECUTE FUNCTION c031_immutable();
CREATE TRIGGER "AssignmentCancellationContext_no_truncate" BEFORE TRUNCATE ON "AssignmentCancellationContext" FOR EACH STATEMENT EXECUTE FUNCTION c031_immutable();
CREATE TRIGGER "AssignmentWithdrawalReceipt_immutable" BEFORE UPDATE OR DELETE ON "AssignmentWithdrawalReceipt" FOR EACH ROW EXECUTE FUNCTION c031_immutable();
CREATE TRIGGER "AssignmentWithdrawalReceipt_no_truncate" BEFORE TRUNCATE ON "AssignmentWithdrawalReceipt" FOR EACH STATEMENT EXECUTE FUNCTION c031_immutable();
COMMIT;
