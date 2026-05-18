CREATE TABLE "WorklogSupplement" (
    "id" TEXT NOT NULL,
    "worklogId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT,
    "attachments" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorklogSupplement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WorklogSupplement_worklogId_idx" ON "WorklogSupplement"("worklogId");
ALTER TABLE "WorklogSupplement" ADD CONSTRAINT "WorklogSupplement_worklogId_fkey" FOREIGN KEY ("worklogId") REFERENCES "Worklog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorklogSupplement" ADD CONSTRAINT "WorklogSupplement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
