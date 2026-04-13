-- CreateTable
CREATE TABLE IF NOT EXISTS "MeetingMinutes" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "participants" JSONB,
    "audioUploadId" TEXT,
    "audioChunks" JSONB,
    "transcript" TEXT,
    "summary" TEXT,
    "actionItems" JSONB,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "duration" INTEGER,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingMinutes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MeetingMinutes_createdById_idx" ON "MeetingMinutes"("createdById");
CREATE INDEX IF NOT EXISTS "MeetingMinutes_date_idx" ON "MeetingMinutes"("date");
CREATE INDEX IF NOT EXISTS "MeetingMinutes_status_idx" ON "MeetingMinutes"("status");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MeetingMinutes_createdById_fkey') THEN
    ALTER TABLE "MeetingMinutes" ADD CONSTRAINT "MeetingMinutes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
