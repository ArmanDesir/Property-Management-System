import { useEffect, useMemo, useState, type FormEvent } from "react";
import { apiRequest } from "../../lib/api";
import { ErrorState, LoadingState } from "../properties/PropertiesPages";
import "./Maintenance.css";

type Role = "administrator" | "property_manager" | "front_desk" | "housekeeping" | "accounting";
type Status = "open" | "in_progress" | "awaiting_parts" | "completed" | "cancelled";
type Priority = "low" | "normal" | "high" | "urgent";
type Category =
  | "plumbing"
  | "electrical"
  | "hvac"
  | "appliance"
  | "furniture"
  | "structural"
  | "cleaning_related"
  | "other";

interface MaintenanceRequest {
  id: number;
  requestCode: string;
  propertyId: number;
  propertyName: string;
  unitId: number | null;
  unitName: string | null;
  title: string;
  description: string;
  category: Category;
  priority: Priority;
  status: Status;
  reportedAt: string;
  targetCompletionDate: string | null;
  assignedStaffId: number | null;
  assignedStaffName: string | null;
  completedAt: string | null;
  resolutionNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RequestDetail extends MaintenanceRequest {
  history: Array<{
    id: number;
    fromStatus: Status | null;
    toStatus: Status;
    note: string | null;
    changedAt: string;
    staff: { id: number; displayName: string } | null;
  }>;
}

interface Options {
  properties: Array<{ id: number; name: string }>;
  units: Array<{ id: number; propertyId: number; name: string; unitType: string }>;
  staff: Array<{ id: number; displayName: string }>;
}

interface Dashboard {
  asOfDate: string;
  current: {
    open: number;
    highPriority: number;
    inProgress: number;
    awaitingParts: number;
    overdue: number;
  };
  byStatus: Array<{ value: string; count: number }>;
  byPriority: Array<{ value: string; count: number }>;
  byProperty: Array<{ propertyId: number; propertyName: string; status: Status; count: number }>;
  recentlyCompleted: MaintenanceRequest[];
}

interface Filters {
  q: string;
  status: string;
  priority: string;
  category: string;
  propertyId: string;
  overdue: boolean;
  sort: string;
  order: string;
}

interface Draft {
  propertyId: string;
  unitId: string;
  title: string;
  description: string;
  category: Category;
  priority: Priority;
  targetCompletionDate: string;
  assignedStaffId: string;
}

const emptyFilters: Filters = {
  q: "",
  status: "all",
  priority: "all",
  category: "all",
  propertyId: "",
  overdue: false,
  sort: "updated",
  order: "desc",
};
const emptyDraft: Draft = {
  propertyId: "",
  unitId: "",
  title: "",
  description: "",
  category: "other",
  priority: "normal",
  targetCompletionDate: "",
  assignedStaffId: "",
};

const statusLabels: Record<Status, string> = {
  open: "Open",
  in_progress: "In progress",
  awaiting_parts: "Awaiting parts",
  completed: "Completed",
  cancelled: "Cancelled",
};
const priorityLabels: Record<Priority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};
const categoryLabels: Record<Category, string> = {
  plumbing: "Plumbing",
  electrical: "Electrical",
  hvac: "HVAC",
  appliance: "Appliance",
  furniture: "Furniture",
  structural: "Structural",
  cleaning_related: "Cleaning-related",
  other: "Other",
};
const statuses = Object.keys(statusLabels) as Status[];
const priorities = Object.keys(priorityLabels) as Priority[];
const categories = Object.keys(categoryLabels) as Category[];

export function MaintenancePage({
  role,
  navigate,
  flash,
}: {
  role: Role;
  navigate: (path: string) => void;
  flash: (message: string) => void;
}) {
  const isManager = role === "administrator" || role === "property_manager";
  const canCreate = isManager || role === "front_desk" || role === "housekeeping";
  const [options, setOptions] = useState<Options>({ properties: [], units: [], staff: [] });
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [requests, setRequests] = useState<MaintenanceRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [statusNote, setStatusNote] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    setError("");
    const query = new URLSearchParams({
      limit: "25",
      offset: String(offset),
      sort: filters.sort,
      order: filters.order,
      status: filters.status,
      priority: filters.priority,
      category: filters.category,
      overdue: String(filters.overdue),
    });
    if (filters.q.trim()) query.set("q", filters.q.trim());
    if (filters.propertyId) query.set("propertyId", filters.propertyId);
    try {
      const [list, dashboardResult, optionsResult] = await Promise.all([
        apiRequest<{
          requests: MaintenanceRequest[];
          total: number;
        }>(`/maintenance?${query.toString()}`),
        apiRequest<{ dashboard: Dashboard }>("/maintenance/dashboard"),
        apiRequest<Options>("/maintenance/options"),
      ]);
      setRequests(list.requests);
      setTotal(list.total);
      setDashboard(dashboardResult.dashboard);
      setOptions(optionsResult);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [filters, offset]);

  const availableUnits = useMemo(
    () => options.units.filter((unit) => String(unit.propertyId) === draft?.propertyId),
    [draft?.propertyId, options.units],
  );

  const changeFilter = (key: keyof Filters, value: string | boolean) => {
    setOffset(0);
    setFilters((previous) => ({ ...previous, [key]: value }));
  };

  const startCreate = () => {
    setEditingId(null);
    setDraft({
      ...emptyDraft,
      propertyId: options.properties[0] ? String(options.properties[0].id) : "",
      category: role === "housekeeping" ? "cleaning_related" : "other",
    });
  };

  const startEdit = (request: MaintenanceRequest) => {
    setExpandedId(request.id);
    setEditingId(request.id);
    setDraft({
      propertyId: String(request.propertyId),
      unitId: request.unitId === null ? "" : String(request.unitId),
      title: request.title,
      description: request.description,
      category: request.category,
      priority: request.priority,
      targetCompletionDate: request.targetCompletionDate ?? "",
      assignedStaffId: request.assignedStaffId === null ? "" : String(request.assignedStaffId),
    });
  };

  const saveDraft = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft) return;
    setSaving(true);
    setError("");
    try {
      const body = {
        propertyId: Number(draft.propertyId),
        unitId: draft.unitId ? Number(draft.unitId) : null,
        title: draft.title,
        description: draft.description,
        category: draft.category,
        priority: draft.priority,
        targetCompletionDate: draft.targetCompletionDate || null,
        assignedStaffId: isManager && draft.assignedStaffId
          ? Number(draft.assignedStaffId)
          : null,
      };
      await apiRequest(
        editingId === null ? "/maintenance" : `/maintenance/${editingId}`,
        editingId === null ? "POST" : "PUT",
        body,
      );
      setDraft(null);
      setEditingId(null);
      flash(editingId === null ? "Maintenance request created." : "Maintenance request updated.");
      await load();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  const toggleDetails = async (id: number) => {
    if (expandedId === id) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(id);
    setDetail(null);
    try {
      const result = await apiRequest<{ request: RequestDetail }>(`/maintenance/${id}`);
      setDetail(result.request);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  const changeStatus = async (request: MaintenanceRequest, status: Status) => {
    if (status === "cancelled" &&
        !window.confirm(`Cancel maintenance request ${request.requestCode}?`)) return;
    if (status === "completed" &&
        !window.confirm(`Mark ${request.requestCode} complete? This will not change the unit's operational availability.`)) return;
    setBusyId(request.id);
    setError("");
    try {
      await apiRequest(`/maintenance/${request.id}/status`, "PATCH", {
        status,
        ...(statusNote.trim() ? { resolutionNotes: statusNote.trim() } : {}),
      });
      setStatusNote("");
      flash(`${request.requestCode} marked ${statusLabels[status].toLowerCase()}.`);
      await load();
      if (expandedId === request.id) {
        const updated = await apiRequest<{ request: RequestDetail }>(`/maintenance/${request.id}`);
        setDetail(updated.request);
      }
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyId(null);
    }
  };

  if (loading && dashboard === null) return <LoadingState label="Loading maintenance…" />;
  if (error && dashboard === null) {
    return <ErrorState message={error} back={() => navigate("/")} />;
  }
  if (!dashboard) return null;

  return (
    <section className="page-section maintenance-page">
      <button className="back-link" onClick={() => navigate("/")}>
        <span aria-hidden="true">←</span> Dashboard
      </button>
      <div className="page-heading maintenance-heading">
        <div>
          <p className="eyebrow"><span /> FACILITIES &amp; REPAIRS</p>
          <h1 className="page-title">Maintenance</h1>
          <p className="page-intro">Track reported issues, work progress, and target dates without changing unit availability.</p>
        </div>
        {canCreate && (
          <button className="button button-primary" onClick={startCreate}>
            ＋ Report an issue
          </button>
        )}
      </div>

      {error && <ErrorState message={error} />}
      <div className="maintenance-snapshot-note">
        Current request counts as of {formatDate(dashboard.asOfDate)}. These are live totals, not date-range statistics.
      </div>
      <div className="maintenance-metrics">
        <Metric label="Open requests" value={dashboard.current.open} />
        <Metric label="High / urgent" value={dashboard.current.highPriority} tone="priority" />
        <Metric label="In progress" value={dashboard.current.inProgress} />
        <Metric label="Awaiting parts" value={dashboard.current.awaitingParts} />
        <Metric label="Overdue" value={dashboard.current.overdue} tone="overdue" />
      </div>

      <div className="maintenance-dashboard-grid">
        <article className="maintenance-summary-card">
          <h2>By status</h2>
          <CompactGroups
            items={dashboard.byStatus.map(({ value, count }) => ({
              label: statusLabels[value as Status] ?? value,
              count,
            }))}
          />
        </article>
        <article className="maintenance-summary-card">
          <h2>By priority</h2>
          <CompactGroups
            items={dashboard.byPriority.map(({ value, count }) => ({
              label: priorityLabels[value as Priority] ?? value,
              count,
            }))}
          />
        </article>
        <article className="maintenance-summary-card maintenance-property-summary">
          <h2>By property and status</h2>
          {dashboard.byProperty.length === 0 ? (
            <p className="maintenance-muted">No maintenance requests recorded.</p>
          ) : (
            <ul>
              {dashboard.byProperty.map((item) => (
                <li key={`${item.propertyId}-${item.status}`}>
                  <span>{item.propertyName} · {statusLabels[item.status]}</span>
                  <strong>{item.count}</strong>
                </li>
              ))}
            </ul>
          )}
        </article>
        <article className="maintenance-summary-card maintenance-recent">
          <h2>Recently completed <small>Latest 10</small></h2>
          {dashboard.recentlyCompleted.length === 0 ? (
            <p className="maintenance-muted">No completed requests yet.</p>
          ) : (
            <ul>
              {dashboard.recentlyCompleted.map((item) => (
                <li key={item.id}>
                  <span>{item.requestCode} · {item.title}</span>
                  <small>{item.completedAt ? formatDateTime(item.completedAt) : "Completion time unavailable"}</small>
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>

      {draft && (
        <form className="maintenance-form state-panel" onSubmit={saveDraft}>
          <div className="maintenance-form-heading">
            <div>
              <p className="eyebrow"><span /> REQUEST DETAILS</p>
              <h2>{editingId === null ? "Report maintenance issue" : "Edit maintenance request"}</h2>
            </div>
            <button className="button button-secondary" type="button" onClick={() => setDraft(null)}>Cancel</button>
          </div>
          <div className="maintenance-form-grid">
            <label className="form-field">
              <span className="field-label">Property</span>
              <select
                required
                value={draft.propertyId}
                onChange={(event) => setDraft({ ...draft, propertyId: event.target.value, unitId: "" })}
              >
                <option value="">Select property</option>
                {options.properties.map((property) => (
                  <option key={property.id} value={property.id}>{property.name}</option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span className="field-label">Unit (optional)</span>
              <select
                value={draft.unitId}
                onChange={(event) => setDraft({ ...draft, unitId: event.target.value })}
              >
                <option value="">Property-level request</option>
                {availableUnits.map((unit) => (
                  <option key={unit.id} value={unit.id}>{unit.name} · {formatLabel(unit.unitType)}</option>
                ))}
              </select>
            </label>
            <label className="form-field maintenance-wide">
              <span className="field-label">Short title</span>
              <input
                maxLength={160}
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                required
              />
            </label>
            <label className="form-field maintenance-wide">
              <span className="field-label">Detailed description</span>
              <textarea
                rows={4}
                maxLength={4000}
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                required
              />
            </label>
            <label className="form-field">
              <span className="field-label">Category</span>
              <select
                value={draft.category}
                disabled={role === "housekeeping"}
                onChange={(event) => setDraft({ ...draft, category: event.target.value as Category })}
              >
                {categories
                  .filter((category) => role !== "housekeeping" || category === "cleaning_related")
                  .map((category) => (
                    <option key={category} value={category}>{categoryLabels[category]}</option>
                  ))}
              </select>
            </label>
            <label className="form-field">
              <span className="field-label">Priority</span>
              <select
                value={draft.priority}
                onChange={(event) => setDraft({ ...draft, priority: event.target.value as Priority })}
              >
                {priorities.map((priority) => (
                  <option key={priority} value={priority}>{priorityLabels[priority]}</option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span className="field-label">Target completion date (optional)</span>
              <input
                type="date"
                value={draft.targetCompletionDate}
                onChange={(event) => setDraft({ ...draft, targetCompletionDate: event.target.value })}
              />
            </label>
            {isManager && (
              <label className="form-field">
                <span className="field-label">Assign to (optional)</span>
                <select
                  value={draft.assignedStaffId}
                  onChange={(event) => setDraft({ ...draft, assignedStaffId: event.target.value })}
                >
                  <option value="">Unassigned</option>
                  {options.staff.map((staff) => (
                    <option key={staff.id} value={staff.id}>{staff.displayName}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="staff-form-actions">
            <button className="button button-primary" type="submit" disabled={saving}>
              {saving ? "Saving…" : editingId === null ? "Create request" : "Save changes"}
            </button>
          </div>
        </form>
      )}

      <div className="maintenance-list-heading">
        <div>
          <h2>Maintenance requests</h2>
          {!loading && <p>{total} {total === 1 ? "request" : "requests"} match these filters.</p>}
        </div>
      </div>
      <div className="maintenance-filters">
        <label className="maintenance-search">
          <span className="sr-only">Search maintenance requests</span>
          <input
            type="search"
            value={filters.q}
            onChange={(event) => changeFilter("q", event.target.value)}
            placeholder="Search request, issue, unit, or property"
            maxLength={120}
          />
        </label>
        <label>
          <span className="sr-only">Property filter</span>
          <select value={filters.propertyId} onChange={(event) => changeFilter("propertyId", event.target.value)}>
            <option value="">All properties</option>
            {options.properties.map((property) => (
              <option key={property.id} value={property.id}>{property.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Status filter</span>
          <select value={filters.status} onChange={(event) => changeFilter("status", event.target.value)}>
            <option value="all">All statuses</option>
            {statuses.map((status) => (
              <option key={status} value={status}>{statusLabels[status]}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Priority filter</span>
          <select value={filters.priority} onChange={(event) => changeFilter("priority", event.target.value)}>
            <option value="all">All priorities</option>
            {priorities.map((priority) => (
              <option key={priority} value={priority}>{priorityLabels[priority]}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Category filter</span>
          <select value={filters.category} onChange={(event) => changeFilter("category", event.target.value)}>
            <option value="all">All categories</option>
            {categories.map((category) => (
              <option key={category} value={category}>{categoryLabels[category]}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Sort requests by</span>
          <select value={filters.sort} onChange={(event) => changeFilter("sort", event.target.value)}>
            <option value="updated">Recently updated</option>
            <option value="reported">Reported date</option>
            <option value="target">Target date</option>
            <option value="priority">Priority</option>
          </select>
        </label>
        <label className="maintenance-overdue-filter">
          <input
            type="checkbox"
            checked={filters.overdue}
            onChange={(event) => changeFilter("overdue", event.target.checked)}
          />
          Overdue only
        </label>
        <button
          className="button button-secondary"
          onClick={() => changeFilter("order", filters.order === "asc" ? "desc" : "asc")}
          title="Toggle sort direction"
        >
          {filters.order === "asc" ? "Oldest first" : "Newest first"}
        </button>
      </div>

      {loading && <LoadingState label="Refreshing maintenance requests…" />}
      {!loading && requests.length === 0 && (
        <div className="state-panel empty-state maintenance-empty">
          <span className="empty-icon" aria-hidden="true">⚒</span>
          <h2>{total === 0 ? "No maintenance requests yet" : "No requests match these filters"}</h2>
          <p>{total === 0 ? "Report an issue to start tracking maintenance work." : "Adjust the filters or search terms and try again."}</p>
          {canCreate && total === 0 && (
            <button className="button button-primary" onClick={startCreate}>Report an issue</button>
          )}
        </div>
      )}
      {!loading && requests.length > 0 && (
        <>
          <div className="maintenance-list">
            {requests.map((request) => (
              <article className="maintenance-request-card" key={request.id}>
                <div className="maintenance-request-main">
                  <div className="maintenance-request-title">
                    <span className="maintenance-code">{request.requestCode}</span>
                    <h3>{request.title}</h3>
                    <span className={`maintenance-priority ${request.priority}`}>
                      {priorityLabels[request.priority]}
                    </span>
                  </div>
                  <p>{request.propertyName}{request.unitName ? ` · Unit ${request.unitName}` : " · Property-level"}</p>
                  <div className="maintenance-request-meta">
                    <span className={`maintenance-status ${request.status}`}>{statusLabels[request.status]}</span>
                    <span>{categoryLabels[request.category]}</span>
                    <span>Reported {formatDateTime(request.reportedAt)}</span>
                    {request.targetCompletionDate && (
                      <span className={isOverdue(request) ? "is-overdue" : ""}>
                        Target {formatDate(request.targetCompletionDate)}
                      </span>
                    )}
                    {request.assignedStaffName && <span>Assigned to {request.assignedStaffName}</span>}
                  </div>
                </div>
                <div className="maintenance-row-actions">
                  <button className="button button-secondary" onClick={() => void toggleDetails(request.id)}>
                    {expandedId === request.id ? "Hide details" : "Details"}
                  </button>
                  {isManager && ["open", "in_progress", "awaiting_parts"].includes(request.status) && (
                    <>
                      {request.status === "open" && (
                        <button className="button button-secondary" disabled={busyId === request.id} onClick={() => void changeStatus(request, "in_progress")}>Start</button>
                      )}
                      {request.status === "in_progress" && (
                        <button className="button button-secondary" disabled={busyId === request.id} onClick={() => void changeStatus(request, "awaiting_parts")}>Await parts</button>
                      )}
                      {request.status === "awaiting_parts" && (
                        <button className="button button-secondary" disabled={busyId === request.id} onClick={() => void changeStatus(request, "in_progress")}>Resume</button>
                      )}
                      <button className="button button-primary" disabled={busyId === request.id} onClick={() => void changeStatus(request, "completed")}>Complete</button>
                      <button className="button button-danger-outline" disabled={busyId === request.id} onClick={() => void changeStatus(request, "cancelled")}>Cancel</button>
                      {request.status !== "awaiting_parts" && (
                        <button className="button button-secondary" disabled={busyId === request.id} onClick={() => startEdit(request)}>Edit</button>
                      )}
                    </>
                  )}
                </div>
                {expandedId === request.id && (
                  <div className="maintenance-request-details">
                    {detail ? (
                      <>
                        <p className="maintenance-description">{detail.description}</p>
                        {detail.resolutionNotes && (
                          <p><strong>Resolution:</strong> {detail.resolutionNotes}</p>
                        )}
                        {detail.completedAt && (
                          <p><strong>Completed:</strong> {formatDateTime(detail.completedAt)}</p>
                        )}
                        {isManager && ["open", "in_progress", "awaiting_parts"].includes(detail.status) && (
                          <label className="form-field maintenance-resolution-note">
                            <span className="field-label">Resolution / status note (optional)</span>
                            <textarea rows={2} maxLength={4000} value={statusNote} onChange={(event) => setStatusNote(event.target.value)} />
                          </label>
                        )}
                        <div className="maintenance-history">
                          <h4>Status history</h4>
                          {detail.history.length === 0 ? (
                            <p className="maintenance-muted">No status history available.</p>
                          ) : (
                            <ol>
                              {detail.history.map((entry) => (
                                <li key={entry.id}>
                                  <span>{entry.fromStatus ? `${statusLabels[entry.fromStatus]} → ` : ""}{statusLabels[entry.toStatus]}</span>
                                  <small>{formatDateTime(entry.changedAt)} · {entry.staff?.displayName ?? "System"}</small>
                                  {entry.note && <p>{entry.note}</p>}
                                </li>
                              ))}
                            </ol>
                          )}
                        </div>
                      </>
                    ) : (
                      <p className="maintenance-muted">Loading request details…</p>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
          <div className="maintenance-pagination">
            <span>Showing {offset + 1}–{Math.min(offset + requests.length, total)} of {total}</span>
            <div>
              <button className="button button-secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>Previous</button>
              <button className="button button-secondary" disabled={offset + requests.length >= total} onClick={() => setOffset(offset + 25)}>Next</button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <article className={`maintenance-metric ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function CompactGroups({ items }: { items: Array<{ label: string; count: number }> }) {
  if (items.length === 0) return <p className="maintenance-muted">No requests recorded.</p>;
  return (
    <ul>
      {items.map((item) => (
        <li key={item.label}><span>{item.label}</span><strong>{item.count}</strong></li>
      ))}
    </ul>
  );
}

function formatLabel(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDate(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.valueOf())
    ? value
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function isOverdue(request: MaintenanceRequest): boolean {
  return Boolean(
    request.targetCompletionDate &&
    request.targetCompletionDate < new Date().toISOString().slice(0, 10) &&
    ["open", "in_progress", "awaiting_parts"].includes(request.status),
  );
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "The request could not be completed.";
}
