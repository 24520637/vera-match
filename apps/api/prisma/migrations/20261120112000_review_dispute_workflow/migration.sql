BEGIN;

ALTER TABLE "ReviewClaim" ADD CONSTRAINT "ReviewClaim_id_reviewId_key" UNIQUE ("id", "reviewId");

ALTER TABLE "ReviewDispute"
  ADD COLUMN "claimId" TEXT,
  ADD COLUMN "reviewVersion" INTEGER,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "inReviewAt" TIMESTAMP(3),
  ADD CONSTRAINT "ReviewDispute_claimId_reviewId_fkey" FOREIGN KEY ("claimId", "reviewId")
    REFERENCES "ReviewClaim" ("id", "reviewId") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ReviewDispute_t12_lifecycle" CHECK (
    "reviewVersion" IS NULL OR (
      "reviewVersion" >= 2 AND length(btrim("reason")) BETWEEN 1 AND 2000 AND (
        ("status" = 'OPEN' AND "revision" = 0 AND "inReviewAt" IS NULL
          AND "resolvedAt" IS NULL AND "resolution" IS NULL)
        OR ("status" = 'IN_REVIEW' AND "revision" = 1 AND "inReviewAt" IS NOT NULL
          AND "resolvedAt" IS NULL AND "resolution" IS NULL)
        OR ("status" IN ('RESOLVED', 'REJECTED') AND "revision" = 2 AND "inReviewAt" IS NOT NULL
          AND "resolvedAt" IS NOT NULL AND "resolvedAt" >= "inReviewAt"
          AND "resolution" IS NOT NULL AND length(btrim("resolution")) BETWEEN 1 AND 2000)
      )
    )
  );

CREATE UNIQUE INDEX "ReviewDispute_open_review_version_key" ON "ReviewDispute" ("reviewId", "reviewVersion")
  WHERE "reviewVersion" IS NOT NULL AND "status" IN ('OPEN', 'IN_REVIEW');
CREATE INDEX "ReviewDispute_reviewId_reviewVersion_status_idx" ON "ReviewDispute" ("reviewId", "reviewVersion", "status");

COMMIT;
