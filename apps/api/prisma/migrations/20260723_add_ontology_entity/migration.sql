CREATE TABLE IF NOT EXISTS "OntologyEntity" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "normName" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'OTHER',
  "aliases" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "OntologyEntity_normName_key" ON "OntologyEntity"("normName");
CREATE INDEX IF NOT EXISTS "OntologyEntity_kind_idx" ON "OntologyEntity"("kind");
CREATE INDEX IF NOT EXISTS "OntologyEntity_name_idx" ON "OntologyEntity"("name");
CREATE TABLE IF NOT EXISTS "WorklogEntity" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "worklogId" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "WorklogEntity_worklogId_entityId_key" ON "WorklogEntity"("worklogId","entityId");
CREATE INDEX IF NOT EXISTS "WorklogEntity_entityId_idx" ON "WorklogEntity"("entityId");
ALTER TABLE "Worklog" ADD COLUMN IF NOT EXISTS "entityMinedAt" TIMESTAMP(3);
