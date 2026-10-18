CREATE TABLE `invoice_line_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`description` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_price_cents` integer NOT NULL,
	`line_total_cents` integer NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "invoice_line_items_quantity_positive" CHECK("invoice_line_items"."quantity" > 0),
	CONSTRAINT "invoice_line_items_price_nonnegative" CHECK("invoice_line_items"."unit_price_cents" >= 0),
	CONSTRAINT "invoice_line_items_total_nonnegative" CHECK("invoice_line_items"."line_total_cents" >= 0),
	CONSTRAINT "invoice_line_items_position_nonnegative" CHECK("invoice_line_items"."position" >= 0)
);
--> statement-breakpoint
CREATE INDEX `invoice_line_items_invoice_position` ON `invoice_line_items` (`invoice_id`,`position`);--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_number` text NOT NULL,
	`reservation_id` integer NOT NULL,
	`issue_date` text NOT NULL,
	`due_date` text,
	`currency` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`tax_rate_bps` integer DEFAULT 0 NOT NULL,
	`subtotal_cents` integer DEFAULT 0 NOT NULL,
	`tax_amount_cents` integer DEFAULT 0 NOT NULL,
	`total_cents` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`issued_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`reservation_id`) REFERENCES `reservations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "invoices_status_check" CHECK("invoices"."status" IN ('draft', 'issued', 'void')),
	CONSTRAINT "invoices_currency_check" CHECK("invoices"."currency" GLOB '[A-Z][A-Z][A-Z]'),
	CONSTRAINT "invoices_tax_rate_check" CHECK("invoices"."tax_rate_bps" BETWEEN 0 AND 10000),
	CONSTRAINT "invoices_subtotal_nonnegative" CHECK("invoices"."subtotal_cents" >= 0),
	CONSTRAINT "invoices_tax_nonnegative" CHECK("invoices"."tax_amount_cents" >= 0),
	CONSTRAINT "invoices_total_nonnegative" CHECK("invoices"."total_cents" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_invoice_number_unique` ON `invoices` (`invoice_number`);--> statement-breakpoint
CREATE INDEX `invoices_reservation` ON `invoices` (`reservation_id`);--> statement-breakpoint
CREATE INDEX `invoices_status_issue_date` ON `invoices` (`status`,`issue_date`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`payment_date` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`method` text NOT NULL,
	`reference` text,
	`note` text,
	`idempotency_key` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "payments_amount_positive" CHECK("payments"."amount_cents" > 0),
	CONSTRAINT "payments_method_check" CHECK("payments"."method" IN ('cash', 'bank_transfer', 'card_terminal', 'other'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_idempotency_key_unique` ON `payments` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `payments_invoice_date` ON `payments` (`invoice_id`,`payment_date`,`id`);
--> statement-breakpoint
CREATE TRIGGER invoices_number_immutable
BEFORE UPDATE OF invoice_number ON invoices
WHEN NEW.invoice_number <> OLD.invoice_number
BEGIN
  SELECT RAISE(ABORT, 'invoice_number_immutable');
END;
--> statement-breakpoint
CREATE TRIGGER invoices_status_transition_guard
BEFORE UPDATE OF status ON invoices
WHEN NOT (
  NEW.status = OLD.status
  OR (OLD.status = 'draft' AND NEW.status = 'issued')
  OR (OLD.status = 'issued' AND NEW.status = 'void')
)
BEGIN
  SELECT RAISE(ABORT, 'invoice_transition_conflict');
END;
--> statement-breakpoint
CREATE TRIGGER invoices_issue_guard
BEFORE UPDATE OF status ON invoices
WHEN OLD.status = 'draft' AND NEW.status = 'issued'
  AND (
    NEW.issued_at IS NULL
    OR NOT EXISTS (SELECT 1 FROM invoice_line_items WHERE invoice_id = OLD.id)
    OR NEW.subtotal_cents <> COALESCE((
      SELECT SUM(line_total_cents) FROM invoice_line_items WHERE invoice_id = OLD.id
    ), 0)
    OR NEW.total_cents <> NEW.subtotal_cents + NEW.tax_amount_cents
  )
BEGIN
  SELECT RAISE(ABORT, 'invoice_issue_conflict');
END;
--> statement-breakpoint
CREATE TRIGGER invoices_void_guard
BEFORE UPDATE OF status ON invoices
WHEN OLD.status = 'issued' AND NEW.status = 'void'
  AND EXISTS (SELECT 1 FROM payments WHERE invoice_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'invoice_has_payments');
END;
--> statement-breakpoint
CREATE TRIGGER invoices_snapshot_guard
BEFORE UPDATE ON invoices
WHEN OLD.status <> 'draft'
  AND (
    NEW.invoice_number <> OLD.invoice_number
    OR NEW.reservation_id <> OLD.reservation_id
    OR NEW.issue_date <> OLD.issue_date
    OR NEW.due_date IS NOT OLD.due_date
    OR NEW.currency <> OLD.currency
    OR NEW.tax_rate_bps <> OLD.tax_rate_bps
    OR NEW.subtotal_cents <> OLD.subtotal_cents
    OR NEW.tax_amount_cents <> OLD.tax_amount_cents
    OR NEW.total_cents <> OLD.total_cents
    OR NEW.notes IS NOT OLD.notes
    OR NEW.issued_at IS NOT OLD.issued_at
  )
BEGIN
  SELECT RAISE(ABORT, 'invoice_snapshot_immutable');
END;
--> statement-breakpoint
CREATE TRIGGER invoice_line_items_insert_guard
BEFORE INSERT ON invoice_line_items
WHEN COALESCE((SELECT status FROM invoices WHERE id = NEW.invoice_id), '') <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'invoice_items_immutable');
END;
--> statement-breakpoint
CREATE TRIGGER invoice_line_items_update_guard
BEFORE UPDATE ON invoice_line_items
WHEN COALESCE((SELECT status FROM invoices WHERE id = OLD.invoice_id), '') <> 'draft'
  OR COALESCE((SELECT status FROM invoices WHERE id = NEW.invoice_id), '') <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'invoice_items_immutable');
END;
--> statement-breakpoint
CREATE TRIGGER invoice_line_items_delete_guard
BEFORE DELETE ON invoice_line_items
WHEN COALESCE((SELECT status FROM invoices WHERE id = OLD.invoice_id), '') <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'invoice_items_immutable');
END;
--> statement-breakpoint
CREATE TRIGGER invoices_delete_guard
BEFORE DELETE ON invoices
BEGIN
  SELECT RAISE(ABORT, 'invoice_history_preserved');
END;
--> statement-breakpoint
CREATE TRIGGER payments_insert_guard
BEFORE INSERT ON payments
WHEN COALESCE((SELECT status FROM invoices WHERE id = NEW.invoice_id), '') <> 'issued'
  OR NEW.amount_cents > COALESCE((
    SELECT total_cents - COALESCE((
      SELECT SUM(amount_cents) FROM payments WHERE invoice_id = NEW.invoice_id
    ), 0)
    FROM invoices WHERE id = NEW.invoice_id
  ), -1)
BEGIN
  SELECT RAISE(ABORT, 'payment_invoice_conflict');
END;
--> statement-breakpoint
CREATE TRIGGER payments_update_guard
BEFORE UPDATE ON payments
BEGIN
  SELECT RAISE(ABORT, 'payment_history_immutable');
END;
--> statement-breakpoint
CREATE TRIGGER payments_delete_guard
BEFORE DELETE ON payments
BEGIN
  SELECT RAISE(ABORT, 'payment_history_immutable');
END;