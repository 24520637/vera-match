CREATE TABLE "RecoveryDatabaseBinding" (
  "journalId" UUID PRIMARY KEY,
  "baselineEntryId" UUID NOT NULL,
  "baselineEntryHash" TEXT NOT NULL CHECK ("baselineEntryHash" ~ '^[a-f0-9]{64}$'),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER recovery_binding_immutable BEFORE UPDATE OR DELETE ON "RecoveryDatabaseBinding"
FOR EACH ROW EXECUTE FUNCTION recovery_receipt_immutable();
CREATE TRIGGER recovery_binding_no_truncate BEFORE TRUNCATE ON "RecoveryDatabaseBinding"
FOR EACH STATEMENT EXECUTE FUNCTION recovery_receipt_immutable();
