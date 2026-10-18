import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  ConfirmDialog,
  ErrorState,
  LoadingState,
} from "../properties/PropertiesPages";
import { apiRequest } from "../../lib/api";
import {
  fetchGuests,
  type Guest,
  type GuestInput,
  type GuestListItem,
  type GuestStatusFilter,
} from "./api";
import "./Guests.css";

type PageProps = {
  navigate: (path: string) => void;
  flash: (message: string) => void;
};

type GuestFormValues = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  country: string;
  notes: string;
};

const emptyGuest: GuestFormValues = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  address: "",
  country: "",
  notes: "",
};

export function GuestsPage({ navigate }: PageProps) {
  const [status, setStatus] = useState<GuestStatusFilter>("active");
  const [search, setSearch] = useState("");
  const [records, setRecords] = useState<GuestListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      fetchGuests(status, search.trim())
        .then((result) => {
          if (current) setRecords(result);
        })
        .catch((reason: unknown) => {
          if (current) setError(errorMessage(reason));
        })
        .finally(() => {
          if (current) setLoading(false);
        });
    }, search ? 180 : 0);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [status, search, refreshKey]);

  return (
    <section className="page-section">
      <div className="page-heading">
        <div>
          <p className="eyebrow"><span /> GUEST MANAGEMENT</p>
          <h1 className="page-title">Guest directory</h1>
          <p className="page-intro">Keep guest contact details and profile notes organized locally.</p>
        </div>
        <button className="button button-primary" onClick={() => navigate("/guests/new")}>
          <span aria-hidden="true">＋</span> Add guest
        </button>
      </div>

      <div className="guest-toolbar">
        <label className="guest-search">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, email, or phone"
            aria-label="Search guests by name, email, or phone"
            maxLength={120}
          />
          {search && (
            <button type="button" onClick={() => setSearch("")} aria-label="Clear search">×</button>
          )}
        </label>
        <div className="tab-group" aria-label="Guest status filter">
          {(["active", "archived", "all"] as const).map((filter) => (
            <button
              key={filter}
              className={status === filter ? "tab active" : "tab"}
              aria-pressed={status === filter}
              onClick={() => setStatus(filter)}
            >
              {filter === "all" ? "All guests" : `${capitalize(filter)} guests`}
            </button>
          ))}
        </div>
        {!loading && !error && (
          <span className="result-count">{records.length} {records.length === 1 ? "guest" : "guests"}</span>
        )}
      </div>

      {loading && <LoadingState label="Loading guests…" />}
      {error && (
        <div>
          <ErrorState message={error} />
          <button className="button button-secondary" onClick={() => setRefreshKey((key) => key + 1)}>
            Try again
          </button>
        </div>
      )}
      {!loading && !error && records.length === 0 && (
        <div className="state-panel empty-state">
          <span className="empty-icon" aria-hidden="true">◎</span>
          <h2>{search ? "No guests match your search" : status === "active" ? "No guests yet" : "No guests found"}</h2>
          <p>
            {search
              ? "Try another name, email address, or phone number."
              : status === "active"
                ? "Add a guest profile to keep their contact details in one place."
                : "There are no guest profiles to show with this filter."}
          </p>
          {!search && status !== "archived" && (
            <button className="button button-primary" onClick={() => navigate("/guests/new")}>
              Add your first guest
            </button>
          )}
        </div>
      )}
      {!loading && !error && records.length > 0 && (
        <div className="guest-list">
          {records.map((guest) => (
            <button
              className="property-card guest-card"
              key={guest.id}
              onClick={() => navigate(`/guests/${guest.id}`)}
            >
              <span className="property-card-icon" aria-hidden="true">◎</span>
              <span className="guest-card-body">
                <span className="property-card-name">{guest.firstName} {guest.lastName}</span>
                <span className="property-card-meta">
                  {[guest.email, guest.phone].filter(Boolean).join(" · ") || "No contact information"}
                </span>
                <span className="guest-created">Added {formatDate(guest.createdAt)}</span>
              </span>
              <span className={`status-pill ${guest.status}`}>{guest.status}</span>
              <span className="card-arrow" aria-hidden="true">↗</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export function GuestFormPage({ guestId, navigate, flash }: PageProps & { guestId?: number }) {
  const [values, setValues] = useState<GuestFormValues>(emptyGuest);
  const [loading, setLoading] = useState(guestId !== undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (guestId === undefined) return;
    let current = true;
    apiRequest<{ guest: Guest }>(`/guests/${guestId}`)
      .then(({ guest }) => {
        if (!current) return;
        if (guest.status === "archived") {
          setError("Restore this guest before editing the profile.");
        } else {
          setValues(guestToForm(guest));
        }
      })
      .catch((reason: unknown) => {
        if (current) setError(errorMessage(reason));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [guestId]);

  const update = (field: keyof GuestFormValues, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!values.email.trim() && !values.phone.trim()) {
      setError("Provide at least one contact method: email or phone number.");
      return;
    }
    setSaving(true);
    setError("");
    const input: GuestInput = {
      firstName: values.firstName,
      lastName: values.lastName,
      email: values.email.trim() || null,
      phone: values.phone.trim() || null,
      address: values.address.trim() || null,
      country: values.country.trim() || null,
      notes: values.notes.trim() || null,
    };
    try {
      const result = await apiRequest<{ guest: Guest }>(
        guestId === undefined ? "/guests" : `/guests/${guestId}`,
        guestId === undefined ? "POST" : "PATCH",
        input,
      );
      navigate(`/guests/${result.guest.id}`);
      flash(guestId === undefined ? "Guest profile created." : "Guest profile updated.");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingState label="Loading guest profile…" />;
  if (guestId !== undefined && error && values.firstName === "") {
    return <ErrorState message={error} back={() => navigate("/guests")} />;
  }

  return (
    <section className="page-section narrow-page">
      <button className="back-link" onClick={() => navigate(guestId ? `/guests/${guestId}` : "/guests")}>
        <span aria-hidden="true">←</span> {guestId ? "Guest profile" : "Guest directory"}
      </button>
      <div className="form-heading">
        <p className="eyebrow"><span /> GUEST DETAILS</p>
        <h1 className="page-title">{guestId === undefined ? "Add a guest" : "Edit guest profile"}</h1>
        <p className="page-intro">Store only useful contact and property-management details.</p>
      </div>
      {error && <ErrorState message={error} />}
      <form className="editor-card" onSubmit={submit}>
        <div className="form-grid">
          <GuestField label="First name" required>
            <input
              value={values.firstName}
              onChange={(event) => update("firstName", event.target.value)}
              maxLength={100}
              autoComplete="given-name"
              required
            />
          </GuestField>
          <GuestField label="Last name" required>
            <input
              value={values.lastName}
              onChange={(event) => update("lastName", event.target.value)}
              maxLength={100}
              autoComplete="family-name"
              required
            />
          </GuestField>
          <GuestField label="Email address">
            <input
              type="email"
              value={values.email}
              onChange={(event) => update("email", event.target.value)}
              maxLength={254}
              autoComplete="email"
            />
          </GuestField>
          <GuestField label="Phone number">
            <input
              type="tel"
              value={values.phone}
              onChange={(event) => update("phone", event.target.value)}
              maxLength={40}
              autoComplete="tel"
            />
          </GuestField>
          <p className="guest-contact-hint span-2">Provide at least one contact method: email or phone.</p>
          <GuestField label="Address" className="span-2">
            <input
              value={values.address}
              onChange={(event) => update("address", event.target.value)}
              maxLength={500}
              autoComplete="street-address"
            />
          </GuestField>
          <GuestField label="Country">
            <input
              value={values.country}
              onChange={(event) => update("country", event.target.value)}
              maxLength={100}
              autoComplete="country-name"
            />
          </GuestField>
          <GuestField label="Notes" className="span-2">
            <textarea
              value={values.notes}
              onChange={(event) => update("notes", event.target.value)}
              maxLength={2000}
              rows={5}
            />
          </GuestField>
        </div>
        <div className="form-actions">
          <button type="button" className="button button-secondary" onClick={() => navigate(guestId ? `/guests/${guestId}` : "/guests")}>
            Cancel
          </button>
          <button className="button button-primary" disabled={saving}>
            {saving ? "Saving…" : guestId === undefined ? "Create guest" : "Save changes"}
          </button>
        </div>
      </form>
    </section>
  );
}

export function GuestDetailsPage({ guestId, navigate, flash }: PageProps & { guestId: number }) {
  const [guest, setGuest] = useState<Guest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let current = true;
    apiRequest<{ guest: Guest }>(`/guests/${guestId}`)
      .then(({ guest: result }) => {
        if (current) setGuest(result);
      })
      .catch((reason: unknown) => {
        if (current) setError(errorMessage(reason));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [guestId]);

  const restore = async () => {
    setWorking(true);
    setError("");
    try {
      const result = await apiRequest<{ guest: Guest }>(`/guests/${guestId}/restore`, "POST");
      setGuest(result.guest);
      flash("Guest restored.");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setWorking(false);
    }
  };

  const archive = async () => {
    setWorking(true);
    setError("");
    try {
      await apiRequest<{ guest: Guest }>(`/guests/${guestId}/archive`, "POST");
      setArchiveOpen(false);
      navigate("/guests");
      flash("Guest archived.");
    } catch (reason) {
      setError(errorMessage(reason));
      setArchiveOpen(false);
    } finally {
      setWorking(false);
    }
  };

  if (loading) return <LoadingState label="Loading guest profile…" />;
  if (error && !guest) return <ErrorState message={error} back={() => navigate("/guests")} />;
  if (!guest) return null;

  return (
    <section className="page-section">
      <button className="back-link" onClick={() => navigate("/guests")}>
        <span aria-hidden="true">←</span> Guest directory
      </button>
      <div className="detail-heading">
        <div className="detail-title-group">
          <span className="detail-icon" aria-hidden="true">◎</span>
          <div>
            <p className="eyebrow"><span /> GUEST PROFILE</p>
            <h1 className="page-title">{guest.firstName} {guest.lastName}</h1>
            <span className={`status-pill ${guest.status}`}>{guest.status}</span>
          </div>
        </div>
        <div className="heading-actions">
          {guest.status === "active" ? (
            <>
              <button className="button button-secondary" onClick={() => navigate(`/guests/${guest.id}/edit`)}>
                Edit profile
              </button>
              <button className="button button-danger-outline" onClick={() => setArchiveOpen(true)}>
                Archive guest
              </button>
            </>
          ) : (
            <button className="button button-primary" disabled={working} onClick={restore}>
              {working ? "Restoring…" : "Restore guest"}
            </button>
          )}
        </div>
      </div>
      {error && <ErrorState message={error} />}

      <div className="details-grid guest-details-grid">
        <article className="info-card">
          <h2>Contact information</h2>
          <div className="info-rows">
            <GuestDetailRow label="Email" value={guest.email || "Not provided"} />
            <GuestDetailRow label="Phone" value={guest.phone || "Not provided"} />
            <GuestDetailRow label="Address" value={guest.address || "Not provided"} />
            <GuestDetailRow label="Country" value={guest.country || "Not provided"} />
          </div>
        </article>
        <article className="info-card">
          <h2>Profile</h2>
          <div className="info-rows">
            <GuestDetailRow label="Guest ID" value={String(guest.id)} />
            <GuestDetailRow label="Status" value={capitalize(guest.status)} />
            <GuestDetailRow label="Created" value={formatTimestamp(guest.createdAt)} />
            <GuestDetailRow label="Last updated" value={formatTimestamp(guest.updatedAt)} />
          </div>
        </article>
        {guest.notes && (
          <article className="info-card guest-notes">
            <h2>Notes</h2>
            <p>{guest.notes}</p>
          </article>
        )}
        <article className="info-card guest-history">
          <h2>Reservation history</h2>
          <p>Reservations will be available in a future phase. No booking history is shown yet.</p>
        </article>
      </div>

      <ConfirmDialog
        open={archiveOpen}
        title="Archive this guest?"
        detail="The guest profile will remain saved and can be restored later. Archiving does not delete the record or its future reservation history."
        confirmLabel="Archive guest"
        busy={working}
        onCancel={() => setArchiveOpen(false)}
        onConfirm={() => void archive()}
      />
    </section>
  );
}

function GuestField({
  label,
  required,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={`form-field ${className ?? ""}`}>
      <span className="field-label">
        {label}{required && <> <span className="required-mark">*</span></>}
      </span>
      {children}
    </label>
  );
}

function GuestDetailRow({ label, value }: { label: string; value: string }) {
  return <div className="detail-row"><span>{label}</span><strong>{value}</strong></div>;
}

function guestToForm(guest: Guest): GuestFormValues {
  return {
    firstName: guest.firstName,
    lastName: guest.lastName,
    email: guest.email ?? "",
    phone: guest.phone ?? "",
    address: guest.address ?? "",
    country: guest.country ?? "",
    notes: guest.notes ?? "",
  };
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected error occurred.";
}
