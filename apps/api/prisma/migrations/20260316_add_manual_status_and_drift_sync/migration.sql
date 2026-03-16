-- Drift sync: captures all db-push-only changes into migration history

-- 1) ManualStatus enum
DO $$ BEGIN
  CREATE TYPE "ManualStatus" AS ENUM ('DRAFT', 'REVIEW', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2) StopType enum
DO $$ BEGIN
  CREATE TYPE "StopType" AS ENUM ('SUSPENDED', 'ABORTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3) ProcessStopEvent table
CREATE TABLE IF NOT EXISTS "ProcessStopEvent" (
  "id" TEXT NOT NULL,
  "processInstanceId" TEXT NOT NULL,
  "stoppedById" TEXT NOT NULL,
  "stopType" "StopType" NOT NULL,
  "reason" TEXT NOT NULL,
  "stoppedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProcessStopEvent_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "ProcessStopEvent" DROP CONSTRAINT IF EXISTS "ProcessStopEvent_processInstanceId_fkey";
ALTER TABLE "ProcessStopEvent" ADD CONSTRAINT "ProcessStopEvent_processInstanceId_fkey"
  FOREIGN KEY ("processInstanceId") REFERENCES "ProcessInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProcessStopEvent" DROP CONSTRAINT IF EXISTS "ProcessStopEvent_stoppedById_fkey";
ALTER TABLE "ProcessStopEvent" ADD CONSTRAINT "ProcessStopEvent_stoppedById_fkey"
  FOREIGN KEY ("stoppedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4) ProcessInstance additions
ALTER TABLE "ProcessInstance" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ProcessInstance" ADD COLUMN IF NOT EXISTS "initiativeId" TEXT;
ALTER TABLE "ProcessInstance" ADD COLUMN IF NOT EXISTS "modifiedById" TEXT;
ALTER TABLE "ProcessInstance" ADD COLUMN IF NOT EXISTS "modifiedAt" TIMESTAMP(3);
ALTER TABLE "ProcessInstance" ADD COLUMN IF NOT EXISTS "modificationReason" TEXT;

DO $$ BEGIN
  ALTER TABLE "ProcessInstance" ADD CONSTRAINT "ProcessInstance_initiativeId_fkey"
    FOREIGN KEY ("initiativeId") REFERENCES "Initiative"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "ProcessInstance" ADD CONSTRAINT "ProcessInstance_modifiedById_fkey"
    FOREIGN KEY ("modifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 5) ProcessTaskInstance additions
ALTER TABLE "ProcessTaskInstance" ADD COLUMN IF NOT EXISTS "initiativeId" TEXT;
DO $$ BEGIN
  ALTER TABLE "ProcessTaskInstance" ADD CONSTRAINT "ProcessTaskInstance_initiativeId_fkey"
    FOREIGN KEY ("initiativeId") REFERENCES "Initiative"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 6) WorkManual: status, reviewer, qualityScore
ALTER TABLE "WorkManual" ADD COLUMN IF NOT EXISTS "status" "ManualStatus" NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "WorkManual" ADD COLUMN IF NOT EXISTS "reviewerId" TEXT;
ALTER TABLE "WorkManual" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3);
ALTER TABLE "WorkManual" ADD COLUMN IF NOT EXISTS "reviewComment" TEXT;
ALTER TABLE "WorkManual" ADD COLUMN IF NOT EXISTS "qualityScore" INTEGER NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE "WorkManual" ADD CONSTRAINT "WorkManual_reviewerId_fkey"
    FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "WorkManual_status_idx" ON "WorkManual"("status");
CREATE INDEX IF NOT EXISTS "WorkManual_reviewerId_idx" ON "WorkManual"("reviewerId");

-- 7) Worklog: processTaskInstanceId
ALTER TABLE "Worklog" ADD COLUMN IF NOT EXISTS "processTaskInstanceId" TEXT;
DO $$ BEGIN
  ALTER TABLE "Worklog" ADD CONSTRAINT "Worklog_processTaskInstanceId_fkey"
    FOREIGN KEY ("processTaskInstanceId") REFERENCES "ProcessTaskInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
