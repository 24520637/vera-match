ALTER TABLE "Video" ADD COLUMN "cleanupCompletedAt" TIMESTAMP(3);
-- Preserve object locators independently of User/Video cascade deletion.
CREATE TABLE "VideoCleanupTask" (
  "id" TEXT NOT NULL,
  "videoId" TEXT NOT NULL,
  "bucket" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "uploadKey" TEXT,
  "uploadExpiresAt" TIMESTAMP(3),
  "removeFinal" BOOLEAN NOT NULL DEFAULT true,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastErrorCode" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VideoCleanupTask_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "VideoCleanupTask_videoId_key" ON "VideoCleanupTask"("videoId");
CREATE INDEX "VideoCleanupTask_status_nextAttemptAt_idx" ON "VideoCleanupTask"("status", "nextAttemptAt");
