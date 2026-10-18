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
    propertyId: integer("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "restrict" }),
    guestId: integer("guest_id")
      .notNull()
      .references(() => guests.id, { onDelete: "restrict" }),
    checkIn: text("check_in").notNull(),
    checkOut: text("check_out").notNull(),
    status: text("status", {
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
      sql`${table.status} IN ('booked', 'checked_in', 'checked_out', 'cancelled')`,
    ),
    check("reservations_total_nonnegative", sql`${table.totalAmountCents} >= 0`),
    check("reservations_checkout_after_checkin", sql`${table.checkOut} > ${table.checkIn}`),
    index("reservations_property_dates").on(
      table.propertyId,
      table.checkIn,
      table.checkOut,
    ),
    index("reservations_guest").on(table.guestId),
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
    check("units_capacity_positive", sql`${table.capacity} > 0`),
    check("units_nightly_rate_nonnegative", sql`${table.baseNightlyRateCents} >= 0`),
    index("units_property_status_archived").on(
      table.propertyId,
      table.status,
      table.archivedAt,
    ),
    uniqueIndex("units_property_name_active_unique")
      .on(table.propertyId, sql`lower(trim(${table.name}))`)
      .where(sql`${table.archivedAt} IS NULL`),
  ],
);
