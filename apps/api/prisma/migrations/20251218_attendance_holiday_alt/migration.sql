-- Extend AttendanceType enum for holiday substitution
ALTER TYPE "AttendanceType" ADD VALUE IF NOT EXISTS 'HOLIDAY_WORK';
ALTER TYPE "AttendanceType" ADD VALUE IF NOT EXISTS 'HOLIDAY_REST';
