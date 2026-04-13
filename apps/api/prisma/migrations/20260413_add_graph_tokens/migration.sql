-- Add Microsoft Graph API token fields to User for Teams Planner integration
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "graphAccessToken" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "graphRefreshToken" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "graphTokenExpiry" TIMESTAMP(3);
