export type PropertyType =
  | "hotel"
  | "resort"
  | "hostel"
  | "apartment"
  | "vacation_rental"
  | "other";

export type PropertyStatus = "active" | "archived";

export type UnitType =
  | "room"
  | "apartment"
  | "villa"
  | "dormitory_room"
  | "studio"
  | "suite"
  | "other";

export type UnitStatus = "active" | "inactive" | "maintenance";

export interface PropertyInput {
  name: string;
  propertyType: PropertyType;
  address: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  defaultCurrency: string;
  defaultCheckInTime: string;
  defaultCheckOutTime: string;
}

export interface Property extends PropertyInput {
  id: number;
  timezone: string;
  status: PropertyStatus;
  createdAt: string;
  updatedAt: string;
}

export interface UnitInput {
  name: string;
  unitType: UnitType;
  description: string | null;
  capacity: number;
  baseNightlyRate: number;
}

export interface Unit {
  id: number;
  propertyId: number;
  name: string;
  unitType: UnitType;
  description: string | null;
  capacity: number;
  baseNightlyRateCents: number;
  status: UnitStatus;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ApiError {
  error?: string;
}

export async function apiRequest<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("Could not reach the local PMS API. Check that the server is running.");
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error("The local PMS API returned an unreadable response.");
  }

  if (!response.ok) {
    const message = typeof data === "object" && data !== null && "error" in data
      ? (data as ApiError).error
      : undefined;
    throw new Error(message ?? `Request failed (${response.status}).`);
  }
  return data as T;
}

export function formatPropertyType(type: PropertyType): string {
  return type === "vacation_rental"
    ? "Vacation rental"
    : type.charAt(0).toUpperCase() + type.slice(1);
}

export function formatUnitType(type: UnitType): string {
  return type.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
