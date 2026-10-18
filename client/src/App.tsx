import { useEffect, useState, type MouseEvent } from "react";
import {
  ErrorState,
  PropertiesPage,
  PropertyDetailsPage,
  PropertyFormPage,
  UnitDetailsPage,
  UnitFormPage,
} from "./features/properties/PropertiesPages";
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
  | { name: "not-found" };

function App() {
  const [pathname, setPathname] = useState(window.location.pathname);
  const [status, setStatus] = useState<HealthStatus>("checking");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname);
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
    if (path !== window.location.pathname) window.history.pushState({}, "", path);
    setPathname(path);
    setNotice("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const flash = (message: string) => setNotice(message);
  const route = resolveRoute(pathname);
  const pageProps = { navigate, flash };

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="/" onClick={linkClick("/", navigate)} aria-label="Local PMS dashboard">
          <span className="brand-mark">L</span>
          <span>local<span className="brand-light">pms</span></span>
        </a>
        <nav className="main-nav" aria-label="Main navigation">
          <a href="/" className={route.name === "dashboard" ? "nav-link active" : "nav-link"} onClick={linkClick("/", navigate)}>Dashboard</a>
          <a href="/properties" className={route.name !== "dashboard" ? "nav-link active" : "nav-link"} onClick={linkClick("/properties", navigate)}>Properties</a>
        </nav>
        <div className="local-badge">
          <span className={`status-dot ${status}`} />
          {status === "checking" ? "Connecting" : status === "online" ? "Local system ready" : "API offline"}
        </div>
      </header>

      {notice && (
        <div className="success-banner" role="status">
          <span aria-hidden="true">✓</span>{notice}
          <button aria-label="Dismiss notification" onClick={() => setNotice("")}>×</button>
        </div>
      )}

      {route.name === "dashboard" && <Dashboard navigate={navigate} />}
      {route.name === "properties" && <PropertiesPage {...pageProps} />}
      {route.name === "new-property" && <PropertyFormPage {...pageProps} />}
      {route.name === "property-details" && <PropertyDetailsPage {...pageProps} propertyId={route.propertyId} />}
      {route.name === "edit-property" && <PropertyFormPage {...pageProps} propertyId={route.propertyId} />}
      {route.name === "new-unit" && <UnitFormPage {...pageProps} propertyId={route.propertyId} />}
      {route.name === "unit-details" && <UnitDetailsPage {...pageProps} propertyId={route.propertyId} unitId={route.unitId} />}
      {route.name === "edit-unit" && <UnitFormPage {...pageProps} propertyId={route.propertyId} unitId={route.unitId} />}
      {route.name === "not-found" && <ErrorState message="We couldn’t find that page." back={() => navigate("/properties")} />}

      <footer><span>LOCAL PMS</span><span>Private by nature. Right on your machine.</span></footer>
    </main>
  );
}

function Dashboard({ navigate }: { navigate: (path: string) => void }) {
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow"><span /> YOUR PROPERTY, IN GOOD ORDER</p>
          <h1>A calmer way to<br />run your <em>stay.</em></h1>
          <p className="hero-description">
            Keep your properties and rentable spaces organized, all together and right here on your machine.
          </p>
          <button className="primary-link" onClick={() => navigate("/properties")}>
            Explore your properties <span aria-hidden="true">↘</span>
          </button>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="sun" />
          <div className="art-card">
            <div className="art-window"><span /><span /><span /></div>
            <div className="art-building">
              <div className="building-roof" />
              <div className="building-body"><i /><i /><i /><i /><i /><i /></div>
            </div>
            <div className="art-ground" />
          </div>
          <div className="art-note"><span className="note-check">✓</span><span>All in one place</span></div>
        </div>
      </section>

      <section className="workspace" id="workspace">
        <div className="section-heading">
          <div>
            <p className="eyebrow">YOUR WORKSPACE</p>
            <h2>Start with the essentials.</h2>
          </div>
          <p className="section-aside">Manage your properties<br />and places to stay.</p>
        </div>
        <div className="area-grid">
          <button className="area-card area-card-button" onClick={() => navigate("/properties")}>
            <span className="card-top"><span className="area-icon">⌂</span><span className="area-number">01</span></span>
            <span className="area-card-title">Properties</span>
            <span className="area-card-description">Manage locations, property details, and rentable spaces.</span>
            <span className="card-arrow" aria-hidden="true">↗</span>
          </button>
          {[
            ["02", "Reservations", "Booking tools are planned for a future phase.", "▦"],
            ["03", "Guests", "Guest records are planned for a future phase.", "◎"],
            ["04", "Billing", "Billing tools are planned for a future phase.", "↗"],
            ["05", "Housekeeping", "Housekeeping is planned for a future phase.", "✳"],
          ].map(([number, title, description, icon]) => (
            <article className="area-card area-card-pending" key={title} aria-disabled="true">
              <span className="card-top"><span className="area-icon">{icon}</span><span className="area-number">{number}</span></span>
              <span className="area-card-title">{title}</span>
              <span className="area-card-description">{description}</span>
              <span className="planned-label">Planned</span>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

function resolveRoute(path: string): Route {
  if (path === "/") return { name: "dashboard" };
  if (path === "/properties") return { name: "properties" };
  if (path === "/properties/new") return { name: "new-property" };

  let match = path.match(/^\/properties\/(\d+)\/edit$/);
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
    ) return;
    event.preventDefault();
    navigate(path);
  };
}

export default App;
