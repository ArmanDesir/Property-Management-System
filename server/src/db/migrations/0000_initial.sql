CREATE TABLE IF NOT EXISTS `billing_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`reservation_id` integer NOT NULL,
	`description` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`entry_type` text NOT NULL,
	`status` text DEFAULT 'posted' NOT NULL,
	`occurred_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`reservation_id`) REFERENCES `reservations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "billing_entry_type_check" CHECK("billing_entries"."entry_type" IN ('charge', 'payment', 'refund')),
	CONSTRAINT "billing_status_check" CHECK("billing_entries"."status" IN ('pending', 'posted', 'void'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `billing_reservation` ON `billing_entries` (`reservation_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `guests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`email` text,
	`phone` text,
	`notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `guests_email_unique` ON `guests` (`email`) WHERE "guests"."email" IS NOT NULL AND "guests"."email" <> '';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `housekeeping_tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`property_id` integer NOT NULL,
	`reservation_id` integer,
	`title` text NOT NULL,
	`due_at` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reservation_id`) REFERENCES `reservations`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "housekeeping_status_check" CHECK("housekeeping_tasks"."status" IN ('pending', 'in_progress', 'complete', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `housekeeping_property_status` ON `housekeeping_tasks` (`property_id`,`status`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `properties` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`address` text,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `reservations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`property_id` integer NOT NULL,
	`guest_id` integer NOT NULL,
	`check_in` text NOT NULL,
	`check_out` text NOT NULL,
	`status` text DEFAULT 'booked' NOT NULL,
	`total_amount_cents` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`guest_id`) REFERENCES `guests`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "reservations_status_check" CHECK("reservations"."status" IN ('booked', 'checked_in', 'checked_out', 'cancelled')),
	CONSTRAINT "reservations_total_nonnegative" CHECK("reservations"."total_amount_cents" >= 0),
	CONSTRAINT "reservations_checkout_after_checkin" CHECK("reservations"."check_out" > "reservations"."check_in")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `reservations_property_dates` ON `reservations` (`property_id`,`check_in`,`check_out`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `reservations_guest` ON `reservations` (`guest_id`);