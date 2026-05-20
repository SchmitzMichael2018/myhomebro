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
    { label: "Email readiness", ok: !!email(row), text: email(row) ? "Email available" : "Missing email" },
    { label: "Website readiness", ok: !!website(row), text: website(row) ? "Website available" : "Missing website" },
    { label: "Service category", ok: primaryService(row) !== "Unclassified", text: primaryService(row) },
    { label: "Service radius", ok: hasRadius(row), text: hasRadius(row) ? `${row.service_radius_miles} miles` : "No radius set" },
  ];
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
  const [listing, setListing] = useState(null);
  const [filters, setFilters] = useState({ q: "", city: "", state: "", service: "", claimed: "" });
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [claimLinks, setClaimLinks] = useState({});

  useEffect(() => {
    if (whoLoading || !isAdmin) return undefined;
    let active = true;
    async function loadDirectory() {
      setLoading(true);
      setStatus("");
      try {
        const { data } = await api.get(`${DIRECTORY_BASE}/`, { params: { limit: 500 } });
        if (active) setRows(directoryRows(data));
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
              <button type="button" className="rounded-xl bg-white px-4 py-2 text-sm font-extrabold text-slate-900 hover:bg-sky-50" onClick={() => navigate("/app/admin/contractor-directory")}>
                Open Contractor Directory
              </button>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2" data-testid="admin-marketplace-tabs">
            <button type="button" className={`rounded-full border px-3 py-1.5 text-xs font-extrabold ${currentView === "overview" ? "border-white bg-white text-slate-900" : "border-white/15 bg-white/10 text-sky-50"}`} onClick={() => go("")}>Overview</button>
            <button type="button" className={`rounded-full border px-3 py-1.5 text-xs font-extrabold ${currentView === "coverage" ? "border-white bg-white text-slate-900" : "border-white/15 bg-white/10 text-sky-50"}`} onClick={() => go("contractors")}>Marketplace Coverage</button>
            <button type="button" className={`rounded-full border px-3 py-1.5 text-xs font-extrabold ${currentView === "directory" ? "border-white bg-white text-slate-900" : "border-white/15 bg-white/10 text-sky-50"}`} onClick={() => go("import")}>Directory Console</button>
          </div>
          {status ? <div data-testid="admin-marketplace-status" className="mt-4 rounded-xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-sky-50">{status}</div> : null}
        </header>

        {loading && !rows.length && currentView !== "listing" ? (
          <Section title="Loading marketplace health" sub="Reading Contractor Directory records." />
        ) : null}

        {currentView === "overview" ? (
          <main className="space-y-6" data-testid="admin-marketplace-page">
            <section data-testid="admin-marketplace-summary" className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
              <MetricCard testId="admin-marketplace-metric-total" label="Total Directory Listings" value={health.total} sub="Contractor records in Directory" onClick={() => openDirectoryFilters()} />
              <MetricCard testId="admin-marketplace-metric-claimed" label="Claimed Contractors" value={health.claimed} sub="Linked to contractor accounts" tone="emerald" onClick={() => openDirectoryFilters({ claimed: "true" })} />
              <MetricCard testId="admin-marketplace-metric-unclaimed" label="Unclaimed Listings" value={health.unclaimed} sub="Claim-ready local businesses" tone="amber" onClick={() => openDirectoryFilters({ claimed: "false" })} />
              <MetricCard testId="admin-marketplace-metric-has-email" label="Listings With Email" value={health.withEmail} sub="Ready for outreach workflows" onClick={() => openDirectoryFilters({ has_email: "true" })} />
              <MetricCard testId="admin-marketplace-metric-has-website" label="Listings With Website" value={health.withWebsite} sub="Useful for enrichment review" onClick={() => openDirectoryFilters({ has_website: "true" })} />
              <MetricCard testId="admin-marketplace-metric-missing-email" label="Listings Missing Email" value={health.missingEmail} sub="Directory enrichment backlog" tone="amber" onClick={() => openDirectoryFilters({ missing_email: "true" })} />
            </section>

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
                        <div className="mt-1 text-xs text-sky-100/60">{clean(phone(row), "Phone not listed")} | {email(row) ? "Email available" : "Email missing"}</div>
                      </td>
                      <td className={tableCellClass}>
                        <div className="font-bold text-sky-50">{primaryService(row)}</div>
                        <div className="text-xs text-sky-100/60">{locationText(row)}</div>
                        <div className="mt-2">{row.claimed ? <Badge tone="emerald">{row.service_radius_miles || 25} mile radius</Badge> : <Badge>Radius pending claim</Badge>}</div>
                      </td>
                      <td className={tableCellClass}>
                        <div className="flex flex-wrap gap-1">
                          <Badge tone={row.claimed ? "emerald" : "amber"}>{row.claimed ? "Claimed" : "Unclaimed"}</Badge>
                          <Badge tone={email(row) ? "emerald" : "rose"}>{email(row) ? "Email ready" : "Missing email"}</Badge>
                          <Badge tone={website(row) ? "sky" : "slate"}>{website(row) ? "Website ready" : "No website"}</Badge>
                        </div>
                      </td>
                      <td className={tableCellClass}>
                        <div className="text-xs text-sky-100/70">Rating {rating(row) || "Not rated"} | {reviews(row)} reviews</div>
                        <div className="mt-1 text-xs text-sky-100/60">Enrichment: {clean(row.enrichment_status, "not_started")}</div>
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
                    <Badge tone={email(listing) ? "emerald" : "rose"}>{email(listing) ? "Email ready" : "Email missing"}</Badge>
                    <Badge tone={website(listing) ? "sky" : "slate"}>{website(listing) ? "Website ready" : "No website"}</Badge>
                  </div>
                  <dl className="mt-4 grid gap-3 text-sm">
                    <div><dt className="text-sky-100/55">Primary service</dt><dd className="font-bold text-white">{primaryService(listing)}</dd></div>
                    <div><dt className="text-sky-100/55">Location</dt><dd className="font-bold text-white">{locationText(listing)} {listing.zip_code || ""}</dd></div>
                    <div><dt className="text-sky-100/55">Service radius</dt><dd className="font-bold text-white">{hasRadius(listing) ? `${listing.service_radius_miles} miles` : "Missing"}</dd></div>
                    <div><dt className="text-sky-100/55">Rating</dt><dd className="font-bold text-white">{rating(listing) || "Not rated"} ({reviews(listing)} reviews)</dd></div>
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
