BEGIN;

CREATE TYPE "ReviewClaimFeedbackTarget" AS ENUM ('TRANSCRIPT', 'CONTEXT');

CREATE TABLE "ReviewClaimFeedback" (
  "claimId" TEXT NOT NULL REFERENCES "ReviewClaim" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "target" "ReviewClaimFeedbackTarget" NOT NULL,
  "note" TEXT NOT NULL CHECK (length(btrim("note")) BETWEEN 1 AND 2000),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReviewClaimFeedback_pkey" PRIMARY KEY ("claimId", "target")
);

COMMIT;
