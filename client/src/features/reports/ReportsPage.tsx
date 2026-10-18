import { useEffect, useState, type ReactNode } from "react";
import {
  fetchReports,
  formatCents,
  type ReportsData,
} from "./api";
import "./Reports.css";

type RangePreset = "today" | "7days" | "30days" | "month" | "custom";

export function ReportsPage({ navigate }: { navigate: (path: string) => void }) {
  const [from, setFrom] = useState(() => shiftDate(localDate(), -29));
  const [to, setTo] = useState(localDate);
  const [preset, setPreset] = useState<RangePreset>("30days");
  const [propertyId, setPropertyId] = useState("");
  const [data, setData] = useState<ReportsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const selectedProperty = propertyId ? Number(propertyId) : null;
    fetchReports({ from, to, propertyId: selectedProperty })
      .then((result) => {
        if (active) setData(result);
      })
      .catch((requestError: unknown) => {
        if (active) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Could not load reports.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [from, to, propertyId, refreshKey]);

  const choosePreset = (next: RangePreset) => {
    setPreset(next);
    const today = localDate();
    setTo(today);
    if (next === "today") setFrom(today);
    if (next === "7days") setFrom(shiftDate(today, -6));
    if (next === "30days") setFrom(shiftDate(today, -29));
    if (next === "month") setFrom(`${today.slice(0, 7)}-01`);
  };

  const summary = data?.summary;
  const properties = summary?.properties ?? [];

  return (
    <section className="page-section reports-page">
      <button className="back-link" onClick={() => navigate("/")}>
        <span aria-hidden="true">←</span> Back to dashboard
      </button>
      <div className="page-heading reports-heading">
        <div>
          <p className="eyebrow"><span /> PROPERTY PERFORMANCE</p>
          <h1 className="page-title">Reports &amp; Analytics</h1>
          <p className="page-intro">
            Read-only operational, reservation, occupancy, and billing summaries.
          </p>
        </div>
        <button
          className="button button-secondary"
          type="button"
          onClick={() => setRefreshKey((value) => value + 1)}
          disabled={loading}
        >
          Refresh
        </button>
      </div>

      <div className="report-filters">
        <fieldset className="report-range-options">
          <legend>Date range</legend>
          {([
            ["today", "Today"],
            ["7days", "Last 7 days"],
            ["30days", "Last 30 days"],
            ["month", "This month"],
          ] as const).map(([value, label]) => (
            <button
              className={preset === value ? "report-range active" : "report-range"}
              type="button"
              key={value}
              onClick={() => choosePreset(value)}
              aria-pressed={preset === value}
            >
              {label}
            </button>
          ))}
          <button
            className={preset === "custom" ? "report-range active" : "report-range"}
            type="button"
            onClick={() => setPreset("custom")}
            aria-pressed={preset === "custom"}
          >
            Custom
          </button>
        </fieldset>
        <label className="report-filter-field">
          <span>From</span>
          <input
            type="date"
            value={from}
            max={to}
            onChange={(event) => {
              setPreset("custom");
              setFrom(event.target.value);
            }}
          />
        </label>
        <label className="report-filter-field">
          <span>To</span>
          <input
            type="date"
            value={to}
            min={from}
            onChange={(event) => {
              setPreset("custom");
              setTo(event.target.value);
            }}
          />
        </label>
        <label className="report-filter-field report-property-filter">
          <span>Property</span>
          <select value={propertyId} onChange={(event) => setPropertyId(event.target.value)}>
            <option value="">All properties</option>
            {properties.map((property) => (
              <option key={property.id} value={property.id}>
                {property.name}{property.status === "archived" ? " (archived)" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="report-range-caption">
        Reporting dates are inclusive: {from} through {to}. Current-status metrics are labeled separately.
      </p>

      {loading && (
        <div className="state-panel" role="status">
          <span className="spinner" /> Loading reports…
        </div>
      )}
      {!loading && error && (
        <div className="state-panel state-error" role="alert">
          <span className="state-symbol">!</span>
          <div>
            <strong>Reports could not be loaded</strong>
            <p>{error}</p>
            <button className="text-button" onClick={() => setRefreshKey((value) => value + 1)}>
              Try again
            </button>
          </div>
        </div>
      )}
      {!loading && !error && data && (
        <>
          <section className="report-section" aria-labelledby="summary-heading">
            <SectionHeading
              id="summary-heading"
              eyebrow="CURRENT SNAPSHOT & PERIOD TOTALS"
              title="Summary"
              note="Property, unit, stay, and housekeeping cards show current status. Arrivals, departures, invoice issue totals, and payments use the selected dates."
            />
            <div className="report-metric-grid">
              <Metric label="Active properties" value={summary?.metrics.activeProperties ?? 0} detail="Current status" />
              <Metric label="Active units" value={summary?.metrics.activeUnits ?? 0} detail="Unarchived and operationally active" />
              <Metric label="Planned arrivals" value={summary?.metrics.arrivals ?? 0} detail="Non-cancelled; planned check-in date" />
              <Metric label="Planned departures" value={summary?.metrics.departures ?? 0} detail="Non-cancelled; planned check-out date" />
              <Metric label="Currently checked in" value={summary?.metrics.checkedInStays ?? 0} detail="Actual stay status; not planned dates" />
              <Metric label="Dirty units" value={summary?.metrics.dirtyUnits ?? 0} detail="Current housekeeping status" />
              <Metric label="Being cleaned" value={summary?.metrics.cleaningUnits ?? 0} detail="Current housekeeping status" />
              <Metric label="Clean units" value={summary?.metrics.cleanUnits ?? 0} detail="Current housekeeping status" />
              <Metric label="Maintenance units" value={summary?.metrics.maintenanceUnits ?? 0} detail="Current operational status" />
              <Metric
                label="Issued invoice totals"
                value={<MoneyTotals rows={(summary?.metrics.issuedInvoiceTotals ?? []).map((row) => ({ currency: row.currency, cents: row.totalCents }))} />}
                detail="Selected issue dates; not money collected"
              />
              <Metric
                label="Recorded payments"
                value={<MoneyTotals rows={data.billing.paymentsByDate.reduce<Array<{ currency: string; cents: string }>>((totals, row) => {
                  const existing = totals.find((item) => item.currency === row.currency);
                  if (existing) existing.cents = (BigInt(existing.cents) + BigInt(row.amountCents)).toString();
                  else totals.push({ currency: row.currency, cents: row.amountCents });
                  return totals;
                }, [])} />}
                detail="Selected payment dates; recorded bookkeeping only"
              />
              <Metric
                label="Outstanding balances"
                value={<MoneyTotals rows={(summary?.metrics.outstandingBalances ?? []).map((row) => ({ currency: row.currency, cents: row.balanceCents }))} />}
                detail="Current issued invoices; excludes draft and void"
              />
            </div>
          </section>

          <section className="report-section" aria-labelledby="reservation-heading">
            <SectionHeading
              id="reservation-heading"
              eyebrow="PLANNED STAYS"
              title="Reservations"
              note="Arrival and departure tables use planned dates, not actual front-desk timestamps. Status counts are grouped by planned check-in date."
            />
            <div className="report-columns">
              <div className="report-panel">
                <h3>Reservations by status</h3>
                <StatusBars
                  rows={Object.entries(data.reservations.statusCounts).map(([label, count]) => ({ label, count }))}
                />
              </div>
              <CountTable title="Arrivals by planned check-in" rows={data.reservations.arrivalsByDate} />
              <CountTable title="Departures by planned check-out" rows={data.reservations.departuresByDate} />
            </div>
            <div className="report-columns report-columns-even">
              <SimpleTable
                title="Reservations by property"
                headers={["Property", "Reservations"]}
                rows={data.reservations.byProperty.map((row) => [row.propertyName, row.count])}
              />
              <SimpleTable
                title="Reservations by unit"
                headers={["Property", "Unit", "Reservations"]}
                rows={data.reservations.byUnit.map((row) => [row.propertyName, row.unitName, row.count])}
              />
            </div>
          </section>

          <section className="report-section" aria-labelledby="occupancy-heading">
            <SectionHeading
              id="occupancy-heading"
              eyebrow="INVENTORY UTILIZATION"
              title="Occupancy"
              note={data.occupancy.definition}
            />
            <div className="report-metric-grid report-metric-grid-occupancy">
              <Metric label="Eligible units" value={data.occupancy.totalEligibleUnits} detail="Current eligibility" />
              <Metric label="Occupied unit-nights" value={data.occupancy.occupiedUnitNights} detail="Overlapping stays counted once" />
              <Metric label="Available unit-nights" value={data.occupancy.availableUnitNights} detail="Eligible less occupied" />
              <Metric label="Occupancy" value={data.occupancy.occupancyPercentage === null ? "—" : `${data.occupancy.occupancyPercentage}%`} detail="Occupied ÷ eligible unit-nights" />
            </div>
            <div className="report-panel">
              <h3>Occupancy by date</h3>
              {data.occupancy.breakdown.length === 0 || data.occupancy.totalEligibleUnits === 0
                ? <EmptyTable message="No eligible unit-nights in this range." />
                : (
                  <div className="occupancy-chart" role="img" aria-label="Occupancy by date, with occupied and available units listed in the table below">
                    {data.occupancy.breakdown.map((row) => (
                      <div className="occupancy-chart-row" key={row.date}>
                        <span>{shortDate(row.date)}</span>
                        <div className="occupancy-track">
                          <span style={{ width: `${row.occupiedUnits / row.eligibleUnits * 100}%` }} />
                        </div>
                        <strong>{row.occupiedUnits}/{row.eligibleUnits}</strong>
                      </div>
                    ))}
                  </div>
                )}
              <SimpleTable
                title="Exact unit-night counts by date"
                headers={["Date", "Eligible units", "Occupied", "Available"]}
                rows={data.occupancy.breakdown.map((row) => [row.date, row.eligibleUnits, row.occupiedUnits, row.availableUnits])}
              />
            </div>
          </section>

          <section className="report-section" aria-labelledby="housekeeping-heading">
            <SectionHeading
              id="housekeeping-heading"
              eyebrow="CURRENT OPERATIONS"
              title="Housekeeping"
              note={data.housekeeping.dateBasis}
            />
            <div className="report-metric-grid report-metric-grid-occupancy">
              <Metric label="Dirty" value={data.housekeeping.current.dirty} detail="Current housekeeping status" />
              <Metric label="Being cleaned" value={data.housekeeping.current.cleaning} detail="Current housekeeping status" />
              <Metric label="Clean" value={data.housekeeping.current.clean} detail="Current housekeeping status" />
              <Metric label="Maintenance" value={data.housekeeping.current.maintenance} detail="Current operational status" />
            </div>
            <div className="report-columns report-columns-even">
              <SimpleTable
                title="Current unit statuses by property"
                headers={["Property", "Dirty", "Cleaning", "Clean", "Maintenance", "Inactive"]}
                rows={data.housekeeping.byProperty.map((row) => [
                  row.propertyName, row.dirty, row.cleaning, row.clean, row.maintenance, row.inactive,
                ])}
              />
              <CountTable title="Last recorded cleanings by date" rows={data.housekeeping.lastRecordedCleaningsByDate} />
            </div>
          </section>

          <section className="report-section" aria-labelledby="billing-heading">
            <SectionHeading
              id="billing-heading"
              eyebrow="INVOICES & RECORDED PAYMENTS"
              title="Billing"
              note={`${data.billing.dateBasis.issuedInvoiceTotals} ${data.billing.dateBasis.payments} Balances and invoice status counts are current, not date-range activity.`}
            />
            <div className="report-columns">
              <SimpleTable
                title="Issued invoice totals by currency"
                headers={["Currency", "Invoices", "Issued total"]}
                rows={data.billing.issuedTotalsByCurrency.map((row) => [
                  row.currency, row.invoiceCount, formatCents(row.totalCents, row.currency),
                ])}
              />
              <SimpleTable
                title="Invoice totals by property"
                headers={["Property", "Currency", "Invoices", "Issued total"]}
                rows={data.billing.issuedTotalsByProperty.map((row) => [
                  row.propertyName, row.currency, row.invoiceCount, formatCents(row.totalCents, row.currency),
                ])}
              />
              <SimpleTable
                title="Payments by date and method"
                headers={["Date", "Currency", "Method", "Count", "Recorded amount"]}
                rows={data.billing.paymentsByDate.map((row) => [
                  row.date, row.currency, row.method.replaceAll("_", " "), row.paymentCount,
                  formatCents(row.amountCents, row.currency),
                ])}
              />
              <div className="report-panel">
                <h3>Current invoice counts by status</h3>
                <StatusBars
                  rows={Object.entries(data.billing.invoiceStatusCounts).map(([label, count]) => ({ label: label.replaceAll("_", " "), count }))}
                />
              </div>
            </div>
            <SimpleTable
              title="Outstanding invoices"
              headers={["Invoice", "Reservation ref.", "Property / unit", "Issue date", "Status", "Currency", "Total", "Paid", "Balance"]}
              rows={data.billing.outstandingInvoices.map((invoice) => [
                invoice.invoiceNumber,
                invoice.reservationReference || `Reservation ${invoice.reservationId}`,
                invoice.unitName ? `${invoice.propertyName} / ${invoice.unitName}` : invoice.propertyName,
                invoice.issueDate,
                invoice.status.replaceAll("_", " "),
                invoice.currency,
                formatCents(invoice.totalCents, invoice.currency),
                formatCents(invoice.paidCents, invoice.currency),
                formatCents(invoice.balanceCents, invoice.currency),
              ])}
            />
            {data.billing.outstandingInvoicesTruncated && (
              <p className="report-range-caption">Showing the first 250 outstanding invoices. Refine by property to narrow the list.</p>
            )}
            <p className="report-range-caption">
              Invoiced amounts and recorded payments are separate measures. No currency conversion is applied.
            </p>
          </section>
        </>
      )}
    </section>
  );
}

function SectionHeading({ id, eyebrow, title, note }: {
  id: string;
  eyebrow: string;
  title: string;
  note: string;
}) {
  return (
    <div className="report-section-heading">
      <div>
        <p className="eyebrow"><span /> {eyebrow}</p>
        <h2 id={id}>{title}</h2>
      </div>
      <p>{note}</p>
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: number | string | ReactNode; detail: string }) {
  return (
    <article className="report-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function MoneyTotals({ rows }: { rows: Array<{ currency: string; cents: string }> }) {
  if (rows.length === 0) return <>—</>;
  return (
    <span className="money-total-list">
      {rows.map((row) => <span key={row.currency}>{formatCents(row.cents, row.currency)}</span>)}
    </span>
  );
}

function StatusBars({ rows }: { rows: Array<{ label: string; count: number }> }) {
  const maximum = Math.max(1, ...rows.map((row) => row.count));
  if (rows.length === 0 || maximum === 0) return <EmptyTable message="No records for this selection." />;
  return (
    <div className="report-bars">
      {rows.map((row) => (
        <div className="report-bar-row" key={row.label}>
          <span>{row.label.replaceAll("_", " ")}</span>
          <div><span style={{ width: `${row.count / maximum * 100}%` }} /></div>
          <strong>{row.count}</strong>
        </div>
      ))}
    </div>
  );
}

function CountTable({ title, rows }: { title: string; rows: Array<{ date: string; count: number }> }) {
  return (
    <SimpleTable
      title={title}
      headers={["Date", "Reservations / records"]}
      rows={rows.map((row) => [row.date, row.count])}
    />
  );
}

function SimpleTable({ title, headers, rows }: {
  title: string;
  headers: string[];
  rows: Array<Array<string | number>>;
}) {
  return (
    <div className="report-panel">
      <h3>{title}</h3>
      <div className="report-table-scroll">
        <table className="report-table">
          <thead><tr>{headers.map((header) => <th key={header} scope="col">{header}</th>)}</tr></thead>
          <tbody>
            {rows.length === 0
              ? <tr><td colSpan={headers.length}><EmptyTable message="No records for this selection." /></td></tr>
              : rows.map((row, index) => (
                <tr key={`${title}-${index}`}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EmptyTable({ message }: { message: string }) {
  return <p className="report-empty">{message}</p>;
}

function localDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDate(date);
}

function shortDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" })
    .format(new Date(`${value}T00:00:00`));
}
