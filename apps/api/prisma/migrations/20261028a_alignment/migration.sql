ALTER TABLE "AgendaItem" ADD COLUMN IF NOT EXISTS "companyKrId" TEXT;
CREATE TABLE IF NOT EXISTS "AlignmentReview" (
  "id" TEXT NOT NULL, "itemType" TEXT NOT NULL, "itemId" TEXT NOT NULL, "decision" TEXT NOT NULL DEFAULT 'DISMISSED',
  "note" TEXT, "decidedById" TEXT NOT NULL, "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AlignmentReview_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AlignmentReview_itemType_itemId_key" ON "AlignmentReview"("itemType", "itemId");
