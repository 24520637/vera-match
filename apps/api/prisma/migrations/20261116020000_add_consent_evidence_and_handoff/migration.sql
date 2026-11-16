-- CreateEnum
CREATE TYPE "ConsentEventKind" AS ENUM ('STATE_CHANGED', 'OFF_REAFFIRMED', 'GRANT_REAFFIRMED', 'POLICY_RECONSENT');

-- AlterTable
ALTER TABLE "Consent" ADD COLUMN     "policyEvidenceId" UUID,
ADD COLUMN     "policyVersion" TEXT;

-- CreateTable
CREATE TABLE "ConsentSubject" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),

    CONSTRAINT "ConsentSubject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentLedger" (
    "userId" TEXT NOT NULL,
    "subjectId" UUID NOT NULL,
    "version" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "ConsentLedger_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "ConsentPolicyEvidence" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "purpose" "ConsentPurpose" NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "testOnly" BOOLEAN NOT NULL DEFAULT false,
    "algorithm" TEXT NOT NULL DEFAULT 'SHA-256',
    "encoding" TEXT NOT NULL DEFAULT 'UTF-8',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentPolicyEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subjectId" UUID NOT NULL,
    "purpose" "ConsentPurpose" NOT NULL,
    "oldGranted" BOOLEAN NOT NULL,
    "newGranted" BOOLEAN NOT NULL,
    "kind" "ConsentEventKind" NOT NULL,
    "previousVersion" BIGINT NOT NULL,
    "nextVersion" BIGINT NOT NULL,
    "policyVersion" TEXT,
    "policyEvidenceId" UUID,
    "evidenceGap" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentIdempotency" (
    "subjectId" UUID NOT NULL,
    "keyHash" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentIdempotency_pkey" PRIMARY KEY ("subjectId","keyHash")
);

-- CreateTable
CREATE TABLE "ConsentWithdrawalTask" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subjectId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "purpose" "ConsentPurpose" NOT NULL,
    "version" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastErrorCode" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsentWithdrawalTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConsentLedger_subjectId_key" ON "ConsentLedger"("subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentPolicyEvidence_purpose_policyVersion_locale_key" ON "ConsentPolicyEvidence"("purpose", "policyVersion", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentEvent_subjectId_nextVersion_purpose_key" ON "ConsentEvent"("subjectId", "nextVersion", "purpose");

-- CreateIndex
CREATE INDEX "ConsentIdempotency_expiresAt_idx" ON "ConsentIdempotency"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentWithdrawalTask_eventId_key" ON "ConsentWithdrawalTask"("eventId");

-- CreateIndex
CREATE INDEX "ConsentWithdrawalTask_status_nextAttemptAt_idx" ON "ConsentWithdrawalTask"("status", "nextAttemptAt");

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_policyEvidenceId_fkey" FOREIGN KEY ("policyEvidenceId") REFERENCES "ConsentPolicyEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentLedger" ADD CONSTRAINT "ConsentLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentLedger" ADD CONSTRAINT "ConsentLedger_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "ConsentSubject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentEvent" ADD CONSTRAINT "ConsentEvent_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "ConsentSubject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentEvent" ADD CONSTRAINT "ConsentEvent_policyEvidenceId_fkey" FOREIGN KEY ("policyEvidenceId") REFERENCES "ConsentPolicyEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentIdempotency" ADD CONSTRAINT "ConsentIdempotency_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "ConsentSubject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentWithdrawalTask" ADD CONSTRAINT "ConsentWithdrawalTask_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "ConsentSubject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentWithdrawalTask" ADD CONSTRAINT "ConsentWithdrawalTask_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ConsentEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Application JSON versions must stay exact; no rollover or reset.
ALTER TABLE "ConsentLedger" ADD CONSTRAINT "ConsentLedger_version_safe_check"
    CHECK ("version" >= 0 AND "version" <= 9007199254740991);
ALTER TABLE "ConsentEvent" ADD CONSTRAINT "ConsentEvent_version_check"
    CHECK ("previousVersion" >= 0 AND "nextVersion" = "previousVersion" + 1 AND "nextVersion" <= 9007199254740991);
ALTER TABLE "ConsentEvent" ADD CONSTRAINT "ConsentEvent_grant_evidence_check"
    CHECK (NOT "newGranted" OR "policyEvidenceId" IS NOT NULL);
ALTER TABLE "ConsentPolicyEvidence" ADD CONSTRAINT "ConsentPolicyEvidence_digest_check"
    CHECK ("digest" ~ '^[a-f0-9]{64}$' AND "algorithm" = 'SHA-256' AND "encoding" = 'UTF-8');
ALTER TABLE "ConsentWithdrawalTask" ADD CONSTRAINT "ConsentWithdrawalTask_attempts_check" CHECK ("attempts" >= 0);

-- Ordinary application DML cannot rewrite, remove or truncate retained evidence.
-- No retention purge is authorized here. A reviewed privileged expiry process
-- and production DB-role restrictions remain pre-production requirements.
CREATE FUNCTION consent_evidence_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Consent evidence is append-only' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER consent_event_immutable BEFORE UPDATE OR DELETE ON "ConsentEvent"
    FOR EACH ROW EXECUTE FUNCTION consent_evidence_immutable();
CREATE TRIGGER consent_event_no_truncate BEFORE TRUNCATE ON "ConsentEvent"
    FOR EACH STATEMENT EXECUTE FUNCTION consent_evidence_immutable();
CREATE TRIGGER consent_policy_immutable BEFORE UPDATE OR DELETE ON "ConsentPolicyEvidence"
    FOR EACH ROW EXECUTE FUNCTION consent_evidence_immutable();
CREATE TRIGGER consent_policy_no_truncate BEFORE TRUNCATE ON "ConsentPolicyEvidence"
    FOR EACH STATEMENT EXECUTE FUNCTION consent_evidence_immutable();
