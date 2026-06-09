-- CreateTable
CREATE TABLE "DocumentViewLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentViewLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentViewLog_userId_idx" ON "DocumentViewLog"("userId");

-- CreateIndex
CREATE INDEX "DocumentViewLog_docType_docId_idx" ON "DocumentViewLog"("docType", "docId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentViewLog_userId_docType_docId_key" ON "DocumentViewLog"("userId", "docType", "docId");

-- AddForeignKey
ALTER TABLE "DocumentViewLog" ADD CONSTRAINT "DocumentViewLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
