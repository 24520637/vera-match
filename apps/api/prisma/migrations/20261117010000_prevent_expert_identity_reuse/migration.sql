BEGIN;

-- Serialize backfill and guard installation against concurrent application writes.
LOCK TABLE "ExpertAssignment", "ExpertActorIdentity" IN SHARE ROW EXCLUSIVE MODE;

-- Preserve issued IDs, including deleted assignments with independently retained events.
-- This integrity registry does not invent historical transitions or qualifications.
CREATE TABLE "ExpertAssignmentIdentity" (
  "assignmentId" TEXT PRIMARY KEY
);
INSERT INTO "ExpertAssignmentIdentity" ("assignmentId")
SELECT id FROM "ExpertAssignment"
UNION SELECT "assignmentId" FROM "AssignmentEvent";

CREATE TRIGGER "ExpertAssignmentIdentity_immutable"
BEFORE UPDATE OR DELETE ON "ExpertAssignmentIdentity"
FOR EACH ROW EXECUTE FUNCTION c031_immutable();
CREATE TRIGGER "ExpertAssignmentIdentity_no_truncate"
BEFORE TRUNCATE ON "ExpertAssignmentIdentity"
FOR EACH STATEMENT EXECUTE FUNCTION c031_immutable();

CREATE FUNCTION c031_reserve_assignment_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- The unique reservation serializes concurrent reuse attempts. Rollback releases
  -- reservations for failed creations; deleting a committed assignment does not.
  INSERT INTO "ExpertAssignmentIdentity" ("assignmentId") VALUES (NEW.id);
  RETURN NEW;
END $$;
CREATE TRIGGER "ExpertAssignment_identity_guard"
BEFORE INSERT ON "ExpertAssignment"
FOR EACH ROW EXECUTE FUNCTION c031_reserve_assignment_identity();

-- Account deletion can still cascade after its User row is removed. Independent
-- deletion of the mapping while that account exists must never reset its subject.
CREATE TRIGGER "ExpertActorIdentity_delete"
BEFORE DELETE ON "ExpertActorIdentity"
FOR EACH ROW EXECUTE FUNCTION c031_live_identity_delete();
CREATE TRIGGER "ExpertActorIdentity_no_truncate"
BEFORE TRUNCATE ON "ExpertActorIdentity"
FOR EACH STATEMENT EXECUTE FUNCTION c031_immutable();

COMMIT;
