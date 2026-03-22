// src/components/LandingPage.jsx
import React from "react";
import { useNavigate } from "react-router-dom";
import {
  Lock,
  Zap,
  MessagesSquare,
  UsersRound,
  Handshake,
  Scale,
  Camera,
} from "lucide-react";
import logo from "../assets/myhomebro_logo.png";

/**
 * LandingPage
 * - Full-bleed gradient background (desktop + mobile)
 * - Centered hero rail (max 1280px)
 * - No horizontal scrollbar
 * - Responsive features grid
 * - Buttons trigger your existing login modal hooks
 */
export default function LandingPage() {
  const navigate = useNavigate();

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

  const openSignup = () => {
    if (typeof window.mhbOpenSignup === "function") {
      window.mhbOpenSignup();
    } else {
      window.dispatchEvent(new CustomEvent("mhb:open-signup"));
    }
  };

  return (
    <div style={S.root}>
      {/* Hero */}
      <div style={S.rail}>
        <div style={S.logoFrame}>
          <img src={logo} alt="MyHomeBro" style={S.logo} draggable={false} />
        </div>

        <h1 data-testid="landing-hero-heading" style={S.title}>
          AI-Powered Agreements. Secure Payments. Faster Payouts.
        </h1>
        <div style={S.brand}>
          <span style={S.brandMain}>MyHome</span>
          <span style={S.brandSub}>Bro</span>
        </div>

        <p style={S.subhead}>Create project scope, milestone pricing, and payment-ready agreements in one place.</p>
        <p style={S.subheadTiny}>No subscription required. Start for free.</p>

        <div style={S.badges}>
          <Badge icon={Zap} text="AI-powered pricing and milestone generation tailored to your project." />
          <Badge icon={Lock} text="Escrow-secured payments for peace of mind." />
          <Badge icon={MessagesSquare} text="Clear communication with secure updates." />
          <Badge
            icon={UsersRound}
            text="Bring your own clients — no marketplace required."
          />
        </div>

        <div style={S.ctas}>
          <button onClick={openSignup} style={{ ...S.btn, ...S.btnPrimary }} type="button">
            Contractor Sign Up
          </button>

          <button
            data-testid="landing-sign-in-button"
            onClick={() => openLogin("login")}
            style={S.btn}
            type="button"
          >
            Sign In
          </button>

          <button
            data-testid="landing-start-project-intake-button"
            onClick={() => navigate("/start-project")}
            style={S.btn}
            type="button"
          >
            Start Project Intake
          </button>
        </div>

        <div style={S.pricingWrap}>
          <div style={S.pricingPill}>
            <span style={S.pricingStrong}>Simple, transparent pricing</span>
            <span style={S.pricingValue}>Escrow: 3% + $1</span>
          </div>

          <div style={S.pricingNote}>
            Direct Pay: <b>2% + $1</b>. You only pay when you get paid. Intro rate for first 60 days. Volume discounts available.
          </div>
        </div>
      </div>

      {/* Features */}
      <section style={S.featuresWrap}>
        <div style={S.featuresGrid}>
          <Tile
            icon={Zap}
            title="AI Pricing & Milestones"
            text="Build your scope, pricing, and milestones in seconds with AI tailored to your project."
          />
          <Tile
            icon={Handshake}
            title="Bring Your Clients"
            text="Work with your existing customers and keep agreements, updates, and payments in one place."
          />
          <Tile
            icon={Scale}
            title="Dispute Resolution"
            text="Structured dispute resolution with evidence review, AI-guided recommendations, and escalation options."
          />
          <Tile
            icon={Camera}
            title="Photo Evidence"
            text="Attach progress photos to milestones — build a clear record for approvals."
          />
        </div>
      </section>

      <footer style={S.footer}>
        <span>&copy; {new Date().getFullYear()} MyHomeBro</span>

        <a href="/legal/terms-of-service/" target="_blank" rel="noreferrer" style={S.footerLink}>
          Terms of Service
        </a>

        <span style={{ margin: "0 6px" }}>&middot;</span>

        <a href="/legal/privacy-policy/" target="_blank" rel="noreferrer" style={S.footerLink}>
          Privacy Policy
        </a>
      </footer>
    </div>
  );
}

/* ---------------- helpers ---------------- */

function Badge({ icon: Icon, text }) {
  return (
    <div style={S.badge}>
      <div style={S.badgeIcon}>
        <Icon size={16} />
      </div>
      <div style={S.badgeText}>{text}</div>
    </div>
  );
}

function Tile({ icon: Icon, title, text }) {
  return (
    <div style={S.tile}>
      <div style={S.tileIcon}>
        <Icon size={22} />
      </div>
      <div style={S.tileTitle}>{title}</div>
      <div style={S.tileText}>{text}</div>
    </div>
  );
}

/* ---------------- styles ---------------- */

const S = {
  root: {
    minHeight: "100vh",
    background:
      "linear-gradient(135deg, #0d47ff 0%, #2d5bff 35%, #6b86ff 60%, #e0c166 100%) fixed",
    overflowX: "hidden",
    WebkitFontSmoothing: "antialiased",
    MozOsxFontSmoothing: "grayscale",
    display: "flex",
    flexDirection: "column",
  },
  rail: {
    maxWidth: 1280,
    margin: "0 auto",
    padding: "48px 16px 36px",
    textAlign: "center",
    color: "#fff",
  },
  logoFrame: {
    width: 220,
    height: 220,
    margin: "0 auto 18px",
    borderRadius: 20,
    display: "grid",
    placeItems: "center",
    boxShadow: "0 10px 28px rgba(0,0,0,.28)",
    background: "rgba(15,23,42,.25)",
    border: "2px solid rgba(255,255,255,.4)",
  },
  logo: { width: 180, height: 180, objectFit: "cover", borderRadius: 16 },
  title: {
    margin: "8px 0 0",
    fontSize: clamp(34, 56),
    lineHeight: 1.05,
    fontWeight: 900,
    textShadow: "0 1px 2px rgba(0,0,0,.25)",
  },
  brand: {
    fontSize: clamp(34, 56),
    lineHeight: 1.05,
    fontWeight: 900,
    marginTop: 4,
    textShadow: "0 1px 2px rgba(0,0,0,.25)",
  },
  brandMain: { color: "#F2C94C" },
  brandSub: { color: "#dbeafe" },
  subhead: { marginTop: 12, fontSize: 18, opacity: 0.95 },
  subheadTiny: { marginTop: 4, fontSize: 14, opacity: 0.88 },

  pricingWrap: {
    marginTop: 14,
    display: "grid",
    gap: 8,
    justifyItems: "center",
  },
  pricingPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
    borderRadius: 999,
    background: "rgba(255,255,255,.94)",
    color: "#0f172a",
    boxShadow: "0 6px 18px rgba(0,0,0,.12)",
    fontWeight: 800,
    maxWidth: 760,
  },
  pricingStrong: {
    opacity: 0.9,
  },
  pricingValue: {
    padding: "4px 10px",
    borderRadius: 999,
    background: "linear-gradient(135deg, #0d47ff 0%, #6b86ff 60%)",
    color: "#fff",
    fontWeight: 900,
    letterSpacing: 0.2,
  },
  pricingNote: {
    fontSize: 13,
    opacity: 0.92,
    textShadow: "0 1px 2px rgba(0,0,0,.18)",
    maxWidth: 760,
    lineHeight: 1.35,
  },

  badges: {
    marginTop: 18,
    display: "grid",
    gap: 12,
    justifyItems: "center",
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
    borderRadius: 12,
    width: "100%",
    maxWidth: 760,
    background: "rgba(255,255,255,.92)",
    color: "#0f172a",
    boxShadow: "0 6px 18px rgba(0,0,0,.12)",
    fontWeight: 700,
  },
  badgeIcon: {
    width: 28,
    height: 28,
    display: "grid",
    placeItems: "center",
    borderRadius: 10,
    background: "linear-gradient(135deg, rgba(255,255,255,.8), rgba(255,255,255,.25))",
    border: "1px solid rgba(255,255,255,.6)",
    color: "#0f172a",
  },
  badgeText: { textAlign: "left" },

  ctas: {
    marginTop: 22,
    display: "flex",
    gap: 12,
    justifyContent: "center",
    flexWrap: "wrap",
  },
  btn: {
    padding: "12px 18px",
    borderRadius: 12,
    border: "1px solid #e5e7eb",
    background: "#ffffff",
    color: "#0f172a",
    fontWeight: 800,
    minHeight: 44,
    boxShadow: "0 8px 22px rgba(0,0,0,.16)",
    cursor: "pointer",
  },
  btnPrimary: {
    background: "linear-gradient(135deg, #0d47ff 0%, #6b86ff 60%)",
    borderColor: "transparent",
    color: "#fff",
  },

  featuresWrap: {
    width: "100%",
    padding: "0 16px 56px",
    flex: "1 0 auto",
  },
  featuresGrid: {
    maxWidth: 1280,
    margin: "36px auto 0",
    display: "grid",
    gap: 16,
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  },

  tile: {
    background: "rgba(255,255,255,.94)",
    borderRadius: 18,
    boxShadow: "0 10px 24px rgba(0,0,0,.12)",
    padding: 18,
    minHeight: 120,
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    gridTemplateAreas: `"icon title" "icon text"`,
    columnGap: 12,
    rowGap: 8,
    alignItems: "start",
  },
  tileIcon: {
    gridArea: "icon",
    display: "grid",
    placeItems: "center",
    width: 36,
    height: 36,
    borderRadius: 10,
    background: "#0d47ff",
    color: "#fff",
  },
  tileTitle: { gridArea: "title", fontSize: 20, fontWeight: 800 },
  tileText: { gridArea: "text", color: "#0f172a", opacity: 0.85 },

  footer: {
    marginTop: "40px",
    padding: "16px 0",
    borderTop: "1px solid rgba(255,255,255,0.45)",
    textAlign: "center",
    color: "rgba(255,255,255,0.85)",
    fontSize: "13px",
  },
  footerLink: {
    color: "#dbeafe",
    textDecoration: "underline",
    marginLeft: "8px",
    marginRight: "8px",
  },
};

function clamp(minPx, maxPx) {
  return `clamp(${minPx}px, 4vw, ${maxPx}px)`;
}
