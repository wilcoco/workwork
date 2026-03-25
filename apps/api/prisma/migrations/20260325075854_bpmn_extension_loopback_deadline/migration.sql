-- AlterTable
ALTER TABLE "ProcessTaskInstance" ADD COLUMN     "loopCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ProcessTaskTemplate" ADD COLUMN     "loopBackCondition" TEXT,
ADD COLUMN     "loopBackTargetId" TEXT,
ADD COLUMN     "maxLoopCount" INTEGER;

-- CreateTable
CREATE TABLE "ProcessDeadlineAlert" (
    "id" TEXT NOT NULL,
    "taskInstanceId" TEXT NOT NULL,
    "alertType" TEXT NOT NULL,
    "alertLevel" INTEGER NOT NULL DEFAULT 0,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "recipientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessDeadlineAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProcessDeadlineAlert_taskInstanceId_idx" ON "ProcessDeadlineAlert"("taskInstanceId");

-- CreateIndex
CREATE INDEX "ProcessDeadlineAlert_scheduledAt_idx" ON "ProcessDeadlineAlert"("scheduledAt");

-- CreateIndex
CREATE INDEX "ProcessDeadlineAlert_sentAt_idx" ON "ProcessDeadlineAlert"("sentAt");

-- AddForeignKey
ALTER TABLE "ProcessDeadlineAlert" ADD CONSTRAINT "ProcessDeadlineAlert_taskInstanceId_fkey" FOREIGN KEY ("taskInstanceId") REFERENCES "ProcessTaskInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
