CREATE TABLE `maintenance_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_id` integer NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`changed_by_staff_id` integer,
	`note` text,
	`changed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `maintenance_requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`changed_by_staff_id`) REFERENCES `staff_accounts`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "maintenance_history_from_status_check" CHECK("maintenance_history"."from_status" IS NULL OR "maintenance_history"."from_status" IN ('open', 'in_progress', 'awaiting_parts', 'completed', 'cancelled')),
	CONSTRAINT "maintenance_history_to_status_check" CHECK("maintenance_history"."to_status" IN ('open', 'in_progress', 'awaiting_parts', 'completed', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX `maintenance_history_request_time` ON `maintenance_history` (`request_id`,`changed_at`,`id`);--> statement-breakpoint
CREATE TABLE `maintenance_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_code` text NOT NULL,
	`property_id` integer NOT NULL,
	`unit_id` integer,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`category` text NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`reported_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`target_completion_date` text,
	`assigned_staff_id` integer,
	`completed_at` text,
	`resolution_notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`assigned_staff_id`) REFERENCES `staff_accounts`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "maintenance_category_check" CHECK("maintenance_requests"."category" IN ('plumbing', 'electrical', 'hvac', 'appliance', 'furniture', 'structural', 'cleaning_related', 'other')),
	CONSTRAINT "maintenance_priority_check" CHECK("maintenance_requests"."priority" IN ('low', 'normal', 'high', 'urgent')),
	CONSTRAINT "maintenance_status_check" CHECK("maintenance_requests"."status" IN ('open', 'in_progress', 'awaiting_parts', 'completed', 'cancelled')),
	CONSTRAINT "maintenance_title_nonempty" CHECK(length(trim("maintenance_requests"."title")) > 0),
	CONSTRAINT "maintenance_description_nonempty" CHECK(length(trim("maintenance_requests"."description")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `maintenance_request_code_unique` ON `maintenance_requests` (`request_code`);--> statement-breakpoint
CREATE INDEX `maintenance_property_status` ON `maintenance_requests` (`property_id`,`status`);--> statement-breakpoint
CREATE INDEX `maintenance_unit_status` ON `maintenance_requests` (`unit_id`,`status`);--> statement-breakpoint
CREATE INDEX `maintenance_status_priority_target` ON `maintenance_requests` (`status`,`priority`,`target_completion_date`);--> statement-breakpoint
CREATE INDEX `maintenance_assigned_staff` ON `maintenance_requests` (`assigned_staff_id`,`status`);