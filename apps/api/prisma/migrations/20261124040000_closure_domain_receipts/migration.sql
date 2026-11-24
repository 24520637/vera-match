CREATE TABLE "ClosureDomainReceipt" (
  "closureId" UUID NOT NULL REFERENCES "AccountClosure"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  name TEXT NOT NULL CHECK (name IN ('REVIEW_CLAIMS','MATCHING','SAFETY','RECOVERY')),
  "policyDigest" TEXT NOT NULL CHECK ("policyDigest" ~ '^[a-f0-9]{64}$'),
  "policyEnvelope" JSONB NOT NULL,
  evidence JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("closureId", name)
);
CREATE TRIGGER closure_domain_receipt_immutable BEFORE UPDATE OR DELETE ON "ClosureDomainReceipt"
FOR EACH ROW EXECUTE FUNCTION closure_immutable();
CREATE TRIGGER closure_domain_receipt_no_truncate BEFORE TRUNCATE ON "ClosureDomainReceipt"
FOR EACH STATEMENT EXECUTE FUNCTION closure_immutable();
CREATE FUNCTION closure_domain_ack_check() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.name <> 'MEDIA' AND NEW.status='ACKNOWLEDGED' AND NOT EXISTS (
    SELECT 1 FROM "ClosureDomainReceipt" r WHERE r."closureId"=NEW."closureId" AND r.name=NEW.name
  ) THEN RAISE EXCEPTION 'CLOSURE_DOMAIN_RECEIPT_REQUIRED'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER closure_domain_ack_check BEFORE INSERT OR UPDATE ON "AccountClosureConsumer"
FOR EACH ROW EXECUTE FUNCTION closure_domain_ack_check();
