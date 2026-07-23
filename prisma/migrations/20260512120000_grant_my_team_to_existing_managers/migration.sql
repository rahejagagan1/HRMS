-- Data migration: backfill hr_my_team = true for existing managers.
--
-- Why: tabs.ts default for orgLevel='manager' was changed to include
-- hr_my_team (so line managers can see the team they already approve
-- leave/WFH for). The role default fix only affects users seeded AFTER
-- the change. Users seeded earlier already have a UserTabPermission row
-- with enabled=false, and per-user rows always win over role defaults.
-- This migration flips those stale rows in one shot.
--
-- Safe scope:
--   - Active users only
--   - orgLevel='manager' only
--   - hr_my_team tab only
--   - Only rows currently enabled=false (idempotent: re-running is a no-op)
--
-- Reversible: same UPDATE with enabled=false in a WHERE enabled=true clause
-- would put things back.
UPDATE "UserTabPermission" utp
   SET "enabled" = true,
       "updatedAt" = NOW()
  FROM "User" u
 WHERE utp."userId"   = u.id
   AND u."orgLevel"   = 'manager'
   AND u."isActive"   = true
   AND utp."tabKey"   = 'hr_my_team'
   AND utp."enabled"  = false;
