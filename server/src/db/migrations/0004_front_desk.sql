ALTER TABLE reservations
  ADD COLUMN stay_status TEXT NOT NULL DEFAULT 'not_checked_in'
  CHECK (stay_status IN ('not_checked_in', 'checked_in', 'checked_out'));
--> statement-breakpoint
ALTER TABLE reservations ADD COLUMN actual_check_in_at TEXT;
--> statement-breakpoint
ALTER TABLE reservations ADD COLUMN actual_check_out_at TEXT;
--> statement-breakpoint
CREATE INDEX reservations_stay_status_dates
  ON reservations(lifecycle_status, stay_status, check_in, check_out);
--> statement-breakpoint
CREATE INDEX reservations_unit_stay_status
  ON reservations(unit_id, stay_status, actual_check_out_at);
--> statement-breakpoint
CREATE TRIGGER reservations_stay_insert_guard
BEFORE INSERT ON reservations
WHEN NEW.stay_status <> 'not_checked_in'
  OR NEW.actual_check_in_at IS NOT NULL
  OR NEW.actual_check_out_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'reservation_stay_must_start_not_checked_in');
END;
--> statement-breakpoint
CREATE TRIGGER reservations_stay_update_guard
BEFORE UPDATE ON reservations
WHEN
  (
    (NEW.stay_status = 'not_checked_in'
      AND (NEW.actual_check_in_at IS NOT NULL OR NEW.actual_check_out_at IS NOT NULL))
    OR (NEW.stay_status = 'checked_in'
      AND (NEW.actual_check_in_at IS NULL OR NEW.actual_check_out_at IS NOT NULL))
    OR (NEW.stay_status = 'checked_out'
      AND (NEW.actual_check_in_at IS NULL
        OR NEW.actual_check_out_at IS NULL
        OR NEW.actual_check_out_at < NEW.actual_check_in_at))
  )
  OR (
    NEW.stay_status <> OLD.stay_status
    AND NOT (
      (OLD.stay_status = 'not_checked_in' AND NEW.stay_status = 'checked_in')
      OR (OLD.stay_status = 'checked_in' AND NEW.stay_status = 'checked_out')
    )
  )
  OR (
    OLD.stay_status IN ('checked_in', 'checked_out')
    AND NEW.actual_check_in_at IS NOT OLD.actual_check_in_at
  )
  OR (
    OLD.stay_status = 'checked_out'
    AND NEW.actual_check_out_at IS NOT OLD.actual_check_out_at
  )
  OR (
    NEW.stay_status = 'checked_in'
    AND OLD.stay_status <> 'checked_in'
    AND (
      NEW.lifecycle_status <> 'confirmed'
      OR NEW.unit_id IS NULL
      OR NEW.check_in > date('now', 'localtime')
      OR NEW.check_out <= date('now', 'localtime')
      OR NOT EXISTS (
        SELECT 1
        FROM units u
        JOIN properties p ON p.id = u.property_id
        JOIN guests g ON g.id = NEW.guest_id
        WHERE u.id = NEW.unit_id
          AND u.property_id = NEW.property_id
          AND u.status = 'active'
          AND u.archived_at IS NULL
          AND p.status = 'active'
          AND g.status = 'active'
          AND NEW.number_of_guests <= u.capacity
      )
      OR EXISTS (
        SELECT 1
        FROM reservations occupied
        WHERE occupied.unit_id = NEW.unit_id
          AND occupied.id <> OLD.id
          AND occupied.stay_status = 'checked_in'
          AND occupied.actual_check_out_at IS NULL
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'reservation_stay_conflict');
END;
--> statement-breakpoint
CREATE TRIGGER reservations_active_stay_lifecycle_guard
BEFORE UPDATE OF lifecycle_status ON reservations
WHEN OLD.stay_status = 'checked_in'
  AND NEW.lifecycle_status <> OLD.lifecycle_status
  AND NEW.lifecycle_status IN ('cancelled', 'completed')
BEGIN
  SELECT RAISE(ABORT, 'reservation_has_active_stay');
END;
--> statement-breakpoint
CREATE TRIGGER units_active_stay_guard
BEFORE UPDATE OF status, archived_at ON units
WHEN (NEW.status <> 'active' OR NEW.archived_at IS NOT NULL)
  AND EXISTS (
    SELECT 1
    FROM reservations r
    WHERE r.unit_id = OLD.id
      AND r.stay_status = 'checked_in'
      AND r.actual_check_out_at IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'unit_has_active_stay');
END;
