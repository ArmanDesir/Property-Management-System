import { useEffect, useState, type MouseEvent } from "react";
import {
  ErrorState,
  PropertiesPage,
  PropertyDetailsPage,
  PropertyFormPage,
  UnitDetailsPage,
  UnitFormPage,
} from "./features/properties/PropertiesPages";
import {
  GuestDetailsPage,
  GuestFormPage,
  GuestsPage,
} from "./features/guests/GuestPages";
import {
  ReservationDetailsPage,
  ReservationFormPage,
  ReservationsPage,
} from "./features/reservations/ReservationPages";
import { FrontDeskPage } from "./features/front-desk/FrontDeskPage";
import { HousekeepingPage } from "./features/housekeeping/HousekeepingPage";
import {
  BillingPage,
  InvoiceDetailsPage,
  InvoiceFormPage,
} from "./features/billing/BillingPages";
import { ReportsPage } from "./features/reports/ReportsPage";
import { AuthPage, type StaffUser } from "./features/auth/AuthPage";
import { StaffPage } from "./features/staff/StaffPage";
import { MaintenancePage } from "./features/maintenance/MaintenancePage";
import { TeamTasksPage, PropertyManagerDashboard } from "./features/tasks/TeamTasksPage";
import { RoomAvailabilityPage } from "./features/room-availability/RoomAvailabilityPage";
import { ApiRequestError, apiRequest } from "./lib/api";
import "./App.css";

type HealthStatus = "checking" | "online" | "offline";
type AuthMode = "checking" | "setup" | "login" | "ready" | "offline";
type Route =
  | { name: "dashboard" }
  | { name: "properties" }
  | { name: "new-property" }
  | { name: "property-details"; propertyId: number }
  | { name: "edit-property"; propertyId: number }
  | { name: "new-unit"; propertyId: number }
  | { name: "unit-details"; propertyId: number; unitId: number }
  | { name: "edit-unit"; propertyId: number; unitId: number }
  | { name: "guests" }
  | { name: "new-guest" }
  | { name: "guest-details"; guestId: number }
  | { name: "edit-guest"; guestId: number }
  | { name: "reservations" }
  | { name: "front-desk" }
  | { name: "housekeeping" }
  | { name: "billing" }
  | { name: "new-invoice" }
  | { name: "invoice-details"; invoiceId: number }
  | { name: "edit-invoice"; invoiceId: number }
  | { name: "reports" }
  | { name: "staff" }
  | { name: "maintenance" }
  | { name: "tasks" }
  | { name: "room-availability" }
  | { name: "new-reservation" }
  | { name: "reservation-details"; reservationId: number }
  | { name: "edit-reservation"; reservationId: number }
  | { name: "not-found" };

function App() {
  const [pathname, setPathname] = useState(window.location.pathname);
  const [locationSearch, setLocationSearch] = useState(window.location.search);
  const [status, setStatus] = useState<HealthStatus>("checking");
  const [notice, setNotice] = useState("");
  const [authMode, setAuthMode] = useState<AuthMode>("checking");
  const [staffUser, setStaffUser] = useState<StaffUser | null>(null);
  const [setupToken, setSetupToken] = useState("");
  const [authError, setAuthError] = useState("");
  const [authRetry, setAuthRetry] = useState(0);

  useEffect(() => {
    const onPopState = () => {
      setPathname(window.location.pathname);
      setLocationSearch(window.location.search);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/health")
      .then((response) => {
        if (!response.ok) throw new Error("API health check failed");
        return response.json();
      })
      .then(() => {
        if (active) setStatus("online");
      })
      .catch(() => {
        if (active) setStatus("offline");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadSession = async () => {
      setAuthMode("checking");
      setAuthError("");
      try {
        const authStatus = await apiRequest<{
          setupRequired: boolean;
          setupToken?: string;
        }>("/auth/status");
        if (!active) return;
        if (authStatus.setupRequired) {
          setSetupToken(authStatus.setupToken ?? "");
          setAuthMode("setup");
          return;
        }
        try {
          const result = await apiRequest<{ user: StaffUser }>("/auth/me");
          if (active) {
            setStaffUser(result.user);
            setAuthMode("ready");
          }
        } catch (reason) {
          if (!active) return;
          if (reason instanceof ApiRequestError && reason.status === 401) {
            setAuthMode("login");
          } else {
            throw reason;
          }
        }
      } catch (reason) {
        if (active) {
          setAuthError(errorMessage(reason));
          setAuthMode("offline");
        }
      }
    };
    void loadSession();
    return () => {
      active = false;
    };
  }, [authRetry]);

  useEffect(() => {
    const onUnauthenticated = () => {
      setStaffUser(null);
      setAuthMode("login");
      setNotice("");
    };
    window.addEventListener("pms:unauthenticated", onUnauthenticated);
    return () => window.removeEventListener("pms:unauthenticated", onUnauthenticated);
  }, []);

  const navigate = (path: string) => {
    const url = new URL(path, window.location.origin);
    if (`${url.pathname}${url.search}` !== `${window.location.pathname}${window.location.search}`) {
      window.history.pushState({}, "", url);
    }
    setPathname(url.pathname);
    setLocationSearch(url.search);
    setNotice("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const flash = (message: string) => setNotice(message);
  const route = resolveRoute(pathname);
  const pageProps = { navigate, flash };
  if (authMode === "checking") {
    return (
      <main className="shell auth-shell">
        <div className="state-panel" role="status">Checking local access…</div>
      </main>
    );
  }
  if (authMode !== "ready" || !staffUser) {
    return (
      <AuthPage
        mode={authMode === "setup" || authMode === "offline" ? authMode : "login"}
        setupToken={setupToken}
        error={authError}
        onAuthenticated={(user) => {
          setStaffUser(user);
          setAuthMode("ready");
          setAuthError("");
        }}
        onRetry={() => setAuthRetry((value) => value + 1)}
      />
    );
  }
  const role = staffUser.role;
  const hasRouteAccess = canAccessRoute(route, role);
  const isPropertiesRoute =
    route.name === "properties" ||
    route.name.includes("property") ||
    route.name.includes("unit");
  const isGuestsRoute = route.name.includes("guest") || route.name === "guests";
  const isReservationsRoute =
    route.name.includes("reservation") || route.name === "reservations";
  const isBillingRoute = route.name === "billing" || route.name.includes("invoice");
  const isReportsRoute = route.name === "reports";
  const canUseRoomCalendar =
    role === "administrator" || role === "property_manager" || role === "front_desk";

  return (
    <main className="shell">
      <header className="topbar">
        <a
          className="brand"
          href="/"
          onClick={linkClick("/", navigate)}
          aria-label="ZCSMST PMS dashboard"
        >
          <span className="brand-mark">L</span>
          <span>
            ZCSMST<span className="brand-light">pms</span>
          </span>
        </a>
        <nav className="main-nav" aria-label="Main navigation">
          <NavLink path="/" label="Dashboard" active={route.name === "dashboard"} navigate={navigate} />
          {(role === "administrator" || role === "front_desk") && (
            <>
              <NavLink path="/front-desk" label="Front Desk" active={route.name === "front-desk"} navigate={navigate} />
              <NavLink path="/guests" label="Guests" active={isGuestsRoute} navigate={navigate} />
              <NavLink path="/reservations" label="Reservations" active={isReservationsRoute} navigate={navigate} />
            </>
          )}
          {(role === "administrator" || role === "housekeeping") && (
            <NavLink path="/housekeeping" label="Housekeeping" active={route.name === "housekeeping"} navigate={navigate} />
          )}
          {role === "administrator" && (
            <NavLink path="/properties" label="Properties" active={isPropertiesRoute} navigate={navigate} />
          )}
          {(role === "administrator" || role === "front_desk" || role === "accounting") && (
            <NavLink path="/billing" label="Billing" active={isBillingRoute} navigate={navigate} />
          )}
          {(role === "administrator" || role === "accounting") && (
            <NavLink path="/reports" label="Reports" active={isReportsRoute} navigate={navigate} />
          )}
          {role === "administrator" && (
            <NavLink path="/staff" label="Staff" active={route.name === "staff"} navigate={navigate} />
          )}
          <NavLink
            path="/tasks"
            label={role === "administrator" || role === "property_manager" ? "Team Tasks" : "My Tasks"}
            active={route.name === "tasks"}
            navigate={navigate}
          />
          {canUseRoomCalendar && (
            <NavLink path="/room-availability" label="Room Availability" active={route.name === "room-availability"} navigate={navigate} />
          )}
          {(role === "administrator" || role === "property_manager" ||
            role === "front_desk" || role === "housekeeping") && (
            <NavLink path="/maintenance" label="Maintenance" active={route.name === "maintenance"} navigate={navigate} />
          )}
        </nav>
        <div className="staff-session">
          <span className="staff-session-name">{staffUser.displayName}</span>
          <button
            className="nav-link sign-out"
            onClick={() => {
              void apiRequest("/auth/logout", "POST").then(() => {
                setStaffUser(null);
                setAuthMode("login");
                navigate("/");
              }).catch((reason: unknown) => flash(errorMessage(reason)));
            }}
          >
            Sign out
          </button>
        </div>
        <div className="local-badge">
          <span className={`status-dot ${status}`} />
          {status === "checking"
            ? "Connecting"
            : status === "online"
              ? "ZCSMST PMS ready"
              : "API offline"}
        </div>
      </header>

      {notice && (
        <div className="success-banner" role="status">
          <span aria-hidden="true">✓</span>
          {notice}
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            ×
          </button>
        </div>
      )}

      {hasRouteAccess ? (
      <>
      {route.name === "dashboard" && (
        role === "property_manager"
          ? <PropertyManagerDashboard navigate={navigate} />
          : <Dashboard navigate={navigate} role={role} />
      )}
      {route.name === "properties" && <PropertiesPage {...pageProps} />}
      {route.name === "new-property" && <PropertyFormPage {...pageProps} />}
      {route.name === "property-details" && (
        <PropertyDetailsPage {...pageProps} propertyId={route.propertyId} />
      )}
      {route.name === "edit-property" && (
        <PropertyFormPage {...pageProps} propertyId={route.propertyId} />
      )}
      {route.name === "new-unit" && (
        <UnitFormPage {...pageProps} propertyId={route.propertyId} />
      )}
      {route.name === "unit-details" && (
        <UnitDetailsPage
          {...pageProps}
          propertyId={route.propertyId}
          unitId={route.unitId}
        />
      )}
      {route.name === "edit-unit" && (
        <UnitFormPage
          {...pageProps}
          propertyId={route.propertyId}
          unitId={route.unitId}
        />
      )}
      {route.name === "guests" && <GuestsPage {...pageProps} />}
      {route.name === "new-guest" && <GuestFormPage {...pageProps} />}
      {route.name === "guest-details" && (
        <GuestDetailsPage {...pageProps} guestId={route.guestId} />
      )}
      {route.name === "edit-guest" && (
        <GuestFormPage {...pageProps} guestId={route.guestId} />
      )}
      {route.name === "reservations" && (
        <ReservationsPage
          key={locationSearch}
          {...pageProps}
          initialFilters={{
            propertyId: new URLSearchParams(locationSearch).get("propertyId") ?? "",
            guestId: new URLSearchParams(locationSearch).get("guestId") ?? "",
            unitId: new URLSearchParams(locationSearch).get("unitId") ?? "",
          }}
        />
      )}
      {route.name === "front-desk" && <FrontDeskPage {...pageProps} />}
      {route.name === "housekeeping" && <HousekeepingPage {...pageProps} />}
      {route.name === "billing" && (
        <BillingPage {...pageProps} readOnly={role === "front_desk"} />
      )}
      {route.name === "reports" && <ReportsPage navigate={navigate} />}
      {route.name === "new-invoice" && (
        <InvoiceFormPage key={locationSearch} {...pageProps} />
      )}
      {route.name === "invoice-details" && (
        <InvoiceDetailsPage
          {...pageProps}
          invoiceId={route.invoiceId}
          readOnly={role === "front_desk"}
          canViewReservation={role === "administrator" || role === "front_desk"}
        />
      )}
      {route.name === "staff" && (
        <StaffPage currentUserId={staffUser.id} {...pageProps} />
      )}
      {route.name === "maintenance" && (
        <MaintenancePage role={role} {...pageProps} />
      )}
      {route.name === "tasks" && (
        <TeamTasksPage currentUser={staffUser} {...pageProps} />
      )}
      {route.name === "room-availability" && (
        <RoomAvailabilityPage {...pageProps} />
      )}
      {route.name === "edit-invoice" && (
        <InvoiceFormPage {...pageProps} invoiceId={route.invoiceId} />
      )}
      {route.name === "new-reservation" && (
        <ReservationFormPage key={locationSearch} {...pageProps} />
      )}
      {route.name === "reservation-details" && (
        <ReservationDetailsPage {...pageProps} reservationId={route.reservationId} />
      )}
      {route.name === "edit-reservation" && (
        <ReservationFormPage {...pageProps} reservationId={route.reservationId} />
      )}
      {route.name === "not-found" && (
        <ErrorState
          message="We couldn’t find that page."
          back={() => navigate("/properties")}
        />
      )}
      </>
      ) : (
        <section className="page-section">
          <ErrorState
            message="This account does not have permission to open that page."
            back={() => navigate("/")}
          />
        </section>
      )}

      <footer>
        <span>ZCSMST PMS</span>
        <span>Private by nature. Right on your machine.</span>
      </footer>
    </main>
  );
}

function Dashboard({
  navigate,
  role,
}: {
  navigate: (path: string) => void;
  role: StaffUser["role"];
}) {
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">
            <span /> YOUR PROPERTY, IN GOOD ORDER
          </p>
          <h1>
            A calmer way to
            <br />
            run your <em>stay.</em>
          </h1>
          <p className="hero-description">
            Keep your properties and rentable spaces organized, all together and
            right here on your machine.
          </p>
          {role === "administrator" && (
            <button
              className="primary-link"
              onClick={() => navigate("/properties")}
            >
              Explore your properties <span aria-hidden="true">↘</span>
            </button>
          )}
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="sun" />
          <div className="art-card">
            <div className="art-window">
              <span />
              <span />
              <span />
            </div>
            <div className="art-building">
              <div className="building-roof" />
              <div className="building-body">
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
              </div>
            </div>
            <div className="art-ground" />
          </div>
          <div className="art-note">
            <span className="note-check">✓</span>
            <span>All in one place</span>
          </div>
        </div>
      </section>

      <section className="workspace" id="workspace">
        <div className="section-heading">
          <div>
            <p className="eyebrow">YOUR WORKSPACE</p>
            <h2>Start with the essentials.</h2>
          </div>
          <p className="section-aside">
            Manage your properties
            <br />
            and places to stay.
          </p>
        </div>
        <div className="area-grid">
          {role === "administrator" && <button
            className="area-card area-card-button"
            onClick={() => navigate("/properties")}
          >
            <span className="card-top">
              <span className="area-icon">⌂</span>
              <span className="area-number">01</span>
            </span>
            <span className="area-card-title">Properties</span>
            <span className="area-card-description">
              Manage locations, property details, and rentable spaces.
            </span>
            <span className="card-arrow" aria-hidden="true">
              ↗
            </span>
          </button>}
          {[
            ["02", "Front Desk", "Manage today’s arrivals, departures, and in-house stays.", "↔"],
            ["03", "Reservations", "Manage dates, availability, and stays.", "▦"],
            ["04", "Guests", "Manage guest profiles and contact details.", "◎"],
            [
              "05",
              "Billing",
              "Create reservation invoices and track manually recorded payments.",
              "↗",
            ],
            [
              "06",
              "Housekeeping",
              "Track unit cleaning and maintenance availability.",
              "✳",
            ],
            [
              "07",
              "Reports",
              "Review reservations, occupancy, housekeeping, and billing trends.",
              "▤",
            ],
            [
              "08",
              "Maintenance",
              "Track property repairs, priorities, assignments, and progress.",
              "⚒",
            ],
            ["09", "Team Tasks", "Assign and review staff work.", "✓"],
            ["10", "Room Availability", "Review hotel room availability by date.", "▦"],
          ].filter(([, title]) => canAccessDashboardTile(role, title)).map(([number, title, description, icon]) =>
            title === "Guests" || title === "Reservations" || title === "Front Desk" || title === "Housekeeping" || title === "Billing" || title === "Reports" || title === "Maintenance" || title === "Team Tasks" || title === "Room Availability" ? (
              <button
                className="area-card area-card-button"
                key={title}
                onClick={() => navigate(
                  title === "Guests"
                    ? "/guests"
                    : title === "Reservations"
                      ? "/reservations"
                      : title === "Front Desk"
                        ? "/front-desk"
                        : title === "Housekeeping"
                          ? "/housekeeping"
                          : title === "Billing"
                            ? "/billing"
                            : title === "Reports"
                              ? "/reports"
                              : title === "Maintenance"
                                ? "/maintenance"
                                : title === "Team Tasks"
                                  ? "/tasks"
                                  : "/room-availability",
                )}
              >
                <span className="card-top">
                  <span className="area-icon">{icon}</span>
                  <span className="area-number">{number}</span>
                </span>
                <span className="area-card-title">{title}</span>
                <span className="area-card-description">{description}</span>
                <span className="card-arrow" aria-hidden="true">
                  ↗
                </span>
              </button>
            ) : (
              <article
                className="area-card area-card-pending"
                key={title}
                aria-disabled="true"
              >
                <span className="card-top">
                  <span className="area-icon">{icon}</span>
                  <span className="area-number">{number}</span>
                </span>
                <span className="area-card-title">{title}</span>
                <span className="area-card-description">{description}</span>
                <span className="planned-label">Planned</span>
              </article>
            ),
          )}
        </div>
      </section>
    </>
  );
}

function resolveRoute(path: string): Route {
  if (path === "/") return { name: "dashboard" };
  if (path === "/guests") return { name: "guests" };
  if (path === "/guests/new") return { name: "new-guest" };
  if (path === "/properties") return { name: "properties" };
  if (path === "/properties/new") return { name: "new-property" };
  if (path === "/reservations") return { name: "reservations" };
  if (path === "/front-desk") return { name: "front-desk" };
  if (path === "/housekeeping") return { name: "housekeeping" };
  if (path === "/billing") return { name: "billing" };
  if (path === "/reports") return { name: "reports" };
  if (path === "/staff") return { name: "staff" };
  if (path === "/maintenance") return { name: "maintenance" };
  if (path === "/tasks") return { name: "tasks" };
  if (path === "/room-availability") return { name: "room-availability" };
  if (path === "/billing/new") return { name: "new-invoice" };
  if (path === "/reservations/new") return { name: "new-reservation" };

  let match = path.match(/^\/billing\/(\d+)\/edit$/);
  if (match) return { name: "edit-invoice", invoiceId: Number(match[1]) };

  match = path.match(/^\/billing\/(\d+)$/);
  if (match) return { name: "invoice-details", invoiceId: Number(match[1]) };

  match = path.match(/^\/guests\/(\d+)\/edit$/);
  if (match) return { name: "edit-guest", guestId: Number(match[1]) };

  match = path.match(/^\/guests\/(\d+)$/);
  if (match) return { name: "guest-details", guestId: Number(match[1]) };

  match = path.match(/^\/reservations\/(\d+)\/edit$/);
  if (match) return { name: "edit-reservation", reservationId: Number(match[1]) };

  match = path.match(/^\/reservations\/(\d+)$/);
  if (match) return { name: "reservation-details", reservationId: Number(match[1]) };

  match = path.match(/^\/properties\/(\d+)\/edit$/);
  if (match) return { name: "edit-property", propertyId: Number(match[1]) };

  match = path.match(/^\/properties\/(\d+)\/units\/new$/);
  if (match) return { name: "new-unit", propertyId: Number(match[1]) };

  match = path.match(/^\/properties\/(\d+)\/units\/(\d+)\/edit$/);
  if (match) {
    return {
      name: "edit-unit",
      propertyId: Number(match[1]),
      unitId: Number(match[2]),
    };
  }

  match = path.match(/^\/properties\/(\d+)\/units\/(\d+)$/);
  if (match) {
    return {
      name: "unit-details",
      propertyId: Number(match[1]),
      unitId: Number(match[2]),
    };
  }

  match = path.match(/^\/properties\/(\d+)$/);
  if (match) return { name: "property-details", propertyId: Number(match[1]) };

  return { name: "not-found" };
}

function canAccessRoute(route: Route, role: StaffUser["role"]): boolean {
  if (route.name === "dashboard" || route.name === "not-found") return true;
  if (role === "administrator") return true;
  if (route.name === "tasks") return true;
  if (role === "property_manager") return route.name === "room-availability";
  if (role === "front_desk") {
    return [
      "front-desk",
      "guests",
      "new-guest",
      "guest-details",
      "edit-guest",
      "reservations",
      "new-reservation",
      "reservation-details",
      "edit-reservation",
      "billing",
      "invoice-details",
      "maintenance",
      "room-availability",
    ].includes(route.name);
  }
  if (role === "housekeeping") return route.name === "housekeeping" || route.name === "maintenance";
  return [
    "billing",
    "new-invoice",
    "invoice-details",
    "edit-invoice",
    "reports",
  ].includes(route.name);
}

function canAccessDashboardTile(
  role: StaffUser["role"],
  title: string,
): boolean {
  if (role === "administrator") return true;
  if (role === "property_manager") return title === "Team Tasks" || title === "Room Availability";
  if (role === "front_desk") {
    return ["Front Desk", "Reservations", "Guests", "Billing", "Maintenance", "Team Tasks", "Room Availability"].includes(title);
  }
  if (role === "housekeeping") return title === "Housekeeping" || title === "Maintenance" || title === "Team Tasks";
  return title === "Billing" || title === "Reports" || title === "Team Tasks";
}

function NavLink({
  path,
  label,
  active,
  navigate,
}: {
  path: string;
  label: string;
  active: boolean;
  navigate: (path: string) => void;
}) {
  return (
    <a
      href={path}
      className={active ? "nav-link active" : "nav-link"}
      onClick={linkClick(path, navigate)}
    >
      {label}
    </a>
  );
}

function linkClick(path: string, navigate: (path: string) => void) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    navigate(path);
  };
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error
    ? reason.message
    : "The local PMS request could not be completed.";
}

export default App;
