import { useEffect, useState } from "react";
import { ErrorState, LoadingState } from "../properties/PropertiesPages";
import {
  formatReservationMoney,
  type Reservation,
} from "../reservations/api";
import { apiRequest } from "../../lib/api";
import "./FrontDesk.css";

type FrontDeskDashboard = {
  date: string;
  properties: Array<{ id: number; name: string; status: string }>;
  summary: {
    arrivalsToday: number;
    departuresToday: number;
    checkedIn: number;
    overdueArrivals: number;
  };
  arrivals: Reservation[];
  departures: Reservation[];
  inHouse: Reservation[];
  overdueArrivals: Reservation[];
};

type StayAction = {
  kind: "check-in" | "check-out";
  reservation: Reservation;
};

export function FrontDeskPage({
  navigate,
  flash,
}: {
  navigate: (path: string) => void;
  flash: (message: string) => void;
}) {
  const [date, setDate] = useState(localDate(new Date()));
  const [propertyId, setPropertyId] = useState("");
  const [dashboard, setDashboard] = useState<FrontDeskDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [action, setAction] = useState<StayAction | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async (selectedDate: string, selectedPropertyId = propertyId) => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ date: selectedDate });
      if (selectedPropertyId) query.set("propertyId", selectedPropertyId);
      const result = await apiRequest<{ frontDesk: FrontDeskDashboard }>(
        `/front-desk?${query.toString()}`,
      );
      setDashboard(result.frontDesk);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh(date, propertyId);
  }, [date, propertyId]);

  const completeAction = async () => {
    if (!action) return;
    setBusy(true);
    setError("");
    try {
      await apiRequest<{ reservation: Reservation }>(
        `/reservations/${action.reservation.id}/${action.kind}`,
        "POST",
      );
      flash(action.kind === "check-in" ? "Guest checked in." : "Guest checked out.");
      setAction(null);
      await refresh(date);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  if (loading && !dashboard) return <LoadingState label="Loading front desk…" />;

  return (
    <section className="page-section front-desk-page">
      <button className="back-link" onClick={() => navigate("/")}>
        <span aria-hidden="true">←</span> Dashboard
      </button>
      <div className="page-heading front-desk-heading">
        <div>
          <p className="eyebrow"><span /> ARRIVALS · DEPARTURES · IN-HOUSE</p>
          <h1 className="page-title">Front desk</h1>
          <p className="page-intro">Manage today’s arrivals and departures on this device.</p>
        </div>
        <div className="front-desk-filters">
          <label className="front-desk-property">
            <span className="field-label">Property</span>
            <select
              value={propertyId}
              onChange={(event) => setPropertyId(event.target.value)}
            >
              <option value="">All properties</option>
              {dashboard?.properties?.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.name}{property.status === "archived" ? " (archived)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="front-desk-date">
            <span className="field-label">Operating date</span>
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
        </div>
      </div>

      {error && <ErrorState message={error} />}
      {loading && dashboard && (
        <div className="front-desk-refresh" role="status">
          <span className="spinner" /> Refreshing front desk…
        </div>
      )}
      {dashboard && (
        <>
          <div className="front-desk-summary" aria-label="Front desk summary">
            <SummaryCard label="Arrivals" value={dashboard.summary.arrivalsToday} />
            <SummaryCard label="Departures" value={dashboard.summary.departuresToday} />
            <SummaryCard label="In-house" value={dashboard.summary.checkedIn} />
            <SummaryCard label="Overdue arrivals" value={dashboard.summary.overdueArrivals} />
          </div>

          <section className="front-desk-panel front-desk-overdue">
            <PanelHeading
              label="OVERDUE ARRIVALS"
              title="Expected earlier"
              count={dashboard.overdueArrivals.length}
            />
            <ReservationList
              items={dashboard.overdueArrivals}
              empty="No overdue arrivals for this date."
              actionLabel="Check in"
              onAction={(reservation) => setAction({ kind: "check-in", reservation })}
              onOpen={(reservation) => navigate(`/reservations/${reservation.id}`)}
            />
          </section>

          <div className="front-desk-columns">
            <section className="front-desk-panel">
              <PanelHeading
                label="ARRIVALS"
                title="Expected today"
                count={dashboard.arrivals.length}
              />
              <ReservationList
                items={dashboard.arrivals}
                empty="No arrivals scheduled for this date."
                actionLabel="Check in"
                onAction={(reservation) => setAction({ kind: "check-in", reservation })}
                onOpen={(reservation) => navigate(`/reservations/${reservation.id}`)}
              />
            </section>
            <section className="front-desk-panel">
              <PanelHeading
                label="DEPARTURES"
                title="Leaving today"
                count={dashboard.departures.length}
              />
              <ReservationList
                items={dashboard.departures}
                empty="No checked-in stays are scheduled to depart on this date."
                actionLabel="Check out"
                onAction={(reservation) => setAction({ kind: "check-out", reservation })}
                onOpen={(reservation) => navigate(`/reservations/${reservation.id}`)}
              />
            </section>
          </div>

          <section className="front-desk-panel">
            <PanelHeading
              label="IN-HOUSE"
              title="Currently checked in"
              count={dashboard.inHouse.length}
            />
            <ReservationList
              items={dashboard.inHouse}
              empty="No guests are currently checked in."
              actionLabel="Check out"
              onAction={(reservation) => setAction({ kind: "check-out", reservation })}
              onOpen={(reservation) => navigate(`/reservations/${reservation.id}`)}
            />
          </section>
        </>
      )}

      <StayConfirmDialog
        action={action}
        busy={busy}
        onCancel={() => setAction(null)}
        onConfirm={() => void completeAction()}
      />
    </section>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <article className="front-desk-summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function PanelHeading({
  label,
  title,
  count,
}: {
  label: string;
  title: string;
  count: number;
}) {
  return (
    <div className="front-desk-panel-heading">
      <div>
        <p className="eyebrow">{label}</p>
        <h2>{title}</h2>
      </div>
      <span className="unit-count">{count}</span>
    </div>
  );
}

function ReservationList({
  items,
  empty,
  actionLabel,
  onAction,
  onOpen,
}: {
  items: Reservation[];
  empty: string;
  actionLabel: string;
  onAction: (reservation: Reservation) => void;
  onOpen: (reservation: Reservation) => void;
}) {
  if (items.length === 0) {
    return <p className="front-desk-empty">{empty}</p>;
  }

  return (
    <div className="front-desk-list">
      {items.map((reservation) => (
        <article className="front-desk-row" key={reservation.id}>
          <div className="front-desk-row-main">
            <button
              className="front-desk-guest"
              onClick={() => onOpen(reservation)}
            >
              {reservation.guestName}
            </button>
            <span>{reservation.propertyName} · {reservation.unitName ?? "Unit unassigned"}</span>
            <span>
              {formatDate(reservation.checkIn)} – {formatDate(reservation.checkOut)}
              {" · "}
              {reservation.numberOfGuests} {reservation.numberOfGuests === 1 ? "guest" : "guests"}
            </span>
            <span className="front-desk-row-total">
              {formatReservationMoney(reservation.totalAmountCents, reservation.currency)}
            </span>
          </div>
          <div className="front-desk-row-actions">
            <button
              className="button button-secondary"
              onClick={() => onOpen(reservation)}
            >
              Details
            </button>
            <button
              className="button button-primary"
              onClick={() => onAction(reservation)}
            >
              {actionLabel}
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function StayConfirmDialog({
  action,
  busy,
  onCancel,
  onConfirm,
}: {
  action: StayAction | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!action) return null;
  const checkingIn = action.kind === "check-in";

  return (
    <div className="dialog-backdrop">
      <section
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="stay-confirm-title"
      >
        <span className="dialog-mark" aria-hidden="true">!</span>
        <h2 id="stay-confirm-title">
          {checkingIn ? "Check in this guest?" : "Check out this guest?"}
        </h2>
        <p>
          {action.reservation.guestName} · {action.reservation.propertyName}
          {action.reservation.unitName ? ` · ${action.reservation.unitName}` : ""}
        </p>
        <div className="dialog-actions">
          <button className="button button-secondary" onClick={onCancel} disabled={busy}>
            Keep stay unchanged
          </button>
          <button className="button button-primary" onClick={onConfirm} disabled={busy}>
            {busy ? "Saving…" : checkingIn ? "Confirm check-in" : "Confirm check-out"}
          </button>
        </div>
      </section>
    </div>
  );
}

function localDate(value: Date): string {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.valueOf())
    ? value
    : parsed.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "The front desk could not be loaded.";
}
