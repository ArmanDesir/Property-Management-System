import { useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";
import { LoadingState, ErrorState } from "../properties/PropertiesPages";
import {
  formatUnitType,
  type Property,
  type UnitType,
} from "../properties/api";
import "./Housekeeping.css";

type HousekeepingStatus = "dirty" | "cleaning" | "clean";
type StatusFilter = HousekeepingStatus | "all";

interface ActiveStay {
  reservationId: number;
  reservationReference: string;
  guestName: string;
  checkIn: string;
  checkOut: string;
  actualCheckInAt: string;
}

interface HousekeepingUnit {
  id: number;
  propertyId: number;
  propertyName: string;
  name: string;
  unitType: UnitType;
  housekeepingStatus: HousekeepingStatus;
  operationalStatus: string;
  lastCleanedAt: string | null;
  activeStay: ActiveStay | null;
}

interface HousekeepingOverview {
  summary: {
    needsCleaning: number;
    cleaningInProgress: number;
    clean: number;
    maintenance: number;
  };
  units: HousekeepingUnit[];
}

const nextStatus: Record<HousekeepingStatus, HousekeepingStatus> = {
  dirty: "cleaning",
  cleaning: "clean",
  clean: "dirty",
};

const actionLabel: Record<HousekeepingStatus, string> = {
  dirty: "Start cleaning",
  cleaning: "Complete cleaning",
  clean: "Mark needs cleaning",
};

export function HousekeepingPage({
  navigate,
  flash,
}: {
  navigate: (path: string) => void;
  flash: (message: string) => void;
}) {
  const [properties, setProperties] = useState<Property[]>([]);
  const [propertyId, setPropertyId] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [overview, setOverview] = useState<HousekeepingOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyUnitId, setBusyUnitId] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    apiRequest<{ properties: Property[] }>("/properties")
      .then(({ properties: records }) => {
        if (active) setProperties(records);
      })
      .catch((reason: unknown) => {
        if (active) setError(errorMessage(reason));
      });
    return () => {
      active = false;
    };
  }, []);

  const refresh = async () => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ status });
    if (propertyId) params.set("propertyId", propertyId);
    try {
      const result = await apiRequest<{ housekeeping: HousekeepingOverview }>(
        `/housekeeping?${params.toString()}`,
      );
      setOverview(result.housekeeping);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [propertyId, status]);

  const changeStatus = async (unit: HousekeepingUnit) => {
    const requestedStatus = nextStatus[unit.housekeepingStatus];
    setBusyUnitId(unit.id);
    setError("");
    try {
      await apiRequest<{ unit: HousekeepingUnit }>(
        `/housekeeping/units/${unit.id}/status`,
        "PATCH",
        { status: requestedStatus },
      );
      flash(
        requestedStatus === "clean"
          ? `${unit.name} marked clean.`
          : requestedStatus === "cleaning"
            ? `Cleaning started for ${unit.name}.`
            : `${unit.name} marked as needing cleaning.`,
      );
      await refresh();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyUnitId(null);
    }
  };

  if (loading && !overview) return <LoadingState label="Loading housekeeping…" />;
  if (error && !overview) {
    return <ErrorState message={error} back={() => navigate("/")} />;
  }
  if (!overview) return null;

  return (
    <section className="page-section housekeeping-page">
      <button className="back-link" onClick={() => navigate("/")}>
        <span aria-hidden="true">←</span> Dashboard
      </button>
      <div className="page-heading housekeeping-heading">
        <div>
          <p className="eyebrow"><span /> UNIT CLEANING STATUS</p>
          <h1 className="page-title">Housekeeping</h1>
          <p className="page-intro">
            Track cleaning progress without changing unit availability or reservations.
          </p>
        </div>
        <div className="housekeeping-filters">
          <label className="form-field">
            <span className="field-label">Property</span>
            <select
              value={propertyId}
              disabled={loading}
              onChange={(event) => setPropertyId(event.target.value)}
            >
              <option value="">All properties</option>
              {properties.map((property) => (
                <option key={property.id} value={property.id}>{property.name}</option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span className="field-label">Housekeeping status</span>
            <select
              value={status}
              disabled={loading}
              onChange={(event) => setStatus(event.target.value as StatusFilter)}
            >
              <option value="all">All statuses</option>
              <option value="dirty">Needs cleaning</option>
              <option value="cleaning">Cleaning in progress</option>
              <option value="clean">Clean</option>
            </select>
          </label>
        </div>
      </div>

      {error && <ErrorState message={error} />}
      {loading && (
        <div className="housekeeping-refresh" role="status">
          <span className="spinner" /> Refreshing units…
        </div>
      )}

      <div className="housekeeping-summary" aria-label="Housekeeping summary">
        <SummaryCard label="Needs cleaning" value={overview.summary.needsCleaning} />
        <SummaryCard label="Cleaning in progress" value={overview.summary.cleaningInProgress} />
        <SummaryCard label="Clean" value={overview.summary.clean} />
        <SummaryCard label="Maintenance" value={overview.summary.maintenance} />
      </div>

      {overview.units.length === 0 ? (
        <div className="state-panel empty-state">
          <span className="empty-icon" aria-hidden="true">✳</span>
          <h2>No matching units</h2>
          <p>
            {properties.length === 0
              ? "Add a property and unit to begin tracking housekeeping."
              : "Try another property or housekeeping status filter."}
          </p>
        </div>
      ) : (
        <div className="housekeeping-list">
          <div className="housekeeping-list-head" aria-hidden="true">
            <span>UNIT</span>
            <span>PROPERTY</span>
            <span>HOUSEKEEPING</span>
            <span>OPERATIONAL</span>
            <span>LAST CLEANED</span>
            <span>ACTION</span>
          </div>
          {overview.units.map((unit) => {
            const occupied = unit.activeStay !== null;
            const blocked = occupied &&
              (unit.housekeepingStatus === "dirty" || unit.housekeepingStatus === "cleaning");
            return (
              <article className="housekeeping-row" key={unit.id}>
                <div className="housekeeping-unit">
                  <strong>{unit.name}</strong>
                  <span>{formatUnitType(unit.unitType)}</span>
                </div>
                <div className="housekeeping-property">{unit.propertyName}</div>
                <div>
                  <span className={`status-pill housekeeping-status ${unit.housekeepingStatus}`}>
                    {formatHousekeepingStatus(unit.housekeepingStatus)}
                  </span>
                </div>
                <div>
                  <span className={`status-pill ${unit.operationalStatus}`}>
                    {unit.operationalStatus}
                  </span>
                  {unit.operationalStatus === "maintenance" && (
                    <span className="housekeeping-maintenance-note">
                      Remains unavailable after cleaning
                    </span>
                  )}
                </div>
                <div className="housekeeping-last-cleaned">
                  {unit.lastCleanedAt ? formatTimestamp(unit.lastCleanedAt) : "Not recorded"}
                </div>
                <div className="housekeeping-actions">
                  <button
                    className="button button-secondary"
                    disabled={busyUnitId !== null || blocked}
                    title={blocked ? "An occupied unit cannot be cleaned." : undefined}
                    onClick={() => void changeStatus(unit)}
                  >
                    {busyUnitId === unit.id ? "Saving…" : actionLabel[unit.housekeepingStatus]}
                  </button>
                </div>
                {unit.activeStay && (
                  <div className="housekeeping-stay">
                    <span>Currently occupied by {unit.activeStay.guestName}</span>
                    <span>
                      {unit.activeStay.reservationReference} · {formatDate(unit.activeStay.checkIn)}
                      {" – "}
                      {formatDate(unit.activeStay.checkOut)}
                    </span>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <article className="housekeeping-summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function formatHousekeepingStatus(status: HousekeepingStatus): string {
  if (status === "dirty") return "Needs cleaning";
  if (status === "cleaning") return "Cleaning";
  return "Clean";
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

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf())
    ? value
    : parsed.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Housekeeping could not be loaded.";
}
