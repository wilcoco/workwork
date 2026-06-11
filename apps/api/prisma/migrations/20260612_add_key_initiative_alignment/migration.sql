-- KeyInitiative 테이블은 과거 db push로 생성되어 마이그레이션 이력이 없음.
-- 새 환경에서도 동작하도록 IF NOT EXISTS로 베이스라인을 포함한다.

-- CreateEnum (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'KeyInitiativeStatus') THEN
    CREATE TYPE "KeyInitiativeStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'DELAYED', 'COMPLETED', 'CANCELLED');
  END IF;
END $$;

-- CreateTable (idempotent)
CREATE TABLE IF NOT EXISTS "KeyInitiative" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "goal" TEXT,
    "description" TEXT,
    "status" "KeyInitiativeStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "startDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "assigneeId" TEXT,
    "createdById" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KeyInitiative_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "KeyInitiativeProgress" (
    "id" TEXT NOT NULL,
    "initiativeId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "progressPct" INTEGER,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KeyInitiativeProgress_pkey" PRIMARY KEY ("id")
);

-- Baseline indexes (idempotent)
CREATE INDEX IF NOT EXISTS "KeyInitiative_status_idx" ON "KeyInitiative"("status");
CREATE INDEX IF NOT EXISTS "KeyInitiative_assigneeId_idx" ON "KeyInitiative"("assigneeId");
CREATE INDEX IF NOT EXISTS "KeyInitiative_createdById_idx" ON "KeyInitiative"("createdById");
CREATE INDEX IF NOT EXISTS "KeyInitiative_dueDate_idx" ON "KeyInitiative"("dueDate");
CREATE INDEX IF NOT EXISTS "KeyInitiative_orgUnitId_idx" ON "KeyInitiative"("orgUnitId");
CREATE INDEX IF NOT EXISTS "KeyInitiativeProgress_initiativeId_idx" ON "KeyInitiativeProgress"("initiativeId");
CREATE INDEX IF NOT EXISTS "KeyInitiativeProgress_createdById_idx" ON "KeyInitiativeProgress"("createdById");
CREATE INDEX IF NOT EXISTS "KeyInitiativeProgress_createdAt_idx" ON "KeyInitiativeProgress"("createdAt");

-- Baseline foreign keys (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'KeyInitiative_assigneeId_fkey') THEN
    ALTER TABLE "KeyInitiative" ADD CONSTRAINT "KeyInitiative_assigneeId_fkey"
      FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'KeyInitiative_createdById_fkey') THEN
    ALTER TABLE "KeyInitiative" ADD CONSTRAINT "KeyInitiative_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'KeyInitiative_orgUnitId_fkey') THEN
    ALTER TABLE "KeyInitiative" ADD CONSTRAINT "KeyInitiative_orgUnitId_fkey"
      FOREIGN KEY ("orgUnitId") REFERENCES "OrgUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'KeyInitiativeProgress_initiativeId_fkey') THEN
    ALTER TABLE "KeyInitiativeProgress" ADD CONSTRAINT "KeyInitiativeProgress_initiativeId_fkey"
      FOREIGN KEY ("initiativeId") REFERENCES "KeyInitiative"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'KeyInitiativeProgress_createdById_fkey') THEN
    ALTER TABLE "KeyInitiativeProgress" ADD CONSTRAINT "KeyInitiativeProgress_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ★ 신규: KeyInitiative에 OKR(Objective) 정렬 필드 추가
ALTER TABLE "KeyInitiative" ADD COLUMN IF NOT EXISTS "alignsToObjectiveId" TEXT;

CREATE INDEX IF NOT EXISTS "KeyInitiative_alignsToObjectiveId_idx" ON "KeyInitiative"("alignsToObjectiveId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'KeyInitiative_alignsToObjectiveId_fkey') THEN
    ALTER TABLE "KeyInitiative" ADD CONSTRAINT "KeyInitiative_alignsToObjectiveId_fkey"
      FOREIGN KEY ("alignsToObjectiveId") REFERENCES "Objective"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
