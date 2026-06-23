-- 경비실 전용 계정 역할 추가 (배차 입/출차 관리 화면만 접근)
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'GUARD';
