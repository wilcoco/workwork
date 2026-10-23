CREATE TABLE IF NOT EXISTS "KpiBinding" (
  "id" TEXT NOT NULL, "keyResultId" TEXT NOT NULL, "sourceType" TEXT NOT NULL, "config" JSONB NOT NULL,
  "schedule" TEXT NOT NULL DEFAULT 'MONTHLY_2', "enabled" BOOLEAN NOT NULL DEFAULT true, "agentName" TEXT,
  "lastRunAt" TIMESTAMP(3), "lastSuccessAt" TIMESTAMP(3), "lastError" TEXT, "lastValues" JSONB,
  "createdById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KpiBinding_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "KpiBinding_keyResultId_key" ON "KpiBinding"("keyResultId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'KpiBinding_keyResultId_fkey') THEN
    ALTER TABLE "KpiBinding" ADD CONSTRAINT "KpiBinding_keyResultId_fkey" FOREIGN KEY ("keyResultId") REFERENCES "KeyResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS "KpiBindingJob" (
  "id" TEXT NOT NULL, "bindingId" TEXT NOT NULL, "kind" TEXT NOT NULL DEFAULT 'SYNC', "status" TEXT NOT NULL DEFAULT 'PENDING',
  "agentName" TEXT NOT NULL DEFAULT 'default', "sql" TEXT NOT NULL, "params" JSONB, "result" JSONB, "error" TEXT, "requestedBy" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "startedAt" TIMESTAMP(3), "finishedAt" TIMESTAMP(3),
  CONSTRAINT "KpiBindingJob_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "KpiBindingJob_status_agentName_idx" ON "KpiBindingJob"("status", "agentName");
CREATE INDEX IF NOT EXISTS "KpiBindingJob_bindingId_idx" ON "KpiBindingJob"("bindingId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'KpiBindingJob_bindingId_fkey') THEN
    ALTER TABLE "KpiBindingJob" ADD CONSTRAINT "KpiBindingJob_bindingId_fkey" FOREIGN KEY ("bindingId") REFERENCES "KpiBinding"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS "KpiAgent" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "version" TEXT NOT NULL DEFAULT '', "host" TEXT NOT NULL DEFAULT '',
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "note" TEXT NOT NULL DEFAULT '',
  CONSTRAINT "KpiAgent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "KpiAgent_name_key" ON "KpiAgent"("name");
