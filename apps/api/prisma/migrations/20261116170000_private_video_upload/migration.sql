-- Additive only. Legacy uploads without an expiry cannot be confirmed.
ALTER TABLE "Video" ADD COLUMN "uploadKey" TEXT, ADD COLUMN "uploadExpiresAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Video_uploadKey_key" ON "Video"("uploadKey");
