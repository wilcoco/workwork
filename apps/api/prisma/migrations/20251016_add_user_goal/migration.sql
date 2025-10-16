-- Enum GoalKind
DO $$ BEGIN
  CREATE TYPE "GoalKind" AS ENUM ('QUALITATIVE','QUANTITATIVE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Table UserGoal
CREATE TABLE IF NOT EXISTS "UserGoal" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "kind" "GoalKind" NOT NULL DEFAULT 'QUALITATIVE',
  "metric" TEXT,
  "target" DOUBLE PRECISION,
  "unit" TEXT,
  "startAt" TIMESTAMP(3),
  "endAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserGoal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserGoal_user_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "UserGoal_user_idx" ON "UserGoal"("userId");
