import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import api from "../../api";
import { useWhoAmI } from "../../hooks/useWhoAmI";

const ADMIN_BASE = "/api/projects/admin/marketplace";

function money(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0.00";
  return n.toFixed(2);
}

function fmt(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function Badge({ tone = "slate", children }) {
  const tones = {
    amber: "bg-amber-100 text-amber-900 border-amber-200",
    emerald: "bg-emerald-100 text-emerald-800 border-emerald-200",
    sky: "bg-sky-100 text-sky-800 border-sky-200",
    violet: "bg-violet-100 text-violet-800 border-violet-200",
    slate: "bg-slate-100 text-slate-700 border-slate-200",
    rose: "bg-rose-100 text-rose-800 border-rose-200",
    gold: "bg-yellow-100 text-yellow-900 border-yellow-200",
  };
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-extrabold ${tones[tone] || tones.slate}`}>
      {children}
    </span>
  );
}

function Card({ title, sub, children, testId, className = "" }) {
  return (
    <section
      data-testid={testId}
      className={["rounded-3xl border border-black/10 bg-white p-5 shadow-sm", className].join(" ")}
    >
      <div className="mb-3">
        <div className="text-lg font-extrabold text-slate-900">{title}</div>
        {sub ? <div className="mt-1 text-sm text-slate-600">{sub}</div> : null}
      </div>
      {children}
    </section>
  );
}

function PillButton({ active, children, onClick, testId }) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-xs font-extrabold transition ${
        active ? "border-slate-900 bg-slate-900 text-white" : "border-black/10 bg-white text-slate-700 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}

function normalizeList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

function filterKey(pathname) {
  if (pathname.includes("/marketplace/listings/")) return "listing";
  if (pathname.includes("/marketplace/import")) return "import";
  if (pathname.includes("/marketplace/contractors")) return "contractors";
  return "overview";
}

export default function AdminMarketplacePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams();
  const { data: identity, loading: whoLoading } = useWhoAmI();
  const isAdmin = ["admin", "platform_admin"].includes(String(identity?.type || identity?.role || "").toLowerCase());

  const currentView = filterKey(location.pathname);
  const listingId = params.id ? String(params.id) : "";

  const [summary, setSummary] = useState(null);
  const [contractors, setContractors] = useState([]);
  const [importResults, setImportResults] = useState([]);
  const [listing, setListing] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);

  const [contractorFilters, setContractorFilters] = useState({
    q: "",
    trade: "",
    city: "",
    state: "",
    claimed: "",
    invited: "",
    source: "",
    assisted_diy: "",
    escrow_friendly: "",
    inspection_capable: "",
    rescue_project_friendly: "",
    has_phone: "",
    has_email: "",
    min_rating: "",
  });

  const [searchFilters, setSearchFilters] = useState({
    query: "",
    project_type: "",
    project_subtype: "",
    project_mode: "",
    city: "",
    state: "",
    zip: "",
    radius_miles: "25",
  });

  const [listingDraft, setListingDraft] = useState({
    admin_notes: "",
    compatibility_tags: "",
    assisted_diy_friendly: false,
    escrow_friendly: false,
    inspection_capable: false,
    rescue_project_friendly: false,
    manually_reviewed: false,
    manually_enriched: false,
    sms_opt_out: false,
    email_opt_out: false,
  });
  const [inviteChannel, setInviteChannel] = useState("sms");

  useEffect(() => {
    if (listing) {
      setListingDraft({
        admin_notes: listing.admin_notes || "",
        compatibility_tags: (listing.compatibility_tags || []).join(", "),
        assisted_diy_friendly: !!listing.assisted_diy_friendly,
        escrow_friendly: !!listing.escrow_friendly,
        inspection_capable: !!listing.inspection_capable,
        rescue_project_friendly: !!listing.rescue_project_friendly,
        manually_reviewed: !!listing.manually_reviewed,
        manually_enriched: !!listing.manually_enriched,
        sms_opt_out: !!listing.sms_opt_out,
        email_opt_out: !!listing.email_opt_out,
      });
    }
  }, [listing]);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        setLoading(true);
        setStatus("");
        const [summaryRes, contractorRes] = await Promise.all([
          api.get(`${ADMIN_BASE}/`),
          api.get(`${ADMIN_BASE}/contractors/`, { params: { limit: 100 } }),
        ]);
        if (!active) return;
        setSummary(summaryRes.data || null);
        setContractors(normalizeList(contractorRes.data));
      } catch (error) {
        console.error(error);
        if (active) setStatus("Failed to load marketplace dashboard.");
      } finally {
        if (active) setLoading(false);
      }
    }

    if (!whoLoading && isAdmin) {
      load();
    }

    return () => {
      active = false;
    };
  }, [whoLoading, isAdmin]);

  useEffect(() => {
    if (!isAdmin || currentView !== "listing" || !listingId) return;
    let active = true;
    async function loadListing() {
      try {
        setLoading(true);
        const res = await api.get(`${ADMIN_BASE}/listings/${listingId}/`);
        if (!active) return;
        setListing(res.data || null);
      } catch (error) {
        console.error(error);
        if (active) setStatus("Failed to load listing detail.");
      } finally {
        if (active) setLoading(false);
      }
    }
    loadListing();
    return () => {
      active = false;
    };
  }, [isAdmin, currentView, listingId]);

  const selectedCount = selectedIds.length;

  const summaryCards = useMemo(() => {
    const base = summary?.summary || {};
    return [
      { label: "Total Listings", value: base.total_listings || 0, sub: "All directory records" },
      { label: "Claimed", value: base.claimed_listings || 0, sub: "Verified contractor profiles" },
      { label: "Unclaimed", value: base.unclaimed_listings || 0, sub: "Local business listings" },
      { label: "Invites", value: base.total_invites || 0, sub: `Claim rate ${base.claim_rate ?? 0}%` },
      { label: "Opt-Outs", value: base.opted_out_listings || 0, sub: "SMS/email blocked listings" },
    ];
  }, [summary]);

  const tabs = [
    ["overview", "Overview"],
    ["contractors", "Contractors"],
    ["import", "Import"],
    ["listing", "Listing Detail"],
  ];

  function goTo(path) {
    navigate(`/app/admin/marketplace${path ? `/${path}` : ""}`);
  }

  async function runContractorSearch() {
    try {
      setStatus("");
      setLoading(true);
      const res = await api.get(`${ADMIN_BASE}/contractors/`, { params: contractorFilters });
      setContractors(normalizeList(res.data));
    } catch (error) {
      console.error(error);
      setStatus("Failed to refresh contractor listings.");
    } finally {
      setLoading(false);
    }
  }

  async function runImportSearch() {
    try {
      setStatus("");
      setLoading(true);
      const res = await api.get(`${ADMIN_BASE}/import/`, { params: searchFilters });
      setImportResults(normalizeList(res.data));
      setSelectedIds([]);
    } catch (error) {
      console.error(error);
      setStatus("Failed to search Google Places marketplace results.");
    } finally {
      setLoading(false);
    }
  }

  async function importSelected() {
    const rows = importResults.filter((row) => selectedIds.includes(String(row.id)));
    if (!rows.length) {
      setStatus("Select at least one result to import.");
      return;
    }
    try {
      setStatus("");
      setLoading(true);
      const res = await api.post(`${ADMIN_BASE}/import/`, {
        selected_contractors: rows,
        admin_notes: listingDraft.admin_notes,
        compatibility_tags: listingDraft.compatibility_tags,
      });
      const nextStatus = res.data?.detail || "Listings imported.";
      await runImportSearch();
      await runContractorSearch();
      setStatus(nextStatus);
    } catch (error) {
      console.error(error);
      setStatus("Failed to import selected listings.");
    } finally {
      setLoading(false);
    }
  }

  async function saveListing() {
    if (!listing) return;
    try {
      setStatus("");
      setLoading(true);
      const res = await api.patch(`${ADMIN_BASE}/listings/${listing.id}/`, {
        admin_notes: listingDraft.admin_notes,
        compatibility_tags: listingDraft.compatibility_tags,
        assisted_diy_friendly: listingDraft.assisted_diy_friendly,
        escrow_friendly: listingDraft.escrow_friendly,
        inspection_capable: listingDraft.inspection_capable,
        rescue_project_friendly: listingDraft.rescue_project_friendly,
        manually_reviewed: listingDraft.manually_reviewed,
        manually_enriched: listingDraft.manually_enriched,
        sms_opt_out: listingDraft.sms_opt_out,
        email_opt_out: listingDraft.email_opt_out,
      });
      setListing(res.data);
      setStatus("Listing saved.");
    } catch (error) {
      console.error(error);
      setStatus("Failed to save listing changes.");
    } finally {
      setLoading(false);
    }
  }

  async function sendInvite() {
    if (!listing) return;
    try {
      setStatus("");
      setLoading(true);
      const res = await api.post(`${ADMIN_BASE}/listings/${listing.id}/invite/`, {
        preferred_channel: inviteChannel,
      });
      setStatus(res.data?.detail || "Invite sent.");
      setListing((prev) => prev ? { ...prev, recent_invites: [res.data.invite, ...(prev.recent_invites || [])] } : prev);
    } catch (error) {
      console.error(error);
      setStatus(error?.response?.data?.detail || "Failed to send invite.");
    } finally {
      setLoading(false);
    }
  }

  if (whoLoading) {
    return <div className="p-6 text-slate-600">Checking admin access…</div>;
  }

  if (!isAdmin) {
    return (
      <div className="p-6">
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
          You need admin access to view marketplace intelligence.
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-gradient-to-b from-slate-50 to-white px-4 py-6 md:px-6">
      <div className="mx-auto max-w-[1500px]">
        <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-slate-500">Admin Marketplace</div>
              <h1 className="mt-1 text-3xl font-black text-slate-900">Contractor Discovery</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-600">
                Discover contractors, manage local business listings, invite businesses to claim their profile, and monitor marketplace coverage.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-extrabold text-slate-700 hover:bg-slate-50"
                onClick={() => goTo("")}
              >
                Overview
              </button>
              <button
                type="button"
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-extrabold text-white hover:bg-slate-800"
                onClick={() => goTo("import")}
              >
                Discover Contractors
              </button>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2" data-testid="admin-marketplace-tabs">
            {tabs.map(([key, label]) => (
              <PillButton key={key} active={currentView === key} onClick={() => goTo(key === "overview" ? "" : key)}>
                {label}
              </PillButton>
            ))}
          </div>

          {status ? (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700" data-testid="admin-marketplace-status">
              {status}
            </div>
          ) : null}
        </div>

        {loading && currentView !== "overview" ? (
          <Card title="Loading…" sub="Fetching marketplace data." className="mt-6">
            <div className="text-sm text-slate-600">Please wait while marketplace intelligence loads.</div>
          </Card>
        ) : null}

        {currentView === "overview" && (
          <div className="mt-6 space-y-6" data-testid="admin-marketplace-page">
            <section data-testid="admin-marketplace-summary" className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              {summaryCards.map((card) => (
                <Card key={card.label} title={card.label} sub={card.sub}>
                  <div className="text-3xl font-black text-slate-900">{Number(card.value || 0).toLocaleString()}</div>
                </Card>
              ))}
            </section>

            <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
              <Card
                title="Marketplace Health"
                sub="Coverage gaps by trade. Unclaimed directories are the fastest route to seeding a market."
              >
                <div className="space-y-3">
                  {(summary?.coverage?.gaps || []).length === 0 ? (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900">
                      No obvious coverage gaps surfaced in the current snapshot.
                    </div>
                  ) : (
                    (summary?.coverage?.gaps || []).slice(0, 8).map((gap) => (
                      <div key={`${gap.trade}-${gap.total}`} className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                        <div className="text-sm font-extrabold text-amber-900">{gap.title}</div>
                        <div className="mt-1 text-sm text-amber-800">{gap.detail}</div>
                      </div>
                    ))
                  )}
                </div>
              </Card>

              <Card title="Quick Actions" sub="Admin moves that keep the marketplace healthy and growing.">
                <div className="grid gap-2">
                  <button
                    type="button"
                    className="rounded-xl border border-black/10 bg-white px-4 py-3 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50"
                    onClick={() => goTo("contractors")}
                  >
                    Review contractor listings
                  </button>
                  <button
                    type="button"
                    className="rounded-xl border border-black/10 bg-white px-4 py-3 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50"
                    onClick={() => goTo("import")}
                  >
                    Search and import new businesses
                  </button>
                </div>
              </Card>
            </div>
          </div>
        )}

        {currentView === "contractors" && (
          <div className="mt-6 space-y-4" data-testid="admin-marketplace-contractors-view">
            <Card title="Contractor Directory Listings" sub="Claimed and unclaimed businesses with compatibility signals.">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <input
                  data-testid="admin-marketplace-contractor-q"
                  className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                  placeholder="Search name, city, trade, phone..."
                  value={contractorFilters.q}
                  onChange={(e) => setContractorFilters((prev) => ({ ...prev, q: e.target.value }))}
                />
                <input
                  data-testid="admin-marketplace-contractor-trade"
                  className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                  placeholder="Trade"
                  value={contractorFilters.trade}
                  onChange={(e) => setContractorFilters((prev) => ({ ...prev, trade: e.target.value }))}
                />
                <input
                  data-testid="admin-marketplace-contractor-city"
                  className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                  placeholder="City"
                  value={contractorFilters.city}
                  onChange={(e) => setContractorFilters((prev) => ({ ...prev, city: e.target.value }))}
                />
                <input
                  data-testid="admin-marketplace-contractor-state"
                  className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                  placeholder="State"
                  value={contractorFilters.state}
                  onChange={(e) => setContractorFilters((prev) => ({ ...prev, state: e.target.value }))}
                />
                <input
                  data-testid="admin-marketplace-contractor-min-rating"
                  className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                  placeholder="Min rating"
                  value={contractorFilters.min_rating}
                  onChange={(e) => setContractorFilters((prev) => ({ ...prev, min_rating: e.target.value }))}
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {[
                  ["claimed", "Claimed"],
                  ["invited", "Invited"],
                  ["opted_out", "Opted Out"],
                  ["assisted_diy", "Assisted DIY"],
                  ["escrow_friendly", "Escrow Friendly"],
                  ["inspection_capable", "Inspection Capable"],
                  ["rescue_project_friendly", "Rescue Friendly"],
                  ["has_phone", "Has Phone"],
                  ["has_email", "Has Email"],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={`rounded-full border px-3 py-1.5 text-xs font-extrabold ${
                      contractorFilters[key] === "1"
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-black/10 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                    onClick={() =>
                      setContractorFilters((prev) => ({
                        ...prev,
                        [key]: prev[key] === "1" ? "" : "1",
                      }))
                    }
                  >
                    {label}
                  </button>
                ))}
                <button
                  type="button"
                  className="ml-auto rounded-xl bg-slate-900 px-4 py-2 text-sm font-extrabold text-white hover:bg-slate-800"
                  onClick={runContractorSearch}
                >
                  Refresh Listings
                </button>
              </div>
            </Card>

            <div className="overflow-x-auto rounded-3xl border border-black/10 bg-white shadow-sm">
              <table className="min-w-full text-sm">
                <thead className="border-b border-black/10 bg-slate-50">
                  <tr>
                    <th className="px-3 py-3 text-left text-xs font-extrabold uppercase tracking-wide text-slate-600">Business</th>
                    <th className="px-3 py-3 text-left text-xs font-extrabold uppercase tracking-wide text-slate-600">Coverage</th>
                    <th className="px-3 py-3 text-left text-xs font-extrabold uppercase tracking-wide text-slate-600">Compatibility</th>
                    <th className="px-3 py-3 text-left text-xs font-extrabold uppercase tracking-wide text-slate-600">Claim / Contact</th>
                    <th className="px-3 py-3 text-left text-xs font-extrabold uppercase tracking-wide text-slate-600">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {contractors.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-slate-600" colSpan={5}>
                        No listings match the current filters.
                      </td>
                    </tr>
                  ) : (
                    contractors.map((row) => (
                      <tr key={row.id} className="border-b border-black/5 hover:bg-slate-50">
                        <td className="px-3 py-3 align-top">
                          <div className="font-extrabold text-slate-900">{row.business_name}</div>
                          <div className="mt-1 text-xs text-slate-600">
                            {row.city || "—"}, {row.state || "—"} • {row.primary_trade || "—"}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1">
                            <Badge tone={row.claimed ? "emerald" : "slate"}>{row.label}</Badge>
                            {row.manually_reviewed ? <Badge tone="sky">Reviewed</Badge> : null}
                            {row.manually_enriched ? <Badge tone="violet">Enriched</Badge> : null}
                          </div>
                        </td>
                        <td className="px-3 py-3 align-top">
                          <div className="text-xs text-slate-600">Rating {row.google_rating || "—"} • {row.google_review_count || 0} reviews</div>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {(row.supported_project_modes || []).map((mode) => (
                              <Badge key={`${row.id}-${mode}`} tone={mode === "assisted_diy" ? "gold" : mode === "inspection_only" ? "slate" : mode === "consultation" ? "violet" : "sky"}>
                                {mode === "full_service" ? "Full Service" : mode === "assisted_diy" ? "Assisted DIY" : mode === "consultation" ? "Consultation" : "Inspection Only"}
                              </Badge>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-3 align-top">
                          <div className="flex flex-wrap gap-1">
                            <Badge tone={row.recommendation_tier === "Strong Match" ? "emerald" : row.recommendation_tier === "Good Match" ? "amber" : "slate"}>{row.recommendation_tier}</Badge>
                            <Badge tone={row.escrow_friendly ? "emerald" : "slate"}>Escrow Friendly</Badge>
                            <Badge tone={row.assisted_diy_friendly ? "gold" : "slate"}>Assisted DIY</Badge>
                            <Badge tone={row.inspection_capable ? "slate" : "slate"}>Inspection</Badge>
                            <Badge tone={row.rescue_project_friendly ? "violet" : "slate"}>Rescue</Badge>
                          </div>
                          <div className="mt-2 text-xs text-slate-600">
                            {row.compatibility_reasons?.slice(0, 3).join(" • ") || "No compatibility notes yet."}
                          </div>
                        </td>
                        <td className="px-3 py-3 align-top">
                          <div className="text-xs text-slate-600">{row.phone_number || "No phone"} • {row.email || "No email"}</div>
                          <div className="mt-1 text-xs text-slate-600">{row.invite_count || 0} invite(s)</div>
                        </td>
                        <td className="px-3 py-3 align-top">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              data-testid={`admin-marketplace-open-listing-${row.id}`}
                              onClick={() => goTo(`listings/${row.id}`)}
                              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-extrabold text-slate-700 hover:bg-slate-50"
                            >
                              Open
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {currentView === "import" && (
          <div className="mt-6 space-y-4" data-testid="admin-marketplace-import-view">
            <Card title="Discover and Import Contractors" sub="Search Google Places, preview local businesses, and mark the best fits as reviewed.">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <input
                  data-testid="admin-marketplace-import-query"
                  className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                  placeholder="Search query"
                  value={searchFilters.query}
                  onChange={(e) => setSearchFilters((prev) => ({ ...prev, query: e.target.value }))}
                />
                <input
                  data-testid="admin-marketplace-import-project-type"
                  className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                  placeholder="Project type"
                  value={searchFilters.project_type}
                  onChange={(e) => setSearchFilters((prev) => ({ ...prev, project_type: e.target.value }))}
                />
                <input
                  data-testid="admin-marketplace-import-city"
                  className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                  placeholder="City"
                  value={searchFilters.city}
                  onChange={(e) => setSearchFilters((prev) => ({ ...prev, city: e.target.value }))}
                />
                <input
                  data-testid="admin-marketplace-import-zip"
                  className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                  placeholder="ZIP"
                  value={searchFilters.zip}
                  onChange={(e) => setSearchFilters((prev) => ({ ...prev, zip: e.target.value }))}
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <input
                  data-testid="admin-marketplace-import-radius"
                  className="w-32 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                  placeholder="Radius"
                  value={searchFilters.radius_miles}
                  onChange={(e) => setSearchFilters((prev) => ({ ...prev, radius_miles: e.target.value }))}
                />
                <button
                  type="button"
                  data-testid="admin-marketplace-import-search"
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-extrabold text-white hover:bg-slate-800"
                  onClick={runImportSearch}
                >
                  Search
                </button>
                <button
                  type="button"
                  data-testid="admin-marketplace-import-selected"
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-extrabold text-slate-700 hover:bg-slate-50"
                  onClick={importSelected}
                >
                  Import Selected ({selectedCount})
                </button>
              </div>
            </Card>

            <div className="grid gap-4">
              {importResults.map((row) => {
                const isSelected = selectedIds.includes(String(row.id));
                return (
                  <button
                    key={row.id}
                    type="button"
                    data-testid={`admin-marketplace-import-result-${row.id}`}
                    onClick={() =>
                      setSelectedIds((prev) =>
                        prev.includes(String(row.id))
                          ? prev.filter((id) => id !== String(row.id))
                          : [...prev, String(row.id)]
                      )
                    }
                    className={`rounded-3xl border p-5 text-left shadow-sm transition ${isSelected ? "border-slate-900 bg-slate-50" : "border-black/10 bg-white hover:bg-slate-50"}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-lg font-extrabold text-slate-900">{row.business_name}</div>
                        <div className="mt-1 text-sm text-slate-600">{row.city || "—"}, {row.state || "—"} • {row.primary_trade || "—"}</div>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <Badge tone={row.claimed ? "emerald" : "slate"}>{row.label}</Badge>
                        <Badge tone={row.recommendation_tier === "Strong Match" ? "emerald" : row.recommendation_tier === "Good Match" ? "amber" : "slate"}>{row.recommendation_tier}</Badge>
                        <Badge tone={row.escrow_friendly ? "emerald" : "slate"}>Escrow Friendly</Badge>
                        <Badge tone={row.assisted_diy_friendly ? "gold" : "slate"}>Assisted DIY</Badge>
                        <Badge tone={row.inspection_capable ? "slate" : "slate"}>Inspection</Badge>
                      </div>
                    </div>
                    <div className="mt-3 text-sm text-slate-700">
                      {row.compatibility_reasons?.slice(0, 4).join(" • ") || "No reasons returned."}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {currentView === "listing" && listing ? (
          <div className="mt-6 space-y-4" data-testid="admin-marketplace-listing-detail">
            <Card title={listing.business_name} sub={`${listing.city || "—"}, ${listing.state || "—"} • ${listing.primary_trade || "—"}`}>
              <div className="flex flex-wrap gap-2">
                <Badge tone={listing.claimed ? "emerald" : "slate"}>{listing.label}</Badge>
                <Badge tone={listing.manually_reviewed ? "sky" : "slate"}>{listing.manually_reviewed ? "Reviewed" : "Needs review"}</Badge>
                <Badge tone={listing.manually_enriched ? "violet" : "slate"}>{listing.manually_enriched ? "Enriched" : "Not enriched"}</Badge>
                <Badge tone={listing.assisted_diy_friendly ? "gold" : "slate"}>Assisted DIY Friendly</Badge>
                <Badge tone={listing.escrow_friendly ? "emerald" : "slate"}>Escrow Friendly</Badge>
                <Badge tone={listing.inspection_capable ? "slate" : "slate"}>Inspection Services</Badge>
                <Badge tone={listing.rescue_project_friendly ? "violet" : "slate"}>Rescue Project Assistance</Badge>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-black/10 bg-slate-50 p-4">
                  <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Rating</div>
                  <div className="mt-1 text-2xl font-black text-slate-900">{listing.google_rating || "—"}</div>
                  <div className="text-xs text-slate-600">{listing.google_review_count || 0} reviews</div>
                </div>
                <div className="rounded-2xl border border-black/10 bg-slate-50 p-4">
                  <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Invite Count</div>
                  <div className="mt-1 text-2xl font-black text-slate-900">{listing.invite_count || 0}</div>
                  <div className="text-xs text-slate-600">{fmt(listing.latest_invite_at)}</div>
                </div>
                <div className="rounded-2xl border border-black/10 bg-slate-50 p-4">
                  <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Contact</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">{listing.phone_number || "No phone"}</div>
                  <div className="text-xs text-slate-600">{listing.email || "No email"}</div>
                </div>
                <div className="rounded-2xl border border-black/10 bg-slate-50 p-4">
                  <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Source</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">{listing.source}</div>
                  <div className="text-xs text-slate-600">{listing.google_place_id || "No Google place id"}</div>
                </div>
              </div>
            </Card>

            <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
              <Card title="Compatibility & Notes" sub="Adjust the marketplace metadata that drives discovery and matching.">
                <div className="grid gap-3">
                  <label className="block">
                    <div className="mb-1 text-xs font-extrabold uppercase tracking-wide text-slate-500">Admin Notes</div>
                    <textarea
                      data-testid="admin-marketplace-listing-admin-notes"
                      className="min-h-[120px] w-full rounded-2xl border border-black/10 bg-white px-3 py-2 text-sm"
                      value={listingDraft.admin_notes}
                      onChange={(e) => setListingDraft((prev) => ({ ...prev, admin_notes: e.target.value }))}
                    />
                  </label>
                  <label className="block">
                    <div className="mb-1 text-xs font-extrabold uppercase tracking-wide text-slate-500">Compatibility Tags</div>
                    <input
                      data-testid="admin-marketplace-listing-tags"
                      className="w-full rounded-2xl border border-black/10 bg-white px-3 py-2 text-sm"
                      value={listingDraft.compatibility_tags}
                      onChange={(e) => setListingDraft((prev) => ({ ...prev, compatibility_tags: e.target.value }))}
                    />
                  </label>
                  <div className="grid gap-2 md:grid-cols-2">
                    {[
                      ["assisted_diy_friendly", "Assisted DIY friendly"],
                      ["escrow_friendly", "Escrow friendly"],
                      ["inspection_capable", "Inspection capable"],
                      ["rescue_project_friendly", "Rescue-project friendly"],
                      ["manually_reviewed", "Mark reviewed"],
                      ["manually_enriched", "Mark enriched"],
                      ["sms_opt_out", "SMS opt-out"],
                      ["email_opt_out", "Email opt-out"],
                    ].map(([key, label]) => (
                      <label key={key} className="flex items-center gap-2 rounded-2xl border border-black/10 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                        <input
                          type="checkbox"
                          checked={!!listingDraft[key]}
                          onChange={(e) => setListingDraft((prev) => ({ ...prev, [key]: e.target.checked }))}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      data-testid="admin-marketplace-listing-save"
                      className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-extrabold text-white hover:bg-slate-800"
                      onClick={saveListing}
                    >
                      Save Listing
                    </button>
                    <button
                      type="button"
                      className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-extrabold text-slate-700 hover:bg-slate-50"
                      onClick={() => goTo("contractors")}
                    >
                      Back to Listings
                    </button>
                  </div>
                </div>
              </Card>

              <Card title="Invite & Claim" sub="Generate a claim invite for this business listing.">
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      data-testid="admin-marketplace-listing-invite-sms"
                      onClick={() => setInviteChannel("sms")}
                      className={`rounded-full border px-3 py-1.5 text-xs font-extrabold ${
                        inviteChannel === "sms" ? "border-slate-900 bg-slate-900 text-white" : "border-black/10 bg-white text-slate-700"
                      }`}
                    >
                      SMS
                    </button>
                    <button
                      type="button"
                      data-testid="admin-marketplace-listing-invite-email"
                      onClick={() => setInviteChannel("email")}
                      className={`rounded-full border px-3 py-1.5 text-xs font-extrabold ${
                        inviteChannel === "email" ? "border-slate-900 bg-slate-900 text-white" : "border-black/10 bg-white text-slate-700"
                      }`}
                    >
                      Email
                    </button>
                    <button
                      type="button"
                      data-testid="admin-marketplace-listing-invite-manual"
                      onClick={() => setInviteChannel("manual")}
                      className={`rounded-full border px-3 py-1.5 text-xs font-extrabold ${
                        inviteChannel === "manual" ? "border-slate-900 bg-slate-900 text-white" : "border-black/10 bg-white text-slate-700"
                      }`}
                    >
                      Manual
                    </button>
                  </div>
                  <p className="text-sm text-slate-600">
                    Claim invites are sent only after a business has been selected for discovery. Unclaimed records stay labeled as local business listings.
                  </p>
                  <button
                    type="button"
                    data-testid="admin-marketplace-send-invite"
                    className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-extrabold text-white hover:bg-slate-800"
                    onClick={sendInvite}
                  >
                    Send Claim Invite
                  </button>
                  <div className="space-y-2">
                    {(listing.recent_invites || []).length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
                        No invites recorded yet.
                      </div>
                    ) : (
                      listing.recent_invites.map((invite) => (
                        <div key={invite.id} className="rounded-2xl border border-black/10 bg-slate-50 p-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge tone={invite.status === "claimed" ? "emerald" : invite.status === "failed" ? "rose" : "slate"}>{invite.status}</Badge>
                            <Badge tone="sky">{invite.channel}</Badge>
                          </div>
                          <div className="mt-2 text-xs text-slate-600">
                            Sent {fmt(invite.sent_at)} • Clicked {fmt(invite.clicked_at)} • Claimed {fmt(invite.claimed_at)}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">{invite.claim_url}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </Card>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
