import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import api from "../../api";
import { useWhoAmI } from "../../hooks/useWhoAmI";

const DIRECTORY_BASE = "/projects/admin/contractor-directory";

const pageStyle = {
  background: "linear-gradient(135deg, #041735 0%, #063f96 38%, #667f88 70%, #f0c94b 100%)",
};

const sectionClass = "rounded-2xl border border-white/10 bg-[#061d42]/95 p-5 text-white shadow-[0_22px_50px_rgba(2,8,23,0.32)]";
const panelClass = "rounded-xl border border-white/10 bg-white/[0.08] p-4";
const inputClass = "rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-sky-100/45 outline-none focus:border-sky-200";
const tableHeadClass = "border-b border-white/10 px-3 py-2 text-left text-xs font-bold uppercase tracking-wide text-sky-100/65";
const tableCellClass = "border-b border-white/10 px-3 py-3 align-top text-sm text-sky-50/85";

function viewKey(pathname) {
  if (pathname.includes("/marketplace/listings/")) return "listing";
  if (pathname.includes("/marketplace/analytics")) return "analytics";
  if (pathname.includes("/marketplace/verification")) return "verification";
  if (pathname.includes("/marketplace/contractors")) return "coverage";
  if (pathname.includes("/marketplace/import")) return "directory";
  return "overview";
}

function asList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function directoryRows(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

function clean(value, fallback = "Not listed") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function rating(row) {
  return row.rating ?? row.google_rating ?? null;
}

function reviews(row) {
  return row.review_count ?? row.google_review_count ?? 0;
}

function percentText(rate, percent) {
  if (typeof percent === "number" && Number.isFinite(percent)) return `${Math.round(percent)}%`;
  if (typeof rate === "number" && Number.isFinite(rate)) return `${Math.round(rate * 100)}%`;
  return "n/a";
}

function rateText(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${Math.round(number)}%` : "0%";
}

function website(row) {
  return row.website || row.website_url || "";
}

function email(row) {
  return row.public_email || row.email || "";
}

function phone(row) {
  return row.phone || row.phone_number || "";
}

function primaryService(row) {
  return row.primary_service || row.primary_trade || asList(row.normalized_services)[0] || asList(row.services)[0] || "Unclassified";
}

function locationText(row) {
  return [row.city, row.state].filter(Boolean).join(", ") || clean(row.zip_code, "Location missing");
}

function hasRadius(row) {
  return Number(row.service_radius_miles || 0) > 0;
}

function contactStatus(row) {
  if (row.contact_status) return row.contact_status;
  if (row.claimed) return "claimed";
  if (email(row)) return "email_ready";
  if (phone(row)) return "phone_ready";
  if (row.has_contact_form && row.contact_form_url) return "website_form_ready";
  if (website(row)) return "website_only";
  return "manual_review_needed";
}

function contactLabel(value) {
  return clean(value, "manual_review_needed").replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function Badge({ tone = "slate", children }) {
  const tones = {
    amber: "border-amber-200/35 bg-amber-300/15 text-amber-100",
    emerald: "border-emerald-200/35 bg-emerald-300/15 text-emerald-100",
    sky: "border-sky-200/35 bg-sky-300/15 text-sky-100",
    rose: "border-rose-200/35 bg-rose-300/15 text-rose-100",
    slate: "border-white/15 bg-white/10 text-sky-50/80",
    violet: "border-violet-200/35 bg-violet-300/15 text-violet-100",
  };
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-extrabold ${tones[tone] || tones.slate}`}>
      {children}
    </span>
  );
}

function Section({ title, sub, children, testId, className = "" }) {
  return (
    <section data-testid={testId} className={`${sectionClass} ${className}`.trim()}>
      <div className="mb-4">
        <h2 className="text-lg font-black text-white">{title}</h2>
        {sub ? <p className="mt-1 text-sm text-sky-100/75">{sub}</p> : null}
      </div>
      {children}
    </section>
  );
}

function MetricCard({ label, value, sub, tone = "sky", onClick, testId }) {
  const Component = onClick ? "button" : "div";
  return (
    <Component
      type={onClick ? "button" : undefined}
      data-testid={testId}
      onClick={onClick}
      className={`${panelClass} ${onClick ? "w-full cursor-pointer text-left transition hover:-translate-y-0.5 hover:border-sky-200/45 hover:bg-white/[0.12] focus:outline-none focus:ring-2 focus:ring-sky-200/60" : ""}`}
    >
      <div className="text-xs font-bold uppercase tracking-wide text-sky-100/60">{label}</div>
      <div className={`mt-2 text-3xl font-black ${tone === "amber" ? "text-amber-100" : tone === "emerald" ? "text-emerald-100" : "text-white"}`}>
        {Number(value || 0).toLocaleString()}
      </div>
      {sub ? <div className="mt-1 text-xs text-sky-100/65">{sub}</div> : null}
    </Component>
  );
}

function groupBy(rows, keyFn) {
  const map = new Map();
  rows.forEach((row) => {
    const key = keyFn(row) || "Unclassified";
    if (!map.has(key)) {
      map.set(key, { key, total: 0, claimed: 0, unclaimed: 0, withEmail: 0, withWebsite: 0, rows: [] });
    }
    const bucket = map.get(key);
    bucket.total += 1;
    bucket.claimed += row.claimed ? 1 : 0;
    bucket.unclaimed += row.claimed ? 0 : 1;
    bucket.withEmail += email(row) ? 1 : 0;
    bucket.withWebsite += website(row) ? 1 : 0;
    bucket.rows.push(row);
  });
  return Array.from(map.values()).sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
}

function computeHealth(rows) {
  const total = rows.length;
  const claimed = rows.filter((row) => row.claimed).length;
  const withEmail = rows.filter((row) => email(row)).length;
  const withWebsite = rows.filter((row) => website(row)).length;
  const serviceBuckets = groupBy(rows, primaryService);
  const geoBuckets = groupBy(rows, (row) => [row.city, row.state].filter(Boolean).join(", ") || row.zip_code || "Location missing");
  return {
    total,
    claimed,
    unclaimed: total - claimed,
    withEmail,
    withWebsite,
    missingEmail: total - withEmail,
    contactReady: rows.filter((row) => ["claimed", "email_ready", "phone_ready", "website_form_ready", "website_only", "contact_ready"].includes(contactStatus(row))).length,
    emailReady: rows.filter((row) => contactStatus(row) === "email_ready").length,
    phoneReady: rows.filter((row) => contactStatus(row) === "phone_ready").length,
    websiteFormReady: rows.filter((row) => contactStatus(row) === "website_form_ready").length,
    websiteOnly: rows.filter((row) => contactStatus(row) === "website_only").length,
    manualReviewNeeded: rows.filter((row) => contactStatus(row) === "manual_review_needed").length,
    serviceGaps: serviceBuckets.filter((bucket) => bucket.claimed === 0 && bucket.total > 0),
    geographicGaps: geoBuckets.filter((bucket) => bucket.claimed === 0 && bucket.total > 0),
    highRatedUnclaimed: rows.filter((row) => !row.claimed && Number(rating(row) || 0) >= 4.5),
    enrichedUnclaimed: rows.filter((row) => !row.claimed && ["reviewed", "enriched", "complete"].includes(String(row.enrichment_status || "").toLowerCase())),
    claimedMissingRadius: rows.filter((row) => row.claimed && !hasRadius(row)),
  };
}

function readinessChecks(row) {
  return [
    { label: "Claim status", ok: !!row.claimed, text: row.claimed ? "Claimed profile" : "Unclaimed listing" },
    { label: "Contactability", ok: contactStatus(row) !== "manual_review_needed", text: contactLabel(contactStatus(row)) },
    { label: "Website readiness", ok: !!website(row), text: website(row) ? "Website available" : "Missing website" },
    { label: "Service category", ok: primaryService(row) !== "Unclassified", text: primaryService(row) },
    { label: "Service radius", ok: hasRadius(row), text: hasRadius(row) ? `${row.service_radius_miles} miles` : "No radius set" },
  ];
}

function formatDate(value) {
  if (!value) return "Not submitted";
  try {
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function routeButtonCopy(row) {
  if (row?.routable_now) return "Route Now";
  if (!row?.marketplace_enabled) return "Marketplace disabled";
  if (row?.at_cap) return "At cap";
  return "Not routable";
}

function joinInviteSummary(row) {
  return row?.marketplace_join_invite || null;
}

function joinInviteLabel(invite) {
  if (!invite) return "Not invited";
  return clean(invite.status, "pending").replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function joinInviteTone(invite) {
  const status = String(invite?.status || "").toLowerCase();
  if (status === "sent" || status === "claimed") return "emerald";
  if (status === "partial" || status === "suppressed" || status === "expired") return "amber";
  if (status === "failed") return "rose";
  return "slate";
}

export default function AdminMarketplacePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams();
  const { data: identity, loading: whoLoading } = useWhoAmI();
  const isAdmin = ["admin", "platform_admin"].includes(String(identity?.type || identity?.role || "").toLowerCase());
  const currentView = viewKey(location.pathname);
  const listingId = params.id ? String(params.id) : "";

  const [rows, setRows] = useState([]);
  const [readinessRows, setReadinessRows] = useState([]);
  const [listing, setListing] = useState(null);
  const [filters, setFilters] = useState({ q: "", city: "", state: "", service: "", claimed: "" });
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [claimLinks, setClaimLinks] = useState({});
  const [joinInviteIds, setJoinInviteIds] = useState({});
  const [savedRequests, setSavedRequests] = useState({ summary: {}, results: [] });
  const [routingIds, setRoutingIds] = useState({});
  const [verificationRows, setVerificationRows] = useState([]);
  const [verificationSummary, setVerificationSummary] = useState({});
  const [verificationFilters, setVerificationFilters] = useState({ status: "", preferred: "", stripe_ready: "", missing: "", q: "" });
  const [verificationNotes, setVerificationNotes] = useState({});
  const [verificationActionIds, setVerificationActionIds] = useState({});
  const [analytics, setAnalytics] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsFilters, setAnalyticsFilters] = useState({ date_from: "", date_to: "", city: "", state: "", trade: "", contractor_status: "" });

  useEffect(() => {
    if (whoLoading || !isAdmin) return undefined;
    let active = true;
    async function loadDirectory() {
      setLoading(true);
      setStatus("");
      try {
        const { data } = await api.get(`${DIRECTORY_BASE}/`, { params: { limit: 500 } });
        if (active) setRows(directoryRows(data));
        try {
          const readiness = await api.get("/projects/admin/marketplace/");
          if (active) {
            setReadinessRows(readiness?.data?.coverage?.location_readiness || []);
            setSavedRequests(readiness?.data?.saved_marketplace_requests || { summary: {}, results: [] });
          }
        } catch {
          if (active) {
            setReadinessRows([]);
            setSavedRequests({ summary: {}, results: [] });
          }
        }
        try {
          const verification = await api.get("/projects/admin/marketplace/verification/");
          if (active) {
            setVerificationRows(verification?.data?.results || []);
            setVerificationSummary(verification?.data?.summary || {});
          }
        } catch {
          if (active) {
            setVerificationRows([]);
            setVerificationSummary({});
          }
        }
      } catch (error) {
        if (active) setStatus(error?.response?.data?.detail || "Failed to load marketplace health data.");
      } finally {
        if (active) setLoading(false);
      }
    }
    loadDirectory();
    return () => {
      active = false;
    };
  }, [whoLoading, isAdmin]);

  async function refreshMarketplaceOverview() {
    const readiness = await api.get("/projects/admin/marketplace/");
    setReadinessRows(readiness?.data?.coverage?.location_readiness || []);
    setSavedRequests(readiness?.data?.saved_marketplace_requests || { summary: {}, results: [] });
    return readiness?.data;
  }

  async function refreshVerification() {
    const params = {};
    Object.entries(verificationFilters).forEach(([key, value]) => {
      if (String(value || "").trim()) params[key] = value;
    });
    const { data } = await api.get("/projects/admin/marketplace/verification/", { params });
    setVerificationRows(data?.results || []);
    setVerificationSummary(data?.summary || {});
    return data;
  }

  useEffect(() => {
    if (whoLoading || !isAdmin || currentView !== "analytics") return undefined;
    const params = new URLSearchParams(location.search || "");
    const nextFilters = {
      date_from: params.get("date_from") || "",
      date_to: params.get("date_to") || "",
      city: params.get("city") || "",
      state: params.get("state") || "",
      trade: params.get("trade") || "",
      contractor_status: params.get("contractor_status") || "",
    };
    setAnalyticsFilters(nextFilters);
    let active = true;
    setAnalyticsLoading(true);
    setStatus("");
    api.get("/projects/admin/marketplace/analytics/", {
      params: Object.fromEntries(Object.entries(nextFilters).filter(([, value]) => String(value || "").trim())),
    }).then(({ data }) => {
      if (active) setAnalytics(data || null);
    }).catch((error) => {
      if (active) {
        setStatus(error?.response?.data?.detail || "Failed to load marketplace analytics.");
        setAnalytics(null);
      }
    }).finally(() => {
      if (active) setAnalyticsLoading(false);
    });
    return () => {
      active = false;
    };
  }, [whoLoading, isAdmin, currentView, location.search]);

  useEffect(() => {
    if (whoLoading || !isAdmin || currentView !== "listing" || !listingId) return undefined;
    let active = true;
    async function loadListing() {
      setLoading(true);
      setStatus("");
      try {
        const { data } = await api.get(`${DIRECTORY_BASE}/${listingId}/`);
        if (active) setListing(data || null);
      } catch (error) {
        if (active) setStatus(error?.response?.data?.detail || "Failed to load marketplace readiness detail.");
      } finally {
        if (active) setLoading(false);
      }
    }
    loadListing();
    return () => {
      active = false;
    };
  }, [whoLoading, isAdmin, currentView, listingId]);

  const health = useMemo(() => computeHealth(rows), [rows]);

  const filteredRows = useMemo(() => {
    const query = filters.q.trim().toLowerCase();
    return rows.filter((row) => {
      const haystack = [
        row.business_name,
        row.city,
        row.state,
        row.zip_code,
        primaryService(row),
        asList(row.normalized_services).join(" "),
      ].join(" ").toLowerCase();
      if (query && !haystack.includes(query)) return false;
      if (filters.city && String(row.city || "").toLowerCase() !== filters.city.toLowerCase()) return false;
      if (filters.state && String(row.state || "").toLowerCase() !== filters.state.toLowerCase()) return false;
      if (filters.service && primaryService(row).toLowerCase() !== filters.service.toLowerCase()) return false;
      if (filters.claimed && String(Boolean(row.claimed)) !== filters.claimed) return false;
      return true;
    });
  }, [filters, rows]);

  const services = useMemo(() => groupBy(rows, primaryService).map((bucket) => bucket.key), [rows]);

  function go(path = "") {
    navigate(`/app/admin/marketplace${path ? `/${path}` : ""}`);
  }

  function applyAnalyticsFilters() {
    const search = new URLSearchParams();
    Object.entries(analyticsFilters).forEach(([key, value]) => {
      if (String(value || "").trim()) search.set(key, String(value).trim());
    });
    navigate(`/app/admin/marketplace/analytics${search.toString() ? `?${search.toString()}` : ""}`);
  }

  function openDirectory(row) {
    navigate(`/app/admin/contractor-directory?entry=${row.id}`);
  }

  function openDirectoryFilters(params = {}) {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        search.set(key, String(value));
      }
    });
    navigate(`/app/admin/contractor-directory${search.toString() ? `?${search.toString()}` : ""}`);
  }

  function mergeDirectoryEntry(nextEntry) {
    if (!nextEntry?.id) return;
    setRows((prev) => prev.map((row) => (String(row.id) === String(nextEntry.id) ? { ...row, ...nextEntry } : row)));
    setListing((prev) => (prev && String(prev.id) === String(nextEntry.id) ? { ...prev, ...nextEntry } : prev));
  }

  function openCoverageFilters(params = {}) {
    setFilters((prev) => ({ ...prev, ...params }));
    go("contractors");
  }

  function splitGeoKey(key) {
    const [cityPart, statePart] = String(key || "").split(",").map((part) => part.trim());
    if (cityPart && statePart) return { city: cityPart, state: statePart };
    if (/^\d{5}/.test(cityPart || "")) return { zip_code: cityPart };
    return { city: cityPart || "" };
  }

  async function generateClaimLink(row) {
    setStatus("");
    try {
      const { data } = await api.post(`${DIRECTORY_BASE}/${row.id}/claim-link/`, {});
      setClaimLinks((prev) => ({ ...prev, [row.id]: data?.claim_url || "" }));
      setStatus("Claim link generated. Open the Directory record to manage claim workflow details.");
    } catch (error) {
      setStatus(error?.response?.data?.detail || "Could not generate claim link.");
    }
  }

  async function sendJoinInvite(row, resend = false) {
    if (!row?.id) return;
    setJoinInviteIds((prev) => ({ ...prev, [row.id]: true }));
    setStatus("");
    try {
      const { data } = await api.post(`${DIRECTORY_BASE}/${row.id}/join-invite/`, {
        preferred_channel: email(row) && phone(row) ? "both" : email(row) ? "email" : "sms",
        resend,
      });
      if (data?.entry) mergeDirectoryEntry(data.entry);
      if (data?.invite?.claim_url) {
        setClaimLinks((prev) => ({ ...prev, [row.id]: data.invite.claim_url }));
      }
      const inviteStatus = joinInviteLabel(data?.invite);
      setStatus(`Join marketplace invite ${inviteStatus.toLowerCase()}.`);
    } catch (error) {
      setStatus(error?.response?.data?.detail || "Could not send marketplace join invite.");
    } finally {
      setJoinInviteIds((prev) => ({ ...prev, [row.id]: false }));
    }
  }

  async function copyClaimLink(row) {
    const link = claimLinks[row.id];
    if (!link) return;
    const absoluteLink = link.startsWith("http") ? link : `${window.location.origin}${link}`;
    try {
      await navigator.clipboard?.writeText(absoluteLink);
    } catch {
      // Clipboard permissions may be unavailable in some admin browsers.
    }
    setStatus("Claim link copied.");
  }

  async function setLocationEnabled(row, enabled) {
    setStatus("");
    try {
      const { data } = await api.post("/projects/admin/marketplace/locations/", {
        city: row.city,
        state: row.state,
        enabled,
      });
      setReadinessRows((prev) => {
        const next = prev.filter((item) => !(item.city === data.city && item.state === data.state));
        return [data, ...next].sort((a, b) => String(a.status).localeCompare(String(b.status)) || String(a.city).localeCompare(String(b.city)));
      });
      try {
        await refreshMarketplaceOverview();
      } catch {
        // The location update succeeded; keep the local row update even if the overview refresh fails.
      }
      setStatus(enabled ? `${row.city}, ${row.state} enabled for gated marketplace routing.` : `${row.city}, ${row.state} disabled for marketplace routing.`);
    } catch (error) {
      setStatus(error?.response?.data?.detail || "Could not update marketplace location.");
    }
  }

  async function routeSavedRequest(row) {
    if (!row?.id || !row.routable_now) return;
    setStatus("");
    setRoutingIds((prev) => ({ ...prev, [row.id]: true }));
    try {
      const { data } = await api.post("/projects/admin/marketplace/route-intake/", { intake_id: row.id });
      await refreshMarketplaceOverview();
      const createdCount = Number(data?.created_count || 0);
      setStatus(`Routed ${createdCount} contractor ${createdCount === 1 ? "opportunity" : "opportunities"} for ${row.request_title}.`);
    } catch (error) {
      setStatus(error?.response?.data?.detail || "Could not route this marketplace request.");
    } finally {
      setRoutingIds((prev) => ({ ...prev, [row.id]: false }));
    }
  }

  async function routeAllEligibleRequests() {
    const rowsToRoute = (savedRequests.results || []).filter((row) => row.routable_now);
    if (!rowsToRoute.length) return;
    setStatus("");
    let routed = 0;
    let skipped = 0;
    const errors = [];
    for (const row of rowsToRoute) {
      setRoutingIds((prev) => ({ ...prev, [row.id]: true }));
      try {
        const { data } = await api.post("/projects/admin/marketplace/route-intake/", { intake_id: row.id });
        routed += Number(data?.created_count || 0);
      } catch (error) {
        skipped += 1;
        errors.push(error?.response?.data?.detail || `Could not route request #${row.id}.`);
      } finally {
        setRoutingIds((prev) => ({ ...prev, [row.id]: false }));
      }
    }
    await refreshMarketplaceOverview();
    setStatus(errors.length ? `Routed ${routed}; ${skipped} request${skipped === 1 ? "" : "s"} skipped. ${errors[0]}` : `Routed ${routed} contractor opportunities across ${rowsToRoute.length} request${rowsToRoute.length === 1 ? "" : "s"}.`);
  }

  async function applyVerificationAction(row, action) {
    if (!row?.id || verificationActionIds[row.id]) return;
    const note = verificationNotes[row.id] || "";
    setStatus("");
    setVerificationActionIds((prev) => ({ ...prev, [row.id]: action }));
    try {
      const { data } = await api.post("/projects/admin/marketplace/verification/", {
        contractor_id: row.id,
        action,
        notes: note,
        reason: note,
      });
      setVerificationRows((prev) => prev.map((item) => (item.id === row.id ? data : item)));
      await refreshMarketplaceOverview();
      setStatus(`${data.business_name || "Contractor"} ${action.replace(/_/g, " ")} complete.`);
    } catch (error) {
      setStatus(error?.response?.data?.detail || "Could not update contractor verification.");
    } finally {
      setVerificationActionIds((prev) => ({ ...prev, [row.id]: "" }));
    }
  }

  if (whoLoading) {
    return <div className="p-6 text-slate-600">Checking admin access...</div>;
  }

  if (!isAdmin) {
    return (
      <div className="p-6">
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
          You need admin access to view marketplace operations.
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full px-4 py-6 md:px-6" style={pageStyle}>
      <div className="mx-auto max-w-[1500px] space-y-6">
        <header className={sectionClass}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-sky-100/65">Admin Marketplace</div>
              <h1 className="mt-1 text-3xl font-black text-white">Marketplace Operations</h1>
              <p className="mt-2 max-w-3xl text-sm text-sky-100/80">
                Monitor contractor coverage, claim readiness, service gaps, and routing health. Contractor Directory remains the record management console for enrichment, imports, edits, and profile data.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="rounded-xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-extrabold text-white hover:bg-white/15" onClick={() => go("")}>
                Overview
              </button>
              <button type="button" className="rounded-xl border border-sky-200/30 bg-sky-300/10 px-4 py-2 text-sm font-extrabold text-sky-50 hover:bg-sky-300/20" onClick={() => go("contractors")}>
                Coverage View
              </button>
              <button type="button" className="rounded-xl border border-amber-200/30 bg-amber-300/10 px-4 py-2 text-sm font-extrabold text-amber-100 hover:bg-amber-300/20" onClick={() => go("analytics")}>
                Analytics
              </button>
              <button type="button" className="rounded-xl border border-emerald-200/30 bg-emerald-300/10 px-4 py-2 text-sm font-extrabold text-emerald-100 hover:bg-emerald-300/20" onClick={() => go("verification")}>
                Verification Queue
              </button>
              <button type="button" className="rounded-xl bg-white px-4 py-2 text-sm font-extrabold text-slate-900 hover:bg-sky-50" onClick={() => navigate("/app/admin/contractor-directory")}>
                Open Contractor Directory
              </button>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2" data-testid="admin-marketplace-tabs">
            <button type="button" className={`rounded-full border px-3 py-1.5 text-xs font-extrabold ${currentView === "overview" ? "border-white bg-white text-slate-900" : "border-white/15 bg-white/10 text-sky-50"}`} onClick={() => go("")}>Overview</button>
            <button type="button" className={`rounded-full border px-3 py-1.5 text-xs font-extrabold ${currentView === "analytics" ? "border-white bg-white text-slate-900" : "border-white/15 bg-white/10 text-sky-50"}`} onClick={() => go("analytics")}>Analytics</button>
            <button type="button" className={`rounded-full border px-3 py-1.5 text-xs font-extrabold ${currentView === "coverage" ? "border-white bg-white text-slate-900" : "border-white/15 bg-white/10 text-sky-50"}`} onClick={() => go("contractors")}>Marketplace Coverage</button>
            <button type="button" className={`rounded-full border px-3 py-1.5 text-xs font-extrabold ${currentView === "verification" ? "border-white bg-white text-slate-900" : "border-white/15 bg-white/10 text-sky-50"}`} onClick={() => go("verification")}>Verification</button>
            <button type="button" className={`rounded-full border px-3 py-1.5 text-xs font-extrabold ${currentView === "directory" ? "border-white bg-white text-slate-900" : "border-white/15 bg-white/10 text-sky-50"}`} onClick={() => go("import")}>Directory Console</button>
          </div>
          {status ? <div data-testid="admin-marketplace-status" className="mt-4 rounded-xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-sky-50">{status}</div> : null}
        </header>

        {loading && !rows.length && currentView !== "listing" ? (
          <Section title="Loading marketplace health" sub="Reading Contractor Directory records." />
        ) : null}

        {currentView === "analytics" ? (
          <main className="space-y-6" data-testid="admin-marketplace-analytics-page">
            <Section
              title="Marketplace Analytics"
              sub="Track whether cities are getting bids, bids are turning into awards, and awards are becoming signed or funded agreements."
              testId="admin-marketplace-analytics-filters"
            >
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
                <input
                  type="date"
                  className={inputClass}
                  data-testid="admin-marketplace-analytics-date-from"
                  value={analyticsFilters.date_from}
                  onChange={(event) => setAnalyticsFilters((prev) => ({ ...prev, date_from: event.target.value }))}
                />
                <input
                  type="date"
                  className={inputClass}
                  data-testid="admin-marketplace-analytics-date-to"
                  value={analyticsFilters.date_to}
                  onChange={(event) => setAnalyticsFilters((prev) => ({ ...prev, date_to: event.target.value }))}
                />
                <input
                  className={inputClass}
                  placeholder="City"
                  data-testid="admin-marketplace-analytics-city"
                  value={analyticsFilters.city}
                  onChange={(event) => setAnalyticsFilters((prev) => ({ ...prev, city: event.target.value }))}
                />
                <input
                  className={inputClass}
                  placeholder="State"
                  data-testid="admin-marketplace-analytics-state"
                  value={analyticsFilters.state}
                  onChange={(event) => setAnalyticsFilters((prev) => ({ ...prev, state: event.target.value }))}
                />
                <input
                  className={inputClass}
                  placeholder="Trade/category"
                  data-testid="admin-marketplace-analytics-trade"
                  value={analyticsFilters.trade}
                  onChange={(event) => setAnalyticsFilters((prev) => ({ ...prev, trade: event.target.value }))}
                />
                <select
                  className={inputClass}
                  data-testid="admin-marketplace-analytics-contractor-status"
                  value={analyticsFilters.contractor_status}
                  onChange={(event) => setAnalyticsFilters((prev) => ({ ...prev, contractor_status: event.target.value }))}
                >
                  <option value="">All contractors</option>
                  <option value="verified">Verified</option>
                  <option value="pending_review">Pending review</option>
                  <option value="rejected">Rejected</option>
                  <option value="suspended">Suspended</option>
                </select>
                <button
                  type="button"
                  className="rounded-xl bg-white px-4 py-2 text-sm font-extrabold text-slate-900 hover:bg-sky-50"
                  data-testid="admin-marketplace-analytics-apply"
                  onClick={applyAnalyticsFilters}
                >
                  Apply
                </button>
              </div>
            </Section>

            {analyticsLoading ? (
              <Section title="Loading analytics" sub="Calculating marketplace conversion metrics." />
            ) : null}

            {analytics ? (
              <>
                <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5" data-testid="admin-marketplace-analytics-kpis">
                  <MetricCard label="Requests Submitted" value={analytics.funnel?.requests_submitted || 0} sub="Marketplace requests" testId="admin-marketplace-analytics-requests" />
                  <MetricCard label="Requests Routed" value={analytics.funnel?.requests_routed || 0} sub={`${rateText(analytics.conversion_rates?.request_to_routed)} routed`} tone="emerald" testId="admin-marketplace-analytics-routed" />
                  <MetricCard label="Bids Submitted" value={analytics.funnel?.bids_submitted || 0} sub={`${analytics.funnel?.requests_with_at_least_one_bid || 0} requests with bids`} testId="admin-marketplace-analytics-bids" />
                  <MetricCard label="Awarded Requests" value={analytics.funnel?.awarded_requests || 0} sub={`${rateText(analytics.conversion_rates?.bid_received_to_awarded)} of bid requests`} tone="amber" testId="admin-marketplace-analytics-awarded" />
                  <MetricCard label="Agreement Drafts" value={analytics.funnel?.agreement_drafts_created || 0} sub={`${analytics.funnel?.signed_agreements || 0} signed | ${analytics.funnel?.escrow_funded || 0} funded`} tone="emerald" testId="admin-marketplace-analytics-agreements" />
                </section>

                <Section title="Marketplace Funnel" sub="Where requests are moving, and where they are getting stuck." testId="admin-marketplace-analytics-funnel">
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                    <MetricCard label="Routed -> Bid" value={rateText(analytics.conversion_rates?.routed_to_bid_received)} sub="Routed requests receiving bids" />
                    <MetricCard label="Bid -> Award" value={rateText(analytics.conversion_rates?.bid_received_to_awarded)} sub="Requests with bids awarded" />
                    <MetricCard label="Award -> Draft" value={rateText(analytics.conversion_rates?.awarded_to_agreement_draft)} sub="Awarded bids creating drafts" />
                    <MetricCard label="Draft -> Signed" value={rateText(analytics.conversion_rates?.agreement_draft_to_signed)} sub="Drafts fully signed" />
                    <MetricCard label="Signed -> Funded" value={rateText(analytics.conversion_rates?.signed_to_escrow_funded)} sub="Signed agreements funded" />
                    <MetricCard label="Zero-Bid Requests" value={analytics.funnel?.requests_with_zero_bids || 0} sub="Need supply or routing review" tone="amber" />
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <div className={panelClass}>
                      <div className="text-xs font-extrabold uppercase tracking-wide text-sky-100/60">Avg request to first bid</div>
                      <div className="mt-2 text-2xl font-black text-white">{analytics.time_metrics?.avg_request_to_first_bid_days ?? "n/a"} days</div>
                    </div>
                    <div className={panelClass}>
                      <div className="text-xs font-extrabold uppercase tracking-wide text-sky-100/60">Avg request to award</div>
                      <div className="mt-2 text-2xl font-black text-white">{analytics.time_metrics?.avg_request_to_award_days ?? "n/a"} days</div>
                    </div>
                    <div className={panelClass}>
                      <div className="text-xs font-extrabold uppercase tracking-wide text-sky-100/60">Avg award to draft</div>
                      <div className="mt-2 text-2xl font-black text-white">{analytics.time_metrics?.avg_award_to_agreement_draft_days ?? "n/a"} days</div>
                    </div>
                  </div>
                </Section>

                <div className="grid gap-6 xl:grid-cols-2">
                  <Section title="City Performance" sub="City-level bid and award health." testId="admin-marketplace-analytics-city-table">
                    <div className="overflow-x-auto">
                      <table className="min-w-full">
                        <thead>
                          <tr>
                            <th className={tableHeadClass}>City</th>
                            <th className={tableHeadClass}>Requests</th>
                            <th className={tableHeadClass}>Bids</th>
                            <th className={tableHeadClass}>Awards</th>
                            <th className={tableHeadClass}>Conversion</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(analytics.city_analytics || []).length ? analytics.city_analytics.map((row) => (
                            <tr key={`${row.city}-${row.state}`} data-testid={`admin-marketplace-analytics-city-${row.city}-${row.state}`} className="hover:bg-white/5">
                              <td className={tableCellClass}><div className="font-extrabold text-white">{row.city}, {row.state}</div></td>
                              <td className={tableCellClass}>{row.requests} requests<br /><span className="text-xs text-sky-100/60">{row.routed} routed</span></td>
                              <td className={tableCellClass}>{row.bids} bids<br /><span className="text-xs text-sky-100/60">{row.average_bids_per_request} avg/request</span></td>
                              <td className={tableCellClass}>{row.awarded_requests} awarded<br /><span className="text-xs text-sky-100/60">{row.zero_bid_requests} zero-bid</span></td>
                              <td className={tableCellClass}>{rateText(row.agreement_conversion_rate)} agreement conversion</td>
                            </tr>
                          )) : (
                            <tr><td className={tableCellClass} colSpan={5}>No city analytics for the selected filters.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </Section>

                  <Section title="Contractor Conversion" sub="Contractor bid conversion with review and performance context." testId="admin-marketplace-analytics-contractor-table">
                    <div className="overflow-x-auto">
                      <table className="min-w-full">
                        <thead>
                          <tr>
                            <th className={tableHeadClass}>Contractor</th>
                            <th className={tableHeadClass}>Bids</th>
                            <th className={tableHeadClass}>Win Rate</th>
                            <th className={tableHeadClass}>Performance</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(analytics.contractor_analytics || []).length ? analytics.contractor_analytics.map((row) => (
                            <tr key={row.contractor_id} data-testid={`admin-marketplace-analytics-contractor-${row.contractor_id}`} className="hover:bg-white/5">
                              <td className={tableCellClass}>
                                <div className="font-extrabold text-white">{row.business_name}</div>
                                <div className="mt-1 flex flex-wrap gap-1">
                                  <Badge tone={row.verification_status === "verified" ? "emerald" : "amber"}>{String(row.verification_status || "unverified").replace(/_/g, " ")}</Badge>
                                  {row.preferred ? <Badge tone="emerald">Preferred</Badge> : null}
                                </div>
                              </td>
                              <td className={tableCellClass}>{row.bids_submitted} submitted<br /><span className="text-xs text-sky-100/60">{row.bids_won} won</span></td>
                              <td className={tableCellClass}>{rateText(row.win_rate)}<br /><span className="text-xs text-sky-100/60">{row.average_bid_amount ? `$${row.average_bid_amount}` : "No bid amount"} avg bid</span></td>
                              <td className={tableCellClass}>Score {row.performance_score ?? "New"}<br /><span className="text-xs text-sky-100/60">{row.confidence_label || "Low Confidence"} | Rating {row.average_rating ?? "New"}</span></td>
                            </tr>
                          )) : (
                            <tr><td className={tableCellClass} colSpan={4}>No contractor analytics for the selected filters.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </Section>
                </div>

                <Section title="Attention Queues" sub="Requests and awards that need admin review." testId="admin-marketplace-analytics-attention">
                  <div className="grid gap-4 xl:grid-cols-3">
                    {[
                      ["Zero-bid requests", analytics.attention_queues?.zero_bid_requests || [], "No zero-bid requests."],
                      ["Requests awaiting award", analytics.attention_queues?.requests_awaiting_award || [], "No requests awaiting award."],
                      ["Awarded not signed/funded", analytics.attention_queues?.awarded_not_signed_or_funded || [], "No awarded drafts waiting on signature or funding."],
                    ].map(([title, rows, empty]) => (
                      <div key={title} className={panelClass}>
                        <div className="font-extrabold text-white">{title}</div>
                        <div className="mt-3 space-y-2">
                          {rows.length ? rows.slice(0, 6).map((row) => (
                            <div key={row.id || row.lead_id || row.agreement_id} className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-sky-100/75">
                              <div className="font-bold text-white">{row.title}</div>
                              <div className="mt-1 text-xs">{[row.city, row.state].filter(Boolean).join(", ") || row.contractor || "Marketplace item"}</div>
                              {row.bid_count ? <div className="mt-1 text-xs">{row.bid_count} bid(s)</div> : null}
                              {row.agreement_id ? <button type="button" className="mt-2 text-xs font-extrabold text-amber-100 underline" onClick={() => navigate(`/app/admin/agreements/${row.agreement_id}`)}>Open agreement</button> : null}
                            </div>
                          )) : <div className="text-sm text-sky-100/65">{empty}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              </>
            ) : null}
          </main>
        ) : null}

        {currentView === "overview" ? (
          <main className="space-y-6" data-testid="admin-marketplace-page">
            <section data-testid="admin-marketplace-summary" className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
              <MetricCard testId="admin-marketplace-metric-total" label="Total Directory Listings" value={health.total} sub="Contractor records in Directory" onClick={() => openDirectoryFilters()} />
              <MetricCard testId="admin-marketplace-metric-claimed" label="Claimed Contractors" value={health.claimed} sub="Linked to contractor accounts" tone="emerald" onClick={() => openDirectoryFilters({ claimed: "true" })} />
              <MetricCard testId="admin-marketplace-metric-unclaimed" label="Unclaimed Listings" value={health.unclaimed} sub="Claim-ready local businesses" tone="amber" onClick={() => openDirectoryFilters({ claimed: "false" })} />
              <MetricCard testId="admin-marketplace-metric-contact-ready" label="Contact Ready" value={health.contactReady} sub="Email, phone, form, website, or claimed" tone="emerald" onClick={() => openDirectoryFilters({ contact_status: "phone_ready" })} />
              <MetricCard testId="admin-marketplace-metric-email-ready" label="Email Ready" value={health.emailReady} sub="Direct public email available" onClick={() => openDirectoryFilters({ contact_status: "email_ready" })} />
              <MetricCard testId="admin-marketplace-metric-phone-ready" label="Phone Ready" value={health.phoneReady} sub="Phone/SMS outreach possible" onClick={() => openDirectoryFilters({ contact_status: "phone_ready" })} />
              <MetricCard testId="admin-marketplace-metric-form-ready" label="Website Form Ready" value={health.websiteFormReady} sub="Manual form outreach possible" onClick={() => openDirectoryFilters({ contact_status: "website_form_ready" })} />
              <MetricCard testId="admin-marketplace-metric-website-only" label="Website Only" value={health.websiteOnly} sub="Claim-link/manual review path" tone="amber" onClick={() => openDirectoryFilters({ contact_status: "website_only" })} />
              <MetricCard testId="admin-marketplace-metric-manual-review" label="Manual Review Needed" value={health.manualReviewNeeded} sub="No usable contact method yet" tone="amber" onClick={() => openDirectoryFilters({ contact_status: "manual_review_needed" })} />
            </section>

            <Section
              title="City Readiness"
              sub="Marketplace routing stays gated until local contractor coverage meets thresholds and an admin enables the city. Google listings count as supply leads; only claimed approved contractors can receive bid invitations."
              testId="admin-marketplace-location-readiness"
            >
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr>
                      <th className={tableHeadClass}>City</th>
                      <th className={tableHeadClass}>Status</th>
                      <th className={tableHeadClass}>Coverage</th>
                      <th className={tableHeadClass}>Gaps</th>
                      <th className={tableHeadClass}>Routing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {readinessRows.length ? readinessRows.slice(0, 12).map((row) => (
                      <tr key={`${row.city}-${row.state}`} data-testid={`admin-marketplace-location-${row.city}-${row.state}`} className="hover:bg-white/5">
                        <td className={tableCellClass}>
                          <div className="font-extrabold text-white">{row.city}, {row.state}</div>
                          <div className="mt-1 text-xs text-sky-100/70">{row.counts?.request_volume || 0} request(s) | Avg {row.counts?.avg_bids_per_request || 0} bids/request</div>
                        </td>
                        <td className={tableCellClass}>
                          <Badge tone={row.status === "enabled" ? "emerald" : row.status === "ready" ? "sky" : row.status === "nearing_ready" ? "amber" : "rose"}>
                            {String(row.status || "not_ready").replace(/_/g, " ")}
                          </Badge>
                        </td>
                        <td className={tableCellClass}>
                          <div className="text-xs text-sky-100/80">
                            {row.counts?.total_discovered || 0} discovered | {row.counts?.claimed_contractors || 0} claimed | {row.counts?.verified_contractors || 0} verified | {row.counts?.stripe_ready_contractors || 0} Stripe-ready
                          </div>
                          <div className="mt-1 text-xs text-sky-100/65">{row.counts?.trade_categories || 0} trade categories represented</div>
                        </td>
                        <td className={tableCellClass}>
                          <div className="max-w-md text-xs text-sky-100/75">
                            {(row.missing_trade_coverage || []).slice(0, 6).join(", ") || "No core trade gaps detected"}
                          </div>
                        </td>
                        <td className={tableCellClass}>
                          <div className="mb-2 text-xs text-sky-100/75">
                            Backlog: {row.marketplace_backlog?.saved_not_routed || 0} saved | {row.marketplace_backlog?.routable_now || 0} routable | {row.marketplace_backlog?.at_cap || 0} at cap
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              data-testid={`admin-marketplace-location-enable-${row.city}-${row.state}`}
                              onClick={() => setLocationEnabled(row, true)}
                              disabled={row.status === "enabled"}
                              className="rounded-lg border border-emerald-200/30 bg-emerald-300/10 px-3 py-1.5 text-xs font-extrabold text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Enable
                            </button>
                            <button
                              type="button"
                              data-testid={`admin-marketplace-location-disable-${row.city}-${row.state}`}
                              onClick={() => setLocationEnabled(row, false)}
                              disabled={!row.manual_enabled}
                              className="rounded-lg border border-rose-200/30 bg-rose-300/10 px-3 py-1.5 text-xs font-extrabold text-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Disable
                            </button>
                          </div>
                        </td>
                      </tr>
                    )) : (
                      <tr>
                        <td className={tableCellClass} colSpan={5}>No city readiness data yet. Import directory listings to start coverage tracking.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Section>

            <Section
              title="Saved Marketplace Requests"
              sub="Requests saved for multi-contractor routing. Route only after the city is enabled and eligible claimed contractors are available."
              testId="admin-marketplace-saved-requests"
            >
              <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                <MetricCard label="Saved Not Routed" value={savedRequests.summary?.saved_not_routed || 0} sub="Waiting on routing" testId="admin-marketplace-backlog-saved" />
                <MetricCard label="Routable Now" value={savedRequests.summary?.routable_now || 0} sub="Enabled locations" tone="emerald" testId="admin-marketplace-backlog-routable" />
                <MetricCard label="Already Routed" value={savedRequests.summary?.already_routed || 0} sub="Has invites or bids" testId="admin-marketplace-backlog-routed" />
                <MetricCard label="Disabled Location" value={savedRequests.summary?.blocked_disabled || 0} sub="City not enabled" tone="amber" testId="admin-marketplace-backlog-disabled" />
                <MetricCard label="No Eligible Contractors" value={savedRequests.summary?.blocked_no_eligible_contractors || 0} sub="Claimed supply gap" tone="amber" testId="admin-marketplace-backlog-no-eligible" />
                <MetricCard label="At Cap" value={savedRequests.summary?.at_cap || 0} sub="Max bids reached" tone="emerald" testId="admin-marketplace-backlog-at-cap" />
              </div>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-sky-100/70">
                  {(savedRequests.results || []).length} saved marketplace request{(savedRequests.results || []).length === 1 ? "" : "s"} tracked.
                </div>
                <button
                  type="button"
                  data-testid="admin-marketplace-route-all-eligible"
                  onClick={routeAllEligibleRequests}
                  disabled={!(savedRequests.results || []).some((row) => row.routable_now) || Object.values(routingIds).some(Boolean)}
                  className="rounded-xl border border-emerald-200/35 bg-emerald-300/15 px-4 py-2 text-sm font-extrabold text-emerald-100 hover:bg-emerald-300/25 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Route All Eligible Requests
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr>
                      <th className={tableHeadClass}>Request</th>
                      <th className={tableHeadClass}>Location</th>
                      <th className={tableHeadClass}>Customer</th>
                      <th className={tableHeadClass}>Routing Status</th>
                      <th className={tableHeadClass}>Counts</th>
                      <th className={tableHeadClass}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(savedRequests.results || []).length ? (savedRequests.results || []).map((row) => (
                      <tr key={row.id} data-testid={`admin-marketplace-saved-request-${row.id}`} className="hover:bg-white/5">
                        <td className={tableCellClass}>
                          <div className="font-extrabold text-white">{row.request_title}</div>
                          <div className="mt-1 text-xs text-sky-100/70">{row.project_type || "Project type pending"} {row.project_subtype ? `| ${row.project_subtype}` : ""}</div>
                          <div className="mt-1 text-xs text-sky-100/55">Submitted {formatDate(row.submitted_at)}</div>
                        </td>
                        <td className={tableCellClass}>
                          <div className="font-bold text-sky-50">{row.city}, {row.state}</div>
                          <div className="mt-2">
                            <Badge tone={row.marketplace_enabled ? "emerald" : "amber"}>{row.marketplace_enabled ? "Enabled" : "Disabled"}</Badge>
                          </div>
                        </td>
                        <td className={tableCellClass}>
                          <div className="font-bold text-sky-50">{row.customer_name || "Customer"}</div>
                          <div className="mt-1 text-xs text-sky-100/70">{row.customer_email || "Email not listed"}</div>
                        </td>
                        <td className={tableCellClass}>
                          <div className="flex flex-wrap gap-2">
                            <Badge tone={row.routable_now ? "emerald" : row.at_cap ? "sky" : row.marketplace_enabled ? "amber" : "rose"}>
                              {String(row.routed_status || "not_routed").replace(/_/g, " ")}
                            </Badge>
                            <Badge>{String(row.marketplace_status || "not_ready").replace(/_/g, " ")}</Badge>
                          </div>
                          <div className="mt-2 max-w-sm text-xs text-sky-100/70">{row.reason || "No routing note available."}</div>
                        </td>
                        <td className={tableCellClass}>
                          <div className="text-xs text-sky-100/80">
                            {row.counts?.invites || 0} invites | {row.counts?.opportunities || 0} opportunities | {row.counts?.leads || 0} leads
                          </div>
                          <div className="mt-1 text-xs text-sky-100/65">{row.eligible_contractors || 0} eligible contractors | Cap {row.cap || 5}</div>
                        </td>
                        <td className={tableCellClass}>
                          <button
                            type="button"
                            data-testid={`admin-marketplace-route-request-${row.id}`}
                            onClick={() => routeSavedRequest(row)}
                            disabled={!row.routable_now || routingIds[row.id]}
                            className="rounded-lg border border-emerald-200/30 bg-emerald-300/10 px-3 py-1.5 text-xs font-extrabold text-emerald-100 hover:bg-emerald-300/20 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {routingIds[row.id] ? "Routing..." : routeButtonCopy(row)}
                          </button>
                        </td>
                      </tr>
                    )) : (
                      <tr>
                        <td className={tableCellClass} colSpan={6}>No saved marketplace requests yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Section>

            <div className="grid gap-6 xl:grid-cols-2">
              <Section title="Top Service Gaps" sub="Services with no claimed contractors yet." testId="admin-marketplace-service-gaps">
                <div className="space-y-3">
                  {health.serviceGaps.length ? health.serviceGaps.slice(0, 6).map((gap) => (
                    <button
                      key={gap.key}
                      type="button"
                      data-testid={`admin-marketplace-service-gap-${gap.key}`}
                      onClick={() => openCoverageFilters({ service: gap.key, claimed: "false" })}
                      className={`${panelClass} w-full cursor-pointer text-left transition hover:-translate-y-0.5 hover:border-sky-200/45 hover:bg-white/[0.12] focus:outline-none focus:ring-2 focus:ring-sky-200/60`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-extrabold text-white">{gap.key}</div>
                        <Badge tone="amber">{gap.total} unclaimed listing{gap.total === 1 ? "" : "s"}</Badge>
                      </div>
                      <div className="mt-1 text-sm text-sky-100/70">No claimed contractors are available for this service in the current directory snapshot.</div>
                    </button>
                  )) : (
                    <div className={panelClass}>No service gaps detected yet.</div>
                  )}
                </div>
              </Section>

              <Section title="Top Geographic Gaps" sub="Cities or ZIP areas with unclaimed supply but no claimed profile." testId="admin-marketplace-geo-gaps">
                <div className="space-y-3">
                  {health.geographicGaps.length ? health.geographicGaps.slice(0, 6).map((gap) => (
                    <button
                      key={gap.key}
                      type="button"
                      data-testid={`admin-marketplace-geo-gap-${gap.key}`}
                      onClick={() => openCoverageFilters({ ...splitGeoKey(gap.key), claimed: "false" })}
                      className={`${panelClass} w-full cursor-pointer text-left transition hover:-translate-y-0.5 hover:border-sky-200/45 hover:bg-white/[0.12] focus:outline-none focus:ring-2 focus:ring-sky-200/60`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-extrabold text-white">{gap.key}</div>
                        <Badge tone="amber">{gap.total} unclaimed</Badge>
                      </div>
                      <div className="mt-1 text-sm text-sky-100/70">Prioritize claim conversion or enrichment before routing homeowner requests here.</div>
                    </button>
                  )) : (
                    <div className={panelClass}>No geographic gaps detected yet.</div>
                  )}
                </div>
              </Section>
            </div>

            <div className="grid gap-6 xl:grid-cols-3">
              <Section title="High-Rated Unclaimed Contractors" sub="Good claim-link candidates." testId="admin-marketplace-high-rated">
                <HealthList rows={health.highRatedUnclaimed} empty="No high-rated unclaimed contractors found." onSelect={(row) => go(`listings/${row.id}`)} testPrefix="admin-marketplace-high-rated-item" />
              </Section>
              <Section title="Enriched But Unclaimed" sub="Ready for claim conversion follow-up." testId="admin-marketplace-enriched-unclaimed">
                <HealthList rows={health.enrichedUnclaimed} empty="No enriched unclaimed contractors yet." onSelect={(row) => go(`listings/${row.id}`)} testPrefix="admin-marketplace-enriched-item" />
              </Section>
              <Section title="Claimed Missing Service Radius" sub="Routing health issue before geographic matching." testId="admin-marketplace-radius-gaps">
                <HealthList rows={health.claimedMissingRadius} empty="Claimed contractors have service radius data." onSelect={(row) => go(`listings/${row.id}`)} testPrefix="admin-marketplace-radius-item" />
              </Section>
            </div>
          </main>
        ) : null}

        {currentView === "verification" ? (
          <main className="space-y-4" data-testid="admin-marketplace-verification-view">
            <Section
              title="Contractor Verification"
              sub="Admin approval controls marketplace eligibility. Preferred status improves customer trust and ranking, but never bypasses eligibility or bid caps."
              testId="admin-marketplace-verification"
            >
              <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                <MetricCard label="Pending" value={verificationSummary.pending_review || 0} sub="Needs admin review" tone="amber" testId="admin-marketplace-verification-pending" />
                <MetricCard label="Verified" value={verificationSummary.verified || 0} sub="Eligible if Stripe/trade match" tone="emerald" testId="admin-marketplace-verification-verified" />
                <MetricCard label="Preferred" value={verificationSummary.preferred || 0} sub="Ranking boost only" tone="emerald" testId="admin-marketplace-verification-preferred" />
                <MetricCard label="Rejected" value={verificationSummary.rejected || 0} sub="Blocked from routing" tone="amber" testId="admin-marketplace-verification-rejected" />
                <MetricCard label="Suspended" value={verificationSummary.suspended || 0} sub="Blocked from routing" tone="amber" testId="admin-marketplace-verification-suspended" />
                <MetricCard label="Stripe Ready" value={verificationSummary.stripe_ready || 0} sub="Can receive payments" testId="admin-marketplace-verification-stripe" />
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                <input
                  data-testid="admin-marketplace-verification-search"
                  className={inputClass}
                  placeholder="Search contractors..."
                  value={verificationFilters.q}
                  onChange={(event) => setVerificationFilters((prev) => ({ ...prev, q: event.target.value }))}
                />
                <select
                  data-testid="admin-marketplace-verification-status-filter"
                  className={inputClass}
                  value={verificationFilters.status}
                  onChange={(event) => setVerificationFilters((prev) => ({ ...prev, status: event.target.value }))}
                >
                  <option value="">All statuses</option>
                  <option value="pending_review">Pending review</option>
                  <option value="verified">Verified</option>
                  <option value="unverified">Unverified</option>
                  <option value="rejected">Rejected</option>
                  <option value="suspended">Suspended</option>
                </select>
                <select
                  data-testid="admin-marketplace-verification-preferred-filter"
                  className={inputClass}
                  value={verificationFilters.preferred}
                  onChange={(event) => setVerificationFilters((prev) => ({ ...prev, preferred: event.target.value }))}
                >
                  <option value="">All preferred states</option>
                  <option value="true">Preferred</option>
                  <option value="false">Not preferred</option>
                </select>
                <select
                  data-testid="admin-marketplace-verification-stripe-filter"
                  className={inputClass}
                  value={verificationFilters.stripe_ready}
                  onChange={(event) => setVerificationFilters((prev) => ({ ...prev, stripe_ready: event.target.value }))}
                >
                  <option value="">All Stripe states</option>
                  <option value="true">Stripe ready</option>
                  <option value="false">Stripe missing</option>
                </select>
                <select
                  data-testid="admin-marketplace-verification-missing-filter"
                  className={inputClass}
                  value={verificationFilters.missing}
                  onChange={(event) => setVerificationFilters((prev) => ({ ...prev, missing: event.target.value }))}
                >
                  <option value="">All requirements</option>
                  <option value="license">Missing license</option>
                  <option value="insurance">Missing insurance</option>
                  <option value="trade/category">Missing trade/category</option>
                </select>
                <button
                  type="button"
                  data-testid="admin-marketplace-verification-apply-filters"
                  onClick={refreshVerification}
                  className="rounded-xl bg-white px-4 py-2 text-sm font-extrabold text-slate-900 hover:bg-sky-50"
                >
                  Apply Filters
                </button>
              </div>
            </Section>

            <div className="overflow-x-auto rounded-2xl border border-white/10 bg-[#061d42]/95 shadow-[0_22px_50px_rgba(2,8,23,0.28)]">
              <table className="min-w-full">
                <thead>
                  <tr>
                    <th className={tableHeadClass}>Contractor</th>
                    <th className={tableHeadClass}>Eligibility</th>
                    <th className={tableHeadClass}>Requirements</th>
                    <th className={tableHeadClass}>Performance</th>
                    <th className={tableHeadClass}>Admin Action</th>
                  </tr>
                </thead>
                <tbody>
                  {verificationRows.length ? verificationRows.map((row) => (
                    <tr key={row.id} data-testid={`admin-marketplace-verification-row-${row.id}`} className="hover:bg-white/5">
                      <td className={tableCellClass}>
                        <div className="font-extrabold text-white">{row.business_name}</div>
                        <div className="mt-1 text-xs text-sky-100/75">{row.email || "Email missing"} {row.phone ? `| ${row.phone}` : ""}</div>
                        <div className="mt-1 text-xs text-sky-100/65">{row.service_area || "Service area missing"}</div>
                      </td>
                      <td className={tableCellClass}>
                        <div className="flex flex-wrap gap-1">
                          <Badge tone={row.verification_status === "verified" ? "emerald" : row.verification_status === "suspended" || row.verification_status === "rejected" ? "rose" : "amber"}>
                            {String(row.verification_status || "unverified").replace(/_/g, " ")}
                          </Badge>
                          {row.preferred ? <Badge tone="emerald">Preferred</Badge> : null}
                          <Badge tone={row.stripe_ready ? "emerald" : "amber"}>{row.stripe_ready ? "Stripe ready" : "Stripe missing"}</Badge>
                          <Badge tone={row.eligible_for_marketplace ? "emerald" : "slate"}>{row.eligible_for_marketplace ? "Eligible" : "Not eligible"}</Badge>
                        </div>
                        <div className="mt-2 text-xs text-sky-100/65">{(row.trades || []).join(", ") || "Trade/category missing"}</div>
                      </td>
                      <td className={tableCellClass}>
                        <div className="flex flex-wrap gap-1">
                          {(row.missing_requirements || []).length ? (row.missing_requirements || []).map((item) => (
                            <Badge key={item} tone="amber">{item}</Badge>
                          )) : <Badge tone="emerald">Requirements met</Badge>}
                        </div>
                        <div className="mt-2 text-xs text-sky-100/65">
                          License {row.license_on_file ? "on file" : "missing"} | Insurance {row.insurance_on_file ? "on file" : "missing"}
                        </div>
                      </td>
                      <td className={tableCellClass}>
                        <div
                          className="space-y-1 text-xs text-sky-100/80"
                          data-testid={`admin-marketplace-verification-performance-${row.id}`}
                        >
                          <div className="font-black text-white">
                            Score {row.performance_summary?.performance_score ?? row.performance_summary?.score ?? "New"} · {row.performance_summary?.confidence_label || "Low Confidence"}
                          </div>
                          <div>
                            {row.performance_summary?.completed_projects || 0} completed | {row.performance_summary?.dispute_count || 0} disputes
                          </div>
                          <div className="text-sky-100/65">
                            Rating {row.performance_summary?.review_rating || row.performance_summary?.average_rating || "New"} ({row.performance_summary?.review_count || 0} reviews)
                          </div>
                          <div className="text-sky-100/65">
                            Win {percentText(row.performance_summary?.marketplace_bid_win_rate, row.performance_summary?.marketplace_bid_win_percent)} | On-time {percentText(row.performance_summary?.on_time_milestone_rate, row.performance_summary?.on_time_milestone_percent)}
                          </div>
                        </div>
                      </td>
                      <td className={tableCellClass}>
                        <textarea
                          data-testid={`admin-marketplace-verification-notes-${row.id}`}
                          className={`${inputClass} mb-2 min-h-[68px] w-full`}
                          placeholder="Admin note or reason"
                          value={verificationNotes[row.id] || ""}
                          onChange={(event) => setVerificationNotes((prev) => ({ ...prev, [row.id]: event.target.value }))}
                        />
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            data-testid={`admin-marketplace-verify-${row.id}`}
                            onClick={() => applyVerificationAction(row, "verify")}
                            disabled={verificationActionIds[row.id] || row.verification_status === "verified"}
                            className="rounded-lg border border-emerald-200/30 bg-emerald-300/10 px-3 py-1.5 text-xs font-extrabold text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Verify
                          </button>
                          <button
                            type="button"
                            data-testid={`admin-marketplace-reject-${row.id}`}
                            onClick={() => applyVerificationAction(row, "reject")}
                            disabled={verificationActionIds[row.id] || row.verification_status === "rejected"}
                            className="rounded-lg border border-amber-200/30 bg-amber-300/10 px-3 py-1.5 text-xs font-extrabold text-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Reject
                          </button>
                          {row.verification_status === "suspended" ? (
                            <button
                              type="button"
                              data-testid={`admin-marketplace-unsuspend-${row.id}`}
                              onClick={() => applyVerificationAction(row, "unsuspend")}
                              disabled={verificationActionIds[row.id]}
                              className="rounded-lg border border-sky-200/30 bg-sky-300/10 px-3 py-1.5 text-xs font-extrabold text-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Unsuspend
                            </button>
                          ) : (
                            <button
                              type="button"
                              data-testid={`admin-marketplace-suspend-${row.id}`}
                              onClick={() => applyVerificationAction(row, "suspend")}
                              disabled={verificationActionIds[row.id]}
                              className="rounded-lg border border-rose-200/30 bg-rose-300/10 px-3 py-1.5 text-xs font-extrabold text-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Suspend
                            </button>
                          )}
                          {row.preferred ? (
                            <button
                              type="button"
                              data-testid={`admin-marketplace-remove-preferred-${row.id}`}
                              onClick={() => applyVerificationAction(row, "remove_preferred")}
                              disabled={verificationActionIds[row.id]}
                              className="rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-extrabold text-sky-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Remove Preferred
                            </button>
                          ) : (
                            <button
                              type="button"
                              data-testid={`admin-marketplace-mark-preferred-${row.id}`}
                              onClick={() => applyVerificationAction(row, "mark_preferred")}
                              disabled={verificationActionIds[row.id] || row.verification_status !== "verified"}
                              className="rounded-lg border border-amber-200/30 bg-amber-300/10 px-3 py-1.5 text-xs font-extrabold text-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Mark Preferred
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td className={tableCellClass} colSpan={5}>No contractor verification rows match these filters.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </main>
        ) : null}

        {currentView === "coverage" ? (
          <main className="space-y-4" data-testid="admin-marketplace-contractors-view">
            <Section
              title="Marketplace Coverage"
              sub="Read-only contractor network coverage. Use Contractor Directory for editing, enrichment import/export, duplicate review, and full profile management."
            >
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <input data-testid="admin-marketplace-contractor-q" className={inputClass} placeholder="Search coverage..." value={filters.q} onChange={(e) => setFilters((prev) => ({ ...prev, q: e.target.value }))} />
                <input data-testid="admin-marketplace-contractor-city" className={inputClass} placeholder="City" value={filters.city} onChange={(e) => setFilters((prev) => ({ ...prev, city: e.target.value }))} />
                <input data-testid="admin-marketplace-contractor-state" className={inputClass} placeholder="State" value={filters.state} onChange={(e) => setFilters((prev) => ({ ...prev, state: e.target.value }))} />
                <select data-testid="admin-marketplace-service-filter" className={inputClass} value={filters.service} onChange={(e) => setFilters((prev) => ({ ...prev, service: e.target.value }))}>
                  <option value="">All services</option>
                  {services.map((service) => <option key={service} value={service}>{service}</option>)}
                </select>
                <select data-testid="admin-marketplace-claimed-filter" className={inputClass} value={filters.claimed} onChange={(e) => setFilters((prev) => ({ ...prev, claimed: e.target.value }))}>
                  <option value="">All claim states</option>
                  <option value="true">Claimed</option>
                  <option value="false">Unclaimed</option>
                </select>
              </div>
            </Section>

            <div className="overflow-x-auto rounded-2xl border border-white/10 bg-[#061d42]/95 shadow-[0_22px_50px_rgba(2,8,23,0.28)]">
              <table className="min-w-full">
                <thead>
                  <tr>
                    <th className={tableHeadClass}>Business</th>
                    <th className={tableHeadClass}>Coverage</th>
                    <th className={tableHeadClass}>Claim Readiness</th>
                    <th className={tableHeadClass}>Signals</th>
                    <th className={tableHeadClass}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length ? filteredRows.map((row) => (
                    <tr key={row.id} data-testid={`admin-marketplace-coverage-row-${row.id}`} className="hover:bg-white/5">
                      <td className={tableCellClass}>
                        <div className="font-extrabold text-white">{row.business_name}</div>
                        <div className="mt-1 text-xs text-sky-100/75">{clean(phone(row), "Phone not listed")} | {contactLabel(contactStatus(row))}</div>
                      </td>
                      <td className={tableCellClass}>
                        <div className="font-bold text-sky-50">{primaryService(row)}</div>
                        <div className="text-xs text-sky-100/75">{locationText(row)}</div>
                        <div className="mt-2">{row.claimed ? <Badge tone="emerald">{row.service_radius_miles || 25} mile radius</Badge> : <Badge>Radius pending claim</Badge>}</div>
                      </td>
                      <td className={tableCellClass}>
                        <div className="flex flex-wrap gap-1">
                          <Badge tone={row.claimed ? "emerald" : "amber"}>{row.claimed ? "Claimed" : "Unclaimed"}</Badge>
                          <Badge tone={contactStatus(row) === "manual_review_needed" ? "rose" : "emerald"}>{contactLabel(contactStatus(row))}</Badge>
                          <Badge tone={website(row) ? "sky" : "slate"}>{website(row) ? "Website ready" : "No website"}</Badge>
                        </div>
                      </td>
                      <td className={tableCellClass}>
                        <div className="text-xs text-sky-100/75">Rating {rating(row) || "Not rated"} | {reviews(row)} reviews</div>
                        <div className="mt-1 text-xs text-sky-100/70">Enrichment: {clean(row.enrichment_status, "not_started")}</div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          <Badge tone={joinInviteTone(joinInviteSummary(row))}>
                            Invite: {joinInviteLabel(joinInviteSummary(row))}
                          </Badge>
                          {joinInviteSummary(row)?.delivery_channel ? (
                            <Badge>{clean(joinInviteSummary(row).delivery_channel).replace(/_/g, " ")}</Badge>
                          ) : null}
                        </div>
                      </td>
                      <td className={tableCellClass}>
                        <div className="flex flex-wrap gap-2">
                          <button type="button" data-testid={`admin-marketplace-open-directory-${row.id}`} onClick={() => openDirectory(row)} className="rounded-lg bg-white px-3 py-1.5 text-xs font-extrabold text-slate-900">
                            Open in Directory
                          </button>
                          <button type="button" data-testid={`admin-marketplace-open-listing-${row.id}`} onClick={() => go(`listings/${row.id}`)} className="rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-extrabold text-sky-50">
                            View Listing Detail
                          </button>
                          {!row.claimed ? (
                            <button type="button" data-testid={`admin-marketplace-claim-link-${row.id}`} onClick={() => generateClaimLink(row)} className="rounded-lg border border-amber-200/30 bg-amber-300/10 px-3 py-1.5 text-xs font-extrabold text-amber-100">
                              Generate Claim Link
                            </button>
                          ) : null}
                          {!row.claimed && (email(row) || phone(row)) ? (
                            <button
                              type="button"
                              data-testid={`admin-marketplace-join-invite-${row.id}`}
                              onClick={() => sendJoinInvite(row, Boolean(joinInviteSummary(row)?.sent_at))}
                              disabled={Boolean(joinInviteIds[row.id])}
                              className="rounded-lg border border-emerald-200/30 bg-emerald-300/10 px-3 py-1.5 text-xs font-extrabold text-emerald-100 disabled:opacity-60"
                            >
                              {joinInviteIds[row.id]
                                ? "Sending..."
                                : joinInviteSummary(row)?.sent_at
                                  ? "Resend Join Invite"
                                  : "Send Join Marketplace Invite"}
                            </button>
                          ) : null}
                          {claimLinks[row.id] ? (
                            <button type="button" data-testid={`admin-marketplace-copy-claim-link-${row.id}`} onClick={() => copyClaimLink(row)} className="rounded-lg border border-emerald-200/30 bg-emerald-300/10 px-3 py-1.5 text-xs font-extrabold text-emerald-100">
                              Copy Claim Link
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td className={tableCellClass} colSpan={5}>No coverage records match these filters.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </main>
        ) : null}

        {currentView === "directory" ? (
          <Section
            title="Directory Console Owns Record Management"
            sub="Contractor discovery search, CSV import/export, enrichment edits, duplicate prevention, and claim-link administration live in Contractor Directory."
            testId="admin-marketplace-directory-redirect"
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <div className={panelClass}>
                <h3 className="font-black text-white">Contractor Directory</h3>
                <p className="mt-2 text-sm text-sky-100/75">Manage contractor records, enrichment, claim links, and profile data.</p>
                <button type="button" className="mt-4 rounded-xl bg-white px-4 py-2 text-sm font-extrabold text-slate-900" onClick={() => navigate("/app/admin/contractor-directory")}>
                  Open Contractor Directory
                </button>
              </div>
              <div className={panelClass}>
                <h3 className="font-black text-white">Marketplace</h3>
                <p className="mt-2 text-sm text-sky-100/75">Monitor contractor coverage, claim readiness, service gaps, and lead routing health without duplicating Directory editing workflows.</p>
              </div>
            </div>
          </Section>
        ) : null}

        {currentView === "listing" && listing ? (
          <main className="space-y-4" data-testid="admin-marketplace-listing-detail">
            <Section title={listing.business_name} sub="Marketplace readiness view. Open the Directory record for full editing and enrichment." testId="admin-marketplace-readiness-detail">
              <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
                <div className={panelClass}>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone={listing.claimed ? "emerald" : "amber"}>{listing.claimed ? "Claimed contractor" : "Unclaimed listing"}</Badge>
                    <Badge tone={contactStatus(listing) === "manual_review_needed" ? "rose" : "emerald"}>{contactLabel(contactStatus(listing))}</Badge>
                    <Badge tone={website(listing) ? "sky" : "slate"}>{website(listing) ? "Website ready" : "No website"}</Badge>
                  </div>
                  <dl className="mt-4 grid gap-3 text-sm">
                    <div><dt className="text-sky-100/55">Primary service</dt><dd className="font-bold text-white">{primaryService(listing)}</dd></div>
                    <div><dt className="text-sky-100/55">Location</dt><dd className="font-bold text-white">{locationText(listing)} {listing.zip_code || ""}</dd></div>
                    <div><dt className="text-sky-100/55">Service radius</dt><dd className="font-bold text-white">{hasRadius(listing) ? `${listing.service_radius_miles} miles` : "Missing"}</dd></div>
                    <div><dt className="text-sky-100/55">Rating</dt><dd className="font-bold text-white">{rating(listing) || "Not rated"} ({reviews(listing)} reviews)</dd></div>
                    <div>
                      <dt className="text-sky-100/55">Join invite</dt>
                      <dd className="mt-1 flex flex-wrap gap-2 font-bold text-white">
                        <Badge tone={joinInviteTone(joinInviteSummary(listing))}>{joinInviteLabel(joinInviteSummary(listing))}</Badge>
                        {joinInviteSummary(listing)?.email_error ? <Badge tone="rose">Email issue</Badge> : null}
                        {joinInviteSummary(listing)?.sms_error ? <Badge tone="amber">SMS note</Badge> : null}
                      </dd>
                    </div>
                  </dl>
                </div>
                <div className={panelClass}>
                  <h3 className="font-black text-white">Matching and Routing Readiness</h3>
                  <div className="mt-3 grid gap-2">
                    {readinessChecks(listing).map((check) => (
                      <div key={check.label} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                        <div>
                          <div className="text-sm font-bold text-white">{check.label}</div>
                          <div className="text-xs text-sky-100/60">{check.text}</div>
                        </div>
                        <Badge tone={check.ok ? "emerald" : "amber"}>{check.ok ? "Ready" : "Needs work"}</Badge>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" data-testid="admin-marketplace-open-directory-detail" onClick={() => openDirectory(listing)} className="rounded-xl bg-white px-4 py-2 text-sm font-extrabold text-slate-900">
                      Open full Directory record
                    </button>
                    {!listing.claimed ? (
                      <button type="button" data-testid="admin-marketplace-detail-claim-link" onClick={() => generateClaimLink(listing)} className="rounded-xl border border-amber-200/30 bg-amber-300/10 px-4 py-2 text-sm font-extrabold text-amber-100">
                        Generate Claim Link
                      </button>
                    ) : null}
                    {!listing.claimed && (email(listing) || phone(listing)) ? (
                      <button
                        type="button"
                        data-testid="admin-marketplace-detail-join-invite"
                        onClick={() => sendJoinInvite(listing, Boolean(joinInviteSummary(listing)?.sent_at))}
                        disabled={Boolean(joinInviteIds[listing.id])}
                        className="rounded-xl border border-emerald-200/30 bg-emerald-300/10 px-4 py-2 text-sm font-extrabold text-emerald-100 disabled:opacity-60"
                      >
                        {joinInviteIds[listing.id]
                          ? "Sending..."
                          : joinInviteSummary(listing)?.sent_at
                            ? "Resend Join Invite"
                            : "Send Join Marketplace Invite"}
                      </button>
                    ) : null}
                    <button type="button" onClick={() => go("contractors")} className="rounded-xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-extrabold text-sky-50">
                      Back to Coverage View
                    </button>
                  </div>
                </div>
              </div>
            </Section>
          </main>
        ) : null}
      </div>
    </div>
  );
}

function HealthList({ rows, empty, onSelect, testPrefix }) {
  if (!rows.length) {
    return <div className={panelClass}>{empty}</div>;
  }
  return (
    <div className="space-y-3">
      {rows.slice(0, 6).map((row) => (
        <button
          key={row.id}
          type="button"
          data-testid={testPrefix ? `${testPrefix}-${row.id}` : undefined}
          onClick={() => onSelect?.(row)}
          className={`${panelClass} w-full cursor-pointer text-left transition hover:-translate-y-0.5 hover:border-sky-200/45 hover:bg-white/[0.12] focus:outline-none focus:ring-2 focus:ring-sky-200/60`}
        >
          <div className="font-extrabold text-white">{row.business_name}</div>
          <div className="mt-1 text-xs text-sky-100/65">
            {primaryService(row)} | {locationText(row)} | Rating {rating(row) || "Not rated"}
          </div>
        </button>
      ))}
    </div>
  );
}
