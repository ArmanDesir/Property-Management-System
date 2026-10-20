import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../../lib/api";
import { ErrorState, LoadingState } from "../properties/PropertiesPages";
import "./RoomAvailability.css";

type RoomStatus = "available" | "reserved" | "occupied" | "unavailable";
type CalendarProperty = { id: number; name: string; propertyType: string };
type Room = {
  id: number;
  name: string;
  unitType: string;
  operationalStatus: string;
  housekeepingStatus: string;
  nights: Array<{ date: string; status: RoomStatus; reason: string | null }>;
  availableForStay: boolean | null;
};
type Availability = {
  property: CalendarProperty;
  range: { from: string; to: string; toExclusive: boolean };
  summary: {
    totalRooms: number; availableRooms: number; reservedRooms: number;
    occupiedRooms: number; unavailableRooms: number;
  };
  rooms: Room[];
};
type View = "day" | "week" | "month";

export function RoomAvailabilityPage({
  navigate,
}: {
  navigate: (path: string) => void;
}) {
  const [properties, setProperties] = useState<CalendarProperty[]>([]);
  const [propertyId, setPropertyId] = useState("");
  const [date, setDate] = useState(localDate(new Date()));
  const [view, setView] = useState<View>("week");
  const [checkIn, setCheckIn] = useState(localDate(new Date()));
  const [checkOut, setCheckOut] = useState(addDays(localDate(new Date()), 1));
  const [searchEnabled, setSearchEnabled] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [queryKey, setQueryKey] = useState(0);

  useEffect(() => {
    let active = true;
    apiRequest<{ properties: CalendarProperty[] }>("/room-availability/properties")
      .then(({ properties: result }) => {
        if (!active) return;
        setProperties(result);
        setPropertyId((current) => current || String(result[0]?.id ?? ""));
      })
      .catch((reason: unknown) => { if (active) setError(errorMessage(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const range = useMemo(() => rangeForDate(date, view), [date, view]);

  useEffect(() => {
    if (!propertyId) return;
    let active = true;
    const params = new URLSearchParams({ from: range.from, to: range.to });
    if (searchEnabled) {
      params.set("checkIn", checkIn);
      params.set("checkOut", checkOut);
    }
    setLoading(true);
    setError("");
    apiRequest<{ availability: Availability }>(
      `/room-availability/${propertyId}?${params.toString()}`,
    ).then(({ availability: result }) => {
      if (active) setAvailability(result);
    }).catch((reason: unknown) => {
      if (active) setError(errorMessage(reason));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [propertyId, range.from, range.to, searchEnabled, checkIn, checkOut, refreshKey, queryKey]);

  const selectedAvailability = availability?.property.id === Number(propertyId)
    ? availability
    : null;
  const visibleRooms = selectedAvailability?.rooms.filter((room) =>
    statusFilter === "all" || room.nights.some((night) => night.status === statusFilter)
  ) ?? [];
  const summary = selectedAvailability
    ? summarizeForDate(selectedAvailability.rooms, date)
    : null;

  const changePeriod = (direction: number) => {
    const days = view === "day" ? 1 : view === "week" ? 7 : 0;
    if (days) setDate(addDays(date, days * direction));
    else {
      const current = new Date(`${date}T12:00:00`);
      current.setMonth(current.getMonth() + direction);
      current.setDate(1);
      setDate(localDate(current));
    }
  };

  if (loading && properties.length === 0) return <LoadingState label="Loading room availability…" />;
  return <section className="page-section room-calendar-page">
    <button className="back-link" onClick={() => navigate("/")}>← Dashboard</button>
    <div className="page-heading">
      <div><p className="eyebrow"><span /> FRONT DESK · ROOM INVENTORY</p><h1 className="page-title">Room availability</h1>
        <p className="page-intro">Reservation nights use [check-in, check-out). Dirty rooms remain visible and require housekeeping attention; they are not automatically out of service.</p></div>
    </div>
    {error && <ErrorState message={error} />}
    {properties.length === 0 && !error && <div className="state-panel empty-state"><h2>No properties available</h2><p>Only active properties you are authorized to access appear in this calendar.</p></div>}
    {properties.length > 0 && <>
      <div className="room-calendar-controls">
        <label>Property <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
          {properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}
        </select></label>
        <label>Date <input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label>View <select value={view} onChange={(e) => setView(e.target.value as View)}>
          <option value="day">Daily</option><option value="week">Weekly</option><option value="month">Monthly</option>
        </select></label>
        <div className="room-period-nav"><button className="button button-secondary" onClick={() => changePeriod(-1)}>Previous</button><span>{formatRange(range.from, range.to)}</span><button className="button button-secondary" onClick={() => changePeriod(1)}>Next</button></div>
        <label>Status <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All rooms</option><option value="available">Available</option><option value="reserved">Reserved</option><option value="occupied">Occupied</option><option value="unavailable">Unavailable</option>
        </select></label>
      </div>
      <div className="room-stay-search">
        <label>Check-in <input type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} /></label>
        <label>Check-out <input type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} /></label>
        <button className="button button-primary" onClick={() => {
          if (!checkIn || !checkOut || checkOut <= checkIn) {
            setError("Check-out date must be after check-in date.");
            return;
          }
          setError("");
          setSearchEnabled(true);
          setQueryKey((value) => value + 1);
        }}>Check stay availability</button>
        {searchEnabled && <button className="button button-secondary" onClick={() => { setSearchEnabled(false); setQueryKey((value) => value + 1); }}>Clear stay search</button>}
      </div>
      {summary && <div className="room-summary" aria-label="Availability on selected date">
        <Summary label="Rooms" value={summary.totalRooms} /><Summary label="Available" value={summary.available} />
        <Summary label="Reserved" value={summary.reserved} /><Summary label="Occupied" value={summary.occupied} />
        <Summary label="Unavailable" value={summary.unavailable} />
      </div>}
      <div className="room-calendar-legend">
        {(["available", "reserved", "occupied", "unavailable"] as const).map((status) =>
          <span key={status}><i className={`room-night ${status}`} />{capitalize(status)}</span>)}
        <span>Housekeeping is shown separately from booking availability.</span>
      </div>
      {loading && <p role="status">Refreshing availability…</p>}
      <div className="room-calendar-scroll">
        <table className="room-calendar-grid">
          <thead><tr><th>Room</th>{range.dates.map((day) => <th key={day} className={day === date ? "selected-date" : ""}>{formatDay(day)}</th>)}</tr></thead>
          <tbody>{visibleRooms.map((room) => <tr key={room.id}>
            <th><strong>{room.name}</strong><small>{capitalize(room.unitType)} · {capitalize(room.housekeepingStatus)} · {capitalize(room.operationalStatus)}</small>
              {searchEnabled && <small className={room.availableForStay ? "stay-available" : "stay-unavailable"}>
                {room.availableForStay ? "Available for full stay" : "Not available for full stay"}
              </small>}
              {searchEnabled && room.availableForStay && <button className="button button-secondary room-reserve" onClick={() => navigate(`/reservations/new?propertyId=${propertyId}&unitId=${room.id}&checkIn=${checkIn}&checkOut=${checkOut}`)}>Start reservation</button>}
            </th>
            {room.nights.map((night) => <td key={night.date} title={night.reason ?? capitalize(night.status)} className={night.date === date ? "selected-date" : ""}>
              <span className={`room-night ${night.status}`} aria-label={`${night.date}: ${night.status}`}>{capitalize(night.status)}</span>
            </td>)}
          </tr>)}
          {visibleRooms.length === 0 && <tr><td colSpan={range.dates.length + 1}>No rooms match this filter.</td></tr>}</tbody>
        </table>
      </div>
      <button className="button button-secondary room-refresh" onClick={() => setRefreshKey((value) => value + 1)}>Refresh availability</button>
    </>}
  </section>;
}

function Summary({ label, value }: { label: string; value: number }) {
  return <article><span>{label}</span><strong>{value}</strong></article>;
}

function summarizeForDate(rooms: Room[], date: string) {
  const nights = rooms.map((room) => room.nights.find((night) => night.date === date)?.status ?? "available");
  return {
    totalRooms: rooms.length,
    available: nights.filter((status) => status === "available").length,
    reserved: nights.filter((status) => status === "reserved").length,
    occupied: nights.filter((status) => status === "occupied").length,
    unavailable: nights.filter((status) => status === "unavailable").length,
  };
}

function rangeForDate(date: string, view: View) {
  const selected = new Date(`${date}T12:00:00`);
  let start: Date;
  let count: number;
  if (view === "day") {
    start = selected;
    count = 1;
  } else if (view === "week") {
    start = new Date(selected);
    start.setDate(selected.getDate() - ((selected.getDay() + 6) % 7));
    count = 7;
  } else {
    start = new Date(selected.getFullYear(), selected.getMonth(), 1, 12);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    count = 42;
  }
  const from = localDate(start);
  const dates = Array.from({ length: count }, (_, index) => addDays(from, index));
  return { from, to: addDays(from, count), dates };
}

function addDays(value: string, count: number): string {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + count);
  return localDate(date);
}

function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDay(value: string): string {
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
}

function formatRange(from: string, toExclusive: string): string {
  return `${from} – ${addDays(toExclusive, -1)}`;
}

function capitalize(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "The local PMS request could not be completed.";
}
