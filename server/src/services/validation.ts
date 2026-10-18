import { HttpError } from "../middleware/http-errors.js";

export const propertyTypes = [
  "hotel",
  "resort",
  "hostel",
  "apartment",
  "vacation_rental",
  "other",
] as const;

export const unitTypes = [
  "room",
  "apartment",
  "villa",
  "dormitory_room",
  "studio",
  "suite",
  "other",
] as const;

export const unitStatuses = ["active", "inactive", "maintenance"] as const;

export function requireObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "Request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

export function parseRecordId(value: unknown): number {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new HttpError(400, "Record ID must be a positive integer.");
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id)) throw new HttpError(400, "Record ID is out of range.");
  return id;
}

export function requiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, `${field} is required.`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new HttpError(400, `${field} must be ${maxLength} characters or fewer.`);
  }
  return normalized;
}

export function optionalText(
  value: unknown,
  field: string,
  maxLength: number,
): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new HttpError(400, `${field} must be text.`);
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new HttpError(400, `${field} must be ${maxLength} characters or fewer.`);
  }
  return normalized || null;
}

export function enumValue<const T extends readonly string[]>(
  value: unknown,
  field: string,
  values: T,
): T[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new HttpError(400, `${field} must be one of: ${values.join(", ")}.`);
  }
  return value;
}

export function currencyValue(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value)) {
    throw new HttpError(400, "Default currency must be a 3-letter uppercase currency code.");
  }
  return value;
}

export function timeValue(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
  ) {
    throw new HttpError(400, `${field} must be a valid 24-hour time (HH:MM).`);
  }
  return value;
}

export function optionalEmail(value: unknown): string | null {
  const email = optionalText(value, "Contact email", 254);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, "Contact email must be a valid email address.");
  }
  return email;
}

export function positiveInteger(value: unknown, field: string, maximum: number): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > maximum
  ) {
    throw new HttpError(400, `${field} must be a whole number between 1 and ${maximum}.`);
  }
  return value;
}

export function rateToCents(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new HttpError(400, "Base nightly rate must be a non-negative number.");
  }
  const cents = Math.round(value * 100);
  if (
    !Number.isSafeInteger(cents) ||
    Math.abs(value * 100 - cents) > 1e-8
  ) {
    throw new HttpError(400, "Base nightly rate must have no more than two decimal places.");
  }
  return cents;
}
