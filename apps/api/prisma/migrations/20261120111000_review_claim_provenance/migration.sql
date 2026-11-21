BEGIN;

ALTER TABLE "ReviewClaim"
  ADD COLUMN "ownerId" TEXT,
  ADD COLUMN "reviewVersion" INTEGER,
  ADD COLUMN "sourceObservationId" TEXT,
  ADD COLUMN "sourceCategory" "ObservationCategory",
  ADD COLUMN "sourceStartMs" INTEGER,
  ADD COLUMN "sourceEndMs" INTEGER,
  ADD COLUMN "transcript" TEXT,
  ADD COLUMN "context" TEXT,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision" >= 0),
  ADD COLUMN "shareConsentSubjectId" UUID,
  ADD COLUMN "shareConsentVersion" BIGINT;

-- Legacy rows lack verified provenance and are ineligible at the read boundary.
ALTER TABLE "ReviewClaim" ADD CONSTRAINT "ReviewClaim_t12_provenance" CHECK (
  "reviewVersion" IS NULL OR (
    "reviewVersion" >= 2 AND "ownerId" IS NOT NULL AND "qaApproved"
    AND "sourceObservationId" IS NOT NULL AND "sourceCategory" IS NOT NULL AND "sourceCategory" = 'SPEECH'
    AND "sourceStartMs" IS NOT NULL AND "sourceEndMs" IS NOT NULL
    AND "sourceStartMs" >= 0 AND "sourceEndMs" >= "sourceStartMs"
    AND "context" IS NOT NULL AND length(btrim("context")) BETWEEN 1 AND 1000
    AND ("transcript" IS NULL OR length(btrim("transcript")) BETWEEN 1 AND 2000)
    AND (NOT "shareApproved" OR ("ownerConfirmed" AND "revokedAt" IS NULL AND
      "shareConsentSubjectId" IS NOT NULL AND "shareConsentVersion" IS NOT NULL AND "shareConsentVersion" >= 0))
  )
);
CREATE UNIQUE INDEX "ReviewClaim_reviewId_claimType_t12_key" ON "ReviewClaim" ("reviewId", "claimType")
  WHERE "reviewVersion" IS NOT NULL;
CREATE INDEX "ReviewClaim_ownerId_shareApproved_revokedAt_idx" ON "ReviewClaim" ("ownerId", "shareApproved", "revokedAt");

COMMIT;
