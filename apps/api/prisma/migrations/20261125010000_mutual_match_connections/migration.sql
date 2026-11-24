ALTER TABLE "MatchPair" ADD COLUMN "connectionRevokedAt" TIMESTAMP(3);
CREATE TABLE "MatchConnectionShare" (
  "pairId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "profileShared" BOOLEAN NOT NULL DEFAULT false,
  "contactShared" BOOLEAN NOT NULL DEFAULT false,
  "chatEnabled" BOOLEAN NOT NULL DEFAULT false,
  "photo" BYTEA CHECK (octet_length("photo") <= 65536),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("pairId", "userId"),
  FOREIGN KEY ("pairId") REFERENCES "MatchPair"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "MatchMessage" (
  "id" TEXT PRIMARY KEY,
  "pairId" TEXT NOT NULL,
  "senderId" TEXT NOT NULL,
  "clientMessageId" UUID NOT NULL,
  "text" TEXT CHECK ("text" IS NULL OR length("text") BETWEEN 1 AND 2000),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("pairId") REFERENCES "MatchPair"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("senderId") REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MatchMessage_pairId_senderId_clientMessageId_key" ON "MatchMessage"("pairId", "senderId", "clientMessageId");
CREATE INDEX "MatchMessage_pairId_createdAt_id_idx" ON "MatchMessage"("pairId", "createdAt", id);

CREATE FUNCTION vera_connection_participant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor TEXT;
BEGIN
  IF TG_TABLE_NAME = 'MatchMessage' THEN actor := NEW."senderId";
  ELSE actor := NEW."userId"; END IF;
  IF NOT EXISTS (SELECT 1 FROM "MatchPair" p WHERE p.id = NEW."pairId"
    AND actor IN (p."userLowId", p."userHighId")) THEN
    RAISE EXCEPTION 'MATCH_CONNECTION_PARTICIPANT_REQUIRED';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER connection_share_participant BEFORE INSERT OR UPDATE ON "MatchConnectionShare"
  FOR EACH ROW EXECUTE FUNCTION vera_connection_participant();
CREATE TRIGGER match_message_participant BEFORE INSERT OR UPDATE ON "MatchMessage"
  FOR EACH ROW EXECUTE FUNCTION vera_connection_participant();

CREATE FUNCTION vera_match_message_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW."pairId" IS DISTINCT FROM OLD."pairId"
    OR NEW."senderId" IS DISTINCT FROM OLD."senderId"
    OR NEW."clientMessageId" IS DISTINCT FROM OLD."clientMessageId"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'MATCH_MESSAGE_IDENTITY_IMMUTABLE';
  END IF;
  IF NEW.text IS DISTINCT FROM OLD.text AND NOT (NEW.text IS NULL AND EXISTS (
    SELECT 1 FROM "MatchPair" p JOIN "User" u ON u.id IN (p."userLowId", p."userHighId")
    WHERE p.id = OLD."pairId" AND u.status IN ('CLOSED', 'DELETED')
  )) THEN RAISE EXCEPTION 'MATCH_MESSAGE_CONTENT_IMMUTABLE'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER match_message_immutable BEFORE UPDATE ON "MatchMessage"
  FOR EACH ROW EXECUTE FUNCTION vera_match_message_immutable();
