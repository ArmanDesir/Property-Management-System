import { useEffect, useMemo, useState, type FormEvent } from "react";
import { apiRequest } from "../../lib/api";
import { formatCents } from "../../lib/money";
import { ErrorState, LoadingState } from "../properties/PropertiesPages";
import type { StaffUser } from "../auth/AuthPage";
import "./TeamTasks.css";

type Status = "pending" | "in_progress" | "submitted" | "completed" | "rejected" | "cancelled";
type Department = "front_desk" | "housekeeping" | "accounting";
type Task = {
  id: number;
  propertyId: number;
  propertyName: string;
  unitId: number | null;
  unitName: string | null;
  reservationId: number | null;
  reservationReference: string | null;
  title: string;
  description: string;
  department: Department;
  assignedStaffId: number;
  assignedName: string;
  createdByStaffId: number;
  creatorName: string;
  priority: "low" | "normal" | "high" | "urgent";
  status: Status;
  dueDate: string | null;
  dueTime: string | null;
  completionNote: string | null;
  overdue: boolean;
  createdAt: string;
  updatedAt: string;
  activity?: Array<{
    id: number;
    eventType: string;
    description: string;
    createdAt: string;
    actorName: string | null;
  }>;
};
type TaskOptions = {
  properties: Array<{ id: number; name: string; propertyType?: string }>;
  staff: Array<{ id: number; displayName: string; department: Department }>;
  units: Array<{ id: number; propertyId: number; name: string; unitType: string }>;
  reservations: Array<{
    id: number; propertyId: number; unitId: number | null;
    reservationReference: string; checkIn: string; checkOut: string;
  }>;
};
type Draft = {
  propertyId: string;
  unitId: string;
  reservationId: string;
  title: string;
  description: string;
  department: Department;
  assignedStaffId: string;
  priority: "low" | "normal" | "high" | "urgent";
  dueDate: string;
  dueTime: string;
};
const blankDraft: Draft = {
  propertyId: "",
  unitId: "",
  reservationId: "",
  title: "",
  description: "",
  department: "front_desk",
  assignedStaffId: "",
  priority: "normal",
  dueDate: "",
  dueTime: "",
};
const statuses: Status[] = ["pending", "in_progress", "submitted", "completed", "rejected", "cancelled"];
const departments: Department[] = ["front_desk", "housekeeping", "accounting"];

export function TeamTasksPage({
  currentUser,
  navigate,
  flash,
}: {
  currentUser: StaffUser;
  navigate: (path: string) => void;
  flash: (message: string) => void;
}) {
  const isManager = currentUser.role === "administrator" || currentUser.role === "property_manager";
  const [tasks, setTasks] = useState<Task[]>([]);
  const [options, setOptions] = useState<TaskOptions | null>(null);
  const [selected, setSelected] = useState<Task | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [propertyFilter, setPropertyFilter] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams();
      if (statusFilter !== "all") query.set("status", statusFilter);
      if (priorityFilter !== "all") query.set("priority", priorityFilter);
      if (propertyFilter) query.set("propertyId", propertyFilter);
      const [taskResult, optionsResult] = await Promise.all([
        apiRequest<{ tasks: Task[] }>(`/team-tasks?${query.toString()}`),
        isManager
          ? apiRequest<{ options: TaskOptions }>("/team-tasks/options")
          : Promise.resolve(null),
      ]);
      setTasks(taskResult.tasks);
      if (optionsResult) {
        setOptions(optionsResult.options);
        if (!draft && optionsResult.options.properties[0]) {
          setDraft({
            ...blankDraft,
            propertyId: String(optionsResult.options.properties[0].id),
          });
        }
      }
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [refreshKey, statusFilter, priorityFilter, propertyFilter]);

  useEffect(() => {
    if (!draft || !isManager || !draft.propertyId || !options) return;
    let active = true;
    apiRequest<{ options: TaskOptions }>(
      `/team-tasks/options?propertyId=${encodeURIComponent(draft.propertyId)}`,
    ).then(({ options: result }) => {
      if (active) setOptions((current) => current ? { ...current, ...result } : result);
    }).catch((reason: unknown) => {
      if (active) setError(errorMessage(reason));
    });
    return () => { active = false; };
  }, [draft?.propertyId, isManager]);

  const eligibleStaff = useMemo(
    () => options?.staff.filter((user) => user.department === draft?.department) ?? [],
    [options?.staff, draft?.department],
  );
  const availableUnits = options?.units.filter(
    (unit) => String(unit.propertyId) === draft?.propertyId,
  ) ?? [];
  const availableReservations = options?.reservations.filter(
    (reservation) => String(reservation.propertyId) === draft?.propertyId &&
      (!draft?.unitId || String(reservation.unitId) === draft.unitId),
  ) ?? [];

  const openTask = async (task: Task) => {
    setSelected(task);
    setNote("");
    try {
      const result = await apiRequest<{ task: Task }>(`/team-tasks/${task.id}`);
      setSelected(result.task);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  const editTask = (task: Task) => {
    setDraft({
      propertyId: String(task.propertyId),
      unitId: task.unitId === null ? "" : String(task.unitId),
      reservationId: task.reservationId === null ? "" : String(task.reservationId),
      title: task.title,
      description: task.description,
      department: task.department,
      assignedStaffId: String(task.assignedStaffId),
      priority: task.priority,
      dueDate: task.dueDate ?? "",
      dueTime: task.dueTime ?? "",
    });
    setEditingTaskId(task.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submitTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft) return;
    setSaving(true);
    setError("");
    try {
      await apiRequest(
        editingTaskId === null ? "/team-tasks" : `/team-tasks/${editingTaskId}`,
        editingTaskId === null ? "POST" : "PUT",
        {
        propertyId: Number(draft.propertyId),
        unitId: draft.unitId ? Number(draft.unitId) : null,
        reservationId: draft.reservationId ? Number(draft.reservationId) : null,
        title: draft.title,
        description: draft.description,
        department: draft.department,
        assignedStaffId: Number(draft.assignedStaffId),
        priority: draft.priority,
        dueDate: draft.dueDate || null,
        dueTime: draft.dueTime || null,
        },
      );
      setDraft({ ...blankDraft, propertyId: draft.propertyId });
      setEditingTaskId(null);
      flash(editingTaskId === null ? "Team task created and assigned." : "Team task updated.");
      setRefreshKey((value) => value + 1);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (task: Task, status: Status) => {
    setSaving(true);
    setError("");
    try {
      await apiRequest(`/team-tasks/${task.id}/status`, "PATCH", {
        status,
        note: note.trim() || undefined,
      });
      flash(status === "completed" ? "Task approved." : status === "rejected"
        ? "Task returned for correction."
        : status === "submitted" ? "Task submitted for review." : "Task status updated.");
      setNote("");
      await refresh();
      const updated = await apiRequest<{ task: Task }>(`/team-tasks/${task.id}`);
      setSelected(updated.task);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  if (loading && tasks.length === 0) return <LoadingState label="Loading team tasks…" />;
  if (error && tasks.length === 0) {
    return <ErrorState message={error} back={() => navigate("/")} />;
  }

  return (
    <section className="page-section team-tasks-page">
      <button className="back-link" onClick={() => navigate("/")}>← Dashboard</button>
      <div className="page-heading">
        <div>
          <p className="eyebrow"><span /> TEAM OPERATIONS</p>
          <h1 className="page-title">{isManager ? "Team tasks" : "My tasks"}</h1>
          <p className="page-intro">
            {isManager
              ? "Assign operational work, monitor progress, and review staff submissions."
              : "Review your assignments, record progress, and submit completed work for approval."}
          </p>
        </div>
        {currentUser.role === "property_manager" && (
          <button className="button button-secondary" onClick={() => navigate("/room-availability")}>
            Room availability
          </button>
        )}
      </div>
      {error && <ErrorState message={error} />}

      {isManager && (
        <TaskFilters
          properties={options?.properties ?? []}
          status={statusFilter}
          priority={priorityFilter}
          propertyId={propertyFilter}
          onStatus={setStatusFilter}
          onPriority={setPriorityFilter}
          onProperty={setPropertyFilter}
        />
      )}

      {isManager && options && (
        <form className="task-create-panel" onSubmit={submitTask}>
          <div>
            <p className="eyebrow"><span /> NEW ASSIGNMENT</p>
            <h2>{editingTaskId === null ? "Create a team task" : "Edit task assignment"}</h2>
          </div>
          <div className="task-form-grid">
            <label className="form-field"><span className="field-label">Property</span>
              <select value={draft?.propertyId ?? ""} required onChange={(e) => setDraft((old) => old && ({
                ...old, propertyId: e.target.value, unitId: "", reservationId: "", assignedStaffId: "",
              }))}>
                <option value="">Choose property</option>
                {options.properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="form-field"><span className="field-label">Task title</span>
              <input required maxLength={160} value={draft?.title ?? ""} onChange={(e) => setDraft((old) => old && ({ ...old, title: e.target.value }))} />
            </label>
            <label className="form-field"><span className="field-label">Department</span>
              <select value={draft?.department ?? "front_desk"} onChange={(e) => setDraft((old) => old && ({
                ...old, department: e.target.value as Department, assignedStaffId: "",
              }))}>
                {departments.map((department) => <option key={department} value={department}>{label(department)}</option>)}
              </select>
            </label>
            <label className="form-field"><span className="field-label">Assigned staff</span>
              <select required value={draft?.assignedStaffId ?? ""} onChange={(e) => setDraft((old) => old && ({ ...old, assignedStaffId: e.target.value }))}>
                <option value="">Choose eligible active staff</option>
                {eligibleStaff.map((staff) => <option key={staff.id} value={staff.id}>{staff.displayName}</option>)}
              </select>
            </label>
            <label className="form-field"><span className="field-label">Priority</span>
              <select value={draft?.priority ?? "normal"} onChange={(e) => setDraft((old) => old && ({ ...old, priority: e.target.value as Draft["priority"] }))}>
                {(["low", "normal", "high", "urgent"] as const).map((value) => <option key={value}>{value}</option>)}
              </select>
            </label>
            <label className="form-field"><span className="field-label">Due date</span>
              <input type="date" value={draft?.dueDate ?? ""} onChange={(e) => setDraft((old) => old && ({ ...old, dueDate: e.target.value }))} />
            </label>
            <label className="form-field"><span className="field-label">Due time</span>
              <input type="time" value={draft?.dueTime ?? ""} onChange={(e) => setDraft((old) => old && ({ ...old, dueTime: e.target.value }))} />
            </label>
            <label className="form-field"><span className="field-label">Related room (optional)</span>
              <select value={draft?.unitId ?? ""} onChange={(e) => setDraft((old) => old && ({ ...old, unitId: e.target.value, reservationId: "" }))}>
                <option value="">No room linked</option>
                {availableUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name} · {unit.unitType}</option>)}
              </select>
            </label>
            <label className="form-field"><span className="field-label">Related reservation (optional)</span>
              <select value={draft?.reservationId ?? ""} onChange={(e) => setDraft((old) => old && ({ ...old, reservationId: e.target.value }))}>
                <option value="">No reservation linked</option>
                {availableReservations.map((reservation) => (
                  <option key={reservation.id} value={reservation.id}>
                    {reservation.reservationReference} · {reservation.checkIn}–{reservation.checkOut}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field task-description"><span className="field-label">Instructions</span>
              <textarea required maxLength={4000} value={draft?.description ?? ""} onChange={(e) => setDraft((old) => old && ({ ...old, description: e.target.value }))} />
            </label>
          </div>
          <button className="button button-primary" disabled={saving || !draft?.propertyId || !draft.assignedStaffId}>
            {saving ? "Saving…" : editingTaskId === null ? "Assign task" : "Save task changes"}
          </button>
          {editingTaskId !== null && <button type="button" className="button button-secondary" onClick={() => {
            setDraft({ ...blankDraft, propertyId: options.properties[0] ? String(options.properties[0].id) : "" });
            setEditingTaskId(null);
          }}>Stop editing</button>}
        </form>
      )}

      {tasks.length === 0 ? (
        <div className="state-panel empty-state"><h2>No tasks found</h2><p>Assignments will appear here when created.</p></div>
      ) : (
        <div className="task-layout">
          <div className="task-list">
            {tasks.map((task) => (
              <button className={`task-row ${selected?.id === task.id ? "selected" : ""}`} key={task.id} onClick={() => void openTask(task)}>
                <span className="task-row-top"><strong>{task.title}</strong><span className={`task-status ${task.status}`}>{label(task.status)}</span></span>
                <span>{task.propertyName}{task.unitName ? ` · ${task.unitName}` : ""}</span>
                <span>{isManager ? task.assignedName : label(task.department)} · {label(task.priority)}</span>
                <span>{task.dueDate ? `Due ${task.dueDate}${task.dueTime ? ` ${task.dueTime}` : ""}` : "No due date"}{task.overdue && <b className="task-overdue"> · Overdue</b>}</span>
              </button>
            ))}
          </div>
          {selected && <TaskDetails
            task={selected}
            currentUser={currentUser}
            isManager={isManager}
            note={note}
            saving={saving}
            onNote={setNote}
            onClose={() => setSelected(null)}
            onEdit={() => editTask(selected)}
            onTransition={(status) => void changeStatus(selected, status)}
          />}
        </div>
      )}
    </section>
  );
}

function TaskFilters({
  properties, status, priority, propertyId, onStatus, onPriority, onProperty,
}: {
  properties: TaskOptions["properties"];
  status: string; priority: string; propertyId: string;
  onStatus: (value: string) => void;
  onPriority: (value: string) => void;
  onProperty: (value: string) => void;
}) {
  return <div className="task-filters">
    <label>Status <select value={status} onChange={(e) => onStatus(e.target.value)}>
      <option value="all">All statuses</option>{statuses.map((s) => <option key={s} value={s}>{label(s)}</option>)}
    </select></label>
    <label>Priority <select value={priority} onChange={(e) => onPriority(e.target.value)}>
      <option value="all">All priorities</option>{(["low", "normal", "high", "urgent"] as const).map((p) => <option key={p}>{p}</option>)}
    </select></label>
    <label>Property <select value={propertyId} onChange={(e) => onProperty(e.target.value)}>
      <option value="">All assigned properties</option>{properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select></label>
  </div>;
}

function TaskDetails({
  task, currentUser, isManager, note, saving, onNote, onClose, onEdit, onTransition,
}: {
  task: Task; currentUser: StaffUser; isManager: boolean; note: string; saving: boolean;
  onNote: (value: string) => void; onClose: () => void; onEdit: () => void;
  onTransition: (status: Status) => void;
}) {
  const assigned = task.assignedStaffId === currentUser.id;
  return <aside className="task-detail">
    <div className="task-detail-heading"><div><p className="eyebrow">TASK DETAILS</p><h2>{task.title}</h2></div><div>{isManager && !["completed", "cancelled"].includes(task.status) && <button className="button button-secondary" onClick={onEdit}>Edit assignment</button>}<button className="button button-secondary" onClick={onClose}>Close</button></div></div>
    <p>{task.description}</p>
    <dl>
      <div><dt>Property</dt><dd>{task.propertyName}</dd></div>
      <div><dt>Assigned to</dt><dd>{task.assignedName} · {label(task.department)}</dd></div>
      <div><dt>Created by</dt><dd>{task.creatorName}</dd></div>
      {task.unitName && <div><dt>Room</dt><dd>{task.unitName}</dd></div>}
      {task.reservationReference && <div><dt>Reservation</dt><dd>{task.reservationReference}</dd></div>}
      <div><dt>Due</dt><dd>{task.dueDate ?? "No due date"}{task.dueTime ? ` · ${task.dueTime}` : ""}</dd></div>
      {task.completionNote && <div><dt>Latest note</dt><dd>{task.completionNote}</dd></div>}
    </dl>
    {!["completed", "cancelled"].includes(task.status) && (
      <div className="task-actions">
        <label className="form-field"><span className="field-label">{task.status === "submitted" ? "Review / correction note" : "Progress or completion note"}</span>
          <textarea value={note} maxLength={2000} onChange={(e) => onNote(e.target.value)} />
        </label>
        {assigned && ["pending", "rejected"].includes(task.status) && <button disabled={saving} className="button button-primary" onClick={() => onTransition("in_progress")}>{task.status === "rejected" ? "Resume corrections" : "Start task"}</button>}
        {assigned && task.status === "in_progress" && <button disabled={saving || !note.trim()} className="button button-primary" onClick={() => onTransition("submitted")}>Submit for review</button>}
        {isManager && task.status === "submitted" && <>
          <button disabled={saving} className="button button-primary" onClick={() => onTransition("completed")}>Approve completion</button>
          <button disabled={saving || !note.trim()} className="button button-secondary" onClick={() => onTransition("rejected")}>Return for correction</button>
        </>}
        {isManager && <button disabled={saving} className="button button-secondary" onClick={() => onTransition("cancelled")}>Cancel task</button>}
      </div>
    )}
    <div className="task-activity"><h3>Activity history</h3>
      {(task.activity ?? []).map((event) => <div className="task-activity-row" key={event.id}>
        <strong>{event.actorName ?? "System"} · {label(event.eventType)}</strong>
        <span>{event.description}</span><small>{new Date(event.createdAt).toLocaleString()}</small>
      </div>)}
    </div>
  </aside>;
}

export function PropertyManagerDashboard({ navigate }: { navigate: (path: string) => void }) {
  const [date, setDate] = useState(localDate(new Date()));
  const [dashboard, setDashboard] = useState<{
    properties: Array<{ id: number; name: string }>;
    operations: Record<string, number>;
    billing: Array<{ currency: string; issuedTodayCents: string; outstandingCents: string }>;
    tasks: { totals: { overdue: number; awaitingReview: number }; byStatus: Record<string, number>; byPriority: Record<string, number> };
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    apiRequest<{ dashboard: NonNullable<typeof dashboard> }>(`/manager/dashboard?date=${encodeURIComponent(date)}`)
      .then(({ dashboard: result }) => { if (active) { setDashboard(result); setError(""); } })
      .catch((reason: unknown) => { if (active) setError(errorMessage(reason)); });
    return () => { active = false; };
  }, [date]);
  if (!dashboard && !error) return <LoadingState label="Loading property operations…" />;
  return <section className="page-section manager-dashboard">
    <div className="page-heading"><div><p className="eyebrow"><span /> PROPERTY OPERATIONS</p><h1 className="page-title">Manager dashboard</h1><p className="page-intro">Operational overview for your assigned properties.</p></div>
      <label className="form-field"><span className="field-label">Operating date</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
    </div>
    {error && <ErrorState message={error} />}
    {dashboard && <>
      <div className="manager-metrics">{Object.entries({
        "Arrivals today": dashboard.operations.arrivals,
        "Departures today": dashboard.operations.departures,
        "Occupied rooms": dashboard.operations.occupiedRooms,
        "Available rooms": dashboard.operations.availableRooms,
        "Out of service": dashboard.operations.unavailableRooms,
        "Dirty rooms": dashboard.operations.dirtyRooms,
        "Cleaning": dashboard.operations.cleaningRooms,
        "Open maintenance": dashboard.operations.openMaintenance,
        "Overdue maintenance": dashboard.operations.overdueMaintenance,
        "Awaiting task review": dashboard.tasks.totals.awaitingReview,
        "Overdue tasks": dashboard.tasks.totals.overdue,
      }).map(([name, value]) => <article className="manager-metric" key={name}><span>{name}</span><strong>{value}</strong></article>)}</div>
      <section className="task-create-panel"><h2>Assigned properties</h2><div className="manager-property-list">{dashboard.properties.map((property) => <span key={property.id}>{property.name}</span>)}</div>
        <h3>Invoices issued today / outstanding</h3>
        {dashboard.billing.length === 0
          ? <p>No invoice totals for this view.</p>
          : dashboard.billing.map((item) => (
            <p key={item.currency}>
              {formatCents(item.issuedTodayCents, item.currency)} issued today ·{" "}
              {formatCents(item.outstandingCents, item.currency)} outstanding
            </p>
          ))}
        <div className="manager-actions"><button className="button button-primary" onClick={() => navigate("/tasks")}>Manage team tasks</button><button className="button button-secondary" onClick={() => navigate("/room-availability")}>Room availability</button></div>
      </section>
    </>}
  </section>;
}

function label(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "The local PMS request could not be completed.";
}
