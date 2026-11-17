BEGIN;
CREATE TYPE "ReportReason" AS ENUM ('HARASSMENT','INAPPROPRIATE_CONTENT','IMPERSONATION','SPAM','OTHER');
ALTER TABLE "Block" ADD CONSTRAINT "Block_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Block" ADD CONSTRAINT "Block_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Block" ADD CONSTRAINT "Block_not_self" CHECK ("blockerId" <> "blockedId");
ALTER TABLE "Report" ALTER COLUMN "reporterId" DROP NOT NULL, ALTER COLUMN "targetUserId" DROP NOT NULL;
ALTER TABLE "Report" ADD COLUMN "reasonCode" "ReportReason", ADD COLUMN revision BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"(id) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Report" ADD CONSTRAINT "Report_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"(id) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Report" ADD CONSTRAINT "Report_moderatorId_fkey" FOREIGN KEY ("moderatorId") REFERENCES "User"(id) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Report" ADD CONSTRAINT "Report_not_self" CHECK ("reporterId" IS NULL OR "targetUserId" IS NULL OR "reporterId" <> "targetUserId"), ADD CONSTRAINT "Report_revision_bound" CHECK (revision BETWEEN 0 AND 9007199254740991);
CREATE INDEX "Report_reporterId_createdAt_idx" ON "Report"("reporterId","createdAt");
CREATE INDEX "Report_targetUserId_idx" ON "Report"("targetUserId");
CREATE INDEX "Report_moderatorId_idx" ON "Report"("moderatorId");
CREATE TABLE "ReportModerationAction" (
 id TEXT PRIMARY KEY, "reportId" TEXT NOT NULL, revision BIGINT NOT NULL,
 "fromStatus" "ReportStatus" NOT NULL, "toStatus" "ReportStatus" NOT NULL,
 "actorEvidence" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ReportModerationAction_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "ReportModerationAction_evidence_check" CHECK (revision BETWEEN 1 AND 9007199254740991 AND jsonb_typeof("actorEvidence")='object' AND "actorEvidence" ? 'subject' AND "actorEvidence"-ARRAY['subject']::text[]='{}'::jsonb AND jsonb_typeof("actorEvidence"->'subject')='string' AND length(trim("actorEvidence"->>'subject'))>0)
);
CREATE UNIQUE INDEX "ReportModerationAction_reportId_revision_key" ON "ReportModerationAction"("reportId",revision);
CREATE FUNCTION safety_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Safety evidence is append-only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER "ReportModerationAction_immutable" BEFORE UPDATE OR DELETE ON "ReportModerationAction" FOR EACH ROW EXECUTE FUNCTION safety_immutable();
CREATE TRIGGER "ReportModerationAction_no_truncate" BEFORE TRUNCATE ON "ReportModerationAction" FOR EACH STATEMENT EXECUTE FUNCTION safety_immutable();
CREATE TRIGGER "ReportModerationAction_recorded_at" BEFORE INSERT ON "ReportModerationAction" FOR EACH ROW EXECUTE FUNCTION c031_audit_recorded_at();
CREATE FUNCTION safety_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='TRUNCATE' THEN RAISE EXCEPTION 'Safety audit cannot be truncated' USING ERRCODE='23514'; END IF;
 IF left(OLD.action,7)='SAFETY_' THEN RAISE EXCEPTION 'Safety audit is append-only' USING ERRCODE='23514'; END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER "AuditLog_safety_immutable" BEFORE UPDATE OR DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION safety_audit_immutable();
CREATE TRIGGER "AuditLog_safety_no_truncate" BEFORE TRUNCATE ON "AuditLog" FOR EACH STATEMENT EXECUTE FUNCTION safety_audit_immutable();
COMMIT;
