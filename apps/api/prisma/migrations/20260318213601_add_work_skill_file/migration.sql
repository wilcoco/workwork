-- CreateTable
CREATE TABLE "WorkSkillFile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "manualId" TEXT,
    "title" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "skillData" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "qaHistory" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkSkillFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkSkillFile_userId_idx" ON "WorkSkillFile"("userId");

-- CreateIndex
CREATE INDEX "WorkSkillFile_manualId_idx" ON "WorkSkillFile"("manualId");

-- CreateIndex
CREATE INDEX "WorkSkillFile_status_idx" ON "WorkSkillFile"("status");

-- AddForeignKey
ALTER TABLE "WorkSkillFile" ADD CONSTRAINT "WorkSkillFile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkSkillFile" ADD CONSTRAINT "WorkSkillFile_manualId_fkey" FOREIGN KEY ("manualId") REFERENCES "WorkManual"("id") ON DELETE SET NULL ON UPDATE CASCADE;
