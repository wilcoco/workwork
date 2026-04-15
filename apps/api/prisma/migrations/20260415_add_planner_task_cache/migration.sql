-- CreateTable
CREATE TABLE IF NOT EXISTS "PlannerTaskCache" (
    "id" TEXT NOT NULL,
    "graphTaskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dueDateTime" TIMESTAMP(3),
    "percentComplete" INTEGER NOT NULL DEFAULT 0,
    "priority" INTEGER NOT NULL DEFAULT 5,
    "planName" TEXT,
    "groupName" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlannerTaskCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PlannerTaskCache_graphTaskId_userId_key" ON "PlannerTaskCache"("graphTaskId", "userId");
CREATE INDEX IF NOT EXISTS "PlannerTaskCache_userId_idx" ON "PlannerTaskCache"("userId");
CREATE INDEX IF NOT EXISTS "PlannerTaskCache_dueDateTime_idx" ON "PlannerTaskCache"("dueDateTime");
CREATE INDEX IF NOT EXISTS "PlannerTaskCache_percentComplete_idx" ON "PlannerTaskCache"("percentComplete");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PlannerTaskCache_userId_fkey') THEN
    ALTER TABLE "PlannerTaskCache" ADD CONSTRAINT "PlannerTaskCache_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
