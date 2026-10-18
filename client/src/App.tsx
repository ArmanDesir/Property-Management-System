import { useEffect, useState } from "react";
import "./App.css";

type HealthStatus = "checking" | "online" | "offline";

const areas = [
  {
    number: "01",
    title: "Properties",
    description: "Keep your rooms, units, and property details in one place.",
    icon: "⌂",
  },
  {
    number: "02",
    title: "Reservations",
    description: "Track upcoming stays and keep every booking organized.",
    icon: "▦",
  },
  {
    number: "03",
    title: "Guests",
    description: "Build a clear guest record from first visit to check-out.",
    icon: "◎",
  },
  {
    number: "04",
    title: "Billing",
    description: "Stay on top of charges, payments, and outstanding balances.",
    icon: "↗",
  },
  {
    number: "05",
    title: "Housekeeping",
    description: "Coordinate turnovers and keep room status up to date.",
    icon: "✳",
  },
];

function App() {
  const [status, setStatus] = useState<HealthStatus>("checking");

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

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Local PMS home">
          <span className="brand-mark">L</span>
          <span>local<span className="brand-light">pms</span></span>
        </a>
        <div className="local-badge">
          <span className={`status-dot ${status}`} />
          {status === "checking" ? "Connecting" : status === "online" ? "Local system ready" : "API offline"}
        </div>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow"><span /> YOUR PROPERTY, IN GOOD ORDER</p>
          <h1>A calmer way to<br />run your <em>stay.</em></h1>
          <p className="hero-description">
            The essentials for keeping your property moving, all together and right here on your machine.
          </p>
          <a className="primary-link" href="#workspace">
            Explore your workspace <span aria-hidden="true">↘</span>
          </a>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="sun" />
          <div className="art-card">
            <div className="art-window"><span /><span /><span /></div>
            <div className="art-building">
              <div className="building-roof" />
              <div className="building-body">
                <i /><i /><i /><i /><i /><i />
              </div>
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
          <p className="section-aside">Everything you need to keep<br />a good stay running smoothly.</p>
        </div>
        <div className="area-grid">
          {areas.map((area) => (
            <article className="area-card" key={area.title}>
              <div className="card-top"><span className="area-icon">{area.icon}</span><span className="area-number">{area.number}</span></div>
              <h3>{area.title}</h3>
              <p>{area.description}</p>
              <span className="card-arrow" aria-hidden="true">↗</span>
            </article>
          ))}
        </div>
      </section>

      <footer><span>LOCAL PMS</span><span>Private by nature. Right on your machine.</span></footer>
    </main>
  );
}

export default App;
