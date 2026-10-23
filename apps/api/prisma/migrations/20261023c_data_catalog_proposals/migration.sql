CREATE TABLE IF NOT EXISTS "DataCatalogEntry" (
  "id" TEXT NOT NULL, "source" TEXT NOT NULL DEFAULT 'ORACLE', "kind" TEXT NOT NULL, "key" TEXT NOT NULL, "name" TEXT NOT NULL DEFAULT '',
  "data" JSONB NOT NULL, "searchText" TEXT NOT NULL DEFAULT '', "sensitive" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DataCatalogEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "DataCatalogEntry_source_kind_key_key" ON "DataCatalogEntry"("source", "kind", "key");
CREATE INDEX IF NOT EXISTS "DataCatalogEntry_kind_idx" ON "DataCatalogEntry"("kind");
CREATE TABLE IF NOT EXISTS "KpiQueryProposal" (
  "id" TEXT NOT NULL, "keyResultId" TEXT NOT NULL, "queryId" TEXT NOT NULL, "name" TEXT NOT NULL, "sql" TEXT NOT NULL,
  "binds" JSONB, "tables" JSONB, "extraBinds" JSONB, "screenRef" TEXT NOT NULL DEFAULT '', "rationale" TEXT NOT NULL DEFAULT '', "caveats" TEXT NOT NULL DEFAULT '',
  "confidence" INTEGER NOT NULL DEFAULT 0, "status" TEXT NOT NULL DEFAULT 'PROPOSED', "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "registeredAt" TIMESTAMP(3), "registeredHost" TEXT NOT NULL DEFAULT '', "agentName" TEXT NOT NULL DEFAULT 'default',
  CONSTRAINT "KpiQueryProposal_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "KpiQueryProposal_keyResultId_status_idx" ON "KpiQueryProposal"("keyResultId", "status");
CREATE INDEX IF NOT EXISTS "KpiQueryProposal_status_agentName_idx" ON "KpiQueryProposal"("status", "agentName");
