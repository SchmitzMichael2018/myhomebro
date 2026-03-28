import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api from "../api";
import { useWhoAmI } from "../hooks/useWhoAmI";

const ADMIN_BASE = "/api/projects/admin";

/* =========================
   Number formatting (commas)
========================= */
const moneyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const numberFmt = new Intl.NumberFormat("en-US");

function toFloat(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function fmtMoney(v) {
  return moneyFmt.format(toFloat(v));
}

function fmtNumber(v) {
  const n = typeof v === "number" ? v : parseInt(String(v).replace(/,/g, ""), 10);
  return Number.isFinite(n) ? numberFmt.format(n) : "0";
}

function fmtDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function titleCase(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function tonePill(tone) {
  if (tone === "good") return "bg-emerald-100 text-emerald-800 border-emerald-200";
  if (tone === "warn") return "bg-amber-100 text-amber-900 border-amber-200";
  if (tone === "bad") return "bg-rose-100 text-rose-800 border-rose-200";
  return "bg-slate-100 text-slate-700 border-slate-200";
}

/* =========================
   URL Helpers (persist filters)
========================= */
function getParams(search) {
  return new URLSearchParams(search || "");
}

function getView(search) {
  const params = getParams(search);
  return (params.get("view") || "overview").toLowerCase();
}

function getQ(search) {
  const params = getParams(search);
  return (params.get("q") || "").toString();
}

function setParam(navigate, location, key, value) {
  const params = getParams(location.search);
  if (value === null || value === undefined || value === "") params.delete(key);
  else params.set(key, String(value));
  navigate(`${location.pathname}?${params.toString()}`, { replace: true });
}

function setParams(navigate, location, patch, replace = false) {
  const params = getParams(location.search);
  Object.entries(patch).forEach(([k, v]) => {
    if (v === null || v === undefined || v === "") params.delete(k);
    else params.set(k, String(v));
  });
  navigate(`${location.pathname}?${params.toString()}`, { replace });
}

/* =========================
   Formatting Helpers
========================= */
function pct(n) {
  if (typeof n !== "number" || Number.isNaN(n)) return "0%";
  return `${Math.round(n * 100)}%`;
}

function statusLabel(status) {
  if (status === "on_track") return "On Track";
  if (status === "at_risk") return "At Risk";
  return "Off Track";
}

function statusPill(status) {
  if (status === "on_track") return "bg-emerald-600 text-white";
  if (status === "at_risk") return "bg-amber-500 text-white";
  return "bg-rose-600 text-white";
}

function softTone(status) {
  if (status === "on_track") return "bg-emerald-50 border-emerald-200";
  if (status === "at_risk") return "bg-amber-50 border-amber-200";
  return "bg-rose-50 border-rose-200";
}

/* =========================
   UI Components
========================= */
const SectionTitle = ({ title, subtitle }) => (
  <div className="mb-3">
    <div className="text-sm font-extrabold text-slate-900">{title}</div>
    {subtitle ? <div className="mt-0.5 text-xs text-slate-700">{subtitle}</div> : null}
  </div>
);

const SoftCard = ({ children, className = "" }) => (
  <div className={["rounded-2xl border border-black/10 bg-white/70 shadow-sm", "backdrop-blur-md", className].join(" ")}>
    {children}
  </div>
);

const BorderedSection = ({ title, subtitle, children, testId }) => (
  <div data-testid={testId} className="rounded-2xl border border-white/25 bg-white/10 p-4 shadow-sm">
    <SectionTitle title={title} subtitle={subtitle} />
    {children}
  </div>
);

const StatCard = ({ label, value, sub, tone = "neutral", onClick, testId }) => {
  const toneClass =
    tone === "good"
      ? "bg-emerald-50 border-emerald-200"
      : tone === "warn"
        ? "bg-amber-50 border-amber-200"
        : tone === "bad"
          ? "bg-rose-50 border-rose-200"
          : "bg-white/70 border-black/10";

  const clickable = typeof onClick === "function";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      data-testid={testId}
      className={[
        "text-left rounded-2xl border p-4 shadow-sm backdrop-blur-md transition",
        toneClass,
        clickable ? "hover:bg-white/80 cursor-pointer" : "cursor-default",
      ].join(" ")}
      title={clickable ? "Click to drill down" : undefined}
    >
      <div className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-3xl font-extrabold text-slate-900">{value}</div>
      {sub ? <div className="mt-1 text-xs text-slate-600">{sub}</div> : null}
    </button>
  );
};

const ThinStat = ({ label, value, sub, onClick, testId }) => {
  const clickable = typeof onClick === "function";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      data-testid={testId}
      className={[
        "text-left rounded-xl border border-black/10 bg-white/70 p-3 shadow-sm transition",
        clickable ? "hover:bg-white cursor-pointer" : "cursor-default",
      ].join(" ")}
      title={clickable ? "Click to drill down" : undefined}
    >
      <div className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-extrabold text-slate-900">{value}</div>
      {sub ? <div className="mt-0.5 text-[11px] text-slate-600">{sub}</div> : null}
    </button>
  );
};

const TableShell = ({ children }) => (
  <div className="overflow-x-auto rounded-2xl border border-black/10 bg-white/70 shadow-sm">
    {children}
  </div>
);

const Th = ({ children }) => (
  <th className="px-3 py-3 text-left text-xs font-extrabold uppercase tracking-wide text-slate-600">{children}</th>
);

const Td = ({ children, className = "", colSpan }) => (
  <td colSpan={colSpan} className={`px-3 py-3 align-top text-slate-800 ${className}`}>
    {children}
  </td>
);

const ActionItem = ({ icon, title, desc, onClick, tone = "neutral" }) => {
  const toneClass =
    tone === "bad"
      ? "border-rose-200 bg-rose-50"
      : tone === "warn"
        ? "border-amber-200 bg-amber-50"
        : "border-black/10 bg-white/70";

  return (
    <button
      onClick={onClick}
      className={["w-full text-left rounded-xl border p-3 shadow-sm", "hover:bg-white transition", toneClass].join(" ")}
    >
      <div className="flex items-start gap-2">
        <div className="text-base">{icon}</div>
        <div className="min-w-0">
          <div className="text-sm font-extrabold text-slate-900 truncate">{title}</div>
          {desc ? <div className="mt-0.5 text-xs text-slate-600">{desc}</div> : null}
        </div>
      </div>
    </button>
  );
};

/* =========================
   Component
========================= */
export default function AdminDashboard() {
  const location = useLocation();
  const navigate = useNavigate();
  const view = getView(location.search);

  const { data: whoami, loading: whoamiLoading } = useWhoAmI();
  const role = whoami?.type || whoami?.role || whoami?.user_type || "";
  const isAdmin = ["admin", "platform_admin"].includes(String(role).toLowerCase());

  const [loading, setLoading] = useState(true);

  const [overview, setOverview] = useState(null);
  const [goals, setGoals] = useState(null);

  const [contractors, setContractors] = useState([]);
  const [subcontractors, setSubcontractors] = useState([]);
  const [homeowners, setHomeowners] = useState([]);
  const [agreements, setAgreements] = useState([]);
  const [disputes, setDisputes] = useState([]);

  // Geo
  const [geo, setGeo] = useState(null);
  const [geoState, setGeoState] = useState("");

  // Fee audit
  const [feeAudit, setFeeAudit] = useState(null);
  const [feeMismatchOnly, setFeeMismatchOnly] = useState(false);

  // Persisted q for agreements
  const qFromUrl = getQ(location.search);
  const [agreementQuery, setAgreementQuery] = useState(qFromUrl || "");

  // Contractor query (optional persistence later)
  const [contractorQuery, setContractorQuery] = useState("");
  const [contractorFilter, setContractorFilter] = useState("newest");

  // Support tools
  const [pwResetEmail, setPwResetEmail] = useState("");
  const [pwResetMsg, setPwResetMsg] = useState("");
  const [agreementOpsMsg, setAgreementOpsMsg] = useState("");
  const [agreementAiContext, setAgreementAiContext] = useState(null);
  const [agreementOpBusy, setAgreementOpBusy] = useState("");

  useEffect(() => {
    if (view === "agreements") {
      const urlQ = getQ(location.search);
      setAgreementQuery(urlQ || "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search, view]);

  function goTo(viewName) {
    setParams(navigate, location, { view: viewName }, false);
  }

  function goToAgreementsWithQ(q) {
    setParams(navigate, location, { view: "agreements", q: q || "" }, false);
  }

  async function loadCore() {
    const [o, g, c, s, h, a, d] = await Promise.all([
      api.get(`${ADMIN_BASE}/overview/`),
      api.get(`${ADMIN_BASE}/goals/`),
      api.get(`${ADMIN_BASE}/contractors/`),
      api.get(`${ADMIN_BASE}/subcontractors/`),
      api.get(`${ADMIN_BASE}/homeowners/`),
      api.get(`${ADMIN_BASE}/agreements/`),
      api.get(`${ADMIN_BASE}/disputes/`),
    ]);

    setOverview(o.data);
    setGoals(g.data);
    setContractors(c.data?.results || []);
    setSubcontractors(s.data?.results || []);
    setHomeowners(h.data?.results || []);
    setAgreements(a.data?.results || []);
    setDisputes(d.data?.results || []);
  }

  async function loadGeo() {
    const res = await api.get(`${ADMIN_BASE}/geo/`);
    setGeo(res.data);
    if (!geoState) {
      const top = (res.data?.states || [])[0];
      if (top?.state) setGeoState(top.state);
    }
  }

  async function loadFeeAudit() {
    const params = new URLSearchParams();
    params.set("limit", "500");
    if (feeMismatchOnly) params.set("mismatch_only", "true");
    const res = await api.get(`${ADMIN_BASE}/fees/ledger/?${params.toString()}`);
    setFeeAudit(res.data);
  }

  async function loadAll() {
    setLoading(true);
    setPwResetMsg("");
    try {
      await loadCore();
      if (view === "geo") await loadGeo();
      if (view === "fee_audit") await loadFeeAudit();
    } catch (err) {
      console.error("Admin load error:", err);
      alert("Admin data failed to load. Check console + API permissions.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!whoamiLoading && isAdmin) loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whoamiLoading, isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    if (loading) return;
    if (view === "geo") loadGeo();
    if (view === "fee_audit") loadFeeAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useEffect(() => {
    if (!isAdmin) return;
    if (view !== "fee_audit") return;
    if (loading) return;
    loadFeeAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feeMismatchOnly]);

  function goToAgreementFinalize(agreementId) {
    navigate(`/app/agreements/${agreementId}/wizard?step=4`);
  }

  function goToAgreementPricing(agreementId) {
    navigate(`/app/agreements/${agreementId}/wizard?step=2`);
  }

  async function viewAgreementAiContext(agreementId) {
    setAgreementOpsMsg("");
    try {
      const res = await api.get(`${ADMIN_BASE}/agreements/${agreementId}/ai-context/`);
      setAgreementAiContext(res.data);
    } catch (err) {
      console.error("Admin AI context error:", err);
      setAgreementAiContext(null);
      setAgreementOpsMsg("Failed to load AI context for this agreement.");
    }
  }

  async function refreshAgreementPricing(agreementId) {
    setAgreementOpsMsg("");
    setAgreementOpBusy(`pricing-${agreementId}`);
    try {
      const res = await api.post(`${ADMIN_BASE}/agreements/${agreementId}/refresh-pricing/`);
      setAgreementOpsMsg(res.data?.detail || "Pricing guidance refreshed.");
    } catch (err) {
      console.error("Admin pricing refresh error:", err);
      setAgreementOpsMsg("Failed to refresh pricing guidance.");
    } finally {
      setAgreementOpBusy("");
    }
  }

  async function resendAgreementSignature(agreementId) {
    setAgreementOpsMsg("");
    setAgreementOpBusy(`signature-${agreementId}`);
    try {
      const res = await api.post(`${ADMIN_BASE}/agreements/${agreementId}/resend-signature/`);
      setAgreementOpsMsg(res.data?.detail || "Signature invite resent.");
    } catch (err) {
      console.error("Admin resend signature error:", err);
      setAgreementOpsMsg(
        err?.response?.data?.detail || "Failed to resend the agreement signature invite."
      );
    } finally {
      setAgreementOpBusy("");
    }
  }

  async function triggerPasswordReset() {
    setPwResetMsg("");
    const email = pwResetEmail.trim();
    if (!email) return;
    try {
      await api.post(`${ADMIN_BASE}/users/password-reset/`, { email });
      setPwResetMsg("✅ Password reset email sent.");
    } catch (err) {
      console.error("Password reset error:", err);
      setPwResetMsg("❌ Failed to send reset email.");
    }
  }

  /* =========================
     Derived values
  ========================= */
  const moneyBlock = overview?.money || {};
  const counts = overview?.counts || {};
  const summary = overview?.summary || {};
  const feeTrend = overview?.fee_trend || [];
  const feeByContractor = overview?.fee_by_contractor || [];
  const feeByPaymentMode = overview?.fee_by_payment_mode || [];
  const topCategories = overview?.top_categories || [];
  const topRegions = overview?.top_regions || [];
  const insights = overview?.insights || [];

  const tracker = goals?.salary_tracker || {};
  const goal = goals?.goal || {};
  const derived = goals?.derived || {};

  const status = tracker.status || "off_track";
  const paceRatio = tracker.pace_ratio ?? 0;

  const disputeCount = counts.disputes || 0;
  const inFlight = toFloat(moneyBlock.escrow_in_flight_total || 0);
  const refunded = toFloat(moneyBlock.escrow_refunded_total || 0);
  const feesTotal = toFloat(moneyBlock.platform_fee_total || 0);
  const escrowFunded = toFloat(moneyBlock.escrow_funded_total || 0);

  // Attention feed
  const attentionItems = [];
  if (status === "off_track") {
    attentionItems.push({
      icon: "🔴",
      title: "Off-track on salary pace",
      desc: `Projection is ${fmtMoney(tracker.projection_annual || 0)} vs goal ${fmtMoney(goal.target || 0)}.`,
      tone: "bad",
      onClick: () => goTo("goals"),
    });
  } else if (status === "at_risk") {
    attentionItems.push({
      icon: "🟠",
      title: "At-risk on salary pace",
      desc: `Pace ${pct(paceRatio)} — increase funded work velocity.`,
      tone: "warn",
      onClick: () => goTo("goals"),
    });
  }

  if (disputeCount > 0) {
    attentionItems.push({
      icon: "⚠️",
      title: `${disputeCount} dispute(s) need attention`,
      desc: "Review disputes to reduce refund risk and payout delays.",
      tone: "warn",
      onClick: () => goTo("disputes"),
    });
  }

  if (refunded > 0) {
    attentionItems.push({
      icon: "↩️",
      title: "Refund activity detected",
      desc: `${fmtMoney(moneyBlock.escrow_refunded_total || 0)} refunded — review causes.`,
      tone: "warn",
      onClick: () => goTo("fee_audit"),
    });
  }

  if (inFlight > 0) {
    attentionItems.push({
      icon: "⏳",
      title: "Escrow in flight",
      desc: `${fmtMoney(moneyBlock.escrow_in_flight_total || 0)} currently in flight.`,
      tone: "neutral",
      onClick: () => goToAgreementsWithQ("in flight"),
    });
  }

  attentionItems.push({
    icon: "🧾",
    title: "Run fee audit check",
    desc: "Spot fee mismatches and cap anomalies quickly.",
    tone: "neutral",
    onClick: () => goTo("fee_audit"),
  });

  // Filters
  const contractorFiltered = (() => {
    const q = contractorQuery.trim().toLowerCase();
    let next = contractors.filter((c) => {
      const blob = [
        c.id,
        c.name,
        c.business_name,
        c.email,
        c.phone,
        c.city,
        c.state,
        c.zip,
        c.stripe_account_id,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
    if (contractorFilter === "inactive") {
      next = next.filter((c) => ["not_onboarded", "pending_stripe", "deauthorized"].includes(c.account_status));
    }
    if (contractorFilter === "top_fee") {
      next = [...next].sort((a, b) => toFloat(b.fee_revenue) - toFloat(a.fee_revenue));
    } else if (contractorFilter === "missing_profile") {
      next = next.filter((c) => c.public_profile_status !== "public");
    } else {
      next = [...next].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    }
    return next;
  })();

  const homeownerRows = homeowners;
  const subcontractorRows = subcontractors;

  const agreementsFiltered = (() => {
    const q = (agreementQuery || "").trim().toLowerCase();
    if (!q) return agreements;
    return agreements.filter((a) => {
      const blob = [
        a.id,
        a.project_title,
        a.project_city,
        a.project_state,
        a.project_zip,
        a.total_cost,
        a.escrow_funded ? "funded" : "not funded",
        a.escrow_funded_amount,
        a.escrow_released_amount,
        a.escrow_refunded_amount,
        a.escrow_in_flight_amount,
        a.pdf_version,
        a.is_archived ? "archived" : "",
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  })();

  // Geo derived
  const selectedStateRow = (() => {
    if (!geoState) return null;
    return (geo?.states || []).find((s) => s.state === geoState) || null;
  })();

  const selectedCities = geo?.cities_by_state?.[geoState] || [];
  const selectedZips = geo?.zips_by_state?.[geoState] || [];

  /* =========================
     Guards
  ========================= */
  if (whoamiLoading) return <div className="p-6 text-slate-700">Checking admin access…</div>;

  if (!isAdmin) {
    return (
      <div className="p-6">
        <SoftCard className="p-5">
          <div className="text-lg font-extrabold text-slate-900">Admin Only</div>
          <div className="mt-1 text-sm text-slate-600">
            You do not have admin permissions for this page.
          </div>
        </SoftCard>
      </div>
    );
  }

  /* =========================
     Render
  ========================= */
  return (
    <div className="mx-auto max-w-7xl p-6">
      <div className="flex flex-wrap items-baseline gap-3">
        <div className="text-2xl font-extrabold text-slate-900">Admin</div>
        <div className="text-sm text-slate-700 capitalize">{view}</div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={loadAll}
            className="rounded-xl border border-black/10 bg-white px-4 py-2 text-sm font-extrabold text-slate-900 hover:bg-slate-50"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {[
          ["overview", "Overview"],
          ["contractors", "Contractors"],
          ["subcontractors", "Subcontractors"],
          ["homeowners", "Customers"],
          ["agreements", "Agreements"],
          ["disputes", "Disputes"],
          ["geo", "Geo"],
          ["fee_audit", "Fee Audit"],
          ["support", "Support"],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => goTo(key)}
            className={[
              "rounded-full border px-3 py-1.5 text-xs font-extrabold transition",
              view === key
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-black/10 bg-white/70 text-slate-700 hover:bg-white",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <SoftCard className="mt-6 p-5">
          <div className="text-slate-700">Loading admin data…</div>
        </SoftCard>
      ) : (
        <>
          {/* ===================== OVERVIEW ===================== */}
          {view === "overview" && (
            <div className="mt-6 space-y-5">
              <BorderedSection
                title="Platform Overview"
                subtitle="Growth, operations, disputes, customers, and platform revenue in one place."
                testId="admin-overview-cards"
              >
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
                  <StatCard testId="admin-stat-contractors" label="Contractors" value={fmtNumber(counts.contractors || 0)} sub={`${fmtNumber(summary.new_contractors_this_month || 0)} new this month`} onClick={() => goTo("contractors")} />
                  <StatCard testId="admin-stat-subcontractors" label="Subcontractors" value={fmtNumber(counts.subcontractors || 0)} sub="Invited + accepted" onClick={() => goTo("subcontractors")} />
                  <StatCard testId="admin-stat-customers" label="Customers" value={fmtNumber(counts.homeowners || 0)} sub="Captured homeowners" onClick={() => goTo("homeowners")} />
                  <StatCard testId="admin-stat-active-agreements" label="Active Agreements" value={fmtNumber(summary.active_agreements || 0)} sub={`${fmtNumber(summary.agreements_this_month || 0)} created this month`} onClick={() => goTo("agreements")} />
                  <StatCard testId="admin-stat-open-disputes" label="Open Disputes" value={fmtNumber(summary.open_disputes || 0)} sub="Operator queue" tone={Number(summary.open_disputes || 0) > 0 ? "warn" : "good"} onClick={() => goTo("disputes")} />
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
                  <ThinStat testId="admin-thin-total-fees" label="Total Fees" value={fmtMoney(moneyBlock.platform_fee_total || 0)} sub="All time" onClick={() => goTo("fee_audit")} />
                  <ThinStat testId="admin-thin-fees-this-month" label="Fees This Month" value={fmtMoney(moneyBlock.platform_fee_this_month || 0)} sub="Current month" onClick={() => goTo("fee_audit")} />
                  <ThinStat testId="admin-thin-gross-paid" label="Gross Paid" value={fmtMoney(moneyBlock.gross_paid_revenue || 0)} sub="Stripe-confirmed" onClick={() => goTo("fee_audit")} />
                  <ThinStat testId="admin-thin-leads-this-month" label="Leads This Month" value={fmtNumber(summary.leads_this_month || 0)} sub="Unified intake volume" onClick={() => goTo("contractors")} />
                  <ThinStat testId="admin-thin-new-this-week" label="New This Week" value={fmtNumber(summary.new_contractors_this_week || 0)} sub="Contractor signups" onClick={() => goTo("contractors")} />
                </div>
              </BorderedSection>

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              <div className="lg:col-span-2 space-y-5">
                <BorderedSection
                  title="Business Health"
                  subtitle="The three numbers that tell you if MyHomeBro is winning this month."
                >
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div className="md:col-span-2">
                      <button
                        type="button"
                        onClick={() => goTo("goals")}
                        className={`w-full text-left rounded-2xl border p-4 shadow-sm backdrop-blur-md transition hover:bg-white/80 ${softTone(status)}`}
                        title="Click to drill into Goals"
                      >
                        <div className="text-[11px] font-extrabold uppercase tracking-wide text-slate-600">
                          Owner Salary Progress (Rolling 12 Months)
                        </div>

                        <div className="mt-2 text-4xl font-extrabold text-slate-900">
                          {fmtMoney(tracker.platform_fees_l12m || 0)}
                          <span className="text-slate-400 text-2xl font-extrabold">
                            {" "}
                            / {fmtMoney(goal.target || 0)}
                          </span>
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className={`inline-flex rounded-full px-3 py-1 text-[11px] font-extrabold ${statusPill(status)}`}>
                            {statusLabel(status)} • Pace {pct(paceRatio)}
                          </span>
                          <span className="text-xs text-slate-700">
                            Projection: <b>{fmtMoney(tracker.projection_annual || 0)}</b>
                          </span>
                        </div>
                      </button>
                    </div>

                    <StatCard
                      label="Escrow Funded"
                      value={fmtMoney(moneyBlock.escrow_funded_total || 0)}
                      sub="Pipeline (funded work)"
                      tone={escrowFunded > 0 ? "neutral" : "warn"}
                      onClick={() => goToAgreementsWithQ("funded")}
                    />
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                    <StatCard label="Contractors" value={fmtNumber(counts.contractors || 0)} sub="Total profiles" onClick={() => goTo("contractors")} />
                    <StatCard label="Customers" value={fmtNumber(counts.homeowners || 0)} sub="Captured" onClick={() => goTo("homeowners")} />
                    <StatCard label="Disputes" value={fmtNumber(counts.disputes || 0)} sub="Risk queue" tone={disputeCount > 0 ? "warn" : "good"} onClick={() => goTo("disputes")} />
                  </div>
                </BorderedSection>

                <BorderedSection
                  title="Money Flow"
                  subtitle="Click any tile to drill into the most relevant view."
                >
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
                    <ThinStat label="Gross Paid" value={fmtMoney(moneyBlock.gross_paid_revenue || 0)} sub="Stripe-confirmed" onClick={() => goTo("fee_audit")} />
                    <ThinStat label="Platform Fees" value={fmtMoney(moneyBlock.platform_fee_total || 0)} sub="Your income" onClick={() => goTo("goals")} />
                    <ThinStat label="Escrow Funded" value={fmtMoney(moneyBlock.escrow_funded_total || 0)} sub="Pipeline" onClick={() => goToAgreementsWithQ("funded")} />
                    <ThinStat label="Escrow Released" value={fmtMoney(moneyBlock.escrow_released_total || 0)} sub="Paid out" onClick={() => goToAgreementsWithQ("released")} />
                    <ThinStat label="In Flight" value={fmtMoney(moneyBlock.escrow_in_flight_total || 0)} sub="Potential stuck" onClick={() => goToAgreementsWithQ("in flight")} />
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                    <StatCard label="Escrow Refunded" value={fmtMoney(moneyBlock.escrow_refunded_total || 0)} sub="Money returned" tone={refunded > 0 ? "warn" : "neutral"} onClick={() => goToAgreementsWithQ("refunded")} />
                    <StatCard label="Receipts" value={fmtNumber(counts.receipts || 0)} sub="Confirmed payments" onClick={() => goTo("fee_audit")} />
                    <StatCard label="Agreements" value={fmtNumber(counts.agreements || 0)} sub="Total agreements" onClick={() => goTo("agreements")} />
                  </div>
                </BorderedSection>

                <BorderedSection
                  title="Growth Insights"
                  subtitle="Rules-first signals that surface activation gaps, conversion misses, and operational risk."
                  testId="admin-growth-insights"
                >
                  <div className="space-y-2">
                    {insights.length === 0 ? (
                      <div className="text-sm text-slate-700">No major platform issues surfaced in this refresh.</div>
                    ) : (
                      insights.map((item, idx) => (
                        <button
                          key={`${item.title}-${idx}`}
                          type="button"
                          onClick={() => goTo(item.view || "overview")}
                          className="w-full rounded-2xl border border-black/10 bg-white/70 p-4 text-left shadow-sm hover:bg-white"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full border px-2 py-1 text-[11px] font-extrabold ${tonePill(item.tone)}`}>
                              {titleCase(item.tone || "note")}
                            </span>
                            <span className="text-sm font-extrabold text-slate-900">{item.title}</span>
                          </div>
                          <div className="mt-2 text-sm text-slate-700">{item.detail}</div>
                        </button>
                      ))
                    )}
                  </div>
                </BorderedSection>

                <BorderedSection
                  title="Revenue Signals"
                  subtitle="Fee trend, payment mix, and the categories driving platform revenue."
                  testId="admin-revenue-summary"
                >
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <TableShell>
                      <table className="min-w-full text-sm">
                        <thead className="border-b border-black/10 bg-white/60">
                          <tr><Th>Month</Th><Th>Fees</Th><Th>Gross Paid</Th></tr>
                        </thead>
                        <tbody>
                          {feeTrend.length === 0 ? (
                            <tr><Td colSpan={3} className="text-slate-600">No fee trend data yet.</Td></tr>
                          ) : (
                            feeTrend.map((row) => (
                              <tr key={row.label} className="border-b border-black/5">
                                <Td className="font-extrabold">{row.label}</Td>
                                <Td>{fmtMoney(row.platform_fee || 0)}</Td>
                                <Td>{fmtMoney(row.gross_paid || 0)}</Td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </TableShell>

                    <div className="space-y-4">
                      <TableShell>
                        <table className="min-w-full text-sm">
                          <thead className="border-b border-black/10 bg-white/60">
                            <tr><Th>Payment Type</Th><Th>Fees</Th></tr>
                          </thead>
                          <tbody>
                            {feeByPaymentMode.length === 0 ? (
                              <tr><Td colSpan={2} className="text-slate-600">No payment mix data yet.</Td></tr>
                            ) : (
                              feeByPaymentMode.map((row) => (
                                <tr key={row.payment_mode} className="border-b border-black/5">
                                  <Td className="font-extrabold">{titleCase(row.payment_mode)}</Td>
                                  <Td>{fmtMoney(row.platform_fee || 0)}</Td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </TableShell>

                      <TableShell>
                        <table className="min-w-full text-sm">
                          <thead className="border-b border-black/10 bg-white/60">
                            <tr><Th>Category</Th><Th>Fees</Th></tr>
                          </thead>
                          <tbody>
                            {topCategories.length === 0 ? (
                              <tr><Td colSpan={2} className="text-slate-600">No category revenue data yet.</Td></tr>
                            ) : (
                              topCategories.map((row) => (
                                <tr key={row.category} className="border-b border-black/5">
                                  <Td className="font-extrabold">{row.category}</Td>
                                  <Td>{fmtMoney(row.platform_fee || 0)}</Td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </TableShell>
                    </div>
                  </div>
                </BorderedSection>
              </div>

              <div className="space-y-4">
                <SoftCard className="p-4">
                  <SectionTitle title="Top Fee Generators" subtitle="Contractors generating the most platform fee revenue." />
                  <div className="space-y-2">
                    {feeByContractor.length === 0 ? (
                      <div className="text-sm text-slate-700">No contractor fee history yet.</div>
                    ) : (
                      feeByContractor.map((row) => (
                        <button
                          key={row.contractor_id}
                          type="button"
                          onClick={() => goTo("contractors")}
                          className="w-full rounded-xl border border-black/10 bg-white/80 p-3 text-left hover:bg-white"
                        >
                          <div className="text-sm font-extrabold text-slate-900">{row.contractor_name}</div>
                          <div className="mt-1 text-xs text-slate-600">
                            {fmtMoney(row.platform_fee || 0)} in fees • {fmtNumber(row.lead_count || 0)} leads • {fmtNumber(row.agreement_count || 0)} agreements
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </SoftCard>

                <SoftCard className="p-4">
                  <SectionTitle title="Needs Attention" subtitle="Click an item to jump to the fix." />
                  <div className="space-y-2">
                    {attentionItems.length === 0 ? (
                      <div className="text-sm text-slate-700">Nothing urgent right now.</div>
                    ) : (
                      attentionItems.slice(0, 5).map((it, idx) => (
                        <ActionItem key={idx} icon={it.icon} title={it.title} desc={it.desc} tone={it.tone} onClick={it.onClick} />
                      ))
                    )}
                  </div>
                </SoftCard>

                <SoftCard className="p-4">
                  <SectionTitle title="Shortcuts" subtitle="Quick jumps." />
                  <div className="grid grid-cols-1 gap-2">
                    <ActionItem icon="📄" title="Agreements" desc="View + drill into Step 4 finalize." onClick={() => goTo("agreements")} />
                    <ActionItem icon="🗺️" title="Geo / Map" desc="State → city → ZIP view." onClick={() => goTo("geo")} />
                    <ActionItem icon="🧾" title="Fee Audit" desc="Ledger + mismatch filter." onClick={() => goTo("fee_audit")} />
                  </div>
                </SoftCard>

                <SoftCard className="p-4">
                  <SectionTitle title="Top Regions" subtitle="Where fee revenue is strongest right now." />
                  <div className="space-y-2">
                    {topRegions.length === 0 ? (
                      <div className="text-sm text-slate-700">No regional fee data yet.</div>
                    ) : (
                      topRegions.map((row) => (
                        <div key={row.region} className="rounded-xl border border-black/10 bg-white/80 p-3">
                          <div className="text-sm font-extrabold text-slate-900">{row.region}</div>
                          <div className="mt-1 text-xs text-slate-600">{fmtMoney(row.platform_fee || 0)} platform fees</div>
                        </div>
                      ))
                    )}
                  </div>
                </SoftCard>

                <SoftCard className="p-4">
                  <div className="text-xs text-slate-600">Generated: {overview?.generated_at || "—"}</div>
                </SoftCard>
              </div>
            </div>
            </div>
          )}

          {/* ===================== GOALS ===================== */}
          {view === "goals" && (
            <>
              <SoftCard className="mt-6 p-5">
                <div className="flex flex-wrap items-start gap-3">
                  <div>
                    <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
                      Owner Salary Progress (Rolling 12 Months)
                    </div>
                    <div className="mt-2 text-4xl font-extrabold text-slate-900">
                      {fmtMoney(tracker.platform_fees_l12m || 0)}{" "}
                      <span className="text-slate-400 text-2xl font-extrabold">
                        / {fmtMoney(goal.target || 0)}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-700">
                      Measured from <b>Receipt.platform_fee_cents</b>.
                    </div>
                  </div>

                  <div className="ml-auto flex flex-col items-end gap-2">
                    <div className={`rounded-full px-3 py-1 text-xs font-extrabold ${statusPill(status)}`}>
                      {statusLabel(status)} • Pace {pct(paceRatio)}
                    </div>
                    <div className="text-xs text-slate-700">
                      Projection: <b>{fmtMoney(tracker.projection_annual || 0)}</b>
                    </div>
                  </div>
                </div>
              </SoftCard>

              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                <StatCard label="Effective Take Rate (L12M)" value={pct(derived.effective_take_rate_l12m ?? 0)} sub="Platform fees ÷ escrow funded" />
                <StatCard label="Escrow Funded (L12M)" value={fmtMoney(goals?.drivers?.escrow_funded_l12m || 0)} sub="Driver metric" />
                <StatCard label="Implied Escrow Needed" value={fmtMoney(derived.implied_escrow_needed_for_goal || 0)} sub="Goal ÷ take rate" />
              </div>
            </>
          )}

          {/* ===================== CONTRACTORS ===================== */}
          {view === "contractors" && (
            <div className="mt-6" data-testid="admin-contractors-view">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <div className="text-sm font-extrabold text-slate-900">Contractors</div>
                <select
                  value={contractorFilter}
                  onChange={(e) => setContractorFilter(e.target.value)}
                  className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                >
                  <option value="newest">Newest signups</option>
                  <option value="inactive">Inactive onboarding</option>
                  <option value="top_fee">Top fee generators</option>
                  <option value="missing_profile">Missing public profile</option>
                </select>
                <input
                  value={contractorQuery}
                  onChange={(e) => setContractorQuery(e.target.value)}
                  placeholder="Search by name, email, city, Stripe acct…"
                  className="ml-auto w-full md:w-[420px] rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                />
              </div>

              <TableShell>
                <table className="min-w-full text-sm">
                  <thead className="border-b border-black/10 bg-white/60">
                    <tr><Th>Contractor</Th><Th>Signup</Th><Th>Status</Th><Th>Public Profile</Th><Th>Pipeline</Th><Th>Fee Revenue</Th><Th>Recent Activity</Th></tr>
                  </thead>
                  <tbody>
                    {contractorFiltered.length === 0 ? (
                      <tr><Td colSpan={7} className="text-slate-600">No results.</Td></tr>
                    ) : (
                      contractorFiltered.map((c) => (
                        <tr key={c.id} data-testid={`admin-contractor-row-${c.id}`} className="border-b border-black/5">
                          <Td>
                            <div className="font-extrabold text-slate-900">{c.business_name || c.name || "—"}</div>
                            <div className="text-xs text-slate-600">{c.email || "—"} • #{c.id}</div>
                          </Td>
                          <Td>{fmtDateTime(c.created_at)}</Td>
                          <Td>
                            <div className="font-semibold text-slate-900">{titleCase(c.account_status)}</div>
                            <div className="text-xs text-slate-600">{c.city || "—"}, {c.state || "—"}</div>
                          </Td>
                          <Td>
                            <div className="font-semibold text-slate-900">{titleCase(c.public_profile_status)}</div>
                            <div className="text-xs text-slate-600">
                              Gallery {fmtNumber(c.gallery_count || 0)} • Reviews {fmtNumber(c.review_count || 0)}
                            </div>
                          </Td>
                          <Td>
                            <div className="font-semibold text-slate-900">{fmtNumber(c.lead_count || 0)} leads • {fmtNumber(c.agreement_count || 0)} agreements</div>
                            <div className="text-xs text-slate-600">{c.stripe_account_id ? String(c.stripe_account_id).slice(0, 16) : "No Stripe account"}</div>
                          </Td>
                          <Td>{fmtMoney(c.fee_revenue || 0)}</Td>
                          <Td title={c.recent_activity_at || ""}>
                            {fmtDateTime(c.recent_activity_at)}
                          </Td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </TableShell>
            </div>
          )}

          {/* ===================== SUBCONTRACTORS ===================== */}
          {view === "subcontractors" && (
            <div className="mt-6" data-testid="admin-subcontractors-view">
              <TableShell>
                <table className="min-w-full text-sm">
                  <thead className="border-b border-black/10 bg-white/60">
                    <tr><Th>Subcontractor</Th><Th>Contractor</Th><Th>Agreement</Th><Th>Status</Th><Th>Assigned Work</Th><Th>Recent Activity</Th></tr>
                  </thead>
                  <tbody>
                    {subcontractorRows.length === 0 ? (
                      <tr><Td colSpan={6} className="text-slate-600">No subcontractor activity yet.</Td></tr>
                    ) : (
                      subcontractorRows.map((row) => (
                        <tr key={row.id} data-testid={`admin-subcontractor-row-${row.id}`} className="border-b border-black/5">
                          <Td>
                            <div className="font-extrabold text-slate-900">{row.name || "—"}</div>
                            <div className="text-xs text-slate-600">{row.email || "—"}</div>
                          </Td>
                          <Td>{row.contractor_name || "—"}</Td>
                          <Td>
                            <div className="font-semibold text-slate-900">{row.agreement_title || `Agreement #${row.agreement_id}`}</div>
                            <div className="text-xs text-slate-600">#{row.agreement_id || "—"}</div>
                          </Td>
                          <Td>
                            <div className="font-semibold text-slate-900">{titleCase(row.status)}</div>
                            <div className="text-xs text-slate-600">
                              Invited {fmtDateTime(row.invited_at)}{row.accepted_at ? ` • Accepted ${fmtDateTime(row.accepted_at)}` : ""}
                            </div>
                          </Td>
                          <Td>{fmtNumber(row.assigned_work_count || 0)}</Td>
                          <Td>{fmtDateTime(row.recent_activity_at)}</Td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </TableShell>
            </div>
          )}

          {/* ===================== HOMEOWNERS ===================== */}
          {view === "homeowners" && (
            <div className="mt-6" data-testid="admin-homeowners-view">
              <TableShell>
                <table className="min-w-full text-sm">
                  <thead className="border-b border-black/10 bg-white/60">
                    <tr><Th>Customer</Th><Th>Contractor</Th><Th>Created</Th><Th>Leads</Th><Th>Agreements</Th><Th>Projects</Th></tr>
                  </thead>
                  <tbody>
                    {homeownerRows.length === 0 ? (
                      <tr><Td colSpan={6} className="text-slate-600">No results.</Td></tr>
                    ) : (
                      homeownerRows.map((h) => (
                        <tr key={h.id} data-testid={`admin-homeowner-row-${h.id}`} className="border-b border-black/5">
                          <Td>
                            <div className="font-extrabold text-slate-900">{h.name || "—"}</div>
                            <div className="text-xs text-slate-600">{h.email || "—"} • {h.phone || "—"}</div>
                          </Td>
                          <Td>
                            <div className="font-semibold text-slate-900">{h.contractor_name || "—"}</div>
                            <div className="text-xs text-slate-600">#{h.created_by_contractor_id || "—"} • {titleCase(h.status || "active")}</div>
                          </Td>
                          <Td>{fmtDateTime(h.created_at)}</Td>
                          <Td>{fmtNumber(h.lead_count || 0)}</Td>
                          <Td>{fmtNumber(h.agreement_count || 0)}</Td>
                          <Td>{fmtNumber(h.project_count || 0)}</Td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </TableShell>
            </div>
          )}

          {/* ===================== AGREEMENTS ===================== */}
          {view === "agreements" && (
            <div className="mt-6">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <div className="text-sm font-extrabold text-slate-900">Agreements</div>

                <input
                  value={agreementQuery}
                  onChange={(e) => {
                    const next = e.target.value;
                    setAgreementQuery(next);
                    setParam(navigate, location, "q", next);
                  }}
                  placeholder="Search by project, city, state, funded…"
                  className="ml-auto w-full md:w-[520px] rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                />
              </div>

              {qFromUrl ? (
                <div className="mb-3 text-xs text-slate-700">
                  Filter from URL: <span className="font-extrabold">{qFromUrl}</span>{" "}
                  <button
                    className="ml-2 underline"
                    onClick={() => {
                      setAgreementQuery("");
                      setParam(navigate, location, "q", "");
                    }}
                  >
                    clear
                  </button>
                </div>
              ) : null}

              {agreementOpsMsg ? (
                <div className="mb-3 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-900">
                  {agreementOpsMsg}
                </div>
              ) : null}

              {agreementAiContext ? (
                <div className="mb-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-extrabold text-slate-900">
                        AI Context for Agreement #{agreementAiContext.agreement_id}
                      </div>
                      <div className="mt-1 text-xs text-slate-600">
                        {agreementAiContext.source_lead_id
                          ? `Source lead #${agreementAiContext.source_lead_id}`
                          : "No linked lead"}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAgreementAiContext(null)}
                      className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50"
                    >
                      Close
                    </button>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-3 text-xs text-slate-700">
                    <div>
                      <div className="font-extrabold text-slate-900">Suggested title</div>
                      <div className="mt-1">{agreementAiContext.suggested_title || "Not available"}</div>
                    </div>
                    <div>
                      <div className="font-extrabold text-slate-900">Template</div>
                      <div className="mt-1">{agreementAiContext.template_name || "Not available"}</div>
                    </div>
                    <div>
                      <div className="font-extrabold text-slate-900">Confidence</div>
                      <div className="mt-1">{agreementAiContext.confidence || "Not available"}</div>
                    </div>
                  </div>
                  <div className="mt-3 text-xs text-slate-700">
                    <span className="font-extrabold text-slate-900">Reason:</span>{" "}
                    {agreementAiContext.reason || "No AI recommendation notes were saved for this agreement."}
                  </div>
                  {Array.isArray(agreementAiContext.pricing_confidence_levels) &&
                  agreementAiContext.pricing_confidence_levels.length ? (
                    <div className="mt-3 text-xs text-slate-700">
                      <span className="font-extrabold text-slate-900">Pricing confidence:</span>{" "}
                      {agreementAiContext.pricing_confidence_levels.join(", ")}
                    </div>
                  ) : null}
                  {Array.isArray(agreementAiContext.pricing_sources) &&
                  agreementAiContext.pricing_sources.length ? (
                    <div className="mt-3">
                      <div className="text-xs font-extrabold text-slate-900">Pricing sources</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {agreementAiContext.pricing_sources.slice(0, 4).map((source, index) => (
                          <span
                            key={`${source}-${index}`}
                            className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-700"
                          >
                            {source}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <TableShell>
                <table className="min-w-full text-sm">
                  <thead className="border-b border-black/10 bg-white/60">
                    <tr><Th>ID</Th><Th>Project</Th><Th>City</Th><Th>State</Th><Th>Funded</Th><Th>Released</Th><Th>In Flight</Th><Th>Actions</Th></tr>
                  </thead>
                  <tbody>
                    {agreementsFiltered.length === 0 ? (
                      <tr><Td colSpan={8} className="text-slate-600">No results.</Td></tr>
                    ) : (
                      agreementsFiltered.map((a) => (
                        <tr key={a.id} className="border-b border-black/5">
                          <Td>{a.id}</Td>
                          <Td>
                            <div className="font-extrabold text-slate-900">{a.project_title || `Agreement #${a.id}`}</div>
                            <div className="text-xs text-slate-600">{a.is_archived ? "Archived" : "Active"} • PDF v{a.pdf_version ?? 0}</div>
                          </Td>
                          <Td>{a.project_city || "—"}</Td>
                          <Td>{a.project_state || "—"}</Td>
                          <Td>{fmtMoney(a.escrow_funded_amount || 0)}</Td>
                          <Td>{fmtMoney(a.escrow_released_amount || 0)}</Td>
                          <Td className="font-extrabold">{fmtMoney(a.escrow_in_flight_amount || 0)}</Td>
                          <Td>
                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={() => goToAgreementFinalize(a.id)}
                                className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-slate-800"
                              >
                                View Agreement
                              </button>
                              <button
                                onClick={() => goToAgreementPricing(a.id)}
                                className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50"
                              >
                                Pricing
                              </button>
                              <button
                                onClick={() => viewAgreementAiContext(a.id)}
                                className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50"
                              >
                                View AI
                              </button>
                              <button
                                onClick={() => refreshAgreementPricing(a.id)}
                                disabled={agreementOpBusy === `pricing-${a.id}`}
                                className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                              >
                                {agreementOpBusy === `pricing-${a.id}` ? "Refreshing..." : "Refresh Pricing"}
                              </button>
                              <button
                                onClick={() => resendAgreementSignature(a.id)}
                                disabled={agreementOpBusy === `signature-${a.id}`}
                                className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                              >
                                {agreementOpBusy === `signature-${a.id}` ? "Sending..." : "Resend Email"}
                              </button>
                            </div>
                          </Td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </TableShell>
            </div>
          )}

          {/* ===================== DISPUTES ===================== */}
          {view === "disputes" && (
            <div className="mt-6" data-testid="admin-disputes-view">
              <TableShell>
                <table className="min-w-full text-sm">
                  <thead className="border-b border-black/10 bg-white/60">
                    <tr><Th>Dispute</Th><Th>Contractor / Customer</Th><Th>Project</Th><Th>Status</Th><Th>Amount</Th><Th>Updated</Th></tr>
                  </thead>
                  <tbody>
                    {disputes.length === 0 ? (
                      <tr><Td colSpan={6} className="text-slate-600">No disputes.</Td></tr>
                    ) : (
                      disputes.map((d) => (
                        <tr key={d.id} data-testid={`admin-dispute-row-${d.id}`} className="border-b border-black/5">
                          <Td>
                            <div className="font-extrabold text-slate-900">Dispute #{d.id}</div>
                            <div className="text-xs text-slate-600">
                              Agreement #{d.agreement_id || "—"}{d.invoice_id ? ` • Invoice #${d.invoice_id}` : ""}{d.initiator ? ` • ${titleCase(d.initiator)}` : ""}
                            </div>
                          </Td>
                          <Td>
                            <div className="font-semibold text-slate-900">{d.contractor_name || "—"}</div>
                            <div className="text-xs text-slate-600">{d.homeowner_name || "—"}</div>
                          </Td>
                          <Td>
                            <div className="font-semibold text-slate-900">{d.project_title || "—"}</div>
                            <div className="text-xs text-slate-600">{d.milestone_title || d.reason || "No detail saved."}</div>
                          </Td>
                          <Td>{titleCase(d.status || "—")}</Td>
                          <Td>{fmtMoney(d.amount || 0)}</Td>
                          <Td>{fmtDateTime(d.updated_at || d.created_at)}</Td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </TableShell>
            </div>
          )}

          {/* ===================== GEO ===================== */}
          {view === "geo" && (
            <div className="mt-6 space-y-4">
              <SoftCard className="p-4">
                <div className="text-sm font-extrabold text-slate-900">Geo / Map (City • State • ZIP)</div>
                <div className="mt-1 text-xs text-slate-700">Revenue-weighted summary using project addresses.</div>
              </SoftCard>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <SoftCard className="p-4">
                  <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500 mb-2">States (L12M fees)</div>

                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs font-extrabold text-slate-700">Selected:</span>
                    <select
                      value={geoState}
                      onChange={(e) => setGeoState(e.target.value)}
                      className="rounded-lg border border-black/10 bg-white px-2 py-1 text-sm"
                    >
                      {(geo?.states || []).map((s) => (
                        <option key={s.state} value={s.state}>{s.state}</option>
                      ))}
                    </select>

                    {selectedStateRow && (
                      <span className="ml-auto text-xs text-slate-700">
                        Fees: <b>{fmtMoney(selectedStateRow.fees)}</b> • Escrow: <b>{fmtMoney(selectedStateRow.escrow)}</b> • Take: <b>{pct(selectedStateRow.take_rate)}</b>
                      </span>
                    )}
                  </div>

                  <TableShell>
                    <table className="min-w-full text-sm">
                      <thead className="border-b border-black/10 bg-white/60">
                        <tr><Th>State</Th><Th>Fees</Th><Th>Escrow</Th><Th>Take</Th><Th>Agreements</Th></tr>
                      </thead>
                      <tbody>
                        {(geo?.states || []).length === 0 ? (
                          <tr><Td colSpan={5} className="text-slate-600">No state data.</Td></tr>
                        ) : (
                          (geo?.states || []).map((s) => (
                            <tr key={s.state} className="border-b border-black/5 hover:bg-white/60 cursor-pointer" onClick={() => setGeoState(s.state)}>
                              <Td className="font-extrabold">{s.state}</Td>
                              <Td>{fmtMoney(s.fees)}</Td>
                              <Td>{fmtMoney(s.escrow)}</Td>
                              <Td>{pct(s.take_rate)}</Td>
                              <Td>{fmtNumber(s.agreements || 0)}</Td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </TableShell>
                </SoftCard>

                <SoftCard className="p-4">
                  <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500 mb-2">Cities in {geoState || "—"}</div>

                  <TableShell>
                    <table className="min-w-full text-sm">
                      <thead className="border-b border-black/10 bg-white/60">
                        <tr><Th>City</Th><Th>Fees</Th><Th>Escrow</Th><Th>Take</Th><Th>Agreements</Th></tr>
                      </thead>
                      <tbody>
                        {selectedCities.length === 0 ? (
                          <tr><Td colSpan={5} className="text-slate-600">No city data.</Td></tr>
                        ) : (
                          selectedCities.map((c) => (
                            <tr key={`${c.city}-${c.state}`} className="border-b border-black/5">
                              <Td className="font-extrabold">{c.city}</Td>
                              <Td>{fmtMoney(c.fees)}</Td>
                              <Td>{fmtMoney(c.escrow)}</Td>
                              <Td>{pct(c.take_rate)}</Td>
                              <Td>{fmtNumber(c.agreements || 0)}</Td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </TableShell>

                  <div className="mt-4 text-xs font-extrabold uppercase tracking-wide text-slate-500 mb-2">ZIPs in {geoState || "—"}</div>

                  <TableShell>
                    <table className="min-w-full text-sm">
                      <thead className="border-b border-black/10 bg-white/60">
                        <tr><Th>ZIP</Th><Th>Fees</Th><Th>Escrow</Th><Th>Agreements</Th></tr>
                      </thead>
                      <tbody>
                        {selectedZips.length === 0 ? (
                          <tr><Td colSpan={4} className="text-slate-600">No ZIP data.</Td></tr>
                        ) : (
                          selectedZips.map((z) => (
                            <tr key={`${z.zip}-${z.state}`} className="border-b border-black/5">
                              <Td className="font-extrabold">{z.zip}</Td>
                              <Td>{fmtMoney(z.fees)}</Td>
                              <Td>{fmtMoney(z.escrow)}</Td>
                              <Td>{fmtNumber(z.agreements || 0)}</Td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </TableShell>
                </SoftCard>
              </div>
            </div>
          )}

          {/* ===================== FEE AUDIT ===================== */}
          {view === "fee_audit" && (
            <div className="mt-6 space-y-3">
              <SoftCard className="p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div>
                    <div className="text-sm font-extrabold text-slate-900">Fee Audit Ledger</div>
                    <div className="mt-1 text-xs text-slate-700">Use mismatch-only to spot anomalies fast.</div>
                  </div>

                  <label className="ml-auto flex items-center gap-2 text-xs font-extrabold text-slate-700">
                    <input type="checkbox" checked={feeMismatchOnly} onChange={(e) => setFeeMismatchOnly(e.target.checked)} />
                    Mismatch only
                  </label>

                  <button onClick={loadFeeAudit} className="rounded-xl border border-black/10 bg-white px-4 py-2 text-sm font-extrabold text-slate-900 hover:bg-slate-50">
                    Refresh Ledger
                  </button>
                </div>

                {feeAudit?.summary && (
                  <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-4">
                    <ThinStat label="Gross Paid" value={fmtMoney(feeAudit.summary.gross_paid)} />
                    <ThinStat label="Fee Charged" value={fmtMoney(feeAudit.summary.fee_charged)} />
                    <ThinStat label="Fee Expected" value={fmtMoney(feeAudit.summary.fee_expected)} />
                    <ThinStat label="Mismatches" value={fmtNumber(feeAudit.summary.mismatches)} />
                  </div>
                )}
              </SoftCard>

              <TableShell>
                <table className="min-w-full text-xs">
                  <thead className="border-b border-black/10 bg-white/60">
                    <tr><Th>Receipt</Th><Th>Created</Th><Th>Agreement</Th><Th>Invoice</Th><Th>Plan</Th><Th>Charged</Th><Th>Expected</Th><Th>Delta</Th><Th>Mismatch</Th></tr>
                  </thead>
                  <tbody>
                    {(feeAudit?.results || []).length === 0 ? (
                      <tr><Td colSpan={9} className="text-slate-600">No ledger rows.</Td></tr>
                    ) : (
                      feeAudit.results.map((r) => (
                        <tr key={r.receipt_number} className="border-b border-black/5">
                          <Td className="font-extrabold">{r.receipt_number}</Td>
                          <Td>{(r.created_at || "").slice(0, 19).replace("T", " ")}</Td>
                          <Td>{r.agreement_id ?? "—"}</Td>
                          <Td>{r.invoice_id ?? "—"}</Td>
                          <Td>{r.fee_plan_code || r.tier_name || "—"}</Td>
                          <Td>{fmtMoney((r.fee_charged_cents || 0) / 100)}</Td>
                          <Td>{fmtMoney((r.fee_expected_cents || 0) / 100)}</Td>
                          <Td className="font-extrabold">{fmtMoney((r.delta_cents || 0) / 100)}</Td>
                          <Td>{r.mismatch ? "⚠️" : "—"}</Td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </TableShell>
            </div>
          )}

          {/* ===================== SUPPORT ===================== */}
          {view === "support" && (
            <div className="mt-6 rounded-2xl border border-black/10 bg-white/70 p-5 shadow-sm">
              <div className="text-lg font-extrabold text-slate-900">Support Tools</div>
              <div className="mt-1 text-sm text-slate-700">Send a password reset email using Django’s standard reset flow.</div>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <input
                  value={pwResetEmail}
                  onChange={(e) => setPwResetEmail(e.target.value)}
                  placeholder="user@email.com"
                  className="min-w-[280px] rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                />
                <button
                  onClick={triggerPasswordReset}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-extrabold text-white hover:bg-slate-800"
                >
                  Send Reset Email
                </button>
                {pwResetMsg ? <div className="text-sm font-extrabold text-slate-700">{pwResetMsg}</div> : null}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
