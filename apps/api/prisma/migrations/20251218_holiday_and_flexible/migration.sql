-- Add FLEXIBLE value to AttendanceType enum
ALTER TYPE "AttendanceType" ADD VALUE IF NOT EXISTS 'FLEXIBLE';

-- CreateTable Holiday
CREATE TABLE IF NOT EXISTS "Holiday" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "isLegal" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Holiday_date_key" UNIQUE ("date")
);
