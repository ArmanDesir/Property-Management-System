ALTER TABLE reservations ADD COLUMN reservation_reference TEXT;
--> statement-breakpoint
ALTER TABLE reservations
  ADD COLUMN unit_id INTEGER REFERENCES units(id) ON UPDATE NO ACTION ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE reservations
  ADD COLUMN number_of_guests INTEGER NOT NULL DEFAULT 1 CHECK (number_of_guests > 0);
--> statement-breakpoint
ALTER TABLE reservations
  ADD COLUMN nightly_rate_cents INTEGER NOT NULL DEFAULT 0 CHECK (nightly_rate_cents >= 0);
--> statement-breakpoint
ALTER TABLE reservations
  ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'confirmed'
  CHECK (lifecycle_status IN ('pending', 'confirmed', 'cancelled', 'completed'));
--> statement-breakpoint
UPDATE reservations
SET reservation_reference = 'LEGACY-' || printf('%06d', id),
    lifecycle_status = CASE status
      WHEN 'cancelled' THEN 'cancelled'
      WHEN 'checked_out' THEN 'completed'
      ELSE 'confirmed'
    END;
--> statement-breakpoint
CREATE UNIQUE INDEX reservations_reference_unique
  ON reservations(reservation_reference);
--> statement-breakpoint
CREATE INDEX reservations_unit_dates_status
  ON reservations(unit_id, check_in, check_out, lifecycle_status);
--> statement-breakpoint
CREATE TRIGGER reservations_insert_guard
BEFORE INSERT ON reservations
WHEN NEW.reservation_reference IS NULL
  OR trim(NEW.reservation_reference) = ''
  OR NEW.unit_id IS NULL
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
  OR NEW.total_amount_cents <>
     CAST(julianday(NEW.check_out) - julianday(NEW.check_in) AS INTEGER)
       * NEW.nightly_rate_cents
  OR (
    NEW.lifecycle_status IN ('pending', 'confirmed')
    AND EXISTS (
      SELECT 1
      FROM reservations r
      WHERE r.unit_id = NEW.unit_id
        AND r.lifecycle_status IN ('pending', 'confirmed')
        AND r.check_in < NEW.check_out
        AND r.check_out > NEW.check_in
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'reservation_conflict');
END;
--> statement-breakpoint
CREATE TRIGGER reservations_update_guard
BEFORE UPDATE ON reservations
WHEN NOT (
    (OLD.lifecycle_status = 'pending'
      AND NEW.lifecycle_status IN ('pending', 'confirmed', 'cancelled'))
    OR (OLD.lifecycle_status = 'confirmed'
      AND NEW.lifecycle_status IN ('confirmed', 'cancelled', 'completed'))
  )
  OR (
    NEW.lifecycle_status IN ('pending', 'confirmed')
    AND (
      NEW.unit_id IS NULL
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
      OR NEW.total_amount_cents <>
         CAST(julianday(NEW.check_out) - julianday(NEW.check_in) AS INTEGER)
           * NEW.nightly_rate_cents
      OR EXISTS (
        SELECT 1
        FROM reservations r
        WHERE r.id <> OLD.id
          AND r.unit_id = NEW.unit_id
          AND r.lifecycle_status IN ('pending', 'confirmed')
          AND r.check_in < NEW.check_out
          AND r.check_out > NEW.check_in
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'reservation_conflict');
END;
