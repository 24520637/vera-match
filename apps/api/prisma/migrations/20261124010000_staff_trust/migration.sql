-- Additive C064 authority ledger. Existing users/roles/sessions are untouched.
CREATE TABLE "StaffTrustEvent" (
 "directiveId" UUID PRIMARY KEY, "userId" TEXT NOT NULL, "subjectId" UUID NOT NULL,
 "revision" BIGINT NOT NULL CHECK ("revision" BETWEEN 1 AND 9007199254740991),
 "mfaEpoch" BIGINT NOT NULL CHECK ("mfaEpoch" BETWEEN 1 AND 9007199254740991),
 "signedDirective" TEXT NOT NULL CHECK (octet_length("signedDirective") BETWEEN 1 AND 8192),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "StaffTrustEvent_subjectId_revision_key" ON "StaffTrustEvent"("subjectId","revision");
CREATE UNIQUE INDEX "StaffTrustEvent_userId_revision_key" ON "StaffTrustEvent"("userId","revision");
CREATE TABLE "StaffIdentity" (
 "userId" TEXT PRIMARY KEY REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
 "subjectId" UUID NOT NULL UNIQUE, "revision" BIGINT NOT NULL CHECK ("revision" BETWEEN 1 AND 9007199254740991),
 "mfaEpoch" BIGINT NOT NULL CHECK ("mfaEpoch" BETWEEN 1 AND 9007199254740991),
 "role" "UserRole" NOT NULL CHECK ("role" IN ('EXPERT','MODERATOR','ADMIN')),
 "state" TEXT NOT NULL CHECK ("state" IN ('ACTIVE','REVOKED')),
 "expiresAt" TIMESTAMPTZ(3) NOT NULL, "currentDirectiveId" UUID NOT NULL UNIQUE
 REFERENCES "StaffTrustEvent"("directiveId") ON DELETE RESTRICT ON UPDATE NO ACTION
);
CREATE FUNCTION vera_staff_immutable() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'STAFF_EVIDENCE_IMMUTABLE' USING ERRCODE='23514';
END $$;
CREATE TRIGGER staff_trust_event_immutable BEFORE UPDATE OR DELETE ON "StaffTrustEvent"
 FOR EACH ROW EXECUTE FUNCTION vera_staff_immutable();
CREATE TRIGGER staff_trust_event_no_truncate BEFORE TRUNCATE ON "StaffTrustEvent"
 FOR EACH STATEMENT EXECUTE FUNCTION vera_staff_immutable();
CREATE TRIGGER staff_identity_no_delete BEFORE DELETE ON "StaffIdentity"
 FOR EACH ROW EXECUTE FUNCTION vera_staff_immutable();
CREATE TRIGGER staff_identity_no_truncate BEFORE TRUNCATE ON "StaffIdentity"
 FOR EACH STATEMENT EXECUTE FUNCTION vera_staff_immutable();
CREATE FUNCTION vera_staff_identity_transition() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='UPDATE' AND (NEW."userId" IS DISTINCT FROM OLD."userId" OR NEW."subjectId" IS DISTINCT FROM OLD."subjectId"
 OR NEW."revision" <> OLD."revision"+1 OR NEW."mfaEpoch" NOT BETWEEN OLD."mfaEpoch" AND OLD."mfaEpoch"+1) THEN
 RAISE EXCEPTION 'STAFF_IDENTITY_TRANSITION_INVALID' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND (NEW."revision"<>1 OR NEW."mfaEpoch"<>1) THEN
 RAISE EXCEPTION 'STAFF_IDENTITY_INITIAL_REVISION_INVALID' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS (SELECT 1 FROM "StaffTrustEvent" e WHERE e."directiveId"=NEW."currentDirectiveId"
 AND e."userId"=NEW."userId" AND e."subjectId"=NEW."subjectId" AND e."revision"=NEW."revision" AND e."mfaEpoch"=NEW."mfaEpoch") THEN
 RAISE EXCEPTION 'STAFF_IDENTITY_EVIDENCE_REQUIRED' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER staff_identity_transition BEFORE INSERT OR UPDATE ON "StaffIdentity"
 FOR EACH ROW EXECUTE FUNCTION vera_staff_identity_transition();
CREATE FUNCTION vera_staff_record_time() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN
 NEW."createdAt"=clock_timestamp(); RETURN NEW; END $$;
CREATE TRIGGER staff_trust_event_record_time BEFORE INSERT ON "StaffTrustEvent"
 FOR EACH ROW EXECUTE FUNCTION vera_staff_record_time();
