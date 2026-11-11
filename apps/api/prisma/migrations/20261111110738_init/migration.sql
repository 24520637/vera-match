-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('MEMBER', 'EXPERT', 'MODERATOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('PENDING_EMAIL', 'ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "ConsentPurpose" AS ENUM ('PROFILE_MATCHING', 'VIDEO_STORAGE', 'EXPERT_VIDEO_REVIEW', 'REPORT_SHARING', 'VIDEO_CLAIM_MATCHING');

-- CreateEnum
CREATE TYPE "VideoStatus" AS ENUM ('UPLOADING', 'READY', 'UNDER_REVIEW', 'DELETED');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ObservationCategory" AS ENUM ('EYE', 'FACIAL', 'BODY', 'SPEECH', 'CROSS_MODAL');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MatchChoice" AS ENUM ('ACCEPT', 'DECLINE');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'MEMBER',
    "status" "AccountStatus" NOT NULL DEFAULT 'PENDING_EMAIL',
    "declaredAdult" BOOLEAN NOT NULL DEFAULT false,
    "emailVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailVerificationToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "birthDate" TIMESTAMP(3),
    "occupation" TEXT,
    "city" TEXT,
    "bio" TEXT,
    "relationshipGoal" TEXT,
    "interests" JSONB,
    "values" JSONB,
    "visibilityEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "minAge" INTEGER,
    "maxAge" INTEGER,
    "relationshipGoal" TEXT,
    "dealBreakers" JSONB,
    "priorities" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionnaireAnswer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questionKey" TEXT NOT NULL,
    "questionnaireVersion" INTEGER NOT NULL DEFAULT 1,
    "responseText" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionnaireAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "ConsentPurpose" NOT NULL,
    "granted" BOOLEAN NOT NULL DEFAULT false,
    "grantedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Video" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "durationMs" INTEGER,
    "status" "VideoStatus" NOT NULL DEFAULT 'UPLOADING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Video_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpertAssignment" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "expertId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "dueAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpertAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpertReview" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'DRAFT',
    "summary" TEXT,
    "limitations" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "submittedAt" TIMESTAMP(3),
    "qaById" TEXT,
    "qaAt" TIMESTAMP(3),
    "qaFeedback" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpertReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpertObservation" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "category" "ObservationCategory" NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "observation" TEXT NOT NULL,
    "context" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpertObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewClaim" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "claimType" TEXT NOT NULL,
    "claimText" TEXT NOT NULL,
    "qaApproved" BOOLEAN NOT NULL DEFAULT false,
    "ownerConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "shareApproved" BOOLEAN NOT NULL DEFAULT false,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewDispute" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewDispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchPair" (
    "id" TEXT NOT NULL,
    "userLowId" TEXT NOT NULL,
    "userHighId" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "reasons" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchPair_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchDecision" (
    "id" TEXT NOT NULL,
    "pairId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "choice" "MatchChoice" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Block" (
    "id" TEXT NOT NULL,
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Block_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "moderatorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_status_role_idx" ON "User"("status", "role");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_userId_expiresAt_idx" ON "EmailVerificationToken"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_expiresAt_idx" ON "PasswordResetToken"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_userId_key" ON "Profile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchPreference_userId_key" ON "MatchPreference"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionnaireAnswer_userId_questionKey_questionnaireVersion_key" ON "QuestionnaireAnswer"("userId", "questionKey", "questionnaireVersion");

-- CreateIndex
CREATE UNIQUE INDEX "Consent_userId_purpose_key" ON "Consent"("userId", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "Video_objectKey_key" ON "Video"("objectKey");

-- CreateIndex
CREATE INDEX "Video_ownerId_status_idx" ON "Video"("ownerId", "status");

-- CreateIndex
CREATE INDEX "ExpertAssignment_expertId_status_idx" ON "ExpertAssignment"("expertId", "status");

-- CreateIndex
CREATE INDEX "ExpertAssignment_videoId_status_idx" ON "ExpertAssignment"("videoId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ExpertReview_assignmentId_key" ON "ExpertReview"("assignmentId");

-- CreateIndex
CREATE INDEX "ExpertObservation_reviewId_category_idx" ON "ExpertObservation"("reviewId", "category");

-- CreateIndex
CREATE INDEX "ReviewClaim_reviewId_qaApproved_ownerConfirmed_shareApprove_idx" ON "ReviewClaim"("reviewId", "qaApproved", "ownerConfirmed", "shareApproved");

-- CreateIndex
CREATE INDEX "ReviewDispute_ownerId_status_idx" ON "ReviewDispute"("ownerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MatchPair_userLowId_userHighId_key" ON "MatchPair"("userLowId", "userHighId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchDecision_pairId_actorUserId_key" ON "MatchDecision"("pairId", "actorUserId");

-- CreateIndex
CREATE INDEX "Block_blockedId_idx" ON "Block"("blockedId");

-- CreateIndex
CREATE UNIQUE INDEX "Block_blockerId_blockedId_key" ON "Block"("blockerId", "blockedId");

-- CreateIndex
CREATE INDEX "Report_status_createdAt_idx" ON "Report"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailVerificationToken" ADD CONSTRAINT "EmailVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchPreference" ADD CONSTRAINT "MatchPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionnaireAnswer" ADD CONSTRAINT "QuestionnaireAnswer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpertAssignment" ADD CONSTRAINT "ExpertAssignment_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpertAssignment" ADD CONSTRAINT "ExpertAssignment_expertId_fkey" FOREIGN KEY ("expertId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpertReview" ADD CONSTRAINT "ExpertReview_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "ExpertAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpertObservation" ADD CONSTRAINT "ExpertObservation_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "ExpertReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewClaim" ADD CONSTRAINT "ReviewClaim_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "ExpertReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewDispute" ADD CONSTRAINT "ReviewDispute_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "ExpertReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchDecision" ADD CONSTRAINT "MatchDecision_pairId_fkey" FOREIGN KEY ("pairId") REFERENCES "MatchPair"("id") ON DELETE CASCADE ON UPDATE CASCADE;
