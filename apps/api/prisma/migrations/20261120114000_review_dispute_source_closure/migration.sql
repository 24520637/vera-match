BEGIN;

ALTER TYPE "DisputeStatus" ADD VALUE 'CLOSED_SOURCE_UNAVAILABLE';

ALTER TABLE "ReviewDispute"
  DROP CONSTRAINT "ReviewDispute_t12_lifecycle",
  ADD CONSTRAINT "ReviewDispute_t12_lifecycle" CHECK (
    ("status"::text <> 'CLOSED_SOURCE_UNAVAILABLE' OR "reviewVersion" IS NOT NULL)
    AND ("reviewVersion" IS NULL OR (
      "reviewVersion" >= 2 AND length(btrim("reason")) BETWEEN 1 AND 2000 AND (
        ("status" = 'OPEN' AND "revision" = 0 AND "inReviewAt" IS NULL
          AND "resolvedAt" IS NULL AND "resolution" IS NULL)
        OR ("status" = 'IN_REVIEW' AND "revision" = 1 AND "inReviewAt" IS NOT NULL
          AND "resolvedAt" IS NULL AND "resolution" IS NULL)
        OR ("status" IN ('RESOLVED', 'REJECTED') AND "revision" = 2 AND "inReviewAt" IS NOT NULL
          AND "resolvedAt" IS NOT NULL AND "resolvedAt" >= "inReviewAt"
          AND "resolution" IS NOT NULL AND length(btrim("resolution")) BETWEEN 1 AND 2000)
        OR ("status"::text = 'CLOSED_SOURCE_UNAVAILABLE'
          AND "resolvedAt" IS NOT NULL AND "resolution" IS NULL
          AND (("revision" = 1 AND "inReviewAt" IS NULL)
            OR ("revision" = 2 AND "inReviewAt" IS NOT NULL AND "resolvedAt" >= "inReviewAt")))
      )
    ))
  );

ALTER TABLE "AssignmentCancellationScan"
  DROP CONSTRAINT "AssignmentCancellationScan_lane_check",
  ADD CONSTRAINT "AssignmentCancellationScan_lane_check"
    CHECK (lane IN ('withdrawal', 'deleted-video', 'review-dispute-source'));

COMMIT;
