import { apiRequest } from "../../lib/api";
export { formatCents } from "../../lib/money";

export interface ReportFilters {
  from: string;
  to: string;
  propertyId: number | null;
}

export interface CurrencyTotal {
  currency: string;
  totalCents: string;
  invoiceCount: number;
}

export interface ReportsSummary {
  filters: ReportFilters;
  properties: Array<{ id: number; name: string; status: string }>;
  metrics: {
    activeProperties: number;
    activeUnits: number;
    arrivals: number;
    departures: number;
    checkedInStays: number;
    dirtyUnits: number;
    cleaningUnits: number;
    cleanUnits: number;
    maintenanceUnits: number;
    issuedInvoiceTotals: Array<{ currency: string; totalCents: string }>;
    outstandingBalances: Array<{ currency: string; balanceCents: string }>;
  };
  metricDefinitions: Record<string, string>;
}

export interface GroupedDateCount {
  date: string;
  count: number;
}

export interface ReservationReport {
  statusCounts: Record<"pending" | "confirmed" | "cancelled" | "completed", number>;
  arrivalsByDate: GroupedDateCount[];
  departuresByDate: GroupedDateCount[];
  byProperty: Array<{ propertyId: number; propertyName: string; count: number }>;
  byUnit: Array<{ unitId: number; propertyName: string; unitName: string; count: number }>;
  dateBasis: Record<string, string>;
}

export interface OccupancyReport {
  totalEligibleUnits: number;
  totalEligibleUnitNights: number;
  occupiedUnitNights: number;
  availableUnitNights: number;
  occupancyPercentage: number | null;
  breakdown: Array<{
    date: string;
    eligibleUnits: number;
    occupiedUnits: number;
    availableUnits: number;
  }>;
  definition: string;
}

export interface HousekeepingReport {
  current: {
    dirty: number;
    cleaning: number;
    clean: number;
    maintenance: number;
    inactive: number;
  };
  byProperty: Array<{
    propertyId: number;
    propertyName: string;
    dirty: number;
    cleaning: number;
    clean: number;
    maintenance: number;
    inactive: number;
  }>;
  lastRecordedCleaningsByDate: GroupedDateCount[];
  dateBasis: string;
}

export interface BillingReport {
  issuedTotalsByCurrency: CurrencyTotal[];
  issuedTotalsByProperty: Array<{
    propertyId: number;
    propertyName: string;
    currency: string;
    totalCents: string;
    invoiceCount: number;
  }>;
  paymentsByDate: Array<{
    date: string;
    currency: string;
    method: string;
    paymentCount: number;
    amountCents: string;
  }>;
  invoiceStatusCounts: Record<
    "draft" | "issued" | "partially_paid" | "paid" | "void",
    number
  >;
  outstandingTotalsByCurrency: Array<{ currency: string; balanceCents: string }>;
  outstandingInvoices: Array<{
    id: number;
    invoiceNumber: string;
    reservationId: number;
    reservationReference: string;
    propertyName: string;
    unitName: string | null;
    issueDate: string;
    currency: string;
    status: "issued" | "partially_paid";
    totalCents: string;
    paidCents: string;
    balanceCents: string;
  }>;
  outstandingInvoicesTruncated: boolean;
  dateBasis: Record<string, string>;
}

export interface ReportsData {
  summary: ReportsSummary;
  reservations: ReservationReport;
  occupancy: OccupancyReport;
  housekeeping: HousekeepingReport;
  billing: BillingReport;
}

export async function fetchReports(filters: ReportFilters): Promise<ReportsData> {
  const params = new URLSearchParams({ from: filters.from, to: filters.to });
  if (filters.propertyId !== null) params.set("propertyId", String(filters.propertyId));
  const query = params.toString();
  const [summary, reservations, occupancy, housekeeping, billing] = await Promise.all([
    apiRequest<{ report: ReportsSummary }>(`/reports/summary?${query}`),
    apiRequest<{ report: ReservationReport }>(`/reports/reservations?${query}`),
    apiRequest<{ report: OccupancyReport }>(`/reports/occupancy?${query}`),
    apiRequest<{ report: HousekeepingReport }>(`/reports/housekeeping?${query}`),
    apiRequest<{ report: BillingReport }>(`/reports/billing?${query}`),
  ]);
  return {
    summary: summary.report,
    reservations: reservations.report,
    occupancy: occupancy.report,
    housekeeping: housekeeping.report,
    billing: billing.report,
  };
}
