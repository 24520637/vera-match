ALTER TABLE "Video" ADD COLUMN "storageConsentVersion" BIGINT;
CREATE TABLE "VideoWithdrawalReceipt" (
  "withdrawalTaskId" UUID NOT NULL,
  "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VideoWithdrawalReceipt_pkey" PRIMARY KEY ("withdrawalTaskId")
);
