ALTER TABLE "MeetingMinutes" ADD COLUMN IF NOT EXISTS "visibility" TEXT NOT NULL DEFAULT 'PRIVATE';
ALTER TABLE "MeetingMinutes" ADD COLUMN IF NOT EXISTS "sharedUserIds" JSONB;
ALTER TABLE "MeetingMinutes" ADD COLUMN IF NOT EXISTS "participantUserIds" JSONB;
ALTER TABLE "MeetingMinutes" ADD COLUMN IF NOT EXISTS "shareToken" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "MeetingMinutes_shareToken_key" ON "MeetingMinutes"("shareToken");
