-- Add WorklogEvalStatus enum and WorklogTeamDailyEval table
DO $$ BEGIN
  CREATE TYPE "WorklogEvalStatus" AS ENUM ('BLUE','GREEN','YELLOW','RED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE "WorklogTeamDailyEval" (
  "id" TEXT NOT NULL,
  "ymd" TEXT NOT NULL,
  "orgUnitId" TEXT NOT NULL,
  "evaluatorId" TEXT NOT NULL,
  "status" "WorklogEvalStatus" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WorklogTeamDailyEval_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorklogTeamDailyEval_ymd_orgUnitId_evaluatorId_key" ON "WorklogTeamDailyEval"("ymd", "orgUnitId", "evaluatorId");
CREATE INDEX "WorklogTeamDailyEval_ymd_idx" ON "WorklogTeamDailyEval"("ymd");
CREATE INDEX "WorklogTeamDailyEval_orgUnitId_ymd_idx" ON "WorklogTeamDailyEval"("orgUnitId", "ymd");
CREATE INDEX "WorklogTeamDailyEval_evaluatorId_ymd_idx" ON "WorklogTeamDailyEval"("evaluatorId", "ymd");

ALTER TABLE "WorklogTeamDailyEval" ADD CONSTRAINT "WorklogTeamDailyEval_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrgUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorklogTeamDailyEval" ADD CONSTRAINT "WorklogTeamDailyEval_evaluatorId_fkey" FOREIGN KEY ("evaluatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
