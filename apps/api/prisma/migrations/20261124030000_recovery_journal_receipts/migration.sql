CREATE TABLE "RecoveryJournalReceipt" (
  "journalId" UUID NOT NULL,
  sequence BIGINT NOT NULL CHECK (sequence > 0),
  "entryId" UUID NOT NULL,
  "entryHash" TEXT NOT NULL CHECK ("entryHash" ~ '^[a-f0-9]{64}$'),
  disposition TEXT NOT NULL CHECK (disposition IN ('APPLIED', 'QUARANTINED')),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("journalId", sequence),
  UNIQUE ("journalId", "entryId")
);
CREATE FUNCTION recovery_receipt_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'RECOVERY_RECEIPT_IMMUTABLE'; END $$;
CREATE TRIGGER recovery_receipt_immutable BEFORE UPDATE OR DELETE ON "RecoveryJournalReceipt"
FOR EACH ROW EXECUTE FUNCTION recovery_receipt_immutable();
CREATE TRIGGER recovery_receipt_no_truncate BEFORE TRUNCATE ON "RecoveryJournalReceipt"
FOR EACH STATEMENT EXECUTE FUNCTION recovery_receipt_immutable();
