-- Add passwordHash column for username/password auth
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;
