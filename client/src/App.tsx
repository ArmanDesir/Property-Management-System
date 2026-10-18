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
import "./App.css";

type HealthStatus = "checking" | "online" | "offline";
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
  | { name: "new-reservation" }
  | { name: "reservation-details"; reservationId: number }
  | { name: "edit-reservation"; reservationId: number }
  | { name: "not-found" };

function App() {
  const [pathname, setPathname] = useState(window.location.pathname);
  const [locationSearch, setLocationSearch] = useState(window.location.search);
  const [status, setStatus] = useState<HealthStatus>("checking");
  const [notice, setNotice] = useState("");

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
  const isPropertiesRoute =
    route.name === "properties" ||
    route.name.includes("property") ||
    route.name.includes("unit");
  const isGuestsRoute = route.name.includes("guest") || route.name === "guests";
  const isReservationsRoute =
    route.name.includes("reservation") || route.name === "reservations";
  const isBillingRoute = route.name === "billing" || route.name.includes("invoice");

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
          <a
            href="/"
            className={
              route.name === "dashboard" ? "nav-link active" : "nav-link"
            }
            onClick={linkClick("/", navigate)}
          >
            Dashboard
          </a>
          <a
            href="/front-desk"
            className={route.name === "front-desk" ? "nav-link active" : "nav-link"}
            onClick={linkClick("/front-desk", navigate)}
          >
            Front Desk
          </a>
          <a
            href="/housekeeping"
            className={route.name === "housekeeping" ? "nav-link active" : "nav-link"}
            onClick={linkClick("/housekeeping", navigate)}
          >
            Housekeeping
          </a>
          <a
            href="/properties"
            className={isPropertiesRoute ? "nav-link active" : "nav-link"}
            onClick={linkClick("/properties", navigate)}
          >
            Properties
          </a>
          <a
            href="/guests"
            className={isGuestsRoute ? "nav-link active" : "nav-link"}
            onClick={linkClick("/guests", navigate)}
          >
            Guests
          </a>
          <a
            href="/reservations"
            className={isReservationsRoute ? "nav-link active" : "nav-link"}
            onClick={linkClick("/reservations", navigate)}
          >
            Reservations
          </a>
          <a
            href="/billing"
            className={isBillingRoute ? "nav-link active" : "nav-link"}
            onClick={linkClick("/billing", navigate)}
          >
            Billing
          </a>
        </nav>
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

      {route.name === "dashboard" && <Dashboard navigate={navigate} />}
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
      {route.name === "billing" && <BillingPage {...pageProps} />}
      {route.name === "new-invoice" && (
        <InvoiceFormPage key={locationSearch} {...pageProps} />
      )}
      {route.name === "invoice-details" && (
        <InvoiceDetailsPage {...pageProps} invoiceId={route.invoiceId} />
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

      <footer>
        <span>ZCSMST PMS</span>
        <span>Private by nature. Right on your machine.</span>
      </footer>
    </main>
  );
}

function Dashboard({ navigate }: { navigate: (path: string) => void }) {
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
          <button
            className="primary-link"
            onClick={() => navigate("/properties")}
          >
            Explore your properties <span aria-hidden="true">↘</span>
          </button>
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
          <button
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
          </button>
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
          ].map(([number, title, description, icon]) =>
            title === "Guests" || title === "Reservations" || title === "Front Desk" || title === "Housekeeping" || title === "Billing" ? (
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
                          : "/billing",
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

export default App;
