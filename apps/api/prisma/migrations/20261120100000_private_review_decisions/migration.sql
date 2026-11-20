BEGIN;

CREATE TABLE "ReviewDecision" (
  "reviewId" TEXT NOT NULL REFERENCES "ExpertReview"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "version" INTEGER NOT NULL CHECK ("version" >= 2),
  "status" "ReviewStatus" NOT NULL,
  "moderatorId" TEXT NOT NULL,
  "reason" TEXT,
  "decidedAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("reviewId", "version"),
  CHECK (("status" = 'RETURNED' AND "reason" IS NOT NULL AND length(btrim("reason")) BETWEEN 1 AND 2000)
    OR ("status" = 'APPROVED' AND "reason" IS NULL))
);

COMMIT;
