ALTER TABLE units
  ADD COLUMN housekeeping_status TEXT NOT NULL DEFAULT 'dirty'
  CHECK (housekeeping_status IN ('dirty', 'cleaning', 'clean'));
--> statement-breakpoint
ALTER TABLE units ADD COLUMN last_cleaned_at TEXT;
--> statement-breakpoint
CREATE INDEX units_property_housekeeping
  ON units(property_id, housekeeping_status, status, archived_at);
--> statement-breakpoint
CREATE TRIGGER units_housekeeping_update_guard
BEFORE UPDATE OF housekeeping_status, last_cleaned_at ON units
WHEN
  (
    NEW.housekeeping_status <> OLD.housekeeping_status
    AND NOT (
      (OLD.housekeeping_status = 'dirty'
        AND NEW.housekeeping_status = 'cleaning')
      OR (OLD.housekeeping_status = 'cleaning'
        AND NEW.housekeeping_status IN ('clean', 'dirty'))
      OR (OLD.housekeeping_status = 'clean'
        AND NEW.housekeeping_status = 'dirty')
    )
  )
  OR (
    NEW.housekeeping_status IN ('cleaning', 'clean')
    AND EXISTS (
      SELECT 1
      FROM reservations r
      WHERE r.unit_id = OLD.id
        AND r.stay_status = 'checked_in'
        AND r.actual_check_out_at IS NULL
    )
  )
  OR (
    NEW.housekeeping_status = 'clean'
    AND NEW.last_cleaned_at IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'unit_housekeeping_conflict');
END;
