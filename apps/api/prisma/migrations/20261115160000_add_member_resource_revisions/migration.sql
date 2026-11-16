-- Add editing metadata without rewriting any existing resource or legacy value.
-- Existing resources start at virtual revision 0, just like absent resources;
-- the first CAS mutation initializes metadata atomically with its data write.
CREATE TYPE "MemberResource" AS ENUM ('PROFILE', 'PREFERENCES', 'QUESTIONNAIRE');

CREATE TABLE "MemberResourceRevision" (
    "userId" TEXT NOT NULL,
    "resource" "MemberResource" NOT NULL,
    "revision" BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT "MemberResourceRevision_pkey" PRIMARY KEY ("userId", "resource"),
    CONSTRAINT "MemberResourceRevision_revision_safe_integer_check"
        CHECK ("revision" >= 0 AND "revision" <= 9007199254740991)
);

ALTER TABLE "MemberResourceRevision" ADD CONSTRAINT "MemberResourceRevision_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Keep the existing uniqueness key; this index supports loading one catalog snapshot.
CREATE INDEX "QuestionnaireAnswer_userId_questionnaireVersion_idx"
    ON "QuestionnaireAnswer"("userId", "questionnaireVersion");
