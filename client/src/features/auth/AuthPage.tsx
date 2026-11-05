import { useState, type FormEvent } from "react";
import { apiRequest } from "../../lib/api";
import "./AuthPage.css";

export interface StaffUser {
  id: number;
  displayName: string;
  username: string;
  role: "administrator" | "property_manager" | "front_desk" | "housekeeping" | "accounting";
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  propertyIds?: number[];
}

export function AuthPage({
  mode,
  setupToken,
  error,
  onAuthenticated,
  onRetry,
}: {
  mode: "setup" | "login" | "offline";
  setupToken?: string;
  error: string;
  onAuthenticated: (user: StaffUser) => void;
  onRetry: () => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [recoveryPin, setRecoveryPin] = useState("");
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const isRecovery = mode === "login" && recoveryMode;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setFormError("");
    try {
      const result = mode === "setup"
        ? await apiRequest<{ user: StaffUser }>(
          "/auth/setup",
          "POST",
          { displayName, username, password, recoveryPin },
          { "x-setup-token": setupToken ?? "" },
        )
        : isRecovery
          ? await apiRequest<{ user: StaffUser }>("/auth/recovery", "POST", {
            username,
            recoveryPin,
            password,
          })
        : await apiRequest<{ user: StaffUser }>("/auth/login", "POST", {
          username,
          password,
        });
      onAuthenticated(result.user);
    } catch (reason) {
      setFormError(errorMessage(reason));
    } finally {
      setSubmitting(false);
    }
  };

  if (mode === "offline") {
    return (
      <main className="shell auth-shell">
        <section className="auth-card" aria-labelledby="auth-title">
          <span className="brand-mark" aria-hidden="true">L</span>
          <p className="eyebrow"><span /> PRIVATE LOCAL WORKSPACE</p>
          <h1 className="page-title" id="auth-title">PMS unavailable</h1>
          <p className="page-intro">{error || "The local API could not be reached."}</p>
          <button className="button button-primary" onClick={onRetry}>Try again</button>
        </section>
        <footer><span>ZCSMST PMS</span><span>Private by nature. Right on your machine.</span></footer>
      </main>
    );
  }

  return (
    <main className="shell auth-shell">
      <section className="auth-card" aria-labelledby="auth-title">
        <span className="brand-mark" aria-hidden="true">L</span>
        <p className="eyebrow"><span /> PRIVATE LOCAL WORKSPACE</p>
        <h1 className="page-title" id="auth-title">
          {mode === "setup"
            ? "Set up your administrator"
            : isRecovery
              ? "Recover administrator access"
              : "Welcome back"}
        </h1>
        <p className="page-intro">
          {mode === "setup"
            ? "Create the first account and an instructor-only recovery PIN."
            : isRecovery
              ? "Use the instructor PIN to set a new administrator password. PMS data will be kept."
              : "Sign in with a staff account to continue."}
        </p>
        {(error || formError) && (
          <div className="error-banner" role="alert">{formError || error}</div>
        )}
        <form className="auth-form" onSubmit={submit}>
          {mode === "setup" && (
            <label className="form-field">
              <span className="field-label">Display name</span>
              <input
                autoComplete="name"
                maxLength={100}
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                required
              />
            </label>
          )}
          <label className="form-field">
            <span className="field-label">Username</span>
            <input
              autoComplete="username"
              maxLength={32}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </label>
          <label className="form-field">
            <span className="field-label">Password</span>
            <input
              type="password"
              autoComplete={mode === "setup" || isRecovery ? "new-password" : "current-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            {mode === "setup" && (
              <span className="field-hint">Choose a password you can remember. It is stored as a bcrypt hash.</span>
            )}
          </label>
          {(mode === "setup" || isRecovery) && (
            <label className="form-field">
              <span className="field-label">Instructor recovery PIN</span>
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]{6}"
                minLength={6}
                maxLength={6}
                autoComplete="off"
                value={recoveryPin}
                onChange={(event) => setRecoveryPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
                required
              />
              {mode === "setup" && (
                <span className="field-hint">
                  Choose a 6-digit PIN and keep it private. You will need it to recover the administrator password or reset the classroom baseline.
                </span>
              )}
            </label>
          )}
          <button className="button button-primary" type="submit" disabled={submitting}>
            {submitting
              ? "Please wait…"
              : mode === "setup"
                ? "Create administrator"
                : isRecovery
                  ? "Set new password"
                  : "Sign in"}
          </button>
          {mode === "login" && (
            <button
              className="button button-secondary auth-retry"
              type="button"
              onClick={() => {
                setRecoveryMode((value) => !value);
                setRecoveryPin("");
                setPassword("");
                setFormError("");
              }}
            >
              {isRecovery ? "Back to sign in" : "Forgot administrator password?"}
            </button>
          )}
          {mode === "setup" && (
            <button className="button button-secondary auth-retry" type="button" onClick={onRetry}>
              Refresh setup token
            </button>
          )}
        </form>
        <p className="auth-local-note">The API and browser interface are configured for loopback access only. This does not replace laptop and account security.</p>
      </section>
      <footer><span>ZCSMST PMS</span><span>Private by nature. Right on your machine.</span></footer>
    </main>
  );
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "The request could not be completed.";
}
