BEGIN;
-- Independent round-robin cursors, bounded per lap, shared by all worker processes.
-- No domain/evidence rows are modified or backfilled. NULL cursors bootstrap lazily.
CREATE TABLE "AssignmentCancellationScan" (
  lane TEXT PRIMARY KEY CHECK (lane IN ('withdrawal', 'deleted-video')),
  "afterId" TEXT,
  "throughId" TEXT,
  CHECK (("afterId" IS NULL AND "throughId" IS NULL) OR
         ("afterId" IS NOT NULL AND "throughId" IS NOT NULL AND
          "afterId" COLLATE "C" <= "throughId" COLLATE "C"))
);
COMMIT;
