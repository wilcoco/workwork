-- CreateTable
CREATE TABLE IF NOT EXISTS "MeetingSummaryEdit" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "original" TEXT NOT NULL,
    "edited" TEXT NOT NULL,
    "editedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingSummaryEdit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MeetingSummaryEdit_meetingId_idx" ON "MeetingSummaryEdit"("meetingId");
CREATE INDEX IF NOT EXISTS "MeetingSummaryEdit_createdAt_idx" ON "MeetingSummaryEdit"("createdAt");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MeetingSummaryEdit_meetingId_fkey') THEN
    ALTER TABLE "MeetingSummaryEdit" ADD CONSTRAINT "MeetingSummaryEdit_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "MeetingMinutes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MeetingSummaryEdit_editedById_fkey') THEN
    ALTER TABLE "MeetingSummaryEdit" ADD CONSTRAINT "MeetingSummaryEdit_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
