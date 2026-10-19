CREATE TABLE staff_role_extensions (
  staff_id INTEGER PRIMARY KEY NOT NULL REFERENCES staff_accounts(id) ON UPDATE NO ACTION ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role = 'property_manager')
);
--> statement-breakpoint
CREATE TABLE property_manager_properties (
  staff_id INTEGER NOT NULL REFERENCES staff_accounts(id) ON UPDATE NO ACTION ON DELETE CASCADE,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON UPDATE NO ACTION ON DELETE CASCADE,
  UNIQUE (staff_id, property_id)
);
--> statement-breakpoint
CREATE INDEX property_manager_properties_property
  ON property_manager_properties(property_id, staff_id);
--> statement-breakpoint
CREATE TABLE team_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON UPDATE NO ACTION ON DELETE RESTRICT,
  unit_id INTEGER REFERENCES units(id) ON UPDATE NO ACTION ON DELETE RESTRICT,
  reservation_id INTEGER REFERENCES reservations(id) ON UPDATE NO ACTION ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  description TEXT NOT NULL CHECK (length(trim(description)) > 0),
  department TEXT NOT NULL CHECK (department IN ('front_desk', 'housekeeping', 'accounting')),
  assigned_staff_id INTEGER NOT NULL REFERENCES staff_accounts(id) ON UPDATE NO ACTION ON DELETE RESTRICT,
  created_by_staff_id INTEGER NOT NULL REFERENCES staff_accounts(id) ON UPDATE NO ACTION ON DELETE RESTRICT,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'submitted', 'completed', 'rejected', 'cancelled')),
  due_date TEXT CHECK (due_date IS NULL OR (length(due_date) = 10 AND date(due_date) = due_date)),
  due_time TEXT CHECK (due_time IS NULL OR (due_time GLOB '[0-2][0-9]:[0-5][0-9]' AND substr(due_time, 1, 2) BETWEEN '00' AND '23')),
  completion_note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TRIGGER team_tasks_property_reference_insert
BEFORE INSERT ON team_tasks
WHEN (NEW.unit_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM units WHERE id = NEW.unit_id AND property_id = NEW.property_id
  ))
  OR (NEW.reservation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM reservations
    WHERE id = NEW.reservation_id AND property_id = NEW.property_id
      AND (NEW.unit_id IS NULL OR unit_id = NEW.unit_id)
  ))
BEGIN
  SELECT RAISE(ABORT, 'team_task_property_reference_conflict');
END;
--> statement-breakpoint
CREATE TRIGGER team_tasks_property_reference_update
BEFORE UPDATE OF property_id, unit_id, reservation_id ON team_tasks
WHEN (NEW.unit_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM units WHERE id = NEW.unit_id AND property_id = NEW.property_id
  ))
  OR (NEW.reservation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM reservations
    WHERE id = NEW.reservation_id AND property_id = NEW.property_id
      AND (NEW.unit_id IS NULL OR unit_id = NEW.unit_id)
  ))
BEGIN
  SELECT RAISE(ABORT, 'team_task_property_reference_conflict');
END;
--> statement-breakpoint
CREATE INDEX team_tasks_property_status_due ON team_tasks(property_id, status, due_date);
--> statement-breakpoint
CREATE INDEX team_tasks_assignee_status_due ON team_tasks(assigned_staff_id, status, due_date);
--> statement-breakpoint
CREATE TABLE team_task_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  task_id INTEGER NOT NULL REFERENCES team_tasks(id) ON UPDATE NO ACTION ON DELETE CASCADE,
  actor_staff_id INTEGER REFERENCES staff_accounts(id) ON UPDATE NO ACTION ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('created', 'status_changed', 'submitted', 'approved', 'returned', 'cancelled', 'details_changed')),
  description TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX team_task_activity_task_time ON team_task_activity(task_id, created_at, id);
--> statement-breakpoint
CREATE TRIGGER team_task_activity_no_update
BEFORE UPDATE ON team_task_activity
BEGIN
  SELECT RAISE(ABORT, 'team_task_activity_immutable');
END;
--> statement-breakpoint
CREATE TRIGGER team_task_activity_no_delete
BEFORE DELETE ON team_task_activity
BEGIN
  SELECT RAISE(ABORT, 'team_task_activity_immutable');
END;
