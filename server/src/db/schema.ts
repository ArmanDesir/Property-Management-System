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
  address: text("address"),
  timezone: text("timezone").notNull().default("UTC"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const guests = sqliteTable(
  "guests",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    notes: text("notes"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("guests_email_unique")
      .on(table.email)
      .where(sql`${table.email} IS NOT NULL AND ${table.email} <> ''`),
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
