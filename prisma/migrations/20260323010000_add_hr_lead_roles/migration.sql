-- AlterEnum: Add new roles
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'lead' AFTER 'manager';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'sub_lead' AFTER 'lead';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'hr_manager' AFTER 'production_manager';

ALTER TYPE "OrgLevel" ADD VALUE IF NOT EXISTS 'hr_manager' AFTER 'manager';
ALTER TYPE "OrgLevel" ADD VALUE IF NOT EXISTS 'lead' AFTER 'hr_manager';
ALTER TYPE "OrgLevel" ADD VALUE IF NOT EXISTS 'sub_lead' AFTER 'lead';
