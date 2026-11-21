CREATE TABLE staff_property_assignments (
  staff_id INTEGER NOT NULL REFERENCES staff_accounts(id) ON UPDATE NO ACTION ON DELETE CASCADE,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON UPDATE NO ACTION ON DELETE CASCADE,
  UNIQUE (staff_id, property_id)
);
--> statement-breakpoint
CREATE INDEX staff_property_assignments_property
  ON staff_property_assignments(property_id, staff_id);
--> statement-breakpoint
INSERT INTO staff_property_assignments (staff_id, property_id)
SELECT staff_id, property_id FROM property_manager_properties;
--> statement-breakpoint
CREATE TABLE guest_property_access (
  guest_id INTEGER NOT NULL REFERENCES guests(id) ON UPDATE NO ACTION ON DELETE CASCADE,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON UPDATE NO ACTION ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (guest_id, property_id)
);
--> statement-breakpoint
CREATE INDEX guest_property_access_property_guest
  ON guest_property_access(property_id, guest_id);
--> statement-breakpoint
INSERT INTO guest_property_access (guest_id, property_id)
SELECT DISTINCT guest_id, property_id FROM reservations;
