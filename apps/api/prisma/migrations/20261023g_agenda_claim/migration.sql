CREATE TABLE IF NOT EXISTS "Agenda" (
  "id" TEXT NOT NULL, "year" INTEGER NOT NULL, "statement" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "aiQuestions" JSONB, "aiAnswers" JSONB, "summary" TEXT, "createdById" TEXT NOT NULL, "publishedAt" TIMESTAMP(3), "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Agenda_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "AgendaItem" (
  "id" TEXT NOT NULL, "agendaId" TEXT NOT NULL, "order" INTEGER NOT NULL DEFAULT 0, "title" TEXT NOT NULL, "description" TEXT,
  "weight" INTEGER NOT NULL DEFAULT 10, "krDraft" JSONB, "status" TEXT NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgendaItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgendaItem_agendaId_fkey" FOREIGN KEY ("agendaId") REFERENCES "Agenda"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "AgendaClaim" (
  "id" TEXT NOT NULL, "itemId" TEXT NOT NULL, "orgUnitId" TEXT NOT NULL, "claimedById" TEXT NOT NULL,
  "title" TEXT NOT NULL, "metric" TEXT NOT NULL, "unit" TEXT NOT NULL, "target" DOUBLE PRECISION NOT NULL, "direction" TEXT, "rationale" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PROPOSED', "keyResultId" TEXT, "objectiveId" TEXT, "decidedById" TEXT, "decidedAt" TIMESTAMP(3), "decisionNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgendaClaim_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgendaClaim_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "AgendaItem"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "AgendaClaim_itemId_orgUnitId_key" ON "AgendaClaim"("itemId", "orgUnitId");
