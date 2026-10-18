ALTER TABLE properties
  ADD COLUMN property_type TEXT NOT NULL DEFAULT 'other'
  CHECK (property_type IN ('hotel', 'resort', 'hostel', 'apartment', 'vacation_rental', 'other'));
--> statement-breakpoint
ALTER TABLE properties
  ADD COLUMN contact_name TEXT;
--> statement-breakpoint
ALTER TABLE properties
  ADD COLUMN contact_email TEXT;
--> statement-breakpoint
ALTER TABLE properties
  ADD COLUMN contact_phone TEXT;
--> statement-breakpoint
ALTER TABLE properties
  ADD COLUMN default_currency TEXT NOT NULL DEFAULT 'USD'
  CHECK (default_currency GLOB '[A-Z][A-Z][A-Z]');
--> statement-breakpoint
ALTER TABLE properties
  ADD COLUMN default_check_in_time TEXT NOT NULL DEFAULT '15:00'
  CHECK (
    default_check_in_time GLOB '[0-2][0-9]:[0-5][0-9]'
    AND substr(default_check_in_time, 1, 2) BETWEEN '00' AND '23'
  );
--> statement-breakpoint
ALTER TABLE properties
  ADD COLUMN default_check_out_time TEXT NOT NULL DEFAULT '11:00'
  CHECK (
    default_check_out_time GLOB '[0-2][0-9]:[0-5][0-9]'
    AND substr(default_check_out_time, 1, 2) BETWEEN '00' AND '23'
  );
--> statement-breakpoint
ALTER TABLE properties
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'archived'));
--> statement-breakpoint
CREATE TABLE units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  unit_type TEXT NOT NULL DEFAULT 'room'
    CHECK (unit_type IN ('room', 'apartment', 'villa', 'dormitory_room', 'studio', 'suite', 'other')),
  description TEXT,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  base_nightly_rate_cents INTEGER NOT NULL CHECK (base_nightly_rate_cents >= 0),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'maintenance')),
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX units_property_status_archived
  ON units(property_id, status, archived_at);
--> statement-breakpoint
CREATE UNIQUE INDEX units_property_name_active_unique
  ON units(property_id, lower(trim(name)))
  WHERE archived_at IS NULL;
