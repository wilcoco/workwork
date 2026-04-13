-- Add attachments column to MeetingMinutes
ALTER TABLE "MeetingMinutes" ADD COLUMN IF NOT EXISTS "attachments" JSONB;
