import React, { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { MapPin, ShieldCheck } from "lucide-react";
import api from "../../api";
import { ProjectModeBadge, normalizeProjectMode, projectModeLabel } from "../projectMode.jsx";
import { contractorMatchTierClass, contractorMatchTierLabel } from "../../lib/contractorMatching.js";

const intakePrimaryButtonClass =
  "rounded-xl border border-blue-300/30 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-700 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-950/25 transition hover:border-amber-200/70 hover:from-blue-500 hover:to-purple-600 hover:shadow-blue-500/20 focus:outline-none focus:ring-2 focus:ring-amber-300/60 disabled:cursor-not-allowed disabled:border-slate-400/30 disabled:from-slate-600 disabled:via-slate-600 disabled:to-slate-600 disabled:text-slate-200 disabled:shadow-none disabled:opacity-70";

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

const RESULTS_PER_PAGE = 10;
const RADIUS_OPTIONS = [
  { value: "5", label: "5 miles" },
  { value: "10", label: "10 miles" },
  { value: "15", label: "15 miles" },
  { value: "25", label: "25 miles" },
  { value: "50", label: "50 miles" },
  { value: "100", label: "50+ miles" },
];

function radiusDisplayLabel(value) {
  const option = RADIUS_OPTIONS.find((item) => item.value === String(value || "25"));
  return option?.label || "25 miles";
}

function radiusWithinLabel(value) {
  return `within ${radiusDisplayLabel(value)}`;
}

function emptyStateMessage(summary, radiusMiles = 25) {
  const reason = safeText(summary?.reason || summary?.external_search?.error || summary?.external_search_diagnostic?.empty_reason);
  const geocodeStatus = safeText(summary?.geocode_status);
  const radiusLabel = radiusDisplayLabel(summary?.radius_miles || radiusMiles);
  if (geocodeStatus === "REQUEST_DENIED") {
    return "We're temporarily unable to verify project locations due to a configuration issue.";
  }
  if (geocodeStatus === "OVER_QUERY_LIMIT" || geocodeStatus === "OVER_DAILY_LIMIT" || geocodeStatus === "UNKNOWN_ERROR") {
    return "Location services are temporarily busy. Please try again shortly.";
  }
  if (geocodeStatus === "ZERO_RESULTS") {
    return "We couldn't verify this address. Please check the ZIP code or street address.";
  }
  if (geocodeStatus === "INVALID_REQUEST") {
    return "We need more project location information before searching contractors.";
  }
  if (reason === "REQUEST_DENIED") {
    return "We're temporarily unable to verify project locations due to a configuration issue.";
  }
  if (reason === "OVER_QUERY_LIMIT" || reason === "OVER_DAILY_LIMIT" || reason === "UNKNOWN_ERROR") {
    return "Location services are temporarily busy. Please try again shortly.";
  }
  if (reason === "ZERO_RESULTS") {
    return "We couldn't verify this address. Please check the ZIP code or street address.";
  }
  if (reason === "INVALID_REQUEST") {
    return "We need more project location information before searching contractors.";
  }
  if (
    reason === "google_geocode_api_key_missing" ||
    reason === "geocode_exception" ||
    reason.startsWith("geocode_http_")
  ) {
    return "We have the project address, but location services could not map it right now. Please try again shortly.";
  }
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
    return `We found contractors, but none were within ${radiusLabel} of the project address.`;
  }
  if (reason === "all_results_missing_coordinates") {
    return "Google returned possible matches, but they did not include usable map coordinates. Try adjusting the project location or search term.";
  }
  return `We couldn't find strong local matches within ${radiusLabel} of this project address. You can invite a contractor manually or adjust the project location.`;
}

function isHomeAdditionText(text) {
  return /bedroom\s+extension|room\s+addition|home\s+addition|house\s+extension|add(?:ing)?\s+(?:a\s+)?room|add(?:ing)?\s+(?:a\s+)?bedroom|build(?:ing)?\s+(?:an?\s+)?addition/.test(
    String(text || "").toLowerCase()
  );
}

function buildInferredSearchQuery(form) {
  const descriptionText = [
    form?.original_description,
    form?.accomplishment_text,
    form?.refined_description,
    form?.ai_description,
    form?.project_scope_summary,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (isHomeAdditionText(descriptionText)) {
    return "home addition contractor";
  }

  const classificationText = [form?.ai_project_type, form?.ai_project_subtype, form?.ai_project_title]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const fullText = [
    form?.ai_project_type,
    form?.ai_project_subtype,
    form?.ai_project_title,
    form?.project_scope_summary,
    form?.refined_description,
    form?.ai_description,
    form?.original_description,
    form?.accomplishment_text,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const matches = (pattern) => pattern.test(classificationText) || (!classificationText.trim() && pattern.test(fullText));
  const contextMatches = (pattern) => pattern.test(fullText);

  if (matches(/floor|flooring|tile|hardwood|laminate|vinyl/)) {
    return contextMatches(/install|installation/) ? "flooring installation contractor" : "flooring contractor";
  }
  if (matches(/electrical|electrician|panel|wire|wiring/)) {
    return "electrician";
  }
  if (matches(/plumbing|plumber|pipe|drain|sewer/)) {
    return "plumber";
  }
  if (matches(/hvac|air conditioning|cooling|heating|furnace/)) {
    return "hvac contractor";
  }
  if (matches(/patio|concrete|slab|driveway|walkway|masonry|hardscape|paver/)) {
    if (contextMatches(/masonry|brick|stone|block/)) return "masonry contractor";
    if (contextMatches(/patio/) && contextMatches(/concrete|slab|driveway|walkway|cement/)) {
      return "concrete contractor patio contractor hardscape contractor";
    }
    if (contextMatches(/patio/)) return "patio contractor concrete contractor hardscape contractor";
    if (contextMatches(/hardscape|paver|pavers|retaining wall/)) {
      return "hardscape contractor patio contractor masonry contractor";
    }
    return "concrete contractor";
  }
  if (matches(/kitchen|cabinet|countertop|quartz|granite/)) {
    if (contextMatches(/cabinet/)) return "cabinet installer";
    if (contextMatches(/countertop|quartz|granite/)) return "countertop installer";
    return "kitchen remodeling contractor";
  }
  if (matches(/bathroom|vanity|shower|tub/)) {
    return "bathroom remodel contractor";
  }
  if (matches(/roof|roofing|shingle|leak/)) {
    return "roofing contractor";
  }
  if (matches(/paint|painting|painter/)) {
    return "painter";
  }
  if (matches(/drywall|sheetrock/)) {
    return "drywall contractor";
  }
  if (matches(/remodel|renovation|renovate/)) {
    return "remodeling contractor";
  }

  const inferred = [];
  const push = (value) => {
    if (value && !inferred.includes(value)) inferred.push(value);
  };

  if (/patio|concrete|slab|driveway|walkway|masonry|hardscape|paver/.test(fullText)) {
    if (/masonry|brick|stone|block/.test(fullText)) push("masonry contractor");
    else if (/patio/.test(fullText) && /concrete|slab|driveway|walkway|cement/.test(fullText)) {
      push("concrete contractor");
      push("patio contractor");
      push("hardscape contractor");
    }
    else if (/patio/.test(fullText)) {
      push("patio contractor");
      push("concrete contractor");
      push("hardscape contractor");
    }
    else if (/hardscape|paver|pavers|retaining wall/.test(fullText)) push("hardscape contractor");
    else push("concrete contractor");
  }
  if (/kitchen|cabinet|countertop|quartz|granite/.test(fullText)) {
    if (/cabinet/.test(fullText)) push("cabinet installer");
    else if (/countertop|quartz|granite/.test(fullText)) push("countertop installer");
    else push("kitchen remodeling contractor");
  }
  if (/bathroom|vanity|shower|tub/.test(fullText)) {
    push("bathroom remodel contractor");
  }
  if (/roof|roofing|shingle|leak/.test(fullText)) {
    push("roofing contractor");
  }
  if (/floor|flooring|tile|hardwood|laminate/.test(fullText)) {
    push(contextMatches(/install|installation/) ? "flooring installation contractor" : "flooring contractor");
  }
  if (/paint|painting|painter/.test(fullText)) {
    push("painter");
  }
  if (/electrical|electrician|panel|wire|wiring/.test(fullText)) {
    push("electrician");
  }
  if (/plumbing|plumber|pipe|drain|sewer/.test(fullText)) {
    push("plumber");
  }
  if (/hvac|air conditioning|cooling|heating|furnace/.test(fullText)) {
    push("hvac contractor");
  }
  if (/drywall|sheetrock/.test(fullText)) {
    push("drywall contractor");
  }
  if (/remodel|renovation|renovate/.test(fullText)) {
    push("remodeling contractor");
  }

  return inferred.join(" ").trim();
}

function buildFriendlyMatchLabel(form) {
  const title = safeText(form?.ai_project_title);
  const subtype = safeText(form?.ai_project_subtype);
  const type = safeText(form?.ai_project_type);
  const parts = [title, subtype && subtype !== title ? subtype : "", type && type !== title && type !== subtype ? type : ""].filter(Boolean);
  if (parts.length) return parts.slice(0, 2).join(" / ");
  return "Showing contractors that match your project";
}

export default function ContractorDiscoveryStep({
  token,
  form,
  active = false,
  selectedTargets = [],
  setSelectedTargets,
  onSkipToManual,
}) {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [summary, setSummary] = useState(null);
  const [userSearchInput, setUserSearchInput] = useState("");
  const [submittedSearchQuery, setSubmittedSearchQuery] = useState("");
  const [hasUserEditedSearch, setHasUserEditedSearch] = useState(false);
  const [searchInitKey, setSearchInitKey] = useState("");
  const [radiusMiles, setRadiusMiles] = useState("25");
  const [visibleCount, setVisibleCount] = useState(RESULTS_PER_PAGE);
  const suggestedSearchQuery = useMemo(() => buildInferredSearchQuery(form), [
    form?.accomplishment_text,
    form?.original_description,
    form?.refined_description,
    form?.ai_description,
    form?.project_scope_summary,
    form?.ai_project_subtype,
    form?.ai_project_title,
    form?.ai_project_type,
  ]);
  const friendlyMatchLabel = useMemo(() => buildFriendlyMatchLabel(form), [
    form?.ai_project_subtype,
    form?.ai_project_title,
    form?.ai_project_type,
  ]);
  const projectSearchKey = useMemo(
    () =>
      [
        token,
        form?.accomplishment_text,
        form?.original_description,
        form?.refined_description,
        form?.ai_description,
        form?.project_scope_summary,
        form?.ai_project_subtype,
        form?.ai_project_title,
        form?.ai_project_type,
      ]
        .map((value) => safeText(value))
        .join("|"),
    [
      token,
      form?.accomplishment_text,
      form?.original_description,
      form?.refined_description,
      form?.ai_description,
      form?.project_scope_summary,
      form?.ai_project_subtype,
      form?.ai_project_title,
      form?.ai_project_type,
    ]
  );

  const modeLabel = projectModeLabel(form?.project_mode);
  const ctaLabel = normalizeProjectMode(form?.project_mode) === "consultation" ? "Select for Quote" : "Select Contractor";
  const showDebug = Boolean(import.meta.env.DEV || (typeof window !== "undefined" && window.MYHOMEBRO_DEBUG));

  const selectedKeys = useMemo(() => new Set((selectedTargets || []).map(cardSelectionKey).filter(Boolean)), [selectedTargets]);
  const visibleResults = useMemo(() => results.slice(0, visibleCount), [results, visibleCount]);
  const resultStart = results.length ? 1 : 0;
  const resultEnd = Math.min(visibleCount, results.length);
  const resultCountText = results.length
    ? `Showing ${resultStart}-${resultEnd} of ${results.length} contractors`
    : "Matches will appear here once loaded.";
  const activeRadiusLabel = radiusWithinLabel(summary?.radius_miles || radiusMiles);

  useEffect(() => {
    if (!active || !token) return;
    if (searchInitKey === projectSearchKey) return;

    setUserSearchInput("");
    setSubmittedSearchQuery(suggestedSearchQuery);
    setHasUserEditedSearch(false);
    setSearchInitKey(projectSearchKey);
  }, [active, token, suggestedSearchQuery, projectSearchKey, searchInitKey]);

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
            project_scope_summary:
              safeText(form?.project_scope_summary) ||
              safeText(form?.refined_description) ||
              safeText(form?.ai_description) ||
              safeText(form?.accomplishment_text) ||
              undefined,
            project_address_line1: safeText(form?.project_address_line1 || form?.customer_address_line1) || undefined,
            project_city: safeText(form?.project_city || form?.customer_city) || undefined,
            project_state: safeText(form?.project_state || form?.customer_state) || undefined,
            project_postal_code: safeText(form?.project_postal_code || form?.customer_postal_code) || undefined,
            project_class: safeText(form?.project_class) || undefined,
            project_mode: safeText(form?.project_mode) || undefined,
            payment_preference: safeText(form?.payment_preference) || undefined,
            radius_miles: radiusMiles || 25,
            limit: 40,
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
        setVisibleCount(RESULTS_PER_PAGE);
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
    form?.original_description,
    form?.refined_description,
    form?.ai_description,
    form?.project_scope_summary,
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
    setUserSearchInput("");
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

  return (
    <div className="rounded-3xl border border-slate-200/80 bg-white p-6 text-slate-950 shadow-2xl shadow-slate-950/20 ring-1 ring-white/80 sm:p-7" data-testid="public-intake-contractor-discovery-step">
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
          {modeLabel} projects can emphasize contractor fit, milestone payment workflow preferences, inspection support, and customer participation preferences.
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
        Profile-reviewed contractors are active MyHomeBro members whose marketplace eligibility has been reviewed. Local business listings are nearby companies discovered from public business data.
      </div>

      <div className="mt-5 rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3" data-testid="public-intake-contractor-match-label">
        <div className="text-sm font-semibold text-indigo-950">Showing contractors that match your project</div>
        <div className="mt-1 text-sm text-indigo-900/80">{friendlyMatchLabel}</div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium text-slate-700">
          Manual search
          <input
            value={userSearchInput}
            onChange={(e) => {
              setUserSearchInput(e.target.value);
              setHasUserEditedSearch(true);
            }}
            placeholder="Search a contractor type manually"
            data-testid="public-intake-contractor-search-input"
            className="ml-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
          />
        </label>
        <button
          type="button"
          onClick={handleSearchSubmit}
          disabled={!safeText(userSearchInput)}
          data-testid="public-intake-contractor-search-submit"
          className={intakePrimaryButtonClass}
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
            Use project match
          </button>
        ) : null}
        {!safeText(userSearchInput) && hasUserEditedSearch ? (
          <div className="text-sm text-amber-700" data-testid="public-intake-contractor-search-empty">
            Enter a contractor type to search.
          </div>
        ) : null}
        <label className="text-sm font-medium text-slate-700">
          Radius
          <select
            value={radiusMiles}
            onChange={(e) => setRadiusMiles(e.target.value)}
            data-testid="public-intake-contractor-radius-select"
            className="ml-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
          >
            {RADIUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="text-sm font-medium text-slate-600" data-testid="public-intake-contractor-radius-display">
          {activeRadiusLabel}
        </div>
        <div className="text-sm text-slate-600">
          {selectedTargets.length ? `${selectedTargets.length} selected` : "Select up to 5 contractors"}
        </div>
      </div>

      {!loading && results.length ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
          <div data-testid="public-intake-contractor-result-count">{resultCountText}</div>
          {visibleCount < results.length ? (
            <button
              type="button"
              onClick={() => setVisibleCount((prev) => Math.min(prev + RESULTS_PER_PAGE, results.length))}
              data-testid="public-intake-contractor-load-more-top"
              className="rounded-full border border-indigo-200 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50"
            >
              Load More
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-2" data-testid="public-intake-contractor-results-list">
        {loading ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-600">
            Finding the best local contractor matches...
          </div>
        ) : results.length ? (
          visibleResults.map((card) => {
            const selected = selectedKeys.has(cardSelectionKey(card));
            const tierClass = contractorMatchTierClass(card.recommendation_tier);
            const tierLabel = contractorMatchTierLabel(card.recommendation_tier);
            const sourceLabel = safeText(card.source_label || card.label);
            const isVerified = Boolean(card.claimed || sourceLabel.toLowerCase().includes("myhomebro"));
            const distanceText = formatDistance(card.distance_miles);
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
                      <span
                        data-testid={`public-intake-contractor-source-badge-${cardSelectionKey(card)}`}
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-semibold ${
                          isVerified
                            ? "border-emerald-600 bg-emerald-600 text-white shadow-sm"
                            : "border-slate-300 bg-slate-100 text-slate-800"
                        }`}
                      >
                        {isVerified ? <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> : <MapPin className="h-3.5 w-3.5" aria-hidden="true" />}
                        {isVerified ? "Verified on MyHomeBro" : "Local supply lead"}
                      </span>
                      {card.rating ? <span>{Number(card.rating).toFixed(1)} rating</span> : null}
                      {card.review_count ? <span>{card.review_count} reviews</span> : null}
                      {distanceText ? (
                        <span
                          data-testid={`public-intake-contractor-distance-${cardSelectionKey(card)}`}
                          className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-800"
                        >
                          {distanceText}
                        </span>
                      ) : null}
                    </div>
                    {!isVerified ? (
                      <div className="mt-2 text-xs font-medium text-slate-500">Local listing only. This business must claim and be approved before bidding through MyHomeBro.</div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleSelection(card)}
                    className={`rounded-full px-4 py-2 text-sm font-semibold ${
                      selected
                        ? "border border-blue-300/30 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-700 text-white shadow-sm"
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
                      Escrow Workflow Compatible
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
            {emptyStateMessage(summary, radiusMiles)}
          </div>
        )}
      </div>

      {!loading && visibleCount < results.length ? (
        <div className="mt-5 flex justify-center">
          <button
            type="button"
            onClick={() => setVisibleCount((prev) => Math.min(prev + RESULTS_PER_PAGE, results.length))}
            data-testid="public-intake-contractor-load-more"
            className="rounded-full border border-indigo-200 bg-white px-5 py-2.5 text-sm font-semibold text-indigo-700 shadow-sm hover:bg-indigo-50"
          >
            Load More
          </button>
        </div>
      ) : null}

      {!loading && showDebug && summary ? (
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500" data-testid="public-intake-contractor-debug">
          Location source: {summary.location_source || "unknown"} · Raw: {summary.google_raw_count ?? 0} · After radius:{" "}
          {summary.after_distance_filter_count ?? 0} · Reason: {summary.reason || "none"}
        </div>
      ) : null}

      {!loading && showDebug && summary ? (
        <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500" data-testid="public-intake-contractor-geocode-debug">
          Geocode: {summary.geocode_status || "none"} · Candidate: {summary.geocode_candidate_used || "none"} · Fallbacks:{" "}
          {summary.geocode_attempt_count ?? 0} · Cached: {summary.geocode_from_cache ? "yes" : "no"}
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
          {selectedTargets.length
            ? `${selectedTargets.length} contractor${selectedTargets.length === 1 ? "" : "s"} selected. Continue when your list looks right.`
            : "Select contractors here, or continue and add a contractor manually."}
        </div>
        <button
          type="button"
          onClick={onSkipToManual}
          data-testid="public-intake-skip-to-manual-contractor"
          className="rounded-full border border-indigo-200 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50"
        >
          Skip contractor selection and add a contractor manually
        </button>
      </div>
    </div>
  );
}
