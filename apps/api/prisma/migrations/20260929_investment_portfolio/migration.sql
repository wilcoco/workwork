CREATE TABLE IF NOT EXISTS "InvestmentMeeting" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'QUARTERLY',
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "location" TEXT NOT NULL DEFAULT '',
  "attendeeIds" JSONB,
  "status" TEXT NOT NULL DEFAULT 'PLANNED',
  "minutes" TEXT,
  "createdById" TEXT NOT NULL,
  "notifiedAt" TIMESTAMP(3),
  "heldAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InvestmentMeeting_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "InvestmentMeeting_scheduledAt_idx" ON "InvestmentMeeting"("scheduledAt");

CREATE TABLE IF NOT EXISTS "InvestmentProposal" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "rationale" TEXT NOT NULL DEFAULT '',
  "orgUnitId" TEXT,
  "orgUnitName" TEXT NOT NULL DEFAULT '',
  "proposerId" TEXT NOT NULL,
  "proposerName" TEXT NOT NULL DEFAULT '',
  "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "targetYear" INTEGER NOT NULL,
  "targetQuarter" INTEGER,
  "carProgram" TEXT NOT NULL DEFAULT '',
  "deadlineAt" TIMESTAMP(3),
  "annualBenefit" DOUBLE PRECISION,
  "paybackMonths" INTEGER,
  "fastTrack" BOOLEAN NOT NULL DEFAULT false,
  "dependencies" JSONB,
  "attachments" JSONB,
  "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
  "scoreFinancial" INTEGER,
  "scoreRisk" INTEGER,
  "scoreStrategic" INTEGER,
  "scoreFeasibility" INTEGER,
  "scoreUrgency" INTEGER,
  "priorityScore" DOUBLE PRECISION,
  "reviewNote" TEXT,
  "reviewerId" TEXT,
  "reviewerName" TEXT NOT NULL DEFAULT '',
  "reviewedAt" TIMESTAMP(3),
  "meetingId" TEXT,
  "decision" TEXT,
  "decisionNote" TEXT,
  "decidedAt" TIMESTAMP(3),
  "approvedAmount" DOUBLE PRECISION,
  "executionNote" TEXT,
  "executionStartAt" TIMESTAMP(3),
  "executionEndAt" TIMESTAMP(3),
  "actualAmount" DOUBLE PRECISION,
  "auditDueAt" TIMESTAMP(3),
  "actualBenefit" DOUBLE PRECISION,
  "auditNote" TEXT,
  "auditedAt" TIMESTAMP(3),
  "auditorName" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InvestmentProposal_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "InvestmentProposal_targetYear_status_idx" ON "InvestmentProposal"("targetYear", "status");
CREATE INDEX IF NOT EXISTS "InvestmentProposal_proposerId_idx" ON "InvestmentProposal"("proposerId");
CREATE INDEX IF NOT EXISTS "InvestmentProposal_meetingId_idx" ON "InvestmentProposal"("meetingId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InvestmentProposal_meetingId_fkey') THEN
    ALTER TABLE "InvestmentProposal" ADD CONSTRAINT "InvestmentProposal_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "InvestmentMeeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "InvestmentBudget" (
  "id" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "limitAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "mandatoryReserve" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "weights" JSONB,
  "note" TEXT NOT NULL DEFAULT '',
  "updatedById" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InvestmentBudget_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "InvestmentBudget_year_key" ON "InvestmentBudget"("year");
