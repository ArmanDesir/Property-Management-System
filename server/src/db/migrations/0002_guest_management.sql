ALTER TABLE guests ADD COLUMN address TEXT;
--> statement-breakpoint
ALTER TABLE guests ADD COLUMN country TEXT;
--> statement-breakpoint
ALTER TABLE guests
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'archived'));
--> statement-breakpoint
DROP INDEX guests_email_unique;
--> statement-breakpoint
CREATE INDEX guests_status_name_search
  ON guests(status, last_name, first_name);
--> statement-breakpoint
CREATE INDEX guests_email_search ON guests(email);
--> statement-breakpoint
CREATE INDEX guests_phone_search ON guests(phone);