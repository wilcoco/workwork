-- 경영지시 팔로우업 모듈: 지시(Instruction) → 꼭지(Milestone) → 검수, 전략합성(StrategySynthesis)

-- Enums
DO $$ BEGIN
  CREATE TYPE "InstructionSource" AS ENUM ('TEXT', 'VOICE');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "InstructionStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "MilestoneStatus" AS ENUM ('PENDING', 'ACTIVE', 'BLOCKED', 'REVIEW', 'DONE');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- User.notifyPrefs (알림 설정)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "notifyPrefs" JSONB NOT NULL DEFAULT '{}';

-- Instruction
CREATE TABLE IF NOT EXISTS "Instruction" (
  "id" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "rawText" TEXT NOT NULL,
  "summary" TEXT,
  "source" "InstructionSource" NOT NULL DEFAULT 'TEXT',
  "status" "InstructionStatus" NOT NULL DEFAULT 'ACTIVE',
  "objectiveId" TEXT,
  "promotedTemplateId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Instruction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Instruction_status_createdAt_idx" ON "Instruction"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "Instruction_authorId_createdAt_idx" ON "Instruction"("authorId", "createdAt");
DO $$ BEGIN
  ALTER TABLE "Instruction" ADD CONSTRAINT "Instruction_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Milestone (꼭지)
CREATE TABLE IF NOT EXISTS "Milestone" (
  "id" TEXT NOT NULL,
  "instructionId" TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  "title" TEXT NOT NULL,
  "expectedResult" TEXT,
  "ownerId" TEXT,
  "status" "MilestoneStatus" NOT NULL DEFAULT 'PENDING',
  "proof" JSONB NOT NULL DEFAULT '[]',
  "dueAt" TIMESTAMP(3),
  "activatedAt" TIMESTAMP(3),
  "doneAt" TIMESTAMP(3),
  "submittedAt" TIMESTAMP(3),
  "returnNote" TEXT,
  "lastNudgeAt" TIMESTAMP(3),
  "keyInitiativeId" TEXT,
  "approvalRequestId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Milestone_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Milestone_ownerId_status_idx" ON "Milestone"("ownerId", "status");
CREATE INDEX IF NOT EXISTS "Milestone_instructionId_idx" ON "Milestone"("instructionId");
CREATE INDEX IF NOT EXISTS "Milestone_status_dueAt_idx" ON "Milestone"("status", "dueAt");
DO $$ BEGIN
  ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_instructionId_fkey" FOREIGN KEY ("instructionId") REFERENCES "Instruction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- StrategySynthesis (전략 통일성 합성)
CREATE TABLE IF NOT EXISTS "StrategySynthesis" (
  "id" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "result" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StrategySynthesis_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "StrategySynthesis_createdAt_idx" ON "StrategySynthesis"("createdAt");
DO $$ BEGIN
  ALTER TABLE "StrategySynthesis" ADD CONSTRAINT "StrategySynthesis_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
