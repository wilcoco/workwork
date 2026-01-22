-- Add comment column to WorklogTeamDailyEval
ALTER TABLE "WorklogTeamDailyEval" ADD COLUMN IF NOT EXISTS "comment" TEXT;
