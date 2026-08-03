-- Attendance status audit trigger (2026-08-03)
--
-- Records EVERY change to Attendance.status / isRegularized into AuditLog —
-- including writes the app never sees: psql sessions, ops scripts, older
-- deployed builds. Motivated by the 16-Jul-2026 incident where a row's
-- half_day_lop penalty was reverted to missed_clock_out with no trace in any
-- log; the actor was unidentifiable after the fact.
--
-- Safety: AFTER trigger; the audit INSERT is wrapped so a failure can NEVER
-- block or roll back the underlying attendance write. Fires only when the
-- watched columns actually change (WHEN clause), so bulk no-op updates cost
-- nothing.
--
-- Apply with: psql "$DATABASE_URL" -f prisma/scripts/attendance-status-audit-trigger.sql

CREATE OR REPLACE FUNCTION attendance_status_audit() RETURNS trigger AS $$
BEGIN
  BEGIN
    INSERT INTO "AuditLog"
      ("actorEmail","action","entityType","entityId","before","after","metadata","createdAt")
    VALUES (
      current_user,
      'attendance.status.db_change',
      'Attendance',
      OLD.id::text,
      jsonb_build_object('status', OLD.status, 'isRegularized', OLD."isRegularized", 'totalMinutes', OLD."totalMinutes"),
      jsonb_build_object('status', NEW.status, 'isRegularized', NEW."isRegularized", 'totalMinutes', NEW."totalMinutes"),
      jsonb_build_object(
        'userId', NEW."userId",
        'date', to_char(NEW.date, 'YYYY-MM-DD'),
        'appName', current_setting('application_name', true),
        'dbUser', current_user
      ),
      now()
    );
  EXCEPTION WHEN OTHERS THEN
    NULL; -- auditing must never break the write itself
  END;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_attendance_status_audit ON "Attendance";
CREATE TRIGGER trg_attendance_status_audit
AFTER UPDATE ON "Attendance"
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD."isRegularized" IS DISTINCT FROM NEW."isRegularized")
EXECUTE FUNCTION attendance_status_audit();
