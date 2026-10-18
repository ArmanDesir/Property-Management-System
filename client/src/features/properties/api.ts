import { apiRequest } from "../../lib/api";

export { apiRequest } from "../../lib/api";

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

export function formatPropertyType(type: PropertyType): string {
  return type === "vacation_rental"
    ? "Vacation rental"
    : type.charAt(0).toUpperCase() + type.slice(1);
}

export function formatUnitType(type: UnitType): string {
  return type.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
