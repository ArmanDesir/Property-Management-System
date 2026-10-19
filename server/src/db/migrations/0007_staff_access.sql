CREATE TABLE `staff_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`display_name` text NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "staff_accounts_role_check" CHECK("staff_accounts"."role" IN ('administrator', 'front_desk', 'housekeeping', 'accounting')),
	CONSTRAINT "staff_accounts_active_check" CHECK("staff_accounts"."is_active" IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_accounts_username_unique` ON `staff_accounts` (`username`);
--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`staff_id` integer NOT NULL,
	`csrf_token_hash` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`staff_id`) REFERENCES `staff_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `auth_sessions_staff_expiry` ON `auth_sessions` (`staff_id`,`expires_at`);
