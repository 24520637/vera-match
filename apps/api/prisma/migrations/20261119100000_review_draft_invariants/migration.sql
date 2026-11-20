BEGIN;

-- ExpertReview and ExpertObservation were created by the initial migration.
-- Preserve any historical rows while enforcing invariants on new writes.
ALTER TABLE "ExpertReview"
  ADD CONSTRAINT "ExpertReview_positive_version" CHECK ("version" >= 1) NOT VALID;
ALTER TABLE "ExpertObservation"
  ADD CONSTRAINT "ExpertObservation_ordered_timecodes" CHECK ("startMs" >= 0 AND "endMs" >= "startMs") NOT VALID;

COMMIT;
