-- AlterTable
ALTER TABLE "WorkManual" ADD COLUMN     "baseType" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "currentPhase" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "department" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "options" JSONB,
ADD COLUMN     "phaseData" JSONB;

-- CreateIndex
CREATE INDEX "WorkManual_baseType_idx" ON "WorkManual"("baseType");
