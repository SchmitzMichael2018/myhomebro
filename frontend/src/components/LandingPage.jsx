import React from "react";
import {
  Lock,
  Zap,
  MessagesSquare,
  UsersRound,
  ShieldCheck,
  Handshake,
  Scale,
  Camera,
} from "lucide-react";

/**
 * LandingPage
 * - Two CTAs (Contractor Sign Up + Sign In)
 * - Framed hero logo + badges
 * - Bottom tile scroller
 * - Buttons trigger a global modal opener that we wire in LoginModal.jsx
 */
export default function LandingPage() {
  const openLogin = (mode = "login") => {
    let handled = false;
    try {
      if (typeof window.mhbOpenLogin === "function") {
        window.mhbOpenLogin(mode);
        handled = true;
      }
    } catch {}
    try {
      if (!handled) {
        window.dispatchEvent(new CustomEvent("mhb:open-login", { detail: { mode } }));
      }
    } catch {}
  };
  const openSignup = () => openLogin("signup");

  return (
    <div className="mhb-gradient-bg" style={{ minHeight: "100vh" }}>
      {/* Hero */}
      <div
        style={{
          maxWidth: 960,
          margin: "0 auto",
          padding: "32px 16px 36px",
          textAlign: "center",
          color: "#fff",
        }}
      >
        {/* Framed logo */}
        <div
          className="mhb-logo-frame"
          style={{ width: 220, height: 220, margin: "0 auto 18px" }}
        >
          <img
            src="/static/assets/myhomebro_logo.png"
            alt="MyHomeBro"
            style={{ maxWidth: 180, maxHeight: 180, display: "block" }}
          />
        </div>

        {/* Title */}
        <h1
          style={{
            margin: "8px 0 0",
            fontSize: 56,
            lineHeight: 1.05,
            fontWeight: 900,
            textShadow: "0 1px 2px rgba(0,0,0,.25)",
          }}
        >
          Welcome to
        </h1>
        <div
          style={{
            fontSize: 56,
            lineHeight: 1.05,
            fontWeight: 900,
            marginTop: 4,
            textShadow: "0 1px 2px rgba(0,0,0,.25)",
          }}
        >
          <span style={{ color: "#F2C94C" }}>MyHome</span>
          <span style={{ color: "#dbeafe" }}>Bro</span>
        </div>

        {/* Subheading */}
        <p style={{ marginTop: 12, fontSize: 18 }}>
          Secure Escrow Payments for Contractors and Homeowners.
        </p>
        <p style={{ marginTop: 4, fontSize: 14, opacity: 0.9 }}>
          The easiest way to pay and get paid for home projects.
        </p>

        {/* Feature bullets */}
        <div style={{ marginTop: 18, display: "grid", gap: 12, justifyItems: "center" }}>
          <Badge icon={Lock} text="Escrow-secured payments for true peace of mind." />
          <Badge icon={Zap} text="Quick contractor sign-up—get paid faster." />
          <Badge icon={MessagesSquare} text="Direct chat between homeowners and contractors." />
          <Badge icon={UsersRound} text="Bring your own clients, or get matched (coming soon)." />
        </div>

        {/* CTAs */}
        <div
          style={{
            marginTop: 22,
            display: "flex",
            gap: 12,
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          <button
            onClick={openSignup}
            className="mhb-btn primary"
            style={{ fontSize: 16, padding: "12px 18px" }}
          >
            Contractor Sign Up
          </button>
          <button
            onClick={() => openLogin("login")}
            className="mhb-btn"
            style={{ fontSize: 16, padding: "12px 18px" }}
          >
            Sign In
          </button>
        </div>
      </div>

      {/* Bottom tile scroller */}
      <section className="mhb-hscroll">
        <div className="mhb-hscroll-track">
          <Tile
            icon={ShieldCheck}
            title="Secure Escrow"
            text="Funds are held safely until milestones are approved—no more payment risk."
          />
          <Tile
            icon={Handshake}
            title="Bring Your Clients"
            text="Use MyHomeBro with your existing customers to keep payments organized."
          />
          <Tile
            icon={Scale}
            title="Dispute Resolution"
            text="Structured workflow with evidence, mediation, and third-party arbitration options."
          />
          <Tile
            icon={Camera}
            title="Photo Evidence"
            text="Attach progress photos to milestones—build a clear record for approvals."
          />
        </div>
      </section>
    </div>
  );
}

function Badge({ icon: Icon, text }) {
  return (
    <div
      className="mhb-glass"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 14px",
        borderRadius: 12,
        color: "var(--mhb-text-strong)",
        minWidth: 420,
        maxWidth: 640,
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          display: "grid",
          placeItems: "center",
          borderRadius: 10,
          background:
            "linear-gradient(135deg, rgba(255,255,255,.8), rgba(255,255,255,.25))",
          border: "1px solid rgba(255,255,255,.6)",
          color: "var(--mhb-text)",
        }}
      >
        <Icon size={16} />
      </div>
      <div style={{ fontWeight: 700 }}>{text}</div>
    </div>
  );
}

function Tile({ icon: Icon, title, text }) {
  return (
    <div className="mhb-tile">
      <div className="mhb-tile-icon">
        <Icon size={22} />
      </div>
      <div className="mhb-tile-title">{title}</div>
      <div className="mhb-tile-text">{text}</div>
    </div>
  );
}
