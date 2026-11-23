-- CreateEnum
CREATE TYPE "ClosureState" AS ENUM ('RESTRICTED', 'RETENTION_PENDING');

-- AlterEnum
ALTER TYPE "AccountStatus" ADD VALUE 'CLOSED';

-- CreateTable
CREATE TABLE "AccountClosure" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" TEXT NOT NULL,
    "state" "ClosureState" NOT NULL DEFAULT 'RESTRICTED',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "keyHash" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountClosure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountClosureEvent" (
    "closureId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountClosureEvent_pkey" PRIMARY KEY ("closureId","revision")
);

-- CreateTable
CREATE TABLE "AccountClosureConsumer" (
    "closureId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "AccountClosureConsumer_pkey" PRIMARY KEY ("closureId","name")
);

-- CreateTable
CREATE TABLE "ClosureStatusToken" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "closureId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "ClosureStatusToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountClosure_userId_key" ON "AccountClosure"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ClosureStatusToken_tokenHash_key" ON "ClosureStatusToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ClosureStatusToken_closureId_createdAt_idx" ON "ClosureStatusToken"("closureId", "createdAt");

-- CreateIndex
CREATE INDEX "ClosureStatusToken_expiresAt_idx" ON "ClosureStatusToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "AccountClosure" ADD CONSTRAINT "AccountClosure_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountClosureEvent" ADD CONSTRAINT "AccountClosureEvent_closureId_fkey" FOREIGN KEY ("closureId") REFERENCES "AccountClosure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountClosureConsumer" ADD CONSTRAINT "AccountClosureConsumer_closureId_fkey" FOREIGN KEY ("closureId") REFERENCES "AccountClosure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClosureStatusToken" ADD CONSTRAINT "ClosureStatusToken_closureId_fkey" FOREIGN KEY ("closureId") REFERENCES "AccountClosure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Identity and evidence never reset by DELETE/recreate/TRUNCATE.
ALTER TABLE "AccountClosure" ADD CONSTRAINT "closure_identity_shape" CHECK (revision >= 1 AND length("keyHash")=64 AND length(fingerprint)=64);
ALTER TABLE "AccountClosureEvent" ADD CONSTRAINT "closure_event_shape" CHECK (revision >= 1 AND kind IN ('RESTRICTED','RETENTION_PENDING'));
ALTER TABLE "AccountClosureConsumer" ADD CONSTRAINT "closure_consumer_shape" CHECK (name IN ('MEDIA','REVIEW_CLAIMS','MATCHING','SAFETY','RECOVERY') AND status IN ('PENDING','ACKNOWLEDGED'));
CREATE FUNCTION closure_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'CLOSURE_EVIDENCE_IMMUTABLE'; END $$;
CREATE TRIGGER closure_event_immutable BEFORE UPDATE OR DELETE ON "AccountClosureEvent" FOR EACH ROW EXECUTE FUNCTION closure_immutable();
CREATE TRIGGER closure_event_no_truncate BEFORE TRUNCATE ON "AccountClosureEvent" FOR EACH STATEMENT EXECUTE FUNCTION closure_immutable();
CREATE FUNCTION closure_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP <> 'UPDATE' THEN RAISE EXCEPTION 'CLOSURE_IDENTITY_IMMUTABLE'; END IF;
 IF NEW.id <> OLD.id OR NEW."userId" <> OLD."userId" OR NEW."keyHash" <> OLD."keyHash" OR NEW.fingerprint <> OLD.fingerprint OR NEW."createdAt" <> OLD."createdAt" OR NEW.revision <> OLD.revision+1 OR OLD.state::text <> 'RESTRICTED' OR NEW.state::text <> 'RETENTION_PENDING' THEN RAISE EXCEPTION 'CLOSURE_TRANSITION_INVALID'; END IF;
 IF (SELECT count(*) FROM "AccountClosureConsumer" WHERE "closureId"=OLD.id) <> 5 OR EXISTS (SELECT 1 FROM "AccountClosureConsumer" WHERE "closureId"=OLD.id AND status <> 'ACKNOWLEDGED') THEN RAISE EXCEPTION 'CLOSURE_CONSUMERS_PENDING'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER closure_identity_guard BEFORE UPDATE OR DELETE ON "AccountClosure" FOR EACH ROW EXECUTE FUNCTION closure_identity_guard();
CREATE TRIGGER closure_identity_no_truncate BEFORE TRUNCATE ON "AccountClosure" FOR EACH STATEMENT EXECUTE FUNCTION closure_immutable();
CREATE FUNCTION closure_barrier_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE uid text; ledger "AccountClosure"; account_status text;
BEGIN
 IF TG_TABLE_NAME = 'User' THEN uid=NEW.id; ELSE uid=NEW."userId"; END IF;
 SELECT * INTO ledger FROM "AccountClosure" WHERE "userId"=uid;
 SELECT status::text INTO account_status FROM "User" WHERE id=uid;
 IF (ledger.id IS NOT NULL AND account_status IS DISTINCT FROM 'CLOSED') OR (account_status='CLOSED' AND ledger.id IS NULL) THEN RAISE EXCEPTION 'CLOSURE_BARRIER_REQUIRED'; END IF;
 IF ledger.id IS NOT NULL AND ((SELECT count(*) FROM "AccountClosureConsumer" WHERE "closureId"=ledger.id) <> 5 OR (SELECT count(*) FROM "Consent" WHERE "userId"=uid AND NOT granted) <> 5 OR EXISTS (SELECT 1 FROM "Consent" WHERE "userId"=uid AND granted) OR EXISTS (SELECT 1 FROM "Session" WHERE "userId"=uid AND "revokedAt" IS NULL) OR EXISTS (SELECT 1 FROM "PasswordResetToken" WHERE "userId"=uid AND "consumedAt" IS NULL) OR EXISTS (SELECT 1 FROM "EmailVerificationToken" WHERE "userId"=uid AND "consumedAt" IS NULL)) THEN RAISE EXCEPTION 'CLOSURE_HANDOFF_REQUIRED'; END IF;
 IF ledger.id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "AccountClosureEvent" WHERE "closureId"=ledger.id AND revision=ledger.revision AND kind=ledger.state::text) THEN RAISE EXCEPTION 'CLOSURE_EVENT_REQUIRED'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER closure_user_barrier AFTER INSERT OR UPDATE ON "User" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION closure_barrier_check();
CREATE CONSTRAINT TRIGGER closure_ledger_barrier AFTER INSERT OR UPDATE ON "AccountClosure" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION closure_barrier_check();
CREATE FUNCTION closure_token_monotonic() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.id <> OLD.id OR NEW."closureId" <> OLD."closureId" OR NEW."tokenHash" <> OLD."tokenHash" OR NEW."createdAt" <> OLD."createdAt" OR NEW."expiresAt" <> OLD."expiresAt" OR OLD."consumedAt" IS NOT NULL THEN RAISE EXCEPTION 'CLOSURE_TOKEN_IMMUTABLE'; END IF; RETURN NEW; END $$;
CREATE TRIGGER closure_token_monotonic BEFORE UPDATE ON "ClosureStatusToken" FOR EACH ROW EXECUTE FUNCTION closure_token_monotonic();

CREATE FUNCTION closure_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.action='ACCOUNT_CLOSURE_RESTRICTED' THEN RAISE EXCEPTION 'CLOSURE_AUDIT_IMMUTABLE'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END $$;
CREATE TRIGGER closure_audit_immutable BEFORE UPDATE OR DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION closure_audit_immutable();

CREATE FUNCTION closure_consumer_monotonic() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP <> 'UPDATE' THEN RAISE EXCEPTION 'CLOSURE_CONSUMER_IDENTITY_IMMUTABLE'; END IF;
 IF NEW."closureId" <> OLD."closureId" OR NEW.name <> OLD.name OR OLD.status <> 'PENDING' OR NEW.status <> 'ACKNOWLEDGED' THEN RAISE EXCEPTION 'CLOSURE_CONSUMER_TRANSITION_INVALID'; END IF; RETURN NEW; END $$;
CREATE TRIGGER closure_consumer_monotonic BEFORE UPDATE OR DELETE ON "AccountClosureConsumer" FOR EACH ROW EXECUTE FUNCTION closure_consumer_monotonic();
CREATE TRIGGER closure_consumer_no_truncate BEFORE TRUNCATE ON "AccountClosureConsumer" FOR EACH STATEMENT EXECUTE FUNCTION closure_immutable();

-- The existing verified delivery address remains the only status channel.
-- Recovery/rebinding needs a separately reviewed support workflow, never a SQL
-- identity edit that silently redirects previously restricted status authority.
CREATE FUNCTION closure_user_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.status::text='CLOSED' AND (NEW.status::text<>'CLOSED' OR NEW.email IS DISTINCT FROM OLD.email OR NEW."emailVerifiedAt" IS DISTINCT FROM OLD."emailVerifiedAt" OR NEW."passwordHash" IS DISTINCT FROM OLD."passwordHash" OR NEW.role IS DISTINCT FROM OLD.role) THEN RAISE EXCEPTION 'CLOSURE_IDENTITY_REBINDING_DENIED'; END IF; RETURN NEW; END $$;
CREATE TRIGGER closure_user_identity_guard BEFORE UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION closure_user_identity_guard();
