-- Link Initiative to UserGoal
ALTER TABLE "Initiative" ADD COLUMN IF NOT EXISTS "userGoalId" TEXT;

DO $$ BEGIN
  ALTER TABLE "Initiative" ADD CONSTRAINT "Initiative_userGoal_fkey"
    FOREIGN KEY ("userGoalId") REFERENCES "UserGoal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "Initiative_userGoal_idx" ON "Initiative"("userGoalId");
