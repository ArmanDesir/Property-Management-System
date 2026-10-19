import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const properties = sqliteTable("properties", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  propertyType: text("property_type", {
    enum: ["hotel", "resort", "hostel", "apartment", "vacation_rental", "other"],
  }).notNull().default("other"),
  address: text("address"),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  defaultCurrency: text("default_currency").notNull().default("USD"),
  defaultCheckInTime: text("default_check_in_time").notNull().default("15:00"),
  defaultCheckOutTime: text("default_check_out_time").notNull().default("11:00"),
  status: text("status", { enum: ["active", "archived"] }).notNull().default("active"),
  timezone: text("timezone").notNull().default("UTC"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  check(
    "properties_type_check",
    sql`${table.propertyType} IN ('hotel', 'resort', 'hostel', 'apartment', 'vacation_rental', 'other')`,
  ),
  check("properties_status_check", sql`${table.status} IN ('active', 'archived')`),
  check(
    "properties_currency_check",
    sql`${table.defaultCurrency} GLOB '[A-Z][A-Z][A-Z]'`,
  ),
  check(
    "properties_check_in_time_check",
    sql`${table.defaultCheckInTime} GLOB '[0-2][0-9]:[0-5][0-9]' AND substr(${table.defaultCheckInTime}, 1, 2) BETWEEN '00' AND '23'`,
  ),
  check(
    "properties_check_out_time_check",
    sql`${table.defaultCheckOutTime} GLOB '[0-2][0-9]:[0-5][0-9]' AND substr(${table.defaultCheckOutTime}, 1, 2) BETWEEN '00' AND '23'`,
  ),
],
);

export const guests = sqliteTable(
  "guests",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    address: text("address"),
    country: text("country"),
    notes: text("notes"),
    status: text("status", { enum: ["active", "archived"] }).notNull().default("active"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    check("guests_status_check", sql`${table.status} IN ('active', 'archived')`),
    index("guests_status_name_search").on(table.status, table.lastName, table.firstName),
    index("guests_email_search").on(table.email),
    index("guests_phone_search").on(table.phone),
  ],
);

export const reservations = sqliteTable(
  "reservations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    reservationReference: text("reservation_reference"),
    propertyId: integer("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "restrict" }),
    guestId: integer("guest_id")
      .notNull()
      .references(() => guests.id, { onDelete: "restrict" }),
    unitId: integer("unit_id").references(() => units.id, { onDelete: "restrict" }),
    checkIn: text("check_in").notNull(),
    checkOut: text("check_out").notNull(),
    numberOfGuests: integer("number_of_guests").notNull().default(1),
    nightlyRateCents: integer("nightly_rate_cents").notNull().default(0),
    reservationStatus: text("lifecycle_status", {
      enum: ["pending", "confirmed", "cancelled", "completed"],
    }).notNull().default("confirmed"),
    stayStatus: text("stay_status", {
      enum: ["not_checked_in", "checked_in", "checked_out"],
    }).notNull().default("not_checked_in"),
    actualCheckInAt: text("actual_check_in_at"),
    actualCheckOutAt: text("actual_check_out_at"),
    legacyStatus: text("status", {
      enum: ["booked", "checked_in", "checked_out", "cancelled"],
    }).notNull().default("booked"),
    totalAmountCents: integer("total_amount_cents").notNull().default(0),
    currency: text("currency").notNull().default("USD"),
    notes: text("notes"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    check(
      "reservations_status_check",
      sql`${table.legacyStatus} IN ('booked', 'checked_in', 'checked_out', 'cancelled')`,
    ),
    check(
      "reservations_lifecycle_status_check",
      sql`${table.reservationStatus} IN ('pending', 'confirmed', 'cancelled', 'completed')`,
    ),
    check(
      "reservations_stay_status_check",
      sql`${table.stayStatus} IN ('not_checked_in', 'checked_in', 'checked_out')`,
    ),
    check("reservations_number_of_guests_positive", sql`${table.numberOfGuests} > 0`),
    check("reservations_nightly_rate_nonnegative", sql`${table.nightlyRateCents} >= 0`),
    check("reservations_total_nonnegative", sql`${table.totalAmountCents} >= 0`),
    check("reservations_checkout_after_checkin", sql`${table.checkOut} > ${table.checkIn}`),
    index("reservations_property_dates").on(
      table.propertyId,
      table.checkIn,
      table.checkOut,
    ),
    index("reservations_guest").on(table.guestId),
    index("reservations_unit_dates_status").on(
      table.unitId,
      table.checkIn,
      table.checkOut,
      table.reservationStatus,
    ),
    index("reservations_stay_status_dates").on(
      table.reservationStatus,
      table.stayStatus,
      table.checkIn,
      table.checkOut,
    ),
    index("reservations_unit_stay_status").on(
      table.unitId,
      table.stayStatus,
      table.actualCheckOutAt,
    ),
    uniqueIndex("reservations_reference_unique").on(table.reservationReference),
  ],
);

export const billingEntries = sqliteTable(
  "billing_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    reservationId: integer("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    amountCents: integer("amount_cents").notNull(),
    entryType: text("entry_type", { enum: ["charge", "payment", "refund"] }).notNull(),
    status: text("status", { enum: ["pending", "posted", "void"] })
      .notNull()
      .default("posted"),
    occurredAt: text("occurred_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    check("billing_entry_type_check", sql`${table.entryType} IN ('charge', 'payment', 'refund')`),
    check("billing_status_check", sql`${table.status} IN ('pending', 'posted', 'void')`),
    index("billing_reservation").on(table.reservationId),
  ],
);

export const invoices = sqliteTable(
  "invoices",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    invoiceNumber: text("invoice_number").notNull(),
    reservationId: integer("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "restrict" }),
    issueDate: text("issue_date").notNull(),
    dueDate: text("due_date"),
    currency: text("currency").notNull(),
    status: text("status", { enum: ["draft", "issued", "void"] })
      .notNull()
      .default("draft"),
    taxRateBps: integer("tax_rate_bps").notNull().default(0),
    subtotalCents: integer("subtotal_cents").notNull().default(0),
    taxAmountCents: integer("tax_amount_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull().default(0),
    notes: text("notes"),
    issuedAt: text("issued_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    check("invoices_status_check", sql`${table.status} IN ('draft', 'issued', 'void')`),
    check("invoices_currency_check", sql`${table.currency} GLOB '[A-Z][A-Z][A-Z]'`),
    check("invoices_tax_rate_check", sql`${table.taxRateBps} BETWEEN 0 AND 10000`),
    check("invoices_subtotal_nonnegative", sql`${table.subtotalCents} >= 0`),
    check("invoices_tax_nonnegative", sql`${table.taxAmountCents} >= 0`),
    check("invoices_total_nonnegative", sql`${table.totalCents} >= 0`),
    uniqueIndex("invoices_invoice_number_unique").on(table.invoiceNumber),
    index("invoices_reservation").on(table.reservationId),
    index("invoices_status_issue_date").on(table.status, table.issueDate),
  ],
);

export const invoiceLineItems = sqliteTable(
  "invoice_line_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "restrict" }),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    lineTotalCents: integer("line_total_cents").notNull(),
    position: integer("position").notNull(),
  },
  (table) => [
    check("invoice_line_items_quantity_positive", sql`${table.quantity} > 0`),
    check("invoice_line_items_price_nonnegative", sql`${table.unitPriceCents} >= 0`),
    check("invoice_line_items_total_nonnegative", sql`${table.lineTotalCents} >= 0`),
    check("invoice_line_items_position_nonnegative", sql`${table.position} >= 0`),
    index("invoice_line_items_invoice_position").on(table.invoiceId, table.position),
  ],
);

export const payments = sqliteTable(
  "payments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "restrict" }),
    paymentDate: text("payment_date").notNull(),
    amountCents: integer("amount_cents").notNull(),
    method: text("method", {
      enum: ["cash", "bank_transfer", "card_terminal", "other"],
    }).notNull(),
    reference: text("reference"),
    note: text("note"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    check("payments_amount_positive", sql`${table.amountCents} > 0`),
    check(
      "payments_method_check",
      sql`${table.method} IN ('cash', 'bank_transfer', 'card_terminal', 'other')`,
    ),
    uniqueIndex("payments_idempotency_key_unique").on(table.idempotencyKey),
    index("payments_invoice_date").on(table.invoiceId, table.paymentDate, table.id),
  ],
);

export const housekeepingTasks = sqliteTable(
  "housekeeping_tasks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    propertyId: integer("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    reservationId: integer("reservation_id").references(() => reservations.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    dueAt: text("due_at"),
    status: text("status", {
      enum: ["pending", "in_progress", "complete", "cancelled"],
    }).notNull().default("pending"),
    notes: text("notes"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    check(
      "housekeeping_status_check",
      sql`${table.status} IN ('pending', 'in_progress', 'complete', 'cancelled')`,
    ),
    index("housekeeping_property_status").on(table.propertyId, table.status),
  ],
);

export const units = sqliteTable(
  "units",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    propertyId: integer("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    unitType: text("unit_type", {
      enum: ["room", "apartment", "villa", "dormitory_room", "studio", "suite", "other"],
    }).notNull().default("room"),
    description: text("description"),
    capacity: integer("capacity").notNull(),
    baseNightlyRateCents: integer("base_nightly_rate_cents").notNull(),
    status: text("status", {
      enum: ["active", "inactive", "maintenance"],
    }).notNull().default("active"),
    housekeepingStatus: text("housekeeping_status", {
      enum: ["dirty", "cleaning", "clean"],
    }).notNull().default("dirty"),
    lastCleanedAt: text("last_cleaned_at"),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    check(
      "units_type_check",
      sql`${table.unitType} IN ('room', 'apartment', 'villa', 'dormitory_room', 'studio', 'suite', 'other')`,
    ),
    check(
      "units_status_check",
      sql`${table.status} IN ('active', 'inactive', 'maintenance')`,
    ),
    check(
      "units_housekeeping_status_check",
      sql`${table.housekeepingStatus} IN ('dirty', 'cleaning', 'clean')`,
    ),
    check("units_capacity_positive", sql`${table.capacity} > 0`),
    check("units_nightly_rate_nonnegative", sql`${table.baseNightlyRateCents} >= 0`),
    index("units_property_status_archived").on(
      table.propertyId,
      table.status,
      table.archivedAt,
    ),
    index("units_property_housekeeping").on(
      table.propertyId,
      table.housekeepingStatus,
      table.status,
      table.archivedAt,
    ),
    uniqueIndex("units_property_name_active_unique")
      .on(table.propertyId, sql`lower(trim(${table.name}))`)
      .where(sql`${table.archivedAt} IS NULL`),
  ],
);

export const staffAccounts = sqliteTable(
  "staff_accounts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    displayName: text("display_name").notNull(),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role", {
      enum: ["administrator", "front_desk", "housekeeping", "accounting"],
    }).notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    check(
      "staff_accounts_role_check",
      sql`${table.role} IN ('administrator', 'front_desk', 'housekeeping', 'accounting')`,
    ),
    check("staff_accounts_active_check", sql`${table.isActive} IN (0, 1)`),
    uniqueIndex("staff_accounts_username_unique").on(table.username),
  ],
);

export const staffRoleExtensions = sqliteTable(
  "staff_role_extensions",
  {
    staffId: integer("staff_id").primaryKey()
      .references(() => staffAccounts.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["property_manager"] }).notNull(),
  },
  (table) => [
    check("staff_role_extensions_role_check", sql`${table.role} = 'property_manager'`),
  ],
);

export const propertyManagerProperties = sqliteTable(
  "property_manager_properties",
  {
    staffId: integer("staff_id").notNull()
      .references(() => staffAccounts.id, { onDelete: "cascade" }),
    propertyId: integer("property_id").notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("property_manager_properties_unique").on(table.staffId, table.propertyId),
    index("property_manager_properties_property").on(table.propertyId, table.staffId),
  ],
);

export const authSessions = sqliteTable(
  "auth_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    staffId: integer("staff_id")
      .notNull()
      .references(() => staffAccounts.id, { onDelete: "cascade" }),
    csrfTokenHash: text("csrf_token_hash").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [
    index("auth_sessions_staff_expiry").on(table.staffId, table.expiresAt),
  ],
);

export const maintenanceRequests = sqliteTable(
  "maintenance_requests",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    requestCode: text("request_code").notNull(),
    propertyId: integer("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "restrict" }),
    unitId: integer("unit_id").references(() => units.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    description: text("description").notNull(),
    category: text("category", {
      enum: [
        "plumbing",
        "electrical",
        "hvac",
        "appliance",
        "furniture",
        "structural",
        "cleaning_related",
        "other",
      ],
    }).notNull(),
    priority: text("priority", {
      enum: ["low", "normal", "high", "urgent"],
    }).notNull().default("normal"),
    status: text("status", {
      enum: ["open", "in_progress", "awaiting_parts", "completed", "cancelled"],
    }).notNull().default("open"),
    reportedAt: text("reported_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    targetCompletionDate: text("target_completion_date"),
    assignedStaffId: integer("assigned_staff_id").references(() => staffAccounts.id, {
      onDelete: "set null",
    }),
    completedAt: text("completed_at"),
    resolutionNotes: text("resolution_notes"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    check(
      "maintenance_category_check",
      sql`${table.category} IN ('plumbing', 'electrical', 'hvac', 'appliance', 'furniture', 'structural', 'cleaning_related', 'other')`,
    ),
    check(
      "maintenance_priority_check",
      sql`${table.priority} IN ('low', 'normal', 'high', 'urgent')`,
    ),
    check(
      "maintenance_status_check",
      sql`${table.status} IN ('open', 'in_progress', 'awaiting_parts', 'completed', 'cancelled')`,
    ),
    check("maintenance_title_nonempty", sql`length(trim(${table.title})) > 0`),
    check("maintenance_description_nonempty", sql`length(trim(${table.description})) > 0`),
    uniqueIndex("maintenance_request_code_unique").on(table.requestCode),
    index("maintenance_property_status").on(table.propertyId, table.status),
    index("maintenance_unit_status").on(table.unitId, table.status),
    index("maintenance_status_priority_target")
      .on(table.status, table.priority, table.targetCompletionDate),
    index("maintenance_assigned_staff").on(table.assignedStaffId, table.status),
  ],
);

export const maintenanceHistory = sqliteTable(
  "maintenance_history",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    requestId: integer("request_id")
      .notNull()
      .references(() => maintenanceRequests.id, { onDelete: "cascade" }),
    fromStatus: text("from_status", {
      enum: ["open", "in_progress", "awaiting_parts", "completed", "cancelled"],
    }),
    toStatus: text("to_status", {
      enum: ["open", "in_progress", "awaiting_parts", "completed", "cancelled"],
    }).notNull(),
    changedByStaffId: integer("changed_by_staff_id").references(() => staffAccounts.id, {
      onDelete: "set null",
    }),
    note: text("note"),
    changedAt: text("changed_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    check(
      "maintenance_history_from_status_check",
      sql`${table.fromStatus} IS NULL OR ${table.fromStatus} IN ('open', 'in_progress', 'awaiting_parts', 'completed', 'cancelled')`,
    ),
    check(
      "maintenance_history_to_status_check",
      sql`${table.toStatus} IN ('open', 'in_progress', 'awaiting_parts', 'completed', 'cancelled')`,
    ),
    index("maintenance_history_request_time").on(table.requestId, table.changedAt, table.id),
  ],
);

export const teamTasks = sqliteTable(
  "team_tasks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    propertyId: integer("property_id").notNull()
      .references(() => properties.id, { onDelete: "restrict" }),
    unitId: integer("unit_id").references(() => units.id, { onDelete: "restrict" }),
    reservationId: integer("reservation_id").references(() => reservations.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    description: text("description").notNull(),
    department: text("department", {
      enum: ["front_desk", "housekeeping", "accounting"],
    }).notNull(),
    assignedStaffId: integer("assigned_staff_id").notNull()
      .references(() => staffAccounts.id, { onDelete: "restrict" }),
    createdByStaffId: integer("created_by_staff_id").notNull()
      .references(() => staffAccounts.id, { onDelete: "restrict" }),
    priority: text("priority", { enum: ["low", "normal", "high", "urgent"] })
      .notNull().default("normal"),
    status: text("status", {
      enum: ["pending", "in_progress", "submitted", "completed", "rejected", "cancelled"],
    }).notNull().default("pending"),
    dueDate: text("due_date"),
    dueTime: text("due_time"),
    completionNote: text("completion_note"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    check("team_tasks_title_nonempty", sql`length(trim(${table.title})) > 0`),
    check("team_tasks_description_nonempty", sql`length(trim(${table.description})) > 0`),
    check("team_tasks_department_check", sql`${table.department} IN ('front_desk', 'housekeeping', 'accounting')`),
    check("team_tasks_priority_check", sql`${table.priority} IN ('low', 'normal', 'high', 'urgent')`),
    check("team_tasks_status_check", sql`${table.status} IN ('pending', 'in_progress', 'submitted', 'completed', 'rejected', 'cancelled')`),
    index("team_tasks_property_status_due").on(table.propertyId, table.status, table.dueDate),
    index("team_tasks_assignee_status_due").on(table.assignedStaffId, table.status, table.dueDate),
  ],
);

export const teamTaskActivity = sqliteTable(
  "team_task_activity",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    taskId: integer("task_id").notNull()
      .references(() => teamTasks.id, { onDelete: "cascade" }),
    actorStaffId: integer("actor_staff_id").references(() => staffAccounts.id, { onDelete: "set null" }),
    eventType: text("event_type", {
      enum: ["created", "status_changed", "submitted", "approved", "returned", "cancelled", "details_changed"],
    }).notNull(),
    description: text("description").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("team_task_activity_task_time").on(table.taskId, table.createdAt, table.id),
  ],
);
