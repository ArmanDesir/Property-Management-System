import { useEffect, useState, type FormEvent } from "react";
import { apiRequest } from "../../lib/api";
import { ErrorState, LoadingState } from "../properties/PropertiesPages";
import type { StaffUser } from "../auth/AuthPage";
import "./Staff.css";

type Role = StaffUser["role"];

type StaffDraft = {
  displayName: string;
  username: string;
  role: Role;
  password: string;
  propertyIds: number[];
};

const emptyDraft: StaffDraft = {
  displayName: "",
  username: "",
  role: "front_desk",
  password: "",
  propertyIds: [],
};

const roleLabels: Record<Role, string> = {
  administrator: "Administrator",
  property_manager: "Property Manager",
  front_desk: "Front Desk",
  housekeeping: "Housekeeping",
  accounting: "Accounting",
};

export function StaffPage({
  currentUserId,
  navigate,
  flash,
}: {
  currentUserId: number;
  navigate: (path: string) => void;
  flash: (message: string) => void;
}) {
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [properties, setProperties] = useState<Array<{ id: number; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<StaffDraft | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      const [result, propertyResult] = await Promise.all([
        apiRequest<{ staff: StaffUser[] }>("/staff"),
        apiRequest<{ properties: Array<{ id: number; name: string }> }>("/properties"),
      ]);
      setStaff(result.staff);
      setProperties(propertyResult.properties);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const edit = (user?: StaffUser) => {
    setEditingId(user?.id ?? null);
    setDraft(user
      ? {
        displayName: user.displayName,
        username: user.username,
        role: user.role,
        password: "",
        propertyIds: user.propertyIds ?? [],
      }
      : { ...emptyDraft });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft) return;
    setSaving(true);
    setError("");
    try {
      const body = {
        displayName: draft.displayName,
        username: draft.username,
        role: draft.role,
        propertyIds: draft.role === "property_manager" ? draft.propertyIds : [],
        ...(draft.password ? { password: draft.password } : {}),
      };
      await apiRequest(
        editingId === null ? "/staff" : `/staff/${editingId}`,
        editingId === null ? "POST" : "PUT",
        body,
      );
      setDraft(null);
      setEditingId(null);
      flash(editingId === null ? "Staff account created." : "Staff account updated.");
      await refresh();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (user: StaffUser) => {
    const nextActive = !user.isActive;
    const action = nextActive ? "reactivate" : "deactivate";
    if (!window.confirm(`${action[0].toUpperCase()}${action.slice(1)} ${user.displayName}?`)) return;
    setBusyId(user.id);
    setError("");
    try {
      await apiRequest(`/staff/${user.id}/status`, "PATCH", { isActive: nextActive });
      flash(`${user.displayName} ${nextActive ? "reactivated" : "deactivated"}.`);
      await refresh();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyId(null);
    }
  };

  if (loading && staff.length === 0) return <LoadingState label="Loading staff…" />;
  if (error && staff.length === 0) {
    return <ErrorState message={error} back={() => navigate("/")} />;
  }

  return (
    <section className="page-section staff-page">
      <button className="back-link" onClick={() => navigate("/")}>
        <span aria-hidden="true">←</span> Dashboard
      </button>
      <div className="page-heading">
        <div>
          <p className="eyebrow"><span /> TEAM ACCESS</p>
          <h1 className="page-title">Staff</h1>
          <p className="page-intro">Manage local accounts and the role assigned to each person.</p>
        </div>
        <button className="button button-primary" onClick={() => edit()}>Add staff account</button>
      </div>

      {error && <ErrorState message={error} />}

      {draft && (
        <form className="staff-form state-panel" onSubmit={submit}>
          <div className="staff-form-heading">
            <div>
              <p className="eyebrow"><span /> ACCOUNT DETAILS</p>
              <h2>{editingId === null ? "New staff account" : "Edit staff account"}</h2>
            </div>
            <button className="button button-secondary" type="button" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
          <div className="staff-form-grid">
            <label className="form-field">
              <span className="field-label">Display name</span>
              <input
                value={draft.displayName}
                maxLength={100}
                onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
                required
              />
            </label>
            <label className="form-field">
              <span className="field-label">Username</span>
              <input
                value={draft.username}
                maxLength={32}
                autoComplete="off"
                onChange={(event) => setDraft({ ...draft, username: event.target.value })}
                required
              />
            </label>
            <label className="form-field">
              <span className="field-label">Role</span>
              <select
                value={draft.role}
                onChange={(event) => setDraft({
                  ...draft,
                  role: event.target.value as Role,
                  propertyIds: event.target.value === "property_manager" ? draft.propertyIds : [],
                })}
              >
                {Object.entries(roleLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            {draft.role === "property_manager" && (
              <fieldset className="form-field staff-property-assignments">
                <legend className="field-label">Assigned properties</legend>
                {properties.length === 0
                  ? <span className="field-hint">Create an active property before assigning a manager.</span>
                  : properties.map((property) => (
                    <label className="staff-property-option" key={property.id}>
                      <input
                        type="checkbox"
                        checked={draft.propertyIds.includes(property.id)}
                        onChange={(event) => setDraft({
                          ...draft,
                          propertyIds: event.target.checked
                            ? [...draft.propertyIds, property.id]
                            : draft.propertyIds.filter((id) => id !== property.id),
                        })}
                      />
                      <span>{property.name}</span>
                    </label>
                  ))}
              </fieldset>
            )}
            <label className="form-field">
              <span className="field-label">
                {editingId === null ? "Temporary password" : "New password (optional)"}
              </span>
              <input
                type="password"
                value={draft.password}
                autoComplete="new-password"
                minLength={12}
                maxLength={72}
                onChange={(event) => setDraft({ ...draft, password: event.target.value })}
                required={editingId === null}
              />
              <span className="field-hint">
                At least 12 characters. Passwords are stored only as bcrypt hashes.
              </span>
            </label>
          </div>
          <div className="staff-form-actions">
            <button className="button button-primary" type="submit" disabled={saving}>
              {saving ? "Saving…" : editingId === null ? "Create account" : "Save changes"}
            </button>
          </div>
        </form>
      )}

      {staff.length === 0 ? (
        <div className="state-panel empty-state">
          <h2>No staff accounts</h2>
          <p>Create a local account for each person who needs access.</p>
        </div>
      ) : (
        <div className="staff-table-wrap">
          <table className="staff-table">
            <thead>
              <tr>
                <th>Staff member</th>
                <th>Username</th>
                <th>Role</th>
                <th>Status</th>
                <th>Created</th>
                <th>Updated</th>
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {staff.map((user) => (
                <tr key={user.id}>
                  <td className="staff-name">{user.displayName}</td>
                  <td>{user.username}</td>
                  <td>{roleLabels[user.role]}</td>
                  <td>
                    <span className={`staff-status ${user.isActive ? "active" : "inactive"}`}>
                      {user.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>{formatTimestamp(user.createdAt)}</td>
                  <td>{formatTimestamp(user.updatedAt)}</td>
                  <td className="staff-actions">
                    <button className="button button-secondary" onClick={() => edit(user)}>
                      Edit
                    </button>
                    <button
                      className="button button-secondary"
                      disabled={busyId === user.id || user.id === currentUserId}
                      title={user.id === currentUserId ? "You cannot change your own active status." : undefined}
                      onClick={() => void toggleActive(user)}
                    >
                      {busyId === user.id
                        ? "Saving…"
                        : user.isActive
                          ? "Deactivate"
                          : "Reactivate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "The request could not be completed.";
}
