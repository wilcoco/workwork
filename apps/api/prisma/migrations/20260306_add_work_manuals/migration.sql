CREATE TABLE "WorkManual" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WorkManual_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkManual_userId_idx" ON "WorkManual"("userId");
CREATE INDEX "WorkManual_updatedAt_idx" ON "WorkManual"("updatedAt");

ALTER TABLE "WorkManual" ADD CONSTRAINT "WorkManual_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
