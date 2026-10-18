import { apiRequest } from "../../lib/api";

export type GuestStatus = "active" | "archived";
export type GuestStatusFilter = GuestStatus | "all";

export interface GuestInput {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  country: string | null;
  notes: string | null;
}

export interface Guest extends GuestInput {
  id: number;
  status: GuestStatus;
  createdAt: string;
  updatedAt: string;
}

export type GuestListItem = Pick<
  Guest,
  "id" | "firstName" | "lastName" | "email" | "phone" | "status" | "createdAt"
>;

export async function fetchGuests(
  status: GuestStatusFilter,
  search: string,
): Promise<GuestListItem[]> {
  const params = new URLSearchParams({ status, q: search });
  const result = await apiRequest<{ guests: GuestListItem[] }>(`/guests?${params.toString()}`);
  return result.guests;
}
