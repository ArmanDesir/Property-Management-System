import { apiRequest } from "../../lib/api";

export type ReservationStatus = "pending" | "confirmed" | "cancelled" | "completed";
export type ReservationStatusFilter = ReservationStatus | "all";
export type StayStatus = "not_checked_in" | "checked_in" | "checked_out";

export interface Reservation {
  id: number;
  reservationReference: string;
  propertyId: number;
  propertyName: string;
  guestId: number;
  guestName: string;
  unitId: number | null;
  unitName: string | null;
  unitStatus: string | null;
  checkIn: string;
  checkOut: string;
  numberOfGuests: number;
  nightlyRateCents: number;
  totalAmountCents: number;
  currency: string;
  status: ReservationStatus;
  stayStatus: StayStatus;
  actualCheckInAt: string | null;
  actualCheckOutAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReservationInput {
  guestId: number;
  unitId: number;
  checkIn: string;
  checkOut: string;
  numberOfGuests: number;
  nightlyRate?: number;
  notes: string | null;
}

export interface AvailabilityQuote {
  unitId: number;
  unitName: string;
  propertyId: number;
  propertyName: string;
  currency: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  numberOfGuests: number;
  nightlyRateCents: number;
  totalAmountCents: number;
  available: boolean;
  reason: string | null;
}

export interface ReservationFilters {
  status: ReservationStatusFilter;
  q: string;
  propertyId: string;
  guestId: string;
  unitId: string;
  checkInFrom: string;
  checkInTo: string;
  offset: number;
}

export async function fetchReservations(filters: ReservationFilters) {
  const params = new URLSearchParams({
    status: filters.status,
    q: filters.q,
    limit: "50",
    offset: String(filters.offset),
  });
  if (filters.propertyId) params.set("propertyId", filters.propertyId);
  if (filters.guestId) params.set("guestId", filters.guestId);
  if (filters.unitId) params.set("unitId", filters.unitId);
  if (filters.checkInFrom) params.set("checkInFrom", filters.checkInFrom);
  if (filters.checkInTo) params.set("checkInTo", filters.checkInTo);
  return apiRequest<{
    reservations: Reservation[];
    total: number;
    limit: number;
    offset: number;
  }>(`/reservations?${params.toString()}`);
}

export function formatReservationMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(cents / 100);
}
