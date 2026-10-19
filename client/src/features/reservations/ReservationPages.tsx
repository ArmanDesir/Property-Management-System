import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  ConfirmDialog,
  ErrorState,
  LoadingState,
} from "../properties/PropertiesPages";
import { apiRequest } from "../../lib/api";
import type { GuestListItem } from "../guests/api";
import type { Property, Unit } from "../properties/api";
import {
  fetchInvoices,
  formatInvoiceMoney,
  type InvoiceSummary,
} from "../billing/api";
import {
  fetchReservations,
  formatReservationMoney,
  type AvailabilityQuote,
  type Reservation,
  type ReservationInput,
  type ReservationStatus,
  type ReservationStatusFilter,
} from "./api";
import "./Reservations.css";

type PageProps = {
  navigate: (path: string) => void;
  flash: (message: string) => void;
};

type ReservationFormValues = {
  propertyId: string;
  unitId: string;
  guestId: string;
  checkIn: string;
  checkOut: string;
  numberOfGuests: string;
  nightlyRate: string;
  notes: string;
};

const emptyValues: ReservationFormValues = {
  propertyId: "",
  unitId: "",
  guestId: "",
  checkIn: "",
  checkOut: "",
  numberOfGuests: "1",
  nightlyRate: "",
  notes: "",
};

export function ReservationsPage({
  navigate,
  initialFilters = { propertyId: "", guestId: "", unitId: "" },
}: PageProps & {
  initialFilters?: { propertyId: string; guestId: string; unitId: string };
}) {
  const [status, setStatus] = useState<ReservationStatusFilter>("all");
  const [search, setSearch] = useState("");
  const [propertyId, setPropertyId] = useState(initialFilters.propertyId);
  const [guestId, setGuestId] = useState(initialFilters.guestId);
  const [unitId, setUnitId] = useState(initialFilters.unitId);
  const [checkInFrom, setCheckInFrom] = useState("");
  const [checkInTo, setCheckInTo] = useState("");
  const [offset, setOffset] = useState(0);
  const [records, setRecords] = useState<Reservation[]>([]);
  const [total, setTotal] = useState(0);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    apiRequest<{ properties: Property[] }>("/properties?includeArchived=true")
      .then(({ properties: items }) => {
        if (active) setProperties(items);
      })
      .catch((reason: unknown) => {
        if (active) setError(errorMessage(reason));
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      fetchReservations({
        status,
        q: search.trim(),
        propertyId,
        guestId,
        unitId,
        checkInFrom,
        checkInTo,
        offset,
      })
        .then((result) => {
          if (!active) return;
          setRecords(result.reservations);
          setTotal(result.total);
        })
        .catch((reason: unknown) => {
          if (active) setError(errorMessage(reason));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, search ? 180 : 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [status, search, propertyId, guestId, unitId, checkInFrom, checkInTo, offset, refreshKey]);

  const setFilters = (update: () => void) => {
    setOffset(0);
    update();
  };

  return (
    <section className="page-section">
      <div className="page-heading">
        <div>
          <p className="eyebrow"><span /> RESERVATION MANAGEMENT</p>
          <h1 className="page-title">Reservations</h1>
          <p className="page-intro">Plan stays, check availability, and keep reservation history in one place.</p>
        </div>
        <button className="button button-primary" onClick={() => navigate("/reservations/new")}>
          <span aria-hidden="true">＋</span> New reservation
        </button>
      </div>

      <div className="reservation-filters">
        <label className="reservation-search">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setFilters(() => setSearch(event.target.value))}
            placeholder="Search reference, guest, property, or unit"
            aria-label="Search reservations"
            maxLength={120}
          />
        </label>
        <label className="reservation-filter-field">
          <span>Property</span>
          <select value={propertyId} onChange={(event) => setFilters(() => setPropertyId(event.target.value))}>
            <option value="">All properties</option>
            {properties.map((property) => <option key={property.id} value={property.id}>{property.name}{property.status === "archived" ? " · archived" : ""}</option>)}
          </select>
        </label>
        <label className="reservation-filter-field">
          <span>Check-in from</span>
          <input type="date" value={checkInFrom} onChange={(event) => setFilters(() => setCheckInFrom(event.target.value))} />
        </label>
        <label className="reservation-filter-field">
          <span>Through</span>
          <input type="date" value={checkInTo} onChange={(event) => setFilters(() => setCheckInTo(event.target.value))} />
        </label>
      </div>
      {(guestId || unitId) && (
        <div className="reservation-filter-chips" aria-label="Related record filters">
          {guestId && (
            <button className="filter-chip" onClick={() => setFilters(() => setGuestId(""))}>
              Guest #{guestId} <span aria-hidden="true">×</span>
            </button>
          )}
          {unitId && (
            <button className="filter-chip" onClick={() => setFilters(() => setUnitId(""))}>
              Unit #{unitId} <span aria-hidden="true">×</span>
            </button>
          )}
        </div>
      )}

      <div className="reservation-toolbar">
        <div className="tab-group" aria-label="Reservation status filter">
          {(["all", "pending", "confirmed", "cancelled", "completed"] as const).map((filter) => (
            <button
              key={filter}
              className={status === filter ? "tab active" : "tab"}
              aria-pressed={status === filter}
              onClick={() => setFilters(() => setStatus(filter))}
            >
              {filter === "all" ? "All" : capitalize(filter)}
            </button>
          ))}
        </div>
        {!loading && !error && <span className="result-count">{total} {total === 1 ? "reservation" : "reservations"}</span>}
      </div>

      {loading && <LoadingState label="Loading reservations…" />}
      {error && (
        <div>
          <ErrorState message={error} />
          <button className="button button-secondary" onClick={() => setRefreshKey((key) => key + 1)}>Try again</button>
        </div>
      )}
      {!loading && !error && records.length === 0 && (
        <div className="state-panel empty-state">
          <span className="empty-icon" aria-hidden="true">▦</span>
          <h2>{search || propertyId || guestId || unitId || checkInFrom || checkInTo ? "No reservations match these filters" : "No reservations yet"}</h2>
          <p>Create a reservation to see the guest, unit, stay dates, and booking status here.</p>
          <button className="button button-primary" onClick={() => navigate("/reservations/new")}>Create reservation</button>
        </div>
      )}
      {!loading && !error && records.length > 0 && (
        <>
          <div className="reservation-list">
            <div className="reservation-list-head">
              <span>Reservation</span><span>Guest &amp; property</span><span>Stay</span><span>Amount</span><span>Status</span>
            </div>
            {records.map((reservation) => (
              <button
                className="reservation-row"
                key={reservation.id}
                onClick={() => navigate(`/reservations/${reservation.id}`)}
              >
                <span className="reservation-row-main">
                  <strong>{reservation.reservationReference}</strong>
                  <small>{reservation.unitName ?? "Legacy · no unit assigned"}</small>
                </span>
                <span className="reservation-row-main">
                  <strong>{reservation.guestName}</strong>
                  <small>{reservation.propertyName}</small>
                </span>
                <span className="reservation-row-main">
                  <strong>{formatDate(reservation.checkIn)} – {formatDate(reservation.checkOut)}</strong>
                  <small>{nights(reservation.checkIn, reservation.checkOut)} nights · {reservation.numberOfGuests} guests</small>
                </span>
                <span className="reservation-amount">{formatReservationMoney(reservation.totalAmountCents, reservation.currency)}</span>
                <span className={`status-pill reservation-status ${reservation.status}`}>{reservation.status}</span>
              </button>
            ))}
          </div>
          <div className="reservation-pagination">
            <span>Showing {offset + 1}–{Math.min(offset + records.length, total)} of {total}</span>
            <div>
              <button className="button button-secondary" disabled={offset === 0} onClick={() => setOffset((value) => Math.max(0, value - 50))}>Previous</button>
              <button className="button button-secondary" disabled={offset + records.length >= total} onClick={() => setOffset((value) => value + 50)}>Next</button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

export function ReservationFormPage({
  reservationId,
  navigate,
  flash,
}: PageProps & { reservationId?: number }) {
  const [values, setValues] = useState<ReservationFormValues>(emptyValues);
  const [properties, setProperties] = useState<Property[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [guests, setGuests] = useState<Array<{ id: number; name: string }>>([]);
  const [quote, setQuote] = useState<AvailabilityQuote | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [quoteError, setQuoteError] = useState("");

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [propertyResult, guestResult, reservationResult] = await Promise.all([
          apiRequest<{ properties: Property[] }>("/properties"),
          apiRequest<{ guests: GuestListItem[] }>("/guests?status=active"),
          reservationId === undefined
            ? Promise.resolve(null)
            : apiRequest<{ reservation: Reservation }>(`/reservations/${reservationId}`),
        ]);
        if (!active) return;
        setProperties(propertyResult.properties);
        const guestChoices = guestResult.guests.map((guest) => ({
          id: guest.id,
          name: `${guest.firstName} ${guest.lastName}`,
        }));
        if (reservationResult && !guestChoices.some((guest) => guest.id === reservationResult.reservation.guestId)) {
          guestChoices.push({
            id: reservationResult.reservation.guestId,
            name: `${reservationResult.reservation.guestName} (archived)`,
          });
        }
        setGuests(guestChoices);

        if (reservationResult) {
          const reservation = reservationResult.reservation;
          if (reservation.status === "cancelled" || reservation.status === "completed") {
            setError("Cancelled or completed reservations cannot be edited.");
          } else {
            setValues({
              propertyId: String(reservation.propertyId),
              unitId: reservation.unitId === null ? "" : String(reservation.unitId),
              guestId: String(reservation.guestId),
              checkIn: reservation.checkIn,
              checkOut: reservation.checkOut,
              numberOfGuests: String(reservation.numberOfGuests),
              nightlyRate: (reservation.nightlyRateCents / 100).toFixed(2),
              notes: reservation.notes ?? "",
            });
          }
        } else {
          const query = new URLSearchParams(window.location.search);
          const requestedPropertyId = query.get("propertyId");
          const requestedGuestId = query.get("guestId");
          const requestedUnitId = query.get("unitId");
          const requestedCheckIn = query.get("checkIn") ?? "";
          const requestedCheckOut = query.get("checkOut") ?? "";
          const selectedProperty = propertyResult.properties.find(
            (property) => String(property.id) === requestedPropertyId,
          );
          const selectedGuest = guestChoices.find(
            (guest) => String(guest.id) === requestedGuestId,
          );
          setValues((current) => ({
            ...current,
            propertyId: String(selectedProperty?.id ?? propertyResult.properties[0]?.id ?? ""),
            unitId: requestedUnitId ?? "",
            guestId: String(selectedGuest?.id ?? guestChoices[0]?.id ?? ""),
            checkIn: requestedCheckIn,
            checkOut: requestedCheckOut,
          }));
        }
      } catch (reason) {
        if (active) setError(errorMessage(reason));
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [reservationId]);

  useEffect(() => {
    if (!values.propertyId) {
      setUnits([]);
      return;
    }
    let active = true;
    apiRequest<{ units: Unit[] }>(`/properties/${values.propertyId}/units?includeArchived=true`)
      .then(({ units: items }) => {
        if (!active) return;
        const rentable = items.filter((unit) => unit.archivedAt === null);
        setUnits(rentable);
        setValues((current) => {
          if (current.unitId && rentable.some((unit) => String(unit.id) === current.unitId)) return current;
          const firstActive = rentable.find((unit) => unit.status === "active");
          return {
            ...current,
            unitId: firstActive ? String(firstActive.id) : "",
            nightlyRate: firstActive ? (firstActive.baseNightlyRateCents / 100).toFixed(2) : "",
          };
        });
      })
      .catch((reason: unknown) => {
        if (active) setError(errorMessage(reason));
      });
    return () => {
      active = false;
    };
  }, [values.propertyId]);

  useEffect(() => {
    setQuote(null);
    setQuoteError("");
    if (!values.unitId || !values.checkIn || !values.checkOut || !values.numberOfGuests) return;
    const params = new URLSearchParams({
      unitId: values.unitId,
      checkIn: values.checkIn,
      checkOut: values.checkOut,
      numberOfGuests: values.numberOfGuests,
    });
    if (values.nightlyRate.trim()) params.set("nightlyRate", values.nightlyRate);
    if (reservationId !== undefined) params.set("excludeReservationId", String(reservationId));
    let active = true;
    const timer = window.setTimeout(() => {
      apiRequest<{ availability: AvailabilityQuote }>(`/reservations/availability?${params.toString()}`)
        .then(({ availability }) => {
          if (active) setQuote(availability);
        })
        .catch((reason: unknown) => {
          if (active) setQuoteError(errorMessage(reason));
        });
    }, 120);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [values.unitId, values.checkIn, values.checkOut, values.numberOfGuests, values.nightlyRate, reservationId]);

  const update = (field: keyof ReservationFormValues, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    const input: ReservationInput = {
      guestId: Number(values.guestId),
      unitId: Number(values.unitId),
      checkIn: values.checkIn,
      checkOut: values.checkOut,
      numberOfGuests: Number(values.numberOfGuests),
      nightlyRate: values.nightlyRate.trim() ? Number(values.nightlyRate) : undefined,
      notes: values.notes.trim() || null,
    };
    try {
      const result = await apiRequest<{ reservation: Reservation }>(
        reservationId === undefined ? "/reservations" : `/reservations/${reservationId}`,
        reservationId === undefined ? "POST" : "PUT",
        input,
      );
      navigate(`/reservations/${result.reservation.id}`);
      flash(reservationId === undefined ? "Reservation created as pending." : "Reservation details updated.");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingState label={reservationId === undefined ? "Preparing reservation form…" : "Loading reservation…"} />;
  const selectedUnit = units.find((unit) => String(unit.id) === values.unitId);
  const selectedProperty = properties.find((property) => String(property.id) === values.propertyId);
  const formUnavailable = properties.length === 0 || guests.length === 0 || units.length === 0;

  return (
    <section className="page-section narrow-page">
      <button className="back-link" onClick={() => navigate(reservationId ? `/reservations/${reservationId}` : "/reservations")}>
        <span aria-hidden="true">←</span> {reservationId ? "Reservation details" : "All reservations"}
      </button>
      <div className="form-heading">
        <p className="eyebrow"><span /> RESERVATION MANAGEMENT</p>
        <h1 className="page-title">{reservationId ? "Edit reservation" : "New reservation"}</h1>
        <p className="page-intro">Select an active guest and unit. Availability and the stay total are checked by the local API.</p>
      </div>
      {error && <ErrorState message={error} />}
      {formUnavailable && !error && (
        <ErrorState message="Add an active property with an active unit and an active guest before creating a reservation." />
      )}
      <form className="editor-card" onSubmit={submit}>
        <div className="form-grid">
          <FormField label="Property" required>
            <select
              value={values.propertyId}
              onChange={(event) => setValues((current) => ({ ...current, propertyId: event.target.value, unitId: "", nightlyRate: "" }))}
              required
            >
              <option value="">Choose a property</option>
              {properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}
            </select>
          </FormField>
          <FormField label="Unit" required>
            <select value={values.unitId} onChange={(event) => {
              const unit = units.find((item) => String(item.id) === event.target.value);
              setValues((current) => ({
                ...current,
                unitId: event.target.value,
                nightlyRate: unit ? (unit.baseNightlyRateCents / 100).toFixed(2) : "",
              }));
            }} required>
              <option value="">Choose an active unit</option>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id} disabled={unit.status !== "active"}>
                  {unit.name} · {unit.status}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Guest" required>
            <select value={values.guestId} onChange={(event) => update("guestId", event.target.value)} required>
              <option value="">Choose an active guest</option>
              {guests.map((guest) => <option key={guest.id} value={guest.id}>{guest.name}</option>)}
            </select>
          </FormField>
          <FormField label="Number of guests" required hint={selectedUnit ? `Unit capacity: ${selectedUnit.capacity}` : undefined}>
            <input type="number" min={1} max={selectedUnit?.capacity ?? 1000} step={1} value={values.numberOfGuests} onChange={(event) => update("numberOfGuests", event.target.value)} required />
          </FormField>
          <FormField label="Check-in" required>
            <input type="date" value={values.checkIn} onChange={(event) => update("checkIn", event.target.value)} required />
          </FormField>
          <FormField label="Check-out" required>
            <input type="date" value={values.checkOut} min={values.checkIn || undefined} onChange={(event) => update("checkOut", event.target.value)} required />
          </FormField>
          <FormField label={`Nightly rate${selectedProperty ? ` (${selectedProperty.defaultCurrency})` : ""}`} required hint="The stored unit rate is the default; you can override it for this stay.">
            <input type="number" min={0} step="0.01" value={values.nightlyRate} onChange={(event) => update("nightlyRate", event.target.value)} required />
          </FormField>
          <div className="reservation-quote" aria-live="polite">
            {quoteError && <span className="quote-error">{quoteError}</span>}
            {quote && (
              <>
                <span className={`quote-indicator ${quote.available ? "available" : "unavailable"}`}>
                  {quote.available ? "Available" : "Unavailable"}
                </span>
                <span>{quote.nights} {quote.nights === 1 ? "night" : "nights"} · {formatReservationMoney(quote.nightlyRateCents, quote.currency)} nightly</span>
                <strong>{formatReservationMoney(quote.totalAmountCents, quote.currency)}</strong>
                {!quote.available && quote.reason && <span className="quote-error">{quote.reason}</span>}
              </>
            )}
            {!quote && !quoteError && <span>Enter stay dates to check availability and calculate the total.</span>}
          </div>
          <FormField label="Reservation notes" className="span-2">
            <textarea rows={3} maxLength={2000} value={values.notes} onChange={(event) => update("notes", event.target.value)} />
          </FormField>
        </div>
        <div className="form-actions">
          <button className="button button-secondary" type="button" onClick={() => navigate(reservationId ? `/reservations/${reservationId}` : "/reservations")}>Cancel</button>
          <button className="button button-primary" type="submit" disabled={saving || formUnavailable || (quote !== null && !quote.available)}>
            {saving ? "Saving…" : reservationId ? "Save changes" : "Create pending reservation"}
          </button>
        </div>
      </form>
    </section>
  );
}

export function ReservationDetailsPage({
  reservationId,
  navigate,
  flash,
}: PageProps & { reservationId: number }) {
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [invoiceError, setInvoiceError] = useState("");
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(true);
  const [confirmStatus, setConfirmStatus] = useState<Exclude<ReservationStatus, "pending"> | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    apiRequest<{ reservation: Reservation }>(`/reservations/${reservationId}`)
      .then(({ reservation: record }) => {
        if (active) setReservation(record);
      })
      .catch((reason: unknown) => {
        if (active) setError(errorMessage(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reservationId]);

  useEffect(() => {
    let active = true;
    fetchInvoices({ status: "all", q: "", reservationId })
      .then(({ invoices: records }) => {
        if (active) setInvoices(records);
      })
      .catch((reason: unknown) => {
        if (active) setInvoiceError(errorMessage(reason));
      })
      .finally(() => {
        if (active) setInvoicesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reservationId]);

  const transition = async () => {
    if (!confirmStatus) return;
    setBusy(true);
    setError("");
    try {
      const result = await apiRequest<{ reservation: Reservation }>(
        `/reservations/${reservationId}/status`,
        "PATCH",
        { status: confirmStatus },
      );
      setReservation(result.reservation);
      setConfirmStatus(null);
      flash(`Reservation ${confirmStatus}.`);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingState label="Loading reservation details…" />;
  if (error && !reservation) return <ErrorState message={error} back={() => navigate("/reservations")} />;
  if (!reservation) return null;
  const activeStatus = reservation.status === "pending" || reservation.status === "confirmed";

  return (
    <section className="page-section">
      <button className="back-link" onClick={() => navigate("/reservations")}><span aria-hidden="true">←</span> All reservations</button>
      {error && <ErrorState message={error} />}
      <div className="detail-heading">
        <div className="detail-title-group">
          <span className="detail-icon reservation-detail-icon" aria-hidden="true">▦</span>
          <div>
            <p className="eyebrow"><span /> RESERVATION · {reservation.reservationReference}</p>
            <h1 className="page-title">{reservation.guestName}</h1>
            <p className="page-intro">{reservation.propertyName} · {reservation.unitName ?? "Legacy reservation · no unit assigned"}</p>
          </div>
        </div>
        <div className="heading-actions">
          <span className={`status-pill reservation-status ${reservation.status}`}>{reservation.status}</span>
          {activeStatus && (
            <>
              <button className="button button-secondary" onClick={() => navigate(`/reservations/${reservation.id}/edit`)}>Edit</button>
              {reservation.status === "pending" && <button className="button button-primary" disabled={reservation.unitId === null} onClick={() => setConfirmStatus("confirmed")}>Confirm</button>}
              {reservation.status === "confirmed" && <button className="button button-secondary" onClick={() => setConfirmStatus("completed")}>Mark completed</button>}
              <button className="button button-danger-outline" onClick={() => setConfirmStatus("cancelled")}>Cancel reservation</button>
            </>
          )}
        </div>
      </div>

      <div className="details-grid">
        <InfoCard label="Stay details">
          <DetailRow label="Property" value={reservation.propertyName} />
          <DetailRow label="Unit" value={reservation.unitName ?? "Unassigned legacy unit"} />
          <DetailRow label="Stay status" value={formatStayStatus(reservation.stayStatus)} />
          <DetailRow label="Check-in" value={formatDate(reservation.checkIn)} />
          <DetailRow label="Check-out" value={formatDate(reservation.checkOut)} />
          {reservation.actualCheckInAt && (
            <DetailRow label="Actual check-in" value={formatTimestamp(reservation.actualCheckInAt)} />
          )}
          {reservation.actualCheckOutAt && (
            <DetailRow label="Actual check-out" value={formatTimestamp(reservation.actualCheckOutAt)} />
          )}
          <DetailRow label="Nights" value={String(nights(reservation.checkIn, reservation.checkOut))} />
          <DetailRow label="Guests" value={String(reservation.numberOfGuests)} />
        </InfoCard>
        <InfoCard label="Rate summary">
          <DetailRow label="Nightly rate" value={formatReservationMoney(reservation.nightlyRateCents, reservation.currency)} />
          <DetailRow label="Total stay amount" value={formatReservationMoney(reservation.totalAmountCents, reservation.currency)} />
          <DetailRow label="Currency" value={reservation.currency} />
          <DetailRow label="Reservation reference" value={reservation.reservationReference} />
        </InfoCard>
        <InfoCard label="Guest and related records">
          <DetailRow label="Guest" value={reservation.guestName} />
          <div className="reservation-related-links">
            <button className="text-button" onClick={() => navigate(`/guests/${reservation.guestId}`)}>Open guest profile ↗</button>
            <button className="text-button" onClick={() => navigate(`/properties/${reservation.propertyId}`)}>Open property ↗</button>
            {reservation.unitId !== null && (
              <button className="text-button" onClick={() => navigate(`/properties/${reservation.propertyId}/units/${reservation.unitId}`)}>Open unit ↗</button>
            )}
          </div>
        </InfoCard>
        <InfoCard label="Invoices">
          <div className="reservation-related-links">
            <button className="text-button" onClick={() => navigate(`/billing/new?reservationId=${reservation.id}`)}>
              Create invoice for this reservation ↗
            </button>
          </div>
          {invoicesLoading && <p className="reservation-notes">Loading invoices…</p>}
          {invoiceError && <p className="reservation-notes">{invoiceError}</p>}
          {!invoicesLoading && !invoiceError && invoices.length === 0 && (
            <p className="reservation-notes">No invoices are linked to this reservation.</p>
          )}
          {invoices.map((invoice) => (
            <div className="reservation-invoice-row" key={invoice.id}>
              <button className="text-button" onClick={() => navigate(`/billing/${invoice.id}`)}>
                {invoice.invoiceNumber} · {invoice.status.replaceAll("_", " ")}
              </button>
              <span>
                {formatInvoiceMoney(invoice.totalCents, invoice.currency)} total ·{" "}
                {formatInvoiceMoney(invoice.paidCents, invoice.currency)} paid ·{" "}
                {formatInvoiceMoney(invoice.balanceCents, invoice.currency)} balance
              </span>
            </div>
          ))}
        </InfoCard>
        <InfoCard label="Notes">
          <p className="reservation-notes">{reservation.notes || "No reservation notes."}</p>
        </InfoCard>
      </div>

      <ConfirmDialog
        open={confirmStatus !== null}
        title={confirmStatus === "cancelled" ? "Cancel this reservation?" : confirmStatus === "completed" ? "Mark this stay completed?" : "Confirm this reservation?"}
        detail={confirmStatus === "cancelled"
          ? "The reservation will remain in the history and stop blocking availability."
          : confirmStatus === "completed"
            ? "The reservation will be retained as completed and stop blocking availability."
            : "Availability, unit capacity, and guest status will be checked again before confirmation."}
        confirmLabel={confirmStatus === "cancelled" ? "Cancel reservation" : confirmStatus === "completed" ? "Mark completed" : "Confirm reservation"}
        busy={busy}
        onCancel={() => setConfirmStatus(null)}
        onConfirm={() => void transition()}
      />
    </section>
  );
}

function FormField({
  label,
  required = false,
  hint,
  className = "",
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={`form-field ${className}`}>
      <span className="field-label">{label}{required && <span className="required-mark"> *</span>}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

function InfoCard({ label, children }: { label: string; children: ReactNode }) {
  return <article className="info-card"><h2>{label}</h2><div className="info-rows">{children}</div></article>;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return <div className="detail-row"><span>{label}</span><strong>{value}</strong></div>;
}

function formatDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.valueOf())
    ? value
    : parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

function formatStayStatus(value: Reservation["stayStatus"]): string {
  return value.replaceAll("_", " ");
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf())
    ? value
    : parsed.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
}

function nights(checkIn: string, checkOut: string): number {
  return (Date.parse(`${checkOut}T00:00:00.000Z`) - Date.parse(`${checkIn}T00:00:00.000Z`)) / 86_400_000;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "An unexpected error occurred.";
}
