-- 육아휴직 유형 추가 (휴가와 구분되는 별도 근태 유형)
ALTER TYPE "AttendanceType" ADD VALUE IF NOT EXISTS 'PARENTAL_LEAVE';
