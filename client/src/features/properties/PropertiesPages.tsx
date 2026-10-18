import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  apiRequest,
  formatPropertyType,
  formatUnitType,
  type Property,
  type PropertyInput,
  type PropertyType,
  type Unit,
  type UnitInput,
  type UnitStatus,
  type UnitType,
} from "./api";

type PageProps = {
  navigate: (path: string) => void;
  flash: (message: string) => void;
};

const emptyProperty: PropertyInput = {
  name: "",
  propertyType: "hotel",
  address: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  defaultCurrency: "USD",
  defaultCheckInTime: "15:00",
  defaultCheckOutTime: "11:00",
};

const propertyTypeOptions: Array<{ value: PropertyType; label: string }> = [
  { value: "hotel", label: "Hotel" },
  { value: "resort", label: "Resort" },
  { value: "hostel", label: "Hostel" },
  { value: "apartment", label: "Apartment" },
  { value: "vacation_rental", label: "Vacation rental" },
  { value: "other", label: "Other" },
];

const unitTypeOptions: Array<{ value: UnitType; label: string }> = [
  { value: "room", label: "Room" },
  { value: "apartment", label: "Apartment" },
  { value: "villa", label: "Villa" },
  { value: "dormitory_room", label: "Dormitory room" },
  { value: "studio", label: "Studio" },
  { value: "suite", label: "Suite" },
  { value: "other", label: "Other" },
];

export function PropertiesPage({ navigate }: PageProps) {
  const [includeArchived, setIncludeArchived] = useState(false);
  const [records, setRecords] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    apiRequest<{ properties: Property[] }>(
      `/properties${includeArchived ? "?includeArchived=true" : ""}`,
    )
      .then((result) => {
        if (active) setRecords(result.properties);
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
  }, [includeArchived]);

  return (
    <section className="page-section">
      <div className="page-heading">
        <div>
          <p className="eyebrow"><span /> PROPERTY MANAGEMENT</p>
          <h1 className="page-title">Your properties</h1>
          <p className="page-intro">Manage locations, property details, and rentable spaces.</p>
        </div>
        <button className="button button-primary" onClick={() => navigate("/properties/new")}>
          <span aria-hidden="true">＋</span> Add property
        </button>
      </div>

      <div className="list-toolbar">
        <div className="tab-group" aria-label="Property status filter">
          <button
            className={!includeArchived ? "tab active" : "tab"}
            onClick={() => setIncludeArchived(false)}
          >Active properties</button>
          <button
            className={includeArchived ? "tab active" : "tab"}
            onClick={() => setIncludeArchived(true)}
          >Include archived</button>
        </div>
        {!loading && <span className="result-count">{records.length} {records.length === 1 ? "property" : "properties"}</span>}
      </div>

      {loading && <LoadingState label="Loading properties…" />}
      {error && <ErrorState message={error} />}
      {!loading && !error && records.length === 0 && (
        <EmptyState
          title={includeArchived ? "No properties found" : "Your first property starts here"}
          detail={includeArchived
            ? "There are no properties to show with this filter."
            : "Add a property to start organizing its rooms and rentable spaces."}
          action={!includeArchived && (
            <button className="button button-primary" onClick={() => navigate("/properties/new")}>
              Add your first property
            </button>
          )}
        />
      )}
      {!loading && !error && records.length > 0 && (
        <div className="property-grid">
          {records.map((property) => (
            <button
              className="property-card"
              key={property.id}
              onClick={() => navigate(`/properties/${property.id}`)}
            >
              <span className="property-card-icon" aria-hidden="true">⌂</span>
              <span className="property-card-body">
                <span className="property-card-name">{property.name}</span>
                <span className="property-card-meta">
                  {formatPropertyType(property.propertyType)}
                  {property.address ? ` · ${property.address}` : ""}
                </span>
              </span>
              <span className={`status-pill ${property.status}`}>{property.status}</span>
              <span className="card-arrow" aria-hidden="true">↗</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export function PropertyFormPage({
  propertyId,
  navigate,
  flash,
}: PageProps & { propertyId?: number }) {
  const [values, setValues] = useState<PropertyInput>(emptyProperty);
  const [loading, setLoading] = useState(propertyId !== undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (propertyId === undefined) return;
    let active = true;
    apiRequest<{ property: Property }>(`/properties/${propertyId}`)
      .then(({ property }) => {
        if (active) {
          if (property.status === "archived") {
            setError("Restore this property before editing its details.");
          } else {
            setValues(propertyToInput(property));
          }
        }
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
  }, [propertyId]);

  const update = <K extends keyof PropertyInput>(field: K, value: PropertyInput[K]) => {
    setValues((current) => ({ ...current, [field]: value }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = await apiRequest<{ property: Property }>(
        propertyId === undefined ? "/properties" : `/properties/${propertyId}`,
        propertyId === undefined ? "POST" : "PUT",
        values,
      );
      flash(propertyId === undefined ? "Property created." : "Property details saved.");
      navigate(`/properties/${result.property.id}`);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingState label="Loading property…" />;
  if (propertyId !== undefined && error && values.name === "") {
    return <ErrorState message={error} back={() => navigate("/properties")} />;
  }

  return (
    <section className="page-section narrow-page">
      <PageBack navigate={navigate} to={propertyId ? `/properties/${propertyId}` : "/properties"} label={propertyId ? "Property details" : "Properties"} />
      <div className="form-heading">
        <p className="eyebrow"><span /> PROPERTY DETAILS</p>
        <h1 className="page-title">{propertyId === undefined ? "Add a property" : "Edit property"}</h1>
        <p className="page-intro">Set the location details and defaults you’ll use for this property.</p>
      </div>
      {error && <ErrorState message={error} />}
      <form className="editor-card" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Property name" required className="span-2">
            <input value={values.name} onChange={(event) => update("name", event.target.value)} maxLength={120} required autoFocus />
          </Field>
          <Field label="Property type" required>
            <select value={values.propertyType} onChange={(event) => update("propertyType", event.target.value as PropertyType)}>
              {propertyTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
          <Field label="Default currency" required hint="Three-letter code, for example USD.">
            <input value={values.defaultCurrency} onChange={(event) => update("defaultCurrency", event.target.value.toUpperCase())} minLength={3} maxLength={3} pattern="[A-Z]{3}" required />
          </Field>
          <Field label="Address" className="span-2">
            <textarea value={values.address ?? ""} onChange={(event) => update("address", event.target.value)} rows={2} maxLength={500} />
          </Field>
          <div className="form-subheading span-2">Contact details <span>Optional</span></div>
          <Field label="Contact name">
            <input value={values.contactName ?? ""} onChange={(event) => update("contactName", event.target.value)} maxLength={120} />
          </Field>
          <Field label="Contact email">
            <input type="email" value={values.contactEmail ?? ""} onChange={(event) => update("contactEmail", event.target.value)} maxLength={254} />
          </Field>
          <Field label="Contact phone" className="span-2">
            <input type="tel" value={values.contactPhone ?? ""} onChange={(event) => update("contactPhone", event.target.value)} maxLength={50} />
          </Field>
          <div className="form-subheading span-2">Standard check-in and check-out</div>
          <Field label="Check-in time">
            <input type="time" value={values.defaultCheckInTime} onChange={(event) => update("defaultCheckInTime", event.target.value)} required />
          </Field>
          <Field label="Check-out time">
            <input type="time" value={values.defaultCheckOutTime} onChange={(event) => update("defaultCheckOutTime", event.target.value)} required />
          </Field>
        </div>
        <FormActions
          navigate={navigate}
          cancelTo={propertyId ? `/properties/${propertyId}` : "/properties"}
          saving={saving}
          submitLabel={propertyId === undefined ? "Create property" : "Save changes"}
        />
      </form>
    </section>
  );
}

export function PropertyDetailsPage({
  propertyId,
  navigate,
  flash,
}: PageProps & { propertyId: number }) {
  const [property, setProperty] = useState<Property | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    setLoading(true);
    setError("");
    Promise.all([
      apiRequest<{ property: Property }>(`/properties/${propertyId}`),
      apiRequest<{ units: Unit[] }>(`/properties/${propertyId}/units?includeArchived=true`),
    ])
      .then(([propertyResult, unitResult]) => {
        setProperty(propertyResult.property);
        setUnits(unitResult.units);
      })
      .catch((reason: unknown) => setError(errorMessage(reason)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
  }, [propertyId]);

  const changePropertyStatus = async (status: "active" | "archived") => {
    if (status === "archived") setConfirmArchive(false);
    setBusy(true);
    setError("");
    try {
      const result = await apiRequest<{ property: Property }>(
        `/properties/${propertyId}/status`,
        "PATCH",
        { status },
      );
      setProperty(result.property);
      flash(status === "archived" ? "Property archived. Its history remains available." : "Property restored.");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingState label="Loading property details…" />;
  if (error && !property) return <ErrorState message={error} back={() => navigate("/properties")} />;
  if (!property) return null;

  const visibleUnits = showArchived ? units : units.filter((unit) => !unit.archivedAt);

  return (
    <section className="page-section">
      <PageBack navigate={navigate} to="/properties" label="All properties" />
      {error && <ErrorState message={error} />}
      <div className="detail-heading">
        <div className="detail-title-group">
          <span className="detail-icon" aria-hidden="true">⌂</span>
          <div>
            <p className="eyebrow"><span /> {formatPropertyType(property.propertyType)}</p>
            <h1 className="page-title">{property.name}</h1>
            <p className="page-intro">{property.address || "No address added"}</p>
          </div>
        </div>
        <div className="heading-actions">
          <span className={`status-pill ${property.status}`}>{property.status}</span>
          {property.status === "active" ? (
            <>
              <button className="button button-secondary" onClick={() => navigate(`/properties/${propertyId}/edit`)}>Edit details</button>
              <button className="button button-danger-outline" onClick={() => setConfirmArchive(true)}>Archive</button>
            </>
          ) : (
            <button className="button button-primary" disabled={busy} onClick={() => void changePropertyStatus("active")}>Restore property</button>
          )}
        </div>
      </div>

      <div className="details-grid">
        <InfoCard label="Property details">
          <DetailRow label="Type" value={formatPropertyType(property.propertyType)} />
          <DetailRow label="Address" value={property.address || "—"} />
          <DetailRow label="Currency" value={property.defaultCurrency} />
          <DetailRow label="Check-in" value={property.defaultCheckInTime} />
          <DetailRow label="Check-out" value={property.defaultCheckOutTime} />
        </InfoCard>
        <InfoCard label="Contact">
          <DetailRow label="Contact name" value={property.contactName || "—"} />
          <DetailRow label="Email" value={property.contactEmail || "—"} />
          <DetailRow label="Phone" value={property.contactPhone || "—"} />
        </InfoCard>
      </div>

      <div className="units-heading">
        <div>
          <p className="eyebrow"><span /> ACCOMMODATION</p>
          <h2>Units <span className="unit-count">{visibleUnits.length}</span></h2>
        </div>
        <div className="heading-actions">
          <label className="check-label">
            <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
            Show archived
          </label>
          {property.status === "active" && (
            <button className="button button-primary" onClick={() => navigate(`/properties/${propertyId}/units/new`)}>＋ Add unit</button>
          )}
        </div>
      </div>

      {visibleUnits.length === 0 ? (
        <EmptyState
          title={showArchived ? "No units to show" : "No units added yet"}
          detail={property.status === "archived"
            ? "This archived property is read-only. Restore it to manage its units."
            : "Add rooms, apartments, villas, or other rentable spaces for this property."}
          action={property.status === "active" && (
            <button className="button button-secondary" onClick={() => navigate(`/properties/${propertyId}/units/new`)}>Add a unit</button>
          )}
        />
      ) : (
        <div className="unit-table">
          <div className="unit-table-head"><span>UNIT</span><span>TYPE</span><span>CAPACITY</span><span>BASE / NIGHT</span><span>STATUS</span><span /></div>
          {visibleUnits.map((unit) => (
            <button className="unit-row" key={unit.id} onClick={() => navigate(`/properties/${propertyId}/units/${unit.id}`)}>
              <span className="unit-name"><span className="unit-symbol" aria-hidden="true">▦</span>{unit.name}</span>
              <span>{formatUnitType(unit.unitType)}</span>
              <span>{unit.capacity} {unit.capacity === 1 ? "guest" : "guests"}</span>
              <span>{formatMoney(unit.baseNightlyRateCents, property.defaultCurrency)}</span>
              <span className={`status-pill ${unit.archivedAt ? "archived" : unit.status}`}>{unit.archivedAt ? "archived" : unit.status}</span>
              <span aria-hidden="true" className="row-arrow">↗</span>
            </button>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={confirmArchive}
        title="Archive this property?"
        detail="The property and its units will stay in your records. New units and edits are disabled until you restore it."
        confirmLabel="Archive property"
        busy={busy}
        onCancel={() => setConfirmArchive(false)}
        onConfirm={() => void changePropertyStatus("archived")}
      />
    </section>
  );
}

export function UnitFormPage({
  propertyId,
  unitId,
  navigate,
  flash,
}: PageProps & { propertyId: number; unitId?: number }) {
  const [property, setProperty] = useState<Property | null>(null);
  const [values, setValues] = useState<UnitInput>({
    name: "",
    unitType: "room",
    description: "",
    capacity: 2,
    baseNightlyRate: 0,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const propertyRequest = apiRequest<{ property: Property }>(`/properties/${propertyId}`);
    const unitRequest = unitId === undefined
      ? Promise.resolve(undefined)
      : apiRequest<{ unit: Unit }>(`/properties/${propertyId}/units/${unitId}`);
    Promise.all([propertyRequest, unitRequest])
      .then(([propertyResult, unitResult]) => {
        if (!active) return;
        setProperty(propertyResult.property);
        if (unitResult) {
          if (unitResult.unit.archivedAt) {
            setError("Restore this unit before editing its details.");
          } else {
            setValues(unitToInput(unitResult.unit));
          }
        }
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
  }, [propertyId, unitId]);

  const update = <K extends keyof UnitInput>(field: K, value: UnitInput[K]) => {
    setValues((current) => ({ ...current, [field]: value }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = await apiRequest<{ unit: Unit }>(
        unitId === undefined
          ? `/properties/${propertyId}/units`
          : `/properties/${propertyId}/units/${unitId}`,
        unitId === undefined ? "POST" : "PUT",
        values,
      );
      flash(unitId === undefined ? "Unit created." : "Unit details saved.");
      navigate(`/properties/${propertyId}/units/${result.unit.id}`);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingState label="Loading unit form…" />;
  if (error && (!property || (unitId !== undefined && values.name === ""))) {
    return <ErrorState message={error} back={() => navigate(`/properties/${propertyId}`)} />;
  }
  if (!property) return null;

  return (
    <section className="page-section narrow-page">
      <PageBack navigate={navigate} to={unitId ? `/properties/${propertyId}/units/${unitId}` : `/properties/${propertyId}`} label={unitId ? "Unit details" : property.name} />
      <div className="form-heading">
        <p className="eyebrow"><span /> {property.name.toUpperCase()}</p>
        <h1 className="page-title">{unitId === undefined ? "Add a unit" : "Edit unit"}</h1>
        <p className="page-intro">Describe a rentable space within this property.</p>
      </div>
      {property.status === "archived" && <ErrorState message="Restore this property before adding or editing units." />}
      {error && <ErrorState message={error} />}
      <form className="editor-card" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Unit name or number" required className="span-2" hint="Must be unique within this property.">
            <input value={values.name} onChange={(event) => update("name", event.target.value)} maxLength={100} required autoFocus />
          </Field>
          <Field label="Unit type" required>
            <select value={values.unitType} onChange={(event) => update("unitType", event.target.value as UnitType)}>
              {unitTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
          <Field label="Capacity" required hint="Maximum 1,000 guests.">
            <input type="number" value={values.capacity} onChange={(event) => update("capacity", Number(event.target.value))} min={1} max={1000} step={1} required />
          </Field>
          <Field label={`Base nightly rate (${property.defaultCurrency})`} required hint="Use up to two decimal places.">
            <input type="number" value={values.baseNightlyRate} onChange={(event) => update("baseNightlyRate", Number(event.target.value))} min={0} step="0.01" required />
          </Field>
          <Field label="Description" className="span-2">
            <textarea value={values.description ?? ""} onChange={(event) => update("description", event.target.value)} rows={4} maxLength={2000} />
          </Field>
        </div>
        <FormActions
          navigate={navigate}
          cancelTo={unitId ? `/properties/${propertyId}/units/${unitId}` : `/properties/${propertyId}`}
          saving={saving}
          disabled={property.status === "archived"}
          submitLabel={unitId === undefined ? "Create unit" : "Save changes"}
        />
      </form>
    </section>
  );
}

export function UnitDetailsPage({
  propertyId,
  unitId,
  navigate,
  flash,
}: PageProps & { propertyId: number; unitId: number }) {
  const [unit, setUnit] = useState<Unit | null>(null);
  const [property, setProperty] = useState<Property | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    setLoading(true);
    Promise.all([
      apiRequest<{ unit: Unit }>(`/properties/${propertyId}/units/${unitId}`),
      apiRequest<{ property: Property }>(`/properties/${propertyId}`),
    ])
      .then(([unitResult, propertyResult]) => {
        setUnit(unitResult.unit);
        setProperty(propertyResult.property);
        setError("");
      })
      .catch((reason: unknown) => setError(errorMessage(reason)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
  }, [propertyId, unitId]);

  const setStatus = async (status: UnitStatus) => {
    setBusy(true);
    setError("");
    try {
      const result = await apiRequest<{ unit: Unit }>(
        `/properties/${propertyId}/units/${unitId}/status`,
        "PATCH",
        { status },
      );
      setUnit(result.unit);
      flash(status === "active" ? "Unit restored and active." : `Unit status set to ${status}.`);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const archive = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await apiRequest<{ unit: Unit }>(
        `/properties/${propertyId}/units/${unitId}`,
        "DELETE",
      );
      setUnit(result.unit);
      setConfirmArchive(false);
      flash("Unit archived. Its history remains available.");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingState label="Loading unit details…" />;
  if (error && (!unit || !property)) return <ErrorState message={error} back={() => navigate(`/properties/${propertyId}`)} />;
  if (!unit || !property) return null;
  const archived = unit.archivedAt !== null;

  return (
    <section className="page-section">
      <PageBack navigate={navigate} to={`/properties/${propertyId}`} label={property.name} />
      {error && <ErrorState message={error} />}
      <div className="detail-heading">
        <div className="detail-title-group">
          <span className="detail-icon unit-detail-icon" aria-hidden="true">▦</span>
          <div>
            <p className="eyebrow"><span /> {formatUnitType(unit.unitType)} · {property.name}</p>
            <h1 className="page-title">{unit.name}</h1>
            <p className="page-intro">{unit.description || "No description added"}</p>
          </div>
        </div>
        <div className="heading-actions">
          <span className={`status-pill ${archived ? "archived" : unit.status}`}>{archived ? "archived" : unit.status}</span>
          {!archived && property.status === "active" && (
            <>
              <button className="button button-secondary" onClick={() => navigate(`/properties/${propertyId}/units/${unitId}/edit`)}>Edit unit</button>
              <button className="button button-danger-outline" onClick={() => setConfirmArchive(true)}>Archive</button>
            </>
          )}
          {archived && property.status === "active" && (
            <button className="button button-primary" disabled={busy} onClick={() => void setStatus("active")}>Restore unit</button>
          )}
        </div>
      </div>

      {property.status === "active" && !archived && (
        <div className="status-control">
          <label htmlFor="unit-status">Unit status</label>
          <select id="unit-status" value={unit.status} disabled={busy} onChange={(event) => void setStatus(event.target.value as UnitStatus)}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="maintenance">Maintenance</option>
          </select>
          <span>Inactive and maintenance units stay in the property record.</span>
        </div>
      )}

      <div className="details-grid single-detail-card">
        <InfoCard label="Unit details">
          <DetailRow label="Property" value={property.name} />
          <DetailRow label="Name or number" value={unit.name} />
          <DetailRow label="Type" value={formatUnitType(unit.unitType)} />
          <DetailRow label="Capacity" value={`${unit.capacity} ${unit.capacity === 1 ? "guest" : "guests"}`} />
          <DetailRow label="Base nightly rate" value={formatMoney(unit.baseNightlyRateCents, property.defaultCurrency)} />
          <DetailRow label="Status" value={archived ? "Archived" : unit.status} />
        </InfoCard>
      </div>

      <ConfirmDialog
        open={confirmArchive}
        title={`Archive unit ${unit.name}?`}
        detail="The unit will be marked inactive and retained in the property record. You can restore it later."
        confirmLabel="Archive unit"
        busy={busy}
        onCancel={() => setConfirmArchive(false)}
        onConfirm={() => void archive()}
      />
    </section>
  );
}

export function PageBack({
  navigate,
  to,
  label,
}: Pick<PageProps, "navigate"> & { to: string; label: string }) {
  return (
    <button className="back-link" onClick={() => navigate(to)}>
      <span aria-hidden="true">←</span> {label}
    </button>
  );
}

function Field({
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

function FormActions({
  navigate,
  cancelTo,
  saving,
  submitLabel,
  disabled = false,
}: Pick<PageProps, "navigate"> & {
  cancelTo: string;
  saving: boolean;
  submitLabel: string;
  disabled?: boolean;
}) {
  return (
    <div className="form-actions">
      <button className="button button-secondary" type="button" onClick={() => navigate(cancelTo)}>Cancel</button>
      <button className="button button-primary" type="submit" disabled={saving || disabled}>
        {saving ? "Saving…" : submitLabel}
      </button>
    </div>
  );
}

function InfoCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <article className="info-card">
      <h2>{label}</h2>
      <div className="info-rows">{children}</div>
    </article>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return <div className="detail-row"><span>{label}</span><strong>{value}</strong></div>;
}

export function LoadingState({ label }: { label: string }) {
  return <div className="state-panel" role="status"><span className="spinner" />{label}</div>;
}

export function ErrorState({ message, back }: { message: string; back?: () => void }) {
  return (
    <div className="state-panel state-error" role="alert">
      <span className="state-symbol" aria-hidden="true">!</span>
      <span>{message}</span>
      {back && <button className="text-button" onClick={back}>Go back</button>}
    </div>
  );
}

function EmptyState({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="state-panel empty-state">
      <span className="empty-icon" aria-hidden="true">⌂</span>
      <h2>{title}</h2>
      <p>{detail}</p>
      {action}
    </div>
  );
}

function ConfirmDialog({
  open,
  title,
  detail,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  detail: string;
  confirmLabel: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <div className="dialog-backdrop">
      <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <span className="dialog-mark" aria-hidden="true">!</span>
        <h2 id="confirm-title">{title}</h2>
        <p>{detail}</p>
        <div className="dialog-actions">
          <button className="button button-secondary" disabled={busy} onClick={onCancel}>Cancel</button>
          <button className="button button-danger" disabled={busy} onClick={onConfirm}>{busy ? "Working…" : confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}

function propertyToInput(property: Property): PropertyInput {
  return {
    name: property.name,
    propertyType: property.propertyType,
    address: property.address,
    contactName: property.contactName,
    contactEmail: property.contactEmail,
    contactPhone: property.contactPhone,
    defaultCurrency: property.defaultCurrency,
    defaultCheckInTime: property.defaultCheckInTime,
    defaultCheckOutTime: property.defaultCheckOutTime,
  };
}

function unitToInput(unit: Unit): UnitInput {
  return {
    name: unit.name,
    unitType: unit.unitType,
    description: unit.description,
    capacity: unit.capacity,
    baseNightlyRate: unit.baseNightlyRateCents / 100,
  };
}

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected error occurred.";
}
