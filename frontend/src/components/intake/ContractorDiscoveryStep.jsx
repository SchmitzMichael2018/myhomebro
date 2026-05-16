import React, { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import api from "../../api";
import { ProjectModeBadge, normalizeProjectMode, projectModeLabel } from "../projectMode.jsx";
import { contractorMatchTierClass, contractorMatchTierLabel } from "../../lib/contractorMatching.js";

function safeText(value) {
  return String(value ?? "").trim();
}

function formatDistance(value) {
  if (value === null || value === undefined || value === "") return "";
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return `${number.toFixed(number >= 10 ? 0 : 1)} miles away`;
}

function cardSelectionKey(card) {
  return safeText(card?.id);
}

function emptyStateMessage(summary) {
  const reason = safeText(summary?.reason || summary?.external_search?.error || summary?.external_search_diagnostic?.empty_reason);
  if (reason === "missing_project_location") {
    return "We need a project ZIP code or address before searching local contractors.";
  }
  if (reason === "geocode_failed") {
    return "We couldn’t confirm this project location. Please check the address or ZIP code.";
  }
  if (reason === "google_returned_zero") {
    return "Google did not return local matches for this search. Try broadening the search term.";
  }
  if (reason === "all_results_outside_radius") {
    return "We found contractors, but none were within 25 miles of the project address.";
  }
  if (reason === "all_results_missing_coordinates") {
    return "Google returned possible matches, but they did not include usable map coordinates. Try adjusting the project location or search term.";
  }
  return "We couldn’t find strong local matches within 25 miles of this project address. You can invite a contractor manually or adjust the project location.";
}

function buildInferredSearchQuery(form) {
  const text = [
    form?.ai_project_type,
    form?.ai_project_subtype,
    form?.ai_project_title,
    form?.ai_description,
    form?.accomplishment_text,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const inferred = [];
  const push = (value) => {
    if (value && !inferred.includes(value)) inferred.push(value);
  };

  if (/kitchen|cabinet|countertop|quartz|granite/.test(text)) {
    push("kitchen remodeling contractor");
    push("cabinet installer");
    push("countertop installer");
  }
  if (/bathroom|vanity|shower|tub/.test(text)) {
    push("bathroom remodel contractor");
  }
  if (/roof|roofing|shingle|leak/.test(text)) {
    push("roofing contractor");
  }
  if (/floor|flooring|tile|hardwood|laminate/.test(text)) {
    push("flooring contractor");
  }
  if (/paint|painting|painter/.test(text)) {
    push("painter");
  }
  if (/electrical|electrician|panel|wire|wiring/.test(text)) {
    push("electrician");
  }
  if (/plumbing|plumber|pipe|drain|sewer/.test(text)) {
    push("plumber");
  }
  if (/hvac|air conditioning|cooling|heating|furnace/.test(text)) {
    push("hvac contractor");
  }
  if (/drywall|sheetrock/.test(text)) {
    push("drywall contractor");
  }
  if (/remodel|renovation|renovate/.test(text)) {
    push("remodeling contractor");
  }

  return inferred.join(" ").trim();
}

export default function ContractorDiscoveryStep({
  token,
  form,
  active = false,
  selectedTargets = [],
  setSelectedTargets,
  onInvitesCreated,
}) {
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState([]);
  const [summary, setSummary] = useState(null);
  const [userSearchInput, setUserSearchInput] = useState("");
  const [submittedSearchQuery, setSubmittedSearchQuery] = useState("");
  const [hasUserEditedSearch, setHasUserEditedSearch] = useState(false);
  const [searchInitKey, setSearchInitKey] = useState("");
  const [radiusMiles, setRadiusMiles] = useState("");
  const suggestedSearchQuery = useMemo(() => buildInferredSearchQuery(form), [
    form?.accomplishment_text,
    form?.ai_description,
    form?.ai_project_subtype,
    form?.ai_project_title,
    form?.ai_project_type,
  ]);
  const projectSearchKey = useMemo(
    () =>
      [
        token,
        form?.accomplishment_text,
        form?.ai_description,
        form?.ai_project_subtype,
        form?.ai_project_title,
        form?.ai_project_type,
      ]
        .map((value) => safeText(value))
        .join("|"),
    [
      token,
      form?.accomplishment_text,
      form?.ai_description,
      form?.ai_project_subtype,
      form?.ai_project_title,
      form?.ai_project_type,
    ]
  );

  const modeLabel = projectModeLabel(form?.project_mode);
  const ctaLabel = normalizeProjectMode(form?.project_mode) === "consultation" ? "Request Quote" : "Request Project Review";
  const showDebug = Boolean(import.meta.env.DEV || (typeof window !== "undefined" && window.MYHOMEBRO_DEBUG));

  const selectedKeys = useMemo(() => new Set((selectedTargets || []).map(cardSelectionKey).filter(Boolean)), [selectedTargets]);

  useEffect(() => {
    if (!active || !token || !suggestedSearchQuery) return;
    if (hasUserEditedSearch) return;
    if (searchInitKey === projectSearchKey) return;

    setUserSearchInput(suggestedSearchQuery);
    setSubmittedSearchQuery(suggestedSearchQuery);
    setHasUserEditedSearch(false);
    setSearchInitKey(projectSearchKey);
  }, [active, token, suggestedSearchQuery, hasUserEditedSearch, projectSearchKey, searchInitKey]);

  useEffect(() => {
    if (!active || !token) return;

    const searchTerm = safeText(submittedSearchQuery);
    if (!searchTerm) {
      setResults([]);
      setSummary(null);
      return;
    }

    let mounted = true;

    async function loadResults() {
      try {
        setLoading(true);
        const { data } = await api.get("/projects/public-intake/contractor-search/", {
          params: {
            token,
            query: searchTerm,
            project_title: safeText(form?.ai_project_title) || undefined,
            project_type: safeText(form?.ai_project_type) || undefined,
            project_subtype: safeText(form?.ai_project_subtype) || undefined,
            description: safeText(form?.accomplishment_text) || undefined,
            project_scope_summary: safeText(form?.ai_description) || safeText(form?.accomplishment_text) || undefined,
            project_address_line1: safeText(form?.project_address_line1 || form?.customer_address_line1) || undefined,
            project_city: safeText(form?.project_city || form?.customer_city) || undefined,
            project_state: safeText(form?.project_state || form?.customer_state) || undefined,
            project_postal_code: safeText(form?.project_postal_code || form?.customer_postal_code) || undefined,
            project_class: safeText(form?.project_class) || undefined,
            project_mode: safeText(form?.project_mode) || undefined,
            payment_preference: safeText(form?.payment_preference) || undefined,
            radius_miles: radiusMiles || 25,
            limit: 8,
          },
        });
        if (!mounted) return;
        const filteredResults = Array.isArray(data?.results)
          ? data.results.filter(
              (card) =>
                card?.source !== "google_places" ||
                (card?.distance_miles !== null && card?.distance_miles !== undefined && card?.distance_miles !== "")
            )
          : [];
        setResults(filteredResults);
        setSummary(data?.summary || null);
      } catch (error) {
        if (!mounted) return;
        toast.error(error?.response?.data?.detail || "Could not load contractor matches.");
        setResults([]);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadResults();
    return () => {
      mounted = false;
    };
  }, [
    active,
    token,
    form?.accomplishment_text,
    form?.ai_description,
    form?.ai_project_subtype,
    form?.ai_project_title,
    form?.ai_project_type,
    form?.project_address_line1,
    form?.project_city,
    form?.project_state,
    form?.project_postal_code,
    form?.customer_address_line1,
    form?.customer_city,
    form?.customer_state,
    form?.customer_postal_code,
    submittedSearchQuery,
    radiusMiles,
  ]);

  function handleSearchSubmit() {
    const nextQuery = safeText(userSearchInput);
    if (!nextQuery) {
      toast.error("Enter a contractor type to search.");
      return;
    }
    setSubmittedSearchQuery(nextQuery);
  }

  function handleUseSuggestedSearch() {
    if (!suggestedSearchQuery) return;
    setUserSearchInput(suggestedSearchQuery);
    setSubmittedSearchQuery(suggestedSearchQuery);
    setHasUserEditedSearch(false);
    setSearchInitKey(projectSearchKey);
  }

  function toggleSelection(card) {
    const key = cardSelectionKey(card);
    if (!key) return;
    setSelectedTargets((prev) => {
      const exists = prev.some((item) => cardSelectionKey(item) === key);
      if (exists) {
        return prev.filter((item) => cardSelectionKey(item) !== key);
      }
      if (prev.length >= 5) {
        toast.error("You can select up to 5 contractors at a time.");
        return prev;
      }
      return [...prev, card];
    });
  }

  async function sendSelectedInvites() {
    if (!token) {
      toast.error("Missing intake token.");
      return;
    }
    if (!selectedTargets.length) {
      toast.error("Select at least one contractor first.");
      return;
    }

    try {
      setSending(true);
      const { data } = await api.post("/projects/public-intake/send-contractor-invites/", {
        token,
        selected_contractors: selectedTargets.map((card) => ({
          id: card.id,
          source: card.source,
          channel: "sms",
        })),
        preferred_channel: "sms",
      });
      onInvitesCreated?.(data);
      toast.success(
        Array.isArray(data?.created) && data.created.length
          ? `Requested ${data.created.length} contractor review${data.created.length === 1 ? "" : "s"}.`
          : "No invites were created."
      );
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not send contractor review requests.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-2xl border border-white/70 bg-white p-6 shadow-2xl shadow-black/10" data-testid="public-intake-contractor-discovery-step">
      <div className="max-w-3xl">
        <div className="inline-flex rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
          Local contractor review
        </div>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-gray-900">Choose Local Contractors</h2>
        <p className="mt-2 text-base text-slate-600">
          Select contractors you&apos;d like to review your project. Some listings may be local business listings that have not claimed a MyHomeBro profile yet.
        </p>
        <p className="mt-1 text-sm text-slate-500">
          Many homeowners use this step to compare a few good matches before they decide how to proceed.
        </p>
      </div>

      <div className="mt-5 rounded-2xl border border-blue-100 bg-blue-50 p-4 shadow-sm">
        <div className="text-sm font-semibold text-slate-900">Payment and collaboration context</div>
        <div className="mt-1 text-sm text-slate-600">
          {modeLabel} projects can emphasize contractor fit, payment protection, inspection support, and homeowner participation preferences.
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium text-slate-700">
          Search
          <input
            value={userSearchInput}
            onChange={(e) => {
              setUserSearchInput(e.target.value);
              setHasUserEditedSearch(true);
            }}
            placeholder="We infer a specialty from your project, or you can search one"
            data-testid="public-intake-contractor-search-input"
            className="ml-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
          />
        </label>
        <button
          type="button"
          onClick={handleSearchSubmit}
          disabled={!safeText(userSearchInput)}
          data-testid="public-intake-contractor-search-submit"
          className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Search
        </button>
        {suggestedSearchQuery && hasUserEditedSearch ? (
          <button
            type="button"
            onClick={handleUseSuggestedSearch}
            data-testid="public-intake-use-suggested-search"
            className="rounded-full border border-indigo-200 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50"
          >
            Use suggested search
          </button>
        ) : null}
        {!safeText(userSearchInput) && hasUserEditedSearch ? (
          <div className="text-sm text-amber-700" data-testid="public-intake-contractor-search-empty">
            Enter a contractor type to search.
          </div>
        ) : null}
        <label className="text-sm font-medium text-slate-700">
          Radius
          <input
            value={radiusMiles}
            onChange={(e) => setRadiusMiles(e.target.value)}
            placeholder="25"
            className="ml-2 w-24 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
          />
        </label>
        <div className="text-sm text-slate-600">
          {selectedTargets.length ? `${selectedTargets.length} selected` : "Select up to 5 contractors"}
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {loading ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-600">
            Finding the best local contractor matches...
          </div>
        ) : results.length ? (
          results.map((card) => {
            const selected = selectedKeys.has(cardSelectionKey(card));
            const tierClass = contractorMatchTierClass(card.recommendation_tier);
            const tierLabel = contractorMatchTierLabel(card.recommendation_tier);
            return (
              <article
                key={card.id}
                data-testid={`public-intake-contractor-card-${cardSelectionKey(card)}`}
                className={`rounded-2xl border p-5 shadow-sm transition ${
                  selected ? "border-indigo-500 bg-indigo-50 ring-2 ring-indigo-100" : "border-slate-200 bg-white hover:bg-slate-50"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-base font-semibold text-gray-900">{card.business_name || "Local contractor"}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 font-semibold ${tierClass}`}>{tierLabel}</span>
                      <span className="inline-flex rounded-full border border-slate-200 bg-white px-2 py-0.5 font-semibold text-slate-700">
                        {card.source_label || card.label}
                      </span>
                      {card.rating ? <span>{Number(card.rating).toFixed(1)} rating</span> : null}
                      {card.review_count ? <span>{card.review_count} reviews</span> : null}
                      {card.distance_miles !== null && card.distance_miles !== undefined ? (
                        <span className="font-semibold text-slate-800">{formatDistance(card.distance_miles)}</span>
                      ) : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleSelection(card)}
                    className={`rounded-full px-4 py-2 text-sm font-semibold ${
                      selected
                        ? "bg-indigo-600 text-white"
                        : "border border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50"
                    }`}
                    data-testid={`public-intake-contractor-select-${cardSelectionKey(card)}`}
                  >
                    {selected ? "Selected" : ctaLabel}
                  </button>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {(card.recommendation_reasons || []).slice(0, 4).map((reason) => (
                    <span
                      key={`${card.id}-${reason}`}
                      className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700"
                    >
                      {reason}
                    </span>
                  ))}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {(card.supported_project_modes || []).map((mode) => (
                    <ProjectModeBadge key={`${card.id}-${mode}`} mode={mode} />
                  ))}
                  {card.escrow_friendly ? (
                    <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700">
                      Escrow Friendly
                    </span>
                  ) : null}
                  {card.assisted_diy_friendly ? (
                    <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800">
                      Assisted DIY
                    </span>
                  ) : null}
                  {card.inspection_capable ? (
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                      Inspection Capable
                    </span>
                  ) : null}
                  {card.rescue_project_friendly ? (
                    <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-700">
                      Rescue Project
                    </span>
                  ) : null}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-slate-600">
                  {card.website_url ? (
                    <a className="font-semibold text-indigo-700 hover:underline" href={card.website_url} target="_blank" rel="noreferrer">
                      Website
                    </a>
                  ) : null}
                  <span>{card.phone || (card.phone_available ? "Phone available" : "Phone not listed")}</span>
                  <span>{card.public_email || card.email || (card.email_available ? "Email available" : "Email not listed")}</span>
                  {card.address || card.formatted_address ? <span>{card.address || card.formatted_address}</span> : null}
                </div>
              </article>
            );
          })
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-600 lg:col-span-2">
            {emptyStateMessage(summary)}
          </div>
        )}
      </div>

      {!loading && showDebug && summary ? (
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500" data-testid="public-intake-contractor-debug">
          Location source: {summary.location_source || "unknown"} · Raw: {summary.google_raw_count ?? 0} · After radius:{" "}
          {summary.after_distance_filter_count ?? 0} · Reason: {summary.reason || "none"}
        </div>
      ) : null}

      {!loading && results.length && Number(summary?.external_results_count || 0) === 0 ? (
        <div
          data-testid="public-intake-no-local-listings-note"
          className="mt-4 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          No outside local listings found yet. You can still invite a contractor manually or continue.
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="text-sm text-slate-600">
          {summary?.results_count ? `${summary.results_count} matches loaded` : "Matches will appear here once loaded."}
        </div>
        <button
          type="button"
          onClick={sendSelectedInvites}
          disabled={sending || !selectedTargets.length}
          data-testid="public-intake-send-contractor-invites"
          className="rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/20 hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {sending ? "Sending..." : ctaLabel}
        </button>
      </div>
    </div>
  );
}
