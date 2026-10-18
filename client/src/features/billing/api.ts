import { apiRequest } from "../../lib/api";

export type InvoiceStatus =
  | "draft"
  | "issued"
  | "partially_paid"
  | "paid"
  | "void";
export type PaymentMethod = "cash" | "bank_transfer" | "card_terminal" | "other";

export interface InvoiceLineItem {
  id: number;
  description: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  position: number;
}

export interface InvoicePayment {
  id: number;
  paymentDate: string;
  amountCents: number;
  method: PaymentMethod;
  reference: string | null;
  note: string | null;
  createdAt: string;
}

export interface InvoiceSummary {
  id: number;
  invoiceNumber: string;
  reservationId: number;
  reservationReference: string;
  guestId: number;
  guestName: string;
  propertyName: string;
  unitName: string | null;
  checkIn: string;
  checkOut: string;
  issueDate: string;
  dueDate: string | null;
  currency: string;
  status: InvoiceStatus;
  taxRateBps: number;
  subtotalCents: number;
  taxAmountCents: number;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  notes: string | null;
  issuedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Invoice extends InvoiceSummary {
  items: InvoiceLineItem[];
  payments: InvoicePayment[];
}

export interface InvoiceDraftInput {
  reservationId: number;
  issueDate: string;
  dueDate: string | null;
  taxRate: string;
  notes: string | null;
  items: Array<{ description: string; quantity: number; unitPrice: string }>;
}

export interface ReservationChoice {
  id: number;
  reservationReference: string;
  guestId: number;
  guestName: string;
  propertyName: string;
  unitName: string | null;
  checkIn: string;
  checkOut: string;
  currency: string;
  totalAmountCents: number;
  status: string;
}

export async function fetchInvoices(filters: {
  status: InvoiceStatus | "all";
  q: string;
  reservationId?: number;
  offset?: number;
}) {
  const params = new URLSearchParams({
    status: filters.status,
    q: filters.q,
    limit: "50",
    offset: String(filters.offset ?? 0),
  });
  if (filters.reservationId !== undefined) {
    params.set("reservationId", String(filters.reservationId));
  }
  return apiRequest<{ invoices: InvoiceSummary[]; total: number }>(`/invoices?${params}`);
}

export async function fetchInvoiceReservations(search: string) {
  const params = new URLSearchParams();
  if (search.trim()) params.set("q", search.trim());
  const query = params.toString();
  return apiRequest<{ reservations: ReservationChoice[] }>(
    `/invoices/reservations${query ? `?${query}` : ""}`,
  );
}

export function fetchInvoiceReservation(id: number) {
  return apiRequest<{ reservation: ReservationChoice }>(`/invoices/reservations/${id}`);
}

export function fetchInvoice(id: number) {
  return apiRequest<{ invoice: Invoice }>(`/invoices/${id}`);
}

export function formatInvoiceMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(cents / 100);
}
