-- CreateTable
CREATE TABLE "KnowledgeBase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "manualId" TEXT,
    "category" TEXT NOT NULL DEFAULT 'general',
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tags" TEXT NOT NULL DEFAULT '',
    "systemName" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeBase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Schedule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "manualId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "milestones" JSONB,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PeriodicAlarm" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "manualId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "cronExpression" TEXT,
    "intervalDays" INTEGER NOT NULL DEFAULT 0,
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "checkItems" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PeriodicAlarm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeBase_userId_idx" ON "KnowledgeBase"("userId");

-- CreateIndex
CREATE INDEX "KnowledgeBase_manualId_idx" ON "KnowledgeBase"("manualId");

-- CreateIndex
CREATE INDEX "KnowledgeBase_category_idx" ON "KnowledgeBase"("category");

-- CreateIndex
CREATE INDEX "KnowledgeBase_systemName_idx" ON "KnowledgeBase"("systemName");

-- CreateIndex
CREATE INDEX "Schedule_userId_idx" ON "Schedule"("userId");

-- CreateIndex
CREATE INDEX "Schedule_manualId_idx" ON "Schedule"("manualId");

-- CreateIndex
CREATE INDEX "Schedule_startDate_idx" ON "Schedule"("startDate");

-- CreateIndex
CREATE INDEX "PeriodicAlarm_userId_idx" ON "PeriodicAlarm"("userId");

-- CreateIndex
CREATE INDEX "PeriodicAlarm_manualId_idx" ON "PeriodicAlarm"("manualId");

-- CreateIndex
CREATE INDEX "PeriodicAlarm_nextRunAt_idx" ON "PeriodicAlarm"("nextRunAt");

-- CreateIndex
CREATE INDEX "PeriodicAlarm_isActive_idx" ON "PeriodicAlarm"("isActive");

-- AddForeignKey
ALTER TABLE "KnowledgeBase" ADD CONSTRAINT "KnowledgeBase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeBase" ADD CONSTRAINT "KnowledgeBase_manualId_fkey" FOREIGN KEY ("manualId") REFERENCES "WorkManual"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_manualId_fkey" FOREIGN KEY ("manualId") REFERENCES "WorkManual"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeriodicAlarm" ADD CONSTRAINT "PeriodicAlarm_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeriodicAlarm" ADD CONSTRAINT "PeriodicAlarm_manualId_fkey" FOREIGN KEY ("manualId") REFERENCES "WorkManual"("id") ON DELETE SET NULL ON UPDATE CASCADE;
