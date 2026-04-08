// frontend/src/components/Step1Details.jsx
// v2026-03-17-step1-template-apply-sync
// Updates:
// - consumes returned agreement payload after template apply
// - syncs Step 1 local state from applied template response
// - wires TemplateSearchSection onTemplateApplied callback
// - keeps existing Step 1 flow intact
// - preserves deselect / template duration / AI milestone behavior

import React, { useEffect, useMemo, useRef, useState } from "react";
import api from "../api";
import { useNavigate, useLocation } from "react-router-dom";
import toast from "react-hot-toast";

import SaveTemplateModal from "./step1/SaveTemplateModal.jsx";
import TemplateSearchSection from "./step1/TemplateSearchSection.jsx";
import CustomerSection from "./step1/CustomerSection.jsx";
import AddressSection from "./step1/AddressSection.jsx";
import useStep1Templates from "./step1/useStep1Templates.jsx";
import useAgreementMilestoneAI from "./ai/useAgreementMilestoneAI.jsx";

import {
  safeTrim,
  computeCustomerAddressMissing,
  normalizePaymentMode,
  normalizePaymentStructure,
  extractAiCredits,
  isAgreementLocked,
} from "./step1/step1Utils";

function PrettyJson({ data }) {
  if (!data) return null;
  let text = "";
  try {
    text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  } catch {
    text = String(data);
  }
  return (
    <pre className="whitespace-pre-wrap break-words rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">
      {text}
    </pre>
  );
}

function formatRecurrenceSummary(pattern, interval) {
  const safePattern = safeTrim(pattern) || "monthly";
  const safeInterval = Math.max(1, Number(interval || 1) || 1);
  const labelMap = {
    weekly: safeInterval === 1 ? "week" : "weeks",
    monthly: safeInterval === 1 ? "month" : "months",
    quarterly: safeInterval === 1 ? "quarter" : "quarters",
    yearly: safeInterval === 1 ? "year" : "years",
  };
  return `Recurring every ${safeInterval} ${labelMap[safePattern] || safePattern}`;
}

const MATCH_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "for",
  "the",
  "with",
  "from",
  "into",
  "this",
  "that",
  "job",
  "project",
  "work",
  "service",
  "repair",
  "replace",
  "replacement",
  "install",
  "installation",
]);

function normalizeAiText(value) {
  return safeTrim(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s/&-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeAiText(value) {
  return normalizeAiText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token && !MATCH_STOP_WORDS.has(token));
}

function titleCaseWords(value) {
  return safeTrim(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function buildGeneratedProjectTitle(text = "") {
  const raw = safeTrim(text);
  if (!raw) return "";
  const firstClause = raw.split(/[,.]/)[0] || raw;
  const trimmedClause = firstClause
    .replace(/\b(with|including|plus|for)\b.*$/i, "")
    .trim();
  const candidate = safeTrim(trimmedClause || firstClause);
  if (!candidate) return "";
  const words = candidate.split(/\s+/).slice(0, 5).join(" ");
  return titleCaseWords(words);
}

function scoreOptionAgainstText(option, sourceText) {
  const optionLabel = safeTrim(option?.label || option?.value);
  if (!optionLabel) return 0;

  const haystack = normalizeAiText(sourceText);
  if (!haystack) return 0;

  const labelNorm = normalizeAiText(optionLabel);
  const tokens = tokenizeAiText(optionLabel);

  let score = 0;
  if (labelNorm && haystack.includes(labelNorm)) score += 80;
  score += tokens.filter((token) => haystack.includes(token)).length * 14;
  return score;
}

function findBestMatchingOption(sourceText, options = [], minimumScore = 24) {
  const ranked = (Array.isArray(options) ? options : [])
    .map((option) => ({ option, score: scoreOptionAgainstText(option, sourceText) }))
    .sort((a, b) => b.score - a.score);
  if (!ranked.length || ranked[0].score < minimumScore) return null;
  return ranked[0].option;
}

function optionDisplayLabel(option) {
  return safeTrim(option?.label || option?.value || option?.name || "");
}

function optionCanonicalValue(option) {
  return safeTrim(option?.value || option?.label || option?.name || "");
}

function normalizeTaxonomyText(value) {
  return safeTrim(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s/&-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractNumericIdCandidate(value) {
  const raw = safeTrim(value);
  if (!raw) return "";
  const directNumeric = raw.match(/^\d+$/);
  if (directNumeric) return directNumeric[0];
  const placeholderNumeric = raw.match(/\b(?:type|subtype)\s+(\d+)\b/i);
  if (placeholderNumeric) return placeholderNumeric[1];
  return "";
}

function resolveOptionFromRawValue(rawValue, options = []) {
  const raw = safeTrim(rawValue);
  if (!raw) return null;

  const normalizedRaw = normalizeTaxonomyText(raw);
  const rawId = extractNumericIdCandidate(raw);

  return (
    (Array.isArray(options) ? options : []).find((option) => {
      const optionId = safeTrim(option?.id);
      const optionValue = optionCanonicalValue(option);
      const optionLabel = optionDisplayLabel(option);
      return (
        (rawId && optionId && rawId === optionId) ||
        normalizeTaxonomyText(optionValue) === normalizedRaw ||
        normalizeTaxonomyText(optionLabel) === normalizedRaw
      );
    }) || null
  );
}

function resolveBestTypeOption({
  rawType,
  rawSubtype,
  sourceText,
  projectTypeOptions = [],
}) {
  const directMatch =
    resolveOptionFromRawValue(rawType, projectTypeOptions) ||
    findBestMatchingOption([rawType, rawSubtype, sourceText].filter(Boolean).join(" "), projectTypeOptions, 18);
  return directMatch;
}

function resolveBestSubtypeOption({
  rawSubtype,
  rawType,
  sourceText,
  matchedType,
  projectSubtypeOptions = [],
}) {
  const filteredSubtypeOptions = (Array.isArray(projectSubtypeOptions) ? projectSubtypeOptions : []).filter(
    (option) =>
      !matchedType ||
      normalizeTaxonomyText(option?.project_type) ===
        normalizeTaxonomyText(optionCanonicalValue(matchedType))
  );

  return (
    resolveOptionFromRawValue(rawSubtype, filteredSubtypeOptions) ||
    findBestMatchingOption(
      [rawSubtype, rawType, sourceText].filter(Boolean).join(" "),
      filteredSubtypeOptions,
      22
    )
  );
}

const PRIMARY_CATEGORY_RULES = [
  {
    category: "Remodel",
    subtype: "Bathroom Remodel",
    reasons: ["bathroom remodel intent"],
    patterns: [
      /\bbath(room)?\s+(remodel|renovation|refresh|upgrade)\b/i,
      /\b(remodel|renovation)\s+(the\s+)?bath(room)?\b/i,
      /\btub(?:\/| and )?shower\s+(replacement|remodel|upgrade)\b/i,
      /\bvanity\b.*\btile\b/i,
      /\bbath(room)?\b.*\b(tile|vanity|fixtures?)\b/i,
    ],
  },
  {
    category: "Remodel",
    subtype: "Kitchen Remodel",
    reasons: ["kitchen remodel intent"],
    patterns: [
      /\bkitchen\s+(remodel|renovation|refresh|upgrade)\b/i,
      /\b(remodel|renovation)\s+(the\s+)?kitchen\b/i,
      /\bkitchen\b.*\b(cabinets?|countertops?|backsplash|island)\b/i,
    ],
  },
  {
    category: "Addition",
    subtype: "",
    reasons: ["addition intent"],
    patterns: [
      /\b(room|home|bedroom|garage|second story|story)\s+addition\b/i,
      /\b(addition|expand|extension)\b/i,
    ],
  },
  {
    category: "Flooring",
    subtype: "",
    reasons: ["flooring intent"],
    patterns: [
      /\bfloor(ing)?\s+(install|installation|replacement|refinish|repair)\b/i,
      /\b(hardwood|laminate|vinyl|tile)\s+floor(ing)?\b/i,
    ],
  },
  {
    category: "Roofing",
    subtype: "Roof Replacement",
    reasons: ["roofing intent"],
    patterns: [
      /\broof\s+(replacement|replace|tear[- ]off|reroof|re-roof)\b/i,
      /\bshingles?\b.*\b(replace|replacement|install)\b/i,
    ],
  },
];

const SUPPORTING_TRADE_PATTERNS = [
  /\belectrical\b/i,
  /\bplumb(ing|er)?\b/i,
  /\blighting\b/i,
  /\bfixtures?\b/i,
  /\boutlets?\b/i,
  /\bwaterproof(ing)?\b/i,
  /\bwiring\b/i,
  /\bsconces?\b/i,
];

function inferDominantProjectCategory(sourceText) {
  const text = safeTrim(sourceText);
  if (!text) {
    return {
      category: "",
      subtype: "",
      reasoning: [],
    };
  }

  const reasoning = [];
  let bestRule = null;
  let bestScore = 0;

  for (const rule of PRIMARY_CATEGORY_RULES) {
    const matchCount = rule.patterns.filter((pattern) => pattern.test(text)).length;
    if (!matchCount) continue;
    const tradePenalty =
      rule.category === "Remodel"
        ? 0
        : SUPPORTING_TRADE_PATTERNS.filter((pattern) => pattern.test(text)).length;
    const score = matchCount * 10 - tradePenalty;
    reasoning.push(
      `${rule.category}${rule.subtype ? ` / ${rule.subtype}` : ""}: ${score}`
    );
    if (score > bestScore) {
      bestScore = score;
      bestRule = rule;
    }
  }

  const supportTradeHits = SUPPORTING_TRADE_PATTERNS.filter((pattern) => pattern.test(text)).length;
  if (!bestRule && supportTradeHits) {
    reasoning.push(`supporting-trade mentions detected: ${supportTradeHits}`);
  }

  return {
    category: bestRule?.category || "",
    subtype: bestRule?.subtype || "",
    reasoning,
  };
}

function StepSection({
  title,
  description = "",
  children,
  className = "",
  highlighted = false,
  highlightLabel = "AI updated",
  emphasis = false,
  sectionRef = null,
}) {
  return (
    <section
      ref={sectionRef}
      className={`rounded-2xl border bg-white p-5 shadow-sm transition-all duration-500 ${
        emphasis ? "border-sky-300 bg-sky-50/70 ring-2 ring-sky-100" : ""
      } ${
        highlighted
          ? "border-amber-200 bg-amber-50/40 ring-2 ring-amber-100"
          : "border-slate-200"
      } ${className}`}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          {description ? <p className="mt-1 text-sm text-slate-600">{description}</p> : null}
        </div>
        {highlighted ? (
          <span className="inline-flex shrink-0 rounded-full border border-amber-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-800">
            {highlightLabel}
          </span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function inferStartMode({
  agreement,
  assistantGuidedFlow,
  assistantTemplateRecommendations,
  assistantTopTemplatePreview,
}) {
  if (agreement?.selected_template?.id || agreement?.selected_template_id) {
    return "template";
  }
  if (
    assistantGuidedFlow?.guided_question ||
    assistantTopTemplatePreview?.id ||
    assistantTopTemplatePreview?.milestone_count ||
    (Array.isArray(assistantTemplateRecommendations) && assistantTemplateRecommendations.length)
  ) {
    return "ai";
  }
  return "manual";
}

export default function Step1Details({
  agreement,
  isEdit,
  agreementId,
  dLocal,
  setDLocal,
  people,
  peopleLoadedOnce,
  reloadPeople,
  showQuickAdd,
  setShowQuickAdd,
  qaName,
  setQaName,
  qaEmail,
  setQaEmail,
  qaBusy,
  setQaBusy,
  onQuickAdd,
  saveStep1,
  last400,
  onLocalChange,
  homeownerOptions,
  projectTypeOptions,
  projectSubtypeOptions,
  onTemplateApplied,
  refreshAgreement,
  assistantGuidedFlow = {},
  assistantTemplateRecommendations = [],
  assistantTopTemplatePreview = {},
  assistantProactiveRecommendations = [],
  assistantPredictiveInsights = [],
  assistantProposedActions = [],
  assistantConfirmationRequiredActions = [],
  aiHighlightKeys = {},
  isAiAssistantActive = false,
  aiSetupRequest = null,
  onAiModeActiveChange = null,
  onAiSetupReviewReady = null,
}) {
  void setQaBusy;

  const empty = (people?.length || 0) === 0;

  const navigate = useNavigate();
  const location = useLocation();

  const BASE = useMemo(() => {
    const p = location.pathname || "";
    return p.startsWith("/app/employee") ? "/app/employee" : "/app";
  }, [location.pathname]);

  const locked = useMemo(() => isAgreementLocked(agreement), [agreement]);

  const selectedProjectType = useMemo(() => {
    const current = safeTrim(dLocal?.project_type);
    if (!current) return null;
    return (
      (projectTypeOptions || []).find((opt) => safeTrim(opt?.value) === current) ||
      null
    );
  }, [projectTypeOptions, dLocal?.project_type]);
  const selectedProjectSubtype = useMemo(() => {
    const current = safeTrim(dLocal?.project_subtype);
    if (!current) return null;
    return (
      (projectSubtypeOptions || []).find((opt) => safeTrim(opt?.value) === current) ||
      null
    );
  }, [projectSubtypeOptions, dLocal?.project_subtype]);
  const augmentedProjectTypeOptions = useMemo(() => {
    const current = safeTrim(dLocal?.project_type);
    if (!current || (projectTypeOptions || []).some((opt) => safeTrim(opt?.value) === current)) {
      return projectTypeOptions || [];
    }
    return [
      ...(projectTypeOptions || []),
      {
        id: `ai-new-type-${current}`,
        value: current,
        label: `${current} (New)`,
        owner_type: "ai",
      },
    ];
  }, [dLocal?.project_type, projectTypeOptions]);
  const augmentedProjectSubtypeOptions = useMemo(() => {
    const current = safeTrim(dLocal?.project_subtype);
    if (
      !current ||
      (projectSubtypeOptions || []).some((opt) => safeTrim(opt?.value) === current)
    ) {
      return projectSubtypeOptions || [];
    }
    return [
      ...(projectSubtypeOptions || []),
      {
        id: `ai-new-subtype-${current}`,
        value: current,
        label: `${current} (New)`,
        owner_type: "ai",
        project_type: safeTrim(dLocal?.project_type),
      },
    ];
  }, [dLocal?.project_subtype, dLocal?.project_type, projectSubtypeOptions]);

  const hasAiSectionHighlight = (...keys) =>
    keys.some((key) => Boolean(aiHighlightKeys?.[key]));
  const projectDetailsSectionRef = useRef(null);
  const projectDetailsPulseTimerRef = useRef(null);

  const [addrSearch, setAddrSearch] = useState("");
  const patchTimerRef = useRef(null);
  const lastPatchedRef = useRef({});

  function formatApiError(error, fallback = "Could not save changes.") {
    const data = error?.response?.data;
    if (!data) return fallback;
    if (typeof data === "string") return data;
    if (typeof data?.detail === "string") return data.detail;
    if (typeof data?.error === "string") return data.error;
    const firstEntry = Object.entries(data).find(([, value]) => value != null);
    if (!firstEntry) return fallback;
    const [field, value] = firstEntry;
    const message = Array.isArray(value) ? value[0] : value;
    if (typeof message === "string") return `${field.replaceAll("_", " ")}: ${message}`;
    return fallback;
  }

  async function patchAgreement(fields, { silent = true } = {}) {
    if (locked) return;

    const id = agreementId ? String(agreementId) : "";
    if (!id) return;
    if (!fields || Object.keys(fields).length === 0) return;

    const key = JSON.stringify(fields);
    if (lastPatchedRef.current[key]) return;
    lastPatchedRef.current[key] = true;

    try {
      await api.patch(`/projects/agreements/${id}/`, fields);
      if (!silent) toast.success("Saved");
    } catch (e) {
      const msg = formatApiError(e, "Could not save changes.");
      if (!silent) toast.error(msg);
    } finally {
      delete lastPatchedRef.current[key];
    }
  }

  function schedulePatch(fields, delayMs = 450) {
    if (locked) return;
    if (patchTimerRef.current) clearTimeout(patchTimerRef.current);
    patchTimerRef.current = setTimeout(() => {
      patchAgreement(fields, { silent: true });
    }, delayMs);
  }

  useEffect(() => {
    return () => {
      if (patchTimerRef.current) clearTimeout(patchTimerRef.current);
    };
  }, []);

  const isNewAgreement = !agreementId;

  const cacheKey = useMemo(() => {
    const id = agreementId ? String(agreementId) : "new";
    return `mhb_step1_cache_${id}`;
  }, [agreementId]);
  const startModeStorageKey = `${cacheKey}_start_mode`;
  const startModeCommittedStorageKey = `${cacheKey}_start_mode_committed`;
  const startModeSourceStorageKey = `${cacheKey}_start_mode_source`;
  const [startMode, setStartMode] = useState(() => {
    try {
      const saved = sessionStorage.getItem(startModeStorageKey);
      if (saved === "ai" || saved === "template" || saved === "manual") return saved;
    } catch {
      // ignore
    }
    return inferStartMode({
      agreement,
      assistantGuidedFlow,
      assistantTemplateRecommendations,
      assistantTopTemplatePreview,
    });
  });
  const [startModeCommitted, setStartModeCommitted] = useState(() => {
    try {
      const saved = sessionStorage.getItem(startModeCommittedStorageKey);
      if (saved === "1") return true;
      if (saved === "0") return false;
    } catch {
      // ignore
    }
    return false;
  });
  const [startModeSource, setStartModeSource] = useState(() => {
    try {
      const saved = sessionStorage.getItem(startModeSourceStorageKey);
      if (
        saved === "derived" ||
        saved === "session" ||
        saved === "user" ||
        saved === "assistant" ||
        saved === "template_apply"
      ) {
        return saved;
      }
      const savedMode = sessionStorage.getItem(startModeStorageKey);
      if (savedMode === "ai" || savedMode === "template" || savedMode === "manual") {
        return "session";
      }
    } catch {
      // ignore
    }
    return "derived";
  });
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [showResetStep1Confirm, setShowResetStep1Confirm] = useState(false);
  const [dismissedAiTemplateRecommendation, setDismissedAiTemplateRecommendation] =
    useState(false);
  const [aiSetupBusy, setAiSetupBusy] = useState(false);
  const [aiSetupError, setAiSetupError] = useState("");
  const [aiSetupResult, setAiSetupResult] = useState(null);
  const [aiSuggestedFieldMeta, setAiSuggestedFieldMeta] = useState({});
  const [projectDetailsReviewPulse, setProjectDetailsReviewPulse] = useState(false);
  const [pendingProjectDetailsReview, setPendingProjectDetailsReview] = useState(null);

  function writeCache(nextPatch = {}) {
    try {
      const raw = sessionStorage.getItem(cacheKey);
      const cur = raw ? JSON.parse(raw) : {};
      const merged = { ...cur, ...nextPatch };
      sessionStorage.setItem(cacheKey, JSON.stringify(merged));
    } catch {
      // ignore
    }
  }

  function activateStartMode(mode, { committed = true, source = "user" } = {}) {
    setStartMode(mode);
    setStartModeCommitted(committed);
    setStartModeSource(source);
  }

  function reopenStartModeChooser() {
    setStartModeCommitted(false);
    setStartModeSource((prev) => (prev === "derived" ? "session" : prev));
  }

  function clearStep1SessionState() {
    try {
      sessionStorage.removeItem(cacheKey);
      sessionStorage.removeItem(startModeStorageKey);
      sessionStorage.removeItem(startModeCommittedStorageKey);
      sessionStorage.removeItem(startModeSourceStorageKey);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (!isNewAgreement) return;
    try {
      sessionStorage.removeItem("mhb_step1_cache_new");
    } catch {
      // ignore
    }
  }, [isNewAgreement]);

  useEffect(() => {
    const normalized = normalizePaymentMode(dLocal?.payment_mode);
    if (!safeTrim(dLocal?.payment_mode)) {
      setDLocal((s) => ({ ...s, payment_mode: normalized }));
      if (!isNewAgreement) {
        writeCache({ payment_mode: normalized });
      }
    }
  }, [agreementId, isNewAgreement, dLocal?.payment_mode, setDLocal]);

  useEffect(() => {
    const normalized = normalizePaymentStructure(dLocal?.payment_structure);
    if (!safeTrim(dLocal?.payment_structure)) {
      setDLocal((s) => ({ ...s, payment_structure: normalized }));
      if (!isNewAgreement) {
        writeCache({ payment_structure: normalized });
      }
    }
  }, [agreementId, isNewAgreement, dLocal?.payment_structure, setDLocal]);

  useEffect(() => {
    if (isNewAgreement) return;

    try {
      const raw = sessionStorage.getItem(cacheKey);
      if (!raw) return;
      const saved = JSON.parse(raw);

      setDLocal((prev) => {
        const next = { ...prev };

        if (!safeTrim(next.payment_mode) && safeTrim(saved.payment_mode)) {
          next.payment_mode = saved.payment_mode;
        }
        if (!safeTrim(next.payment_structure) && safeTrim(saved.payment_structure)) {
          next.payment_structure = saved.payment_structure;
        }
        if (!safeTrim(next.retainage_percent) && safeTrim(saved.retainage_percent)) {
          next.retainage_percent = saved.retainage_percent;
        }
        if (!safeTrim(next.address_line1) && safeTrim(saved.address_line1)) {
          next.address_line1 = saved.address_line1;
        }
        if (!safeTrim(next.address_line2) && safeTrim(saved.address_line2)) {
          next.address_line2 = saved.address_line2;
        }
        if (!safeTrim(next.address_city) && safeTrim(saved.address_city)) {
          next.address_city = saved.address_city;
        }
        if (!safeTrim(next.address_state) && safeTrim(saved.address_state)) {
          next.address_state = saved.address_state;
        }
        if (
          !safeTrim(next.address_postal_code) &&
          safeTrim(saved.address_postal_code)
        ) {
          next.address_postal_code = saved.address_postal_code;
        }
        if (!safeTrim(next.description) && safeTrim(saved.description)) {
          next.description = saved.description;
        }

        return next;
      });

      if (safeTrim(saved.address_search)) {
        setAddrSearch(saved.address_search);
      } else if (safeTrim(saved.address_line1)) {
        setAddrSearch(saved.address_line1);
      }
    } catch {
      // ignore
    }
  }, [cacheKey, isNewAgreement, setDLocal]);

  useEffect(() => {
    if (!safeTrim(addrSearch) && safeTrim(dLocal?.address_line1)) {
      setAddrSearch(dLocal.address_line1);
    }
  }, [agreementId, dLocal?.address_line1, addrSearch]);

  useEffect(() => {
    try {
      sessionStorage.setItem(startModeStorageKey, startMode);
    } catch {
      // ignore
    }
  }, [startMode, startModeStorageKey]);

  useEffect(() => {
    try {
      sessionStorage.setItem(startModeCommittedStorageKey, startModeCommitted ? "1" : "0");
    } catch {
      // ignore
    }
  }, [startModeCommitted, startModeCommittedStorageKey]);

  useEffect(() => {
    try {
      sessionStorage.setItem(startModeSourceStorageKey, startModeSource);
    } catch {
      // ignore
    }
  }, [startModeSource, startModeSourceStorageKey]);

  useEffect(() => {
    if (isNewAgreement) return;

    try {
      const payload = {
        payment_mode: dLocal?.payment_mode || "",
        payment_structure: dLocal?.payment_structure || "",
        retainage_percent: dLocal?.retainage_percent || "",
        address_search: addrSearch || "",
        address_line1: dLocal?.address_line1 || "",
        address_line2: dLocal?.address_line2 || "",
        address_city: dLocal?.address_city || "",
        address_state: dLocal?.address_state || "",
        address_postal_code: dLocal?.address_postal_code || "",
        description: dLocal?.description || "",
        geo: null,
      };
      sessionStorage.setItem(cacheKey, JSON.stringify(payload));
    } catch {
      // ignore
    }
  }, [
    isNewAgreement,
    cacheKey,
    addrSearch,
    dLocal?.payment_mode,
    dLocal?.payment_structure,
    dLocal?.retainage_percent,
    dLocal?.address_line1,
    dLocal?.address_line2,
    dLocal?.address_city,
    dLocal?.address_state,
    dLocal?.address_postal_code,
    dLocal?.description,
  ]);

  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerAddrMissing, setCustomerAddrMissing] = useState(null);
  const [customerAddrLoading, setCustomerAddrLoading] = useState(false);

  useEffect(() => {
    const raw = dLocal?.homeowner;
    const idVal = typeof raw === "number" ? raw : parseInt(String(raw || ""), 10);

    if (!idVal || Number.isNaN(idVal)) {
      setSelectedCustomer(null);
      setCustomerAddrMissing(null);
      return;
    }

    let cancelled = false;

    async function run() {
      setCustomerAddrLoading(true);
      try {
        const { data } = await api.get(`/projects/homeowners/${idVal}/`, {
          params: { _ts: Date.now() },
          headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
        });

        if (cancelled) return;

        setSelectedCustomer(data);

        const missing = computeCustomerAddressMissing(data);
        setCustomerAddrMissing(missing.length ? missing : null);
      } catch {
        if (cancelled) return;
        setSelectedCustomer(null);
        setCustomerAddrMissing(null);
      } finally {
        if (!cancelled) setCustomerAddrLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [dLocal?.homeowner]);

  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState("");
  const [aiPreview, setAiPreview] = useState("");

  const [aiCredits, setAiCredits] = useState({
    loading: true,
    access: "included",
    enabled: true,
    unlimited: true,
  });

  const refreshAiCredits = async () => {
    try {
      setAiCredits((s) => ({ ...s, loading: true }));
      const { data } = await api.get("/projects/contractors/me/");
      const c = extractAiCredits(data || {});
      setAiCredits({ loading: false, ...c });
    } catch {
      setAiCredits((s) => ({ ...s, loading: false }));
    }
  };

  useEffect(() => {
    refreshAiCredits();
  }, [agreementId]);

  const hasSomeContext = useMemo(() => {
    return (
      !!safeTrim(dLocal.project_title) ||
      !!safeTrim(dLocal.project_type) ||
      !!safeTrim(dLocal.project_subtype)
    );
  }, [dLocal.project_title, dLocal.project_type, dLocal.project_subtype]);
  const startModeCards = useMemo(
    () => [
      {
        key: "ai",
        title: "Use AI",
        description: "Describe the job and let the wizard help prefill setup details.",
      },
      {
        key: "template",
        title: "Use Template",
        description: "Start from a saved agreement pattern and adjust it for this project.",
      },
      {
        key: "manual",
        title: "Start from scratch",
        description: "Build the agreement manually with full control over the setup fields.",
      },
    ],
    []
  );
  const hasTemplateApplied =
    Boolean(agreement?.selected_template?.id || agreement?.selected_template_id) ||
    Boolean(assistantTopTemplatePreview?.id);
  const derivedStartMode = inferStartMode({
    agreement,
    assistantGuidedFlow,
    assistantTemplateRecommendations,
    assistantTopTemplatePreview,
  });
  useEffect(() => {
    if (startModeSource !== "derived") return;
    if (startMode !== derivedStartMode) {
      setStartMode(derivedStartMode);
    }
    if (
      (derivedStartMode === "template" ||
        (derivedStartMode === "ai" &&
          (assistantGuidedFlow?.guided_question ||
            assistantTopTemplatePreview?.id ||
            assistantTopTemplatePreview?.milestone_count ||
            assistantTemplateRecommendations.length))) &&
      !startModeCommitted
    ) {
      setStartModeCommitted(true);
    }
  }, [
    assistantGuidedFlow,
    assistantTemplateRecommendations.length,
    assistantTopTemplatePreview,
    derivedStartMode,
    startMode,
    startModeCommitted,
    startModeSource,
  ]);

  useEffect(() => {
    onAiModeActiveChange?.(startModeCommitted && startMode === "ai");
  }, [onAiModeActiveChange, startMode, startModeCommitted]);

  useEffect(() => {
    return () => {
      if (projectDetailsPulseTimerRef.current) {
        clearTimeout(projectDetailsPulseTimerRef.current);
      }
    };
  }, []);

  function queueProjectDetailsReview(changedKeys = []) {
    if (typeof window === "undefined") return;
    setPendingProjectDetailsReview({
      nonce: Date.now(),
      baselineScrollY: window.scrollY,
      changedKeys: Array.isArray(changedKeys) ? changedKeys.filter(Boolean) : [],
    });
  }

  function getAiSuggestedIndicator(fieldKey) {
    const fieldHighlight = aiHighlightKeys?.[fieldKey];
    if (!fieldHighlight) return null;
    const meta = aiSuggestedFieldMeta?.[fieldKey] || {};
    return meta.isNew ? "AI suggested (New)" : "AI suggested";
  }

  useEffect(() => {
    if (!pendingProjectDetailsReview?.nonce) return;

    const hasReviewFields =
      Boolean(safeTrim(dLocal?.project_title)) ||
      Boolean(safeTrim(dLocal?.project_type)) ||
      Boolean(safeTrim(dLocal?.project_subtype));

    if (!hasReviewFields || typeof window === "undefined") {
      setPendingProjectDetailsReview(null);
      return;
    }

    onAiSetupReviewReady?.({
      message: "Setup is ready to review in Project Details.",
      changedKeys: pendingProjectDetailsReview.changedKeys,
    });

    if (
      Math.abs(window.scrollY - Number(pendingProjectDetailsReview.baselineScrollY || 0)) > 180
    ) {
      setPendingProjectDetailsReview(null);
      return;
    }

    const target = projectDetailsSectionRef.current;
    if (!target) {
      setPendingProjectDetailsReview(null);
      return;
    }

    target.scrollIntoView({ behavior: "smooth", block: "start" });
    setProjectDetailsReviewPulse(true);
    if (projectDetailsPulseTimerRef.current) {
      clearTimeout(projectDetailsPulseTimerRef.current);
    }
    projectDetailsPulseTimerRef.current = setTimeout(() => {
      setProjectDetailsReviewPulse(false);
    }, 2200);
    setPendingProjectDetailsReview(null);
  }, [
    dLocal?.project_subtype,
    dLocal?.project_title,
    dLocal?.project_type,
    onAiSetupReviewReady,
    pendingProjectDetailsReview,
  ]);

  async function runAiDescription(mode) {
    if (locked) return;

    setAiErr("");
    setAiPreview("");
    setAiBusy(true);

    try {
      const payload = {
        mode,
        agreement_id: agreementId || null,
        project_title: dLocal.project_title || "",
        project_type: dLocal.project_type || "",
        project_subtype: dLocal.project_subtype || "",
        current_description: dLocal.description || "",
      };

      const res = await api.post(`/projects/agreements/ai/description/`, payload);
      const text = res?.data?.description || "";

      if (!safeTrim(text)) {
        throw new Error("AI returned an empty description.");
      }

      setAiPreview(text);

      setAiCredits((prev) => ({
        ...prev,
        loading: false,
        access: res?.data?.ai_access || "included",
        enabled: res?.data?.ai_enabled !== false,
        unlimited: res?.data?.ai_unlimited !== false,
      }));
    } catch (e) {
      setAiErr(
        e?.response?.data?.detail ||
          e?.message ||
          "AI description request failed."
      );
    } finally {
      setAiBusy(false);
    }
  }

  async function applyAiDescription(action) {
    if (locked) return;

    const suggestion = safeTrim(aiPreview);
    if (!suggestion) return;

    const cur = safeTrim(dLocal.description);
    const nextDescription =
      action === "append" && cur ? `${cur}\n\n${suggestion}` : suggestion;

    setDLocal((s) => ({ ...s, description: nextDescription }));
    if (!isNewAgreement) {
      writeCache({ description: nextDescription });
    }

    await patchAgreement({ description: nextDescription }, { silent: true });
    setAiPreview("");
  }

  const paymentStructure = normalizePaymentStructure(dLocal?.payment_structure);
  const retainagePercent = safeTrim(dLocal?.retainage_percent) || "0.00";
  const agreementMode = safeTrim(dLocal?.agreement_mode) || "standard";
  const isMaintenanceMode = agreementMode === "maintenance";
  const recurrencePattern = safeTrim(dLocal?.recurrence_pattern) || "monthly";
  const recurrenceInterval = safeTrim(dLocal?.recurrence_interval) || "1";
  const recurrenceStartDate = safeTrim(dLocal?.recurrence_start_date);
  const recurrenceEndDate = safeTrim(dLocal?.recurrence_end_date);
  const maintenanceStatus = safeTrim(dLocal?.maintenance_status) || "active";
  const autoGenerateNextOccurrence = dLocal?.auto_generate_next_occurrence !== false;
  const recurringSummaryLabel = safeTrim(dLocal?.recurring_summary_label);
  const nextOccurrenceDate = safeTrim(
    dLocal?.next_occurrence_date || agreement?.next_occurrence_date
  );
  const recurringSummaryText =
    recurringSummaryLabel || formatRecurrenceSummary(recurrencePattern, recurrenceInterval);

  async function handlePaymentStructureChange(nextMode) {
    if (locked) return;

    const normalized = normalizePaymentStructure(nextMode);
    if (normalized === paymentStructure) return;

    const confirmed = window.confirm(
      normalized === "progress"
        ? "Switch to Progress Payments? Milestones will stay intact, but the workflow will use draw requests after signing."
        : "Switch back to Simple Payments? Draw request tools will be hidden and retainage will reset to 0%."
    );
    if (!confirmed) return;

    const nextRetainage = normalized === "progress" ? retainagePercent || "0.00" : "0.00";
    const previousPaymentStructure = paymentStructure;
    const previousRetainage = retainagePercent || "0.00";
    setDLocal((s) => ({
      ...s,
      payment_structure: normalized,
      retainage_percent: nextRetainage,
    }));
    if (!isNewAgreement) {
      writeCache({ payment_structure: normalized, retainage_percent: nextRetainage });
    }

    if (!agreementId) return;

    try {
      await api.patch(`/projects/agreements/${agreementId}/`, {
        payment_structure: normalized,
        retainage_percent: nextRetainage,
      });
    } catch (e) {
      setDLocal((s) => ({
        ...s,
        payment_structure: previousPaymentStructure,
        retainage_percent: previousRetainage,
      }));
      if (!isNewAgreement) {
        writeCache({
          payment_structure: previousPaymentStructure,
          retainage_percent: previousRetainage,
        });
      }
      toast.error(formatApiError(e, "Could not update payment structure."));
    }
  }

  async function handleRetainageChange(value) {
    if (locked) return;
    const previousRetainage = retainagePercent || "0.00";
    setDLocal((s) => ({ ...s, retainage_percent: value }));
    if (!isNewAgreement) {
      writeCache({ retainage_percent: value });
    }
    if (!agreementId) return;
    try {
      await api.patch(`/projects/agreements/${agreementId}/`, {
        retainage_percent: value || "0.00",
      });
    } catch (e) {
      setDLocal((s) => ({ ...s, retainage_percent: previousRetainage }));
      if (!isNewAgreement) {
        writeCache({ retainage_percent: previousRetainage });
      }
      toast.error(formatApiError(e, "Could not update retainage."));
    }
  }

  async function handleMaintenanceModeChange(nextMode) {
    if (locked) return;
    const normalized = safeTrim(nextMode) === "maintenance" ? "maintenance" : "standard";
    const nextPatch =
      normalized === "maintenance"
        ? {
            agreement_mode: "maintenance",
            recurring_service_enabled: true,
            recurrence_pattern: recurrencePattern || "monthly",
            recurrence_interval: Math.max(1, Number(recurrenceInterval || 1) || 1),
            recurrence_start_date: recurrenceStartDate || "",
            recurrence_end_date: recurrenceEndDate || "",
            maintenance_status: maintenanceStatus || "active",
            auto_generate_next_occurrence: autoGenerateNextOccurrence,
            service_window_notes: dLocal?.service_window_notes || "",
            recurring_summary_label: dLocal?.recurring_summary_label || "",
          }
        : {
            agreement_mode: "standard",
            recurring_service_enabled: false,
            recurrence_pattern: "",
            recurrence_interval: 1,
            recurrence_start_date: null,
            recurrence_end_date: null,
            maintenance_status: "active",
            auto_generate_next_occurrence: false,
            service_window_notes: "",
            recurring_summary_label: "",
          };

    setDLocal((s) => ({
      ...s,
      ...nextPatch,
      agreement_mode: normalized,
    }));

    if (!agreementId) return;
    await patchAgreement(nextPatch, { silent: true });
  }

  async function handleMaintenanceFieldPatch(name, value) {
    if (locked) return;
    setDLocal((s) => ({ ...s, [name]: value }));
    if (!agreementId) return;
    await patchAgreement({ [name]: value }, { silent: true });
  }

  function persistAddressNow({ silent = true } = {}) {
    if (locked) return;

    patchAgreement(
      {
        address_line1: safeTrim(dLocal?.address_line1),
        address_line2: safeTrim(dLocal?.address_line2),
        address_city: safeTrim(dLocal?.address_city),
        address_state: safeTrim(dLocal?.address_state),
        address_postal_code: safeTrim(dLocal?.address_postal_code),
      },
      { silent }
    );
  }

  const {
    templatesLoading,
    templatesErr,
    selectedTemplateId,
    setSelectedTemplateId,
    applyingTemplateId,
    recommendedTemplateId,
    templateRecommendationReason,
    templateRecommendationScore,
    recommendationLoading,
    recommendationConfidence,
    templateSearch,
    setTemplateSearch,
    selectedTemplate,
    filteredTemplates,
    noTemplateMatch,
    noTemplateReason,
    templateDetail,
    templateDetailLoading,
    templateDetailErr,
    handleApplyTemplate,
    handleDeleteTemplate,
    handleSaveAsTemplate,
    handleTemplatePick,
  } = useStep1Templates({
    locked,
    agreementId,
    dLocal,
    setDLocal,
    isNewAgreement,
    writeCache,
    onTemplateApplied,
    refreshAgreement,
  });

  useEffect(() => {
    setDismissedAiTemplateRecommendation(false);
  }, [startMode, recommendedTemplateId, assistantTemplateRecommendations.length]);

  useEffect(() => {
    if (!aiSetupRequest?.nonce || startMode !== "ai") return;
    runAiRefineAndSetup(aiSetupRequest.prompt);
  }, [aiSetupRequest?.nonce]);

  async function onSubmitSaveAsTemplate(payload) {
    setSavingTemplate(true);
    try {
      const result = await handleSaveAsTemplate(payload);
      if (result?.ok) {
        setShowSaveTemplateModal(false);
      }
    } finally {
      setSavingTemplate(false);
    }
  }

  const [spreadEnabled, setSpreadEnabled] = useState(true);
  const [spreadTotal, setSpreadTotal] = useState("");
  const [autoSchedule, setAutoSchedule] = useState(true);

  const {
    aiLoading: aiMilestoneBusy,
    aiApplying: aiMilestoneApplying,
    aiError: aiMilestoneErr,
    aiPreview: aiMilestonePreview,
    setAiPreview: setAiMilestonePreview,
    runAiSuggest,
    applyAiMilestones,
  } = useAgreementMilestoneAI({
    agreementId,
    locked,
    refreshAgreement,
    refreshMilestones: null,
  });

  async function runAiMilestonesFromScope() {
    if (locked) return;
    if (!agreementId) {
      toast.error("Save Draft first.");
      return;
    }
    const notes = [
      safeTrim(dLocal?.project_title)
        ? `Project Title: ${safeTrim(dLocal.project_title)}`
        : "",
      safeTrim(dLocal?.project_type)
        ? `Project Type: ${safeTrim(dLocal.project_type)}`
        : "",
      safeTrim(dLocal?.project_subtype)
        ? `Project Subtype: ${safeTrim(dLocal.project_subtype)}`
        : "",
      safeTrim(dLocal?.description) ? `Scope: ${safeTrim(dLocal.description)}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    await runAiSuggest({ notes });
  }

  async function applyAiMilestonesFromScope(mode = "replace") {
    if (locked) return;

    const st = String(spreadTotal || "").trim();
    if (spreadEnabled && st !== "") {
      const n = Number(st);
      if (!Number.isFinite(n) || n <= 0) {
        toast.error("Auto-spread total must be greater than $0.");
        return;
      }
    }

    const result = await applyAiMilestones({
      mode,
      spreadEnabled,
      spreadTotal,
      autoSchedule,
    });

    if (result?.count > 0) {
      toast.success(`Created ${result.count} milestones via AI.`);
      if (typeof refreshAgreement === "function") {
        await refreshAgreement();
      }
    }
  }

  function syncLocalFromAgreementPayload(nextAgreement) {
    if (!nextAgreement || typeof nextAgreement !== "object") return;

    const nextSelectedTemplate =
      nextAgreement.selected_template || nextAgreement.selectedTemplate || null;

    const nextSelectedTemplateId =
      nextAgreement.selected_template_id ??
      nextAgreement.selectedTemplateId ??
      nextAgreement.project_template_id ??
      nextAgreement.template_id ??
      nextSelectedTemplate?.id ??
      null;

    const nextProjectTitle =
      safeTrim(nextAgreement.project_title) ||
      safeTrim(nextAgreement.title) ||
      safeTrim(nextAgreement.project?.title) ||
      safeTrim(dLocal?.project_title);

    const nextAddressLine1 =
      nextAgreement.address_line1 ??
      nextAgreement.project_address_line1 ??
      dLocal?.address_line1 ??
      "";

    const nextAddressLine2 =
      nextAgreement.address_line2 ??
      nextAgreement.project_address_line2 ??
      dLocal?.address_line2 ??
      "";

    const nextAddressCity =
      nextAgreement.address_city ??
      nextAgreement.city ??
      nextAgreement.project_address_city ??
      dLocal?.address_city ??
      "";

    const nextAddressState =
      nextAgreement.address_state ??
      nextAgreement.state ??
      nextAgreement.project_address_state ??
      dLocal?.address_state ??
      "";

    const nextAddressPostalCode =
      nextAgreement.address_postal_code ??
      nextAgreement.postal_code ??
      nextAgreement.project_postal_code ??
      dLocal?.address_postal_code ??
      "";

    setDLocal((prev) => ({
      ...prev,
      project_title: nextProjectTitle,
      project_type:
        nextAgreement.project_type ?? nextAgreement.projectType ?? prev.project_type ?? "",
      project_subtype:
        nextAgreement.project_subtype ??
        nextAgreement.projectSubtype ??
        prev.project_subtype ??
        "",
      description: nextAgreement.description ?? prev.description ?? "",
      payment_mode:
        normalizePaymentMode(
          nextAgreement.payment_mode ?? nextAgreement.paymentMode ?? prev.payment_mode
        ) || prev.payment_mode,
      payment_structure:
        normalizePaymentStructure(
          nextAgreement.payment_structure ?? nextAgreement.paymentStructure ?? prev.payment_structure
        ) || prev.payment_structure || "simple",
      retainage_percent:
        nextAgreement.retainage_percent != null
          ? String(nextAgreement.retainage_percent)
          : prev.retainage_percent || "0.00",
      selected_template: nextSelectedTemplate,
      selected_template_id: nextSelectedTemplateId,
      selected_template_name_snapshot:
        nextAgreement.selected_template_name_snapshot ??
        nextAgreement.selectedTemplateNameSnapshot ??
        nextSelectedTemplate?.name ??
        "",
      project_template_id: nextSelectedTemplateId,
      template_id: nextSelectedTemplateId,
      homeowner:
        nextAgreement.homeowner ??
        nextAgreement.homeowner_id ??
        prev.homeowner ??
        "",
      address_line1: nextAddressLine1,
      address_line2: nextAddressLine2,
      address_city: nextAddressCity,
      address_state: nextAddressState,
      address_postal_code: nextAddressPostalCode,
    }));

    if (!isNewAgreement) {
      writeCache({
        description: nextAgreement.description ?? dLocal?.description ?? "",
        payment_mode:
          normalizePaymentMode(
            nextAgreement.payment_mode ?? nextAgreement.paymentMode ?? dLocal?.payment_mode
          ) || dLocal?.payment_mode,
        payment_structure:
          normalizePaymentStructure(
            nextAgreement.payment_structure ?? nextAgreement.paymentStructure ?? dLocal?.payment_structure
          ) || dLocal?.payment_structure || "simple",
        retainage_percent:
          nextAgreement.retainage_percent != null
            ? String(nextAgreement.retainage_percent)
            : dLocal?.retainage_percent || "0.00",
        selected_template: nextSelectedTemplate,
        selected_template_id: nextSelectedTemplateId,
        selected_template_name_snapshot:
          nextAgreement.selected_template_name_snapshot ??
          nextSelectedTemplate?.name ??
          "",
        project_template_id: nextSelectedTemplateId,
        template_id: nextSelectedTemplateId,
        address_line1: nextAddressLine1,
        address_line2: nextAddressLine2,
        address_city: nextAddressCity,
        address_state: nextAddressState,
        address_postal_code: nextAddressPostalCode,
        address_search: nextAddressLine1 || "",
      });
    }

    if (safeTrim(nextAddressLine1)) {
      setAddrSearch(nextAddressLine1);
    }
  }

  async function handleTemplateApplied(nextAgreement, payload = null) {
    activateStartMode(startMode === "ai" ? "ai" : "template", {
      source: startMode === "ai" ? "assistant" : "template_apply",
    });
    setDismissedAiTemplateRecommendation(false);
    syncLocalFromAgreementPayload(nextAgreement);

    if (typeof onTemplateApplied === "function") {
      try {
        await onTemplateApplied(nextAgreement, payload);
      } catch {
        // ignore parent callback errors so local UI still updates
      }
    }

    if (typeof refreshAgreement === "function") {
      await refreshAgreement();
    }
  }

  async function handleTemplateApplyWithOptions(template, options = {}) {
    if (typeof handleApplyTemplate !== "function") return null;
    return handleApplyTemplate(template, options);
  }

  const appliedTemplateId = useMemo(() => {
    return (
      agreement?.selected_template?.id ||
      agreement?.selected_template_id ||
      agreement?.project_template_id ||
      agreement?.template_id ||
      dLocal?.selected_template?.id ||
      dLocal?.selected_template_id ||
      dLocal?.project_template_id ||
      dLocal?.template_id ||
      null
    );
  }, [
    agreement?.selected_template?.id,
    agreement?.selected_template_id,
    agreement?.project_template_id,
    agreement?.template_id,
    dLocal?.selected_template?.id,
    dLocal?.selected_template_id,
    dLocal?.project_template_id,
    dLocal?.template_id,
  ]);

  const complianceWarning = agreement?.compliance_warning || null;
  const appliedTemplateName = safeTrim(
    agreement?.selected_template?.name ||
      agreement?.selected_template_name_snapshot ||
      dLocal?.selected_template_name_snapshot ||
      selectedTemplate?.name
  );
  const aiRecommendedTemplate = useMemo(() => {
    const assistantTop = Array.isArray(assistantTemplateRecommendations)
      ? assistantTemplateRecommendations[0]
      : null;
    if (assistantTop?.id) return assistantTop;
    if (
      recommendedTemplateId &&
      selectedTemplate &&
      String(selectedTemplate.id) === String(recommendedTemplateId)
    ) {
      return selectedTemplate;
    }
    return (
      (filteredTemplates || []).find(
        (tpl) => String(tpl?.id || "") === String(recommendedTemplateId || "")
      ) || null
    );
  }, [
    assistantTemplateRecommendations,
    filteredTemplates,
    recommendedTemplateId,
    selectedTemplate,
  ]);
  const shouldShowCompactTemplateRecommendation =
    startMode === "ai" &&
    !appliedTemplateId &&
    !dismissedAiTemplateRecommendation &&
    !aiSetupResult &&
    Boolean(aiRecommendedTemplate?.id);
  const shouldShowAppliedTemplateSummary =
    startMode !== "template" && Boolean(appliedTemplateId);

  async function handleUseAiRecommendedTemplate() {
    if (!aiRecommendedTemplate) return;
    await handleTemplateApplyWithOptions(aiRecommendedTemplate);
  }

  function applyRefinedDescription(refinedDescription) {
    const nextDescription = safeTrim(refinedDescription);
    if (!nextDescription) return;

    setDLocal((prev) => ({ ...prev, description: nextDescription }));
    if (!isNewAgreement) {
      writeCache({ description: nextDescription });
    }
    if (agreementId) {
      patchAgreement({ description: nextDescription }, { silent: true });
    }
  }

  function applyAiSetupFields(aiData = {}) {
    const refinedDescription = safeTrim(aiData?.description || aiData?.normalized_description || "");
    const rawProjectTitle = safeTrim(
      aiData?.project_title ?? aiData?.title ?? aiData?.projectTitle ?? ""
    );
    const rawProjectType = safeTrim(aiData?.project_type ?? aiData?.projectType ?? "");
    const rawProjectSubtype = safeTrim(
      aiData?.project_subtype ?? aiData?.projectSubtype ?? ""
    );
    const sourceText = [
      rawProjectTitle,
      rawProjectType,
      rawProjectSubtype,
      refinedDescription,
    ]
      .filter(Boolean)
      .join(" ");
    const dominantCategory = inferDominantProjectCategory(sourceText);
    const dominantTypeOption = dominantCategory.category
      ? resolveOptionFromRawValue(dominantCategory.category, projectTypeOptions)
      : null;

    const matchedType = resolveBestTypeOption({
      rawType: rawProjectType || dominantCategory.category,
      rawSubtype: rawProjectSubtype || dominantCategory.subtype,
      sourceText,
      projectTypeOptions,
    }) || dominantTypeOption;
    const matchedSubtype = resolveBestSubtypeOption({
      rawSubtype: rawProjectSubtype || dominantCategory.subtype,
      rawType: rawProjectType || dominantCategory.category,
      sourceText,
      matchedType,
      projectSubtypeOptions,
    });
    const matchedSubtypeParentType =
      matchedSubtype?.project_type && !matchedType
        ? resolveOptionFromRawValue(matchedSubtype.project_type, projectTypeOptions)
        : null;
    const resolvedType = matchedType || matchedSubtypeParentType || null;

    const generatedTitle =
      rawProjectTitle ||
      optionDisplayLabel(matchedSubtype) ||
      buildGeneratedProjectTitle(sourceText) ||
      optionDisplayLabel(resolvedType) ||
      "Custom Project";

    const generatedType =
      optionCanonicalValue(resolvedType) ||
      dominantCategory.category ||
      buildGeneratedProjectTitle(sourceText).split(/\s+/).slice(0, 2).join(" ") ||
      "Custom Project";

    const generatedSubtype =
      optionCanonicalValue(matchedSubtype) ||
      dominantCategory.subtype ||
      (rawProjectSubtype && !extractNumericIdCandidate(rawProjectSubtype) ? rawProjectSubtype : "") ||
      generatedTitle;

    const nextValues = {
      project_title: generatedTitle,
      project_type: generatedType,
      project_subtype: generatedSubtype,
    };

    const changedKeys = Object.entries(nextValues)
      .filter(([key, value]) => safeTrim(value) && safeTrim(dLocal?.[key]) !== safeTrim(value))
      .map(([key]) => key);

    if (!changedKeys.length) {
      return { changedKeys, nextValues };
    }

    const projectTypeRef = resolvedType?.id || null;
    const projectSubtypeRef = matchedSubtype?.id || null;
    const usedFallbackCreation = Boolean(
      (generatedType && !resolvedType) || (generatedSubtype && !matchedSubtype)
    );

    console.info("[Step1 AI setup taxonomy]", {
      classificationReasoning: dominantCategory.reasoning,
      dominantCategory: dominantCategory.category,
      dominantSubtype: dominantCategory.subtype,
      rawProjectType,
      matchedProjectType: optionCanonicalValue(resolvedType),
      rawProjectSubtype,
      matchedProjectSubtype: optionCanonicalValue(matchedSubtype),
      usedFallbackCreation,
    });

    setAiSuggestedFieldMeta({
      project_title: { isNew: false },
      project_type: { isNew: Boolean(generatedType && !resolvedType) },
      project_subtype: { isNew: Boolean(generatedSubtype && !matchedSubtype) },
    });

    setDLocal((prev) => ({
      ...prev,
      ...nextValues,
    }));

    if (!isNewAgreement) {
      writeCache(nextValues);
    }

    if (agreementId) {
      patchAgreement(
        {
          project_title: generatedTitle,
          title: generatedTitle,
          project_type: generatedType,
          project_type_ref: projectTypeRef,
          project_subtype: generatedSubtype,
          project_subtype_ref: projectSubtypeRef,
        },
        { silent: true }
      );
    }

    return { changedKeys, nextValues };
  }

  async function runAiRefineAndSetup(promptText) {
    const roughDescription = safeTrim(promptText);
    if (!roughDescription) return;

    setAiSetupBusy(true);
    setAiSetupError("");
    setAiSetupResult(null);
    setDismissedAiTemplateRecommendation(false);

    try {
      const refinePayload = {
        mode: "generate",
        agreement_id: agreementId || null,
        project_title: dLocal.project_title || "",
        project_type: dLocal.project_type || "",
        project_subtype: dLocal.project_subtype || "",
        current_description: roughDescription,
      };

      const refineRes = await api.post(`/projects/agreements/ai/description/`, refinePayload);
      const refinedDescription = safeTrim(refineRes?.data?.description || "");

      if (!refinedDescription) {
        throw new Error("AI returned an empty description.");
      }

      applyRefinedDescription(refinedDescription);
      const {
        changedKeys: setupFieldKeys,
        nextValues: suggestedSetupValues,
      } = applyAiSetupFields(refineRes?.data || {});

      const recommendRes = await api.post("/projects/templates/recommend/", {
        project_title: suggestedSetupValues?.project_title || dLocal.project_title || "",
        project_type: suggestedSetupValues?.project_type || dLocal.project_type || "",
        project_subtype:
          suggestedSetupValues?.project_subtype || dLocal.project_subtype || "",
        description: refinedDescription,
      });

      const recommendationData = recommendRes?.data || {};
      const resolvedProjectType = safeTrim(
        suggestedSetupValues?.project_type || dLocal.project_type || ""
      );
      const resolvedProjectSubtype = safeTrim(
        suggestedSetupValues?.project_subtype || dLocal.project_subtype || ""
      );
      const recommendationCandidates = Array.isArray(recommendationData?.candidates)
        ? recommendationData.candidates
        : Array.isArray(recommendationData?.results)
        ? recommendationData.results
        : [];
      const recommendedTemplate =
        recommendationData?.recommended_template ||
        recommendationData?.possible_match ||
        recommendationCandidates[0] ||
        null;
      const confidence = String(recommendationData?.confidence || "none").toLowerCase();
      const score = Number(
        recommendationData?.score ??
          recommendedTemplate?.score ??
          recommendedTemplate?.rank_score ??
          0
      );
      const exactTypeMatch =
        safeTrim(recommendedTemplate?.project_type).toLowerCase() ===
          resolvedProjectType.toLowerCase() && resolvedProjectType;
      const exactSubtypeMatch =
        safeTrim(recommendedTemplate?.project_subtype).toLowerCase() ===
          resolvedProjectSubtype.toLowerCase() && resolvedProjectSubtype;
      const strongMatch =
        Boolean(recommendedTemplate?.id) &&
        (confidence === "recommended" || score >= 70 || (exactTypeMatch && exactSubtypeMatch));
      const recommendationReason =
        safeTrim(recommendationData?.reason) ||
        (exactTypeMatch && exactSubtypeMatch
          ? "Matches the project type and subtype you selected."
          : exactTypeMatch
          ? "Matches the project type you selected."
          : "This template closely matches the job details you provided.");

      if (strongMatch) {
        setAiSetupResult({
          kind: "template_match",
          refinedDescription,
          recommendedTemplate,
          reason: recommendationReason,
          setupFieldKeys,
        });
        queueProjectDetailsReview(["description", ...setupFieldKeys]);
      } else {
        setAiSetupResult({
          kind: "description_only",
          refinedDescription,
          message:
            "No matching template found. We added the refined description and you can continue.",
          setupFieldKeys,
        });
        queueProjectDetailsReview(["description", ...setupFieldKeys]);
      }
    } catch (e) {
      setAiSetupError(
        e?.response?.data?.detail || e?.message || "Could not refine and set up this agreement."
      );
    } finally {
      setAiSetupBusy(false);
    }
  }

  async function handleUseAiDescriptionOnly() {
    if (!aiSetupResult?.refinedDescription) return;
    applyRefinedDescription(aiSetupResult.refinedDescription);
    setAiSetupResult({
      kind: "description_only",
      refinedDescription: aiSetupResult.refinedDescription,
      message:
        "No matching template found. We added the refined description and you can continue.",
      setupFieldKeys: Array.isArray(aiSetupResult?.setupFieldKeys)
        ? aiSetupResult.setupFieldKeys
        : [],
    });
    setDismissedAiTemplateRecommendation(true);
  }

  async function handleResetStep1Setup() {
    if (locked || !agreementId) return;

    try {
      const { data } = await api.post(`/projects/agreements/${agreementId}/reset-step1/`);
      const nextAgreement = data?.agreement || null;

      setDLocal((prev) => ({
        ...prev,
        project_title: safeTrim(nextAgreement?.project_title ?? nextAgreement?.title ?? ""),
        project_type: nextAgreement?.project_type ?? "",
        project_subtype: nextAgreement?.project_subtype ?? "",
        description: nextAgreement?.description ?? "",
        homeowner:
          nextAgreement?.homeowner != null && nextAgreement?.homeowner !== ""
            ? String(nextAgreement.homeowner)
            : "",
        selected_template: null,
        selected_template_id: null,
        selected_template_name_snapshot: "",
        project_template_id: null,
        template_id: null,
        agreement_mode: nextAgreement?.agreement_mode ?? "standard",
        recurring_service_enabled: false,
        recurrence_pattern: "",
        recurrence_interval: "1",
        recurrence_start_date: "",
        recurrence_end_date: "",
        next_occurrence_date: "",
        maintenance_status: "active",
        auto_generate_next_occurrence: false,
        service_window_notes: "",
        recurring_summary_label: "",
        payment_structure:
          normalizePaymentStructure(nextAgreement?.payment_structure) || "simple",
        retainage_percent:
          nextAgreement?.retainage_percent != null
            ? String(nextAgreement.retainage_percent)
            : "0.00",
        address_line1: "",
        address_line2: "",
        address_city: "",
        address_state: "",
        address_postal_code: "",
      }));

      setSelectedTemplateId(null);
      setTemplateSearch("");
      setAiPreview("");
      setAiErr("");
      setAiMilestonePreview("");
      setAddrSearch("");
      setSelectedCustomer(null);
      setCustomerAddrMissing(null);
      setShowQuickAdd(false);
      setShowResetStep1Confirm(false);
      clearStep1SessionState();
      setStartMode("manual");
      setStartModeCommitted(false);
      setStartModeSource("session");

      toast.success("Form reset. Choose how you want to start again.");

      if (typeof refreshAgreement === "function") {
        await refreshAgreement();
      }
    } catch (e) {
      toast.error(formatApiError(e, "Could not reset this draft."));
    }
  }

  async function handleUpdateTemplateDays(templateId, payload = {}) {
    if (locked) return;
    if (!templateId) return;

    const parsedDays = Number(payload?.estimated_days || 0);
    if (!parsedDays || parsedDays < 1) {
      toast.error("Estimated days must be at least 1.");
      return;
    }

    try {
      await api.patch(`/projects/templates/${templateId}/`, {
        estimated_days: parsedDays,
      });

      toast.success("Template duration updated.");

      if (typeof refreshAgreement === "function") {
        await refreshAgreement();
      }

      if (typeof handleTemplatePick === "function" && selectedTemplate) {
        const nextSelected =
          String(selectedTemplate?.id || "") === String(templateId)
            ? { ...selectedTemplate, estimated_days: parsedDays }
            : selectedTemplate;

        handleTemplatePick(nextSelected);
      }
    } catch (e) {
      const msg =
        e?.response?.data?.detail ||
        e?.response?.data?.error ||
        "Could not update template duration.";
      toast.error(msg);
    }
  }

  const goNextNoSave = () => {
    if (!agreementId) return;
    navigate(`${BASE}/agreements/${agreementId}/wizard?step=2`);
  };

  const defaultTemplateName = useMemo(() => {
    const parts = [
      safeTrim(dLocal?.project_type),
      safeTrim(dLocal?.project_subtype),
      safeTrim(dLocal?.project_title),
    ].filter(Boolean);

    return parts.length ? parts.join(" – ") : "My New Template";
  }, [dLocal?.project_type, dLocal?.project_subtype, dLocal?.project_title]);

  const handleCreateNewType = () => {
    if (locked) return;
    toast("New Type modal/form is the next step to wire.");
  };

  const handleCreateNewSubtype = () => {
    if (locked) return;
    if (!safeTrim(dLocal?.project_type)) {
      toast("Select a Type first.");
      return;
    }
    toast(
      `New Subtype flow for "${safeTrim(dLocal?.project_type)}" is the next step to wire.`
    );
  };

  const handleStep1LocalChange = async (e) => {
    if (locked) return;

    const name = e?.target?.name;
    const value = e?.target?.value;

    if (name === "project_title" || name === "project_type" || name === "project_subtype") {
      setAiSuggestedFieldMeta((prev) => {
        if (!prev?.[name]) return prev;
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }

    onLocalChange?.(e);

    if (!agreementId || !name) return;

    if (name === "project_title") {
      schedulePatch(
        {
          project_title: value || "",
          title: value || "",
        },
        450
      );
      return;
    }

    if (name === "project_type") {
      const pickedType =
        (projectTypeOptions || []).find(
          (opt) => safeTrim(opt?.value) === safeTrim(value)
        ) || null;

      schedulePatch(
        {
          project_type: value || "",
          project_type_ref: pickedType?.id || null,
          project_subtype: "",
          project_subtype_ref: null,
        },
        250
      );
      return;
    }

    if (name === "project_subtype") {
      const pickedSubtype =
        (projectSubtypeOptions || []).find(
          (opt) => safeTrim(opt?.value) === safeTrim(value)
        ) || null;

      schedulePatch(
        {
          project_subtype: value || "",
          project_subtype_ref: pickedSubtype?.id || null,
          ...(pickedSubtype?.project_type && !safeTrim(dLocal?.project_type)
            ? { project_type: pickedSubtype.project_type }
            : {}),
          ...(pickedSubtype?.project_type && !selectedProjectType?.id
            ? {
                project_type_ref:
                  (projectTypeOptions || []).find(
                    (opt) =>
                      safeTrim(opt?.value) === safeTrim(pickedSubtype.project_type)
                  )?.id || null,
              }
            : {}),
        },
        250
      );
      return;
    }

    if (name === "description") {
      schedulePatch({ description: value || "" }, 450);
      return;
    }
  };

  const activeStartModeLabel =
    startMode === "ai"
      ? "AI-assisted"
      : startMode === "template"
      ? "Template-based"
      : "Start from scratch";
  const activeStartModeSummary =
    startMode === "ai"
      ? "Describe the job in the AI panel first, then review the setup details it prepares below."
      : startMode === "template"
      ? "Use a template as the starting point, then review and edit the agreement details below."
      : "Fill in the setup details directly, with AI and templates still available if you want help later.";
  const canResetStep1 =
    Boolean(agreementId) &&
    !locked &&
    String(agreement?.status || "").toLowerCase() === "draft";
  const hasResettableStep1State =
    Boolean(appliedTemplateId) ||
    Boolean(safeTrim(dLocal?.project_title)) ||
    Boolean(safeTrim(dLocal?.project_type)) ||
    Boolean(safeTrim(dLocal?.project_subtype)) ||
    Boolean(safeTrim(dLocal?.description)) ||
    Boolean(dLocal?.homeowner) ||
    Boolean(safeTrim(dLocal?.address_line1)) ||
    Boolean(safeTrim(dLocal?.address_city)) ||
    paymentStructure !== "simple" ||
    safeTrim(dLocal?.agreement_mode) === "maintenance";
  const shouldDeemphasizeManualReview = startModeCommitted && startMode !== "manual";
  const supportSectionClass = shouldDeemphasizeManualReview
    ? "border-slate-200 bg-slate-50/40 shadow-none"
    : "";
  const projectDetailsDescription =
    startMode === "ai"
      ? "Describe the job with AI first, then review and edit the project details here."
      : startMode === "template"
      ? "Confirm the template-driven details here so the agreement matches this specific project."
      : "Define the project type, title, scope, and agreement behavior for this job.";

  return (
    <>
      <div className="space-y-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="text-sm text-gray-600">
          {isEdit ? <>Agreement #{agreementId}</> : <>New Agreement</>}
        </div>

        {locked ? (
          <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <div className="font-semibold">Locked</div>
            <div className="mt-1 text-xs text-amber-900/90">
              This agreement is signed/executed. Step 1–3 are read-only. Create an
              amendment to change details.
            </div>
          </div>
        ) : null}

        {complianceWarning?.warning_level && complianceWarning.warning_level !== "none" ? (
          <div
            data-testid="agreement-compliance-warning"
            className={`mb-3 rounded-md border px-4 py-3 text-sm ${
              complianceWarning.warning_level === "critical"
                ? "border-rose-200 bg-rose-50 text-rose-900"
                : complianceWarning.warning_level === "warning"
                ? "border-amber-200 bg-amber-50 text-amber-900"
                : "border-sky-200 bg-sky-50 text-sky-900"
            }`}
          >
            <div className="font-semibold">Compliance note</div>
            <div className="mt-1">
              {complianceWarning.message || "This work may require a license in the project state."}
            </div>
            {complianceWarning.official_lookup_url ? (
              <a
                href={complianceWarning.official_lookup_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-xs font-semibold underline"
              >
                View official source
              </a>
            ) : null}
          </div>
        ) : null}

        {assistantGuidedFlow?.guided_question ? (
          <div
            data-testid="assistant-guided-step1"
            className="mb-3 rounded-md border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900"
          >
            <div className="font-semibold">Guided next step</div>
            <div className="mt-1">{assistantGuidedFlow.guided_question}</div>
            {assistantGuidedFlow.why_this_matters ? (
              <div className="mt-1 text-xs text-indigo-800/90">
                {assistantGuidedFlow.why_this_matters}
              </div>
            ) : null}
          </div>
        ) : null}

        {startMode === "ai" &&
        assistantTemplateRecommendations.length &&
        !shouldShowCompactTemplateRecommendation ? (
          <div
            data-testid="assistant-template-preview-step1"
            className="mb-3 rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900"
          >
            <div className="font-semibold">Recommended template</div>
            <div className="mt-1">{assistantTemplateRecommendations[0]?.name}</div>
            {assistantTemplateRecommendations[0]?.rank_reasons?.length ? (
              <div className="mt-1 text-xs text-sky-800/90">
                {assistantTemplateRecommendations[0].rank_reasons.slice(0, 2).join(" • ")}
              </div>
            ) : null}
            {assistantTopTemplatePreview?.milestone_count ? (
              <div className="mt-1 text-xs text-sky-800/90">
                Includes {assistantTopTemplatePreview.milestone_count} default milestone
                {assistantTopTemplatePreview.milestone_count === 1 ? "" : "s"}.
              </div>
            ) : null}
          </div>
        ) : null}

        {assistantProactiveRecommendations.length ? (
          <div
            data-testid="assistant-proactive-step1"
            className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            <div className="font-semibold">Proactive recommendations</div>
            <div className="mt-2 space-y-2">
              {assistantProactiveRecommendations.slice(0, 2).map((item) => (
                <div key={`${item.recommendation_type}-${item.title}`}>
                  <div className="font-medium">{item.title}</div>
                  <div className="text-xs text-amber-800/90">{item.message}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {assistantPredictiveInsights.length ? (
          <div
            data-testid="assistant-predictive-step1"
            className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900"
          >
            <div className="font-semibold">Predictive insight</div>
            <div className="mt-1">{assistantPredictiveInsights[0]?.title}</div>
            <div className="mt-1 text-xs text-slate-700">
              {assistantPredictiveInsights[0]?.summary}
            </div>
          </div>
        ) : null}

        {assistantConfirmationRequiredActions.length ? (
          <div
            data-testid="assistant-confirmation-step1"
            className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900"
          >
            <div className="font-semibold">Actions requiring confirmation</div>
            <div className="mt-1 text-xs text-rose-800/90">
              {assistantConfirmationRequiredActions[0]?.action_label ||
                assistantProposedActions[0]?.action_label ||
                "Review AI-prepared changes before saving them."}
            </div>
          </div>
        ) : null}

        {last400 ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
            <div className="text-sm font-semibold text-red-700">
              Server response (400)
            </div>
            <PrettyJson data={last400} />
          </div>
        ) : null}

        <section className="min-h-[180px] rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          {startModeCommitted ? (
            <div
              data-testid="step1-start-mode-summary"
              className={`rounded-2xl border px-4 py-4 ${
                startMode === "ai"
                  ? "border-indigo-200 bg-indigo-50/70"
                  : startMode === "template"
                  ? "border-sky-200 bg-sky-50/70"
                  : "border-slate-200 bg-slate-50"
              }`}
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Mode
                  </div>
                  <div className="mt-1 text-base font-semibold text-slate-900">
                    {activeStartModeLabel}
                  </div>
                  <div className="mt-1 text-sm text-slate-600">{activeStartModeSummary}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {canResetStep1 && hasResettableStep1State ? (
                    <button
                      type="button"
                      data-testid="step1-reset-form-button"
                      onClick={() => setShowResetStep1Confirm(true)}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Reset form
                    </button>
                  ) : null}
                  <button
                    type="button"
                    data-testid="step1-change-start-mode"
                    onClick={reopenStartModeChooser}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Change start mode
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div data-testid="step1-start-mode-chooser">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">
                    How do you want to start this agreement?
                  </h3>
                  <p className="mt-1 text-sm text-slate-600">
                    Choose the fastest starting path for this job. You can still switch approaches as
                    you work.
                  </p>
                </div>
                <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Step 1 setup
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {startModeCards.map((option) => {
                  const active = startMode === option.key;
                  return (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => activateStartMode(option.key)}
                      className={`rounded-2xl border px-4 py-4 text-left transition ${
                        active
                          ? "border-indigo-300 bg-indigo-50 shadow-sm"
                          : "border-slate-200 bg-slate-50/70 hover:border-slate-300 hover:bg-white"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-slate-900">{option.title}</div>
                        {active ? (
                          <span className="rounded-full border border-indigo-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700">
                            Selected
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-2 text-sm text-slate-600">{option.description}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {showResetStep1Confirm && canResetStep1 ? (
          <div
            data-testid="step1-reset-form-confirm"
            className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-900"
          >
            <div className="font-semibold">Start over?</div>
            <div className="mt-1 text-sm text-rose-900/90">
              This will clear your current setup so you can begin again.
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="step1-reset-form-confirm-button"
                onClick={handleResetStep1Setup}
                className="rounded-xl bg-rose-600 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-700"
              >
                Reset
              </button>
              <button
                type="button"
                data-testid="step1-reset-form-cancel-button"
                onClick={() => setShowResetStep1Confirm(false)}
                className="rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-800 hover:bg-rose-100"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {startMode === "ai" && aiSetupBusy ? (
          <div
            data-testid="step1-ai-setup-status"
            className="rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-4 text-sm text-indigo-900"
          >
            <div className="font-semibold">Refining the description and checking for a template match…</div>
          </div>
        ) : null}

        {startMode === "ai" && aiSetupError ? (
          <div
            data-testid="step1-ai-setup-error"
            className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-900"
          >
            {aiSetupError}
          </div>
        ) : null}

        {startMode === "ai" && aiSetupResult?.kind === "template_match" ? (
          <section
            data-testid="step1-ai-setup-result"
            className="rounded-2xl border border-indigo-200 bg-indigo-50/70 p-5 shadow-sm"
          >
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-700">
              Template recommendation
            </div>
            <div className="mt-2 text-base font-semibold text-slate-900">
              {aiSetupResult.recommendedTemplate?.name || "Recommended template"}
            </div>
            <div className="mt-1 text-sm text-slate-700">
              We refined the description first and found a strong template match for this setup.
            </div>
            <div className="mt-2 rounded-xl border border-white/80 bg-white/80 px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Refined description
              </div>
              <div className="mt-2 whitespace-pre-wrap text-sm text-slate-800">
                {aiSetupResult.refinedDescription}
              </div>
            </div>
            <div className="mt-3 text-sm text-slate-700">
              {aiSetupResult.reason}
            </div>
            <div className="mt-2 text-xs text-slate-600">
              The Project Details section below stays editable after you choose how to continue.
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="step1-ai-setup-apply-template"
                onClick={() => handleTemplateApplyWithOptions(aiSetupResult.recommendedTemplate)}
                disabled={
                  locked ||
                  !agreementId ||
                  applyingTemplateId === aiSetupResult.recommendedTemplate?.id
                }
                className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {applyingTemplateId === aiSetupResult.recommendedTemplate?.id
                  ? "Applying..."
                  : "Apply Template"}
              </button>
              <button
                type="button"
                data-testid="step1-ai-setup-description-only"
                onClick={handleUseAiDescriptionOnly}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Use Description Only
              </button>
            </div>
          </section>
        ) : null}

        {startMode === "ai" && aiSetupResult?.kind === "description_only" ? (
          <section
            data-testid="step1-ai-setup-result"
            className="rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm"
          >
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Description ready
            </div>
            <div className="mt-2 text-base font-semibold text-slate-900">
              Refined description added
            </div>
            <div className="mt-2 rounded-xl border border-white/80 bg-white/80 px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Refined description
              </div>
              <div className="mt-2 whitespace-pre-wrap text-sm text-slate-800">
                {aiSetupResult.refinedDescription}
              </div>
            </div>
            <div className="mt-3 text-sm text-slate-700">
              {aiSetupResult.message}
            </div>
            <div className="mt-2 text-xs text-slate-600">
              Review the Project Details section below and keep editing before you continue.
            </div>
          </section>
        ) : null}

        {startMode === "template" ? (
          <section
            data-testid="step1-template-browser"
            className="rounded-2xl border border-indigo-200 bg-indigo-50/40 shadow-sm"
          >
            <div className="flex items-center justify-between gap-3 px-5 py-4">
              <div>
                <div className="text-base font-semibold text-slate-900">Templates</div>
                <div className="mt-1 text-sm text-slate-600">
                  Reuse a saved agreement structure if this project follows a familiar pattern.
                </div>
              </div>
              <span className="rounded-full border border-indigo-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
                Template mode
              </span>
            </div>
            <div className="border-t border-slate-200 px-5 py-5">
              <TemplateSearchSection
                locked={locked}
                agreementId={agreementId}
                dLocal={dLocal}
                onLocalChange={handleStep1LocalChange}
                entryMode={startMode}
                projectTypeOptions={projectTypeOptions}
                projectSubtypeOptions={projectSubtypeOptions}
                templatesLoading={templatesLoading}
                templatesErr={templatesErr}
                filteredTemplates={filteredTemplates}
                templateSearch={templateSearch}
                setTemplateSearch={setTemplateSearch}
                selectedTemplateId={selectedTemplateId}
                recommendedTemplateId={recommendedTemplateId}
                recommendationConfidence={recommendationConfidence}
                recommendationLoading={recommendationLoading}
                templateRecommendationReason={templateRecommendationReason}
                templateRecommendationScore={templateRecommendationScore}
                selectedTemplate={selectedTemplate}
                applyingTemplateId={applyingTemplateId}
                handleTemplatePick={handleTemplatePick}
                handleApplyTemplate={handleTemplateApplyWithOptions}
                handleDeleteTemplate={handleDeleteTemplate}
                handleUpdateTemplateDays={handleUpdateTemplateDays}
                setSelectedTemplateId={setSelectedTemplateId}
                setShowSaveTemplateModal={setShowSaveTemplateModal}
                noTemplateMatch={noTemplateMatch}
                noTemplateReason={noTemplateReason}
                templateDetail={templateDetail}
                templateDetailLoading={templateDetailLoading}
                templateDetailErr={templateDetailErr}
                aiCredits={aiCredits}
                aiBusy={aiBusy}
                aiErr={aiErr}
                aiPreview={aiPreview}
                setAiPreview={setAiPreview}
                refreshAiCredits={refreshAiCredits}
                runAiDescription={runAiDescription}
                applyAiDescription={applyAiDescription}
                hasSomeContext={hasSomeContext}
                onAddProjectType={handleCreateNewType}
                onAddProjectSubtype={handleCreateNewSubtype}
                aiMilestoneBusy={aiMilestoneBusy}
                aiMilestoneApplying={aiMilestoneApplying}
                aiMilestoneErr={aiMilestoneErr}
                aiMilestonePreview={aiMilestonePreview}
                setAiMilestonePreview={setAiMilestonePreview}
                runAiMilestonesFromScope={runAiMilestonesFromScope}
                applyAiMilestonesFromScope={applyAiMilestonesFromScope}
                spreadEnabled={spreadEnabled}
                setSpreadEnabled={setSpreadEnabled}
                spreadTotal={spreadTotal}
                setSpreadTotal={setSpreadTotal}
                autoSchedule={autoSchedule}
                setAutoSchedule={setAutoSchedule}
                showProjectFields={false}
                appliedTemplateId={appliedTemplateId}
                onTemplateApplied={handleTemplateApplied}
              />
            </div>
          </section>
        ) : null}

        {shouldShowCompactTemplateRecommendation ? (
          <section
            data-testid="step1-ai-template-recommendation"
            className="rounded-2xl border border-sky-200 bg-sky-50/70 p-5 shadow-sm"
          >
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                  AI Recommendation
                </div>
                <div className="mt-1 text-base font-semibold text-slate-900">
                  {aiRecommendedTemplate?.name || "I found a strong template fit"}
                </div>
                <div className="mt-1 text-sm text-slate-700">
                  {templateRecommendationReason ||
                    "This looks like a strong starting structure for the job you described."}
                </div>
                {assistantTopTemplatePreview?.milestone_count ? (
                  <div className="mt-2 text-xs text-sky-800/90">
                    Includes {assistantTopTemplatePreview.milestone_count} default milestone
                    {assistantTopTemplatePreview.milestone_count === 1 ? "" : "s"}.
                  </div>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-testid="step1-ai-template-apply"
                  onClick={handleUseAiRecommendedTemplate}
                  disabled={locked || !agreementId || applyingTemplateId === aiRecommendedTemplate?.id}
                  className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  {applyingTemplateId === aiRecommendedTemplate?.id
                    ? "Applying..."
                    : "Use this template"}
                </button>
                <button
                  type="button"
                  data-testid="step1-ai-template-browse"
                  onClick={() => activateStartMode("template")}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  View template options
                </button>
                <button
                  type="button"
                  data-testid="step1-ai-template-dismiss"
                  onClick={() => setDismissedAiTemplateRecommendation(true)}
                  className="rounded-xl border border-transparent px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-white/70"
                >
                  Keep building with AI
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {shouldShowAppliedTemplateSummary ? (
          <section
            data-testid="step1-template-applied-summary"
            className={`rounded-2xl border p-5 shadow-sm ${
              startMode === "ai"
                ? "border-indigo-200 bg-indigo-50/60"
                : "border-slate-200 bg-slate-50/70"
            }`}
          >
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Template in use
                </div>
                <div className="mt-1 text-base font-semibold text-slate-900">
                  {appliedTemplateName || "Template applied"}
                </div>
                <div className="mt-1 text-sm text-slate-600">
                  {startMode === "ai"
                    ? "AI is still guiding this setup. Review the template-shaped details below and keep refining the agreement."
                    : "This draft already has a template applied. Review the setup details below or switch modes if you want a different starting path."}
                </div>
              </div>
              <button
                type="button"
                data-testid="step1-template-applied-browse"
                onClick={() => activateStartMode("template")}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                View template options
              </button>
            </div>
          </section>
        ) : null}

        <div className="space-y-6">
          <StepSection
            title="Project Details"
            description={projectDetailsDescription}
            sectionRef={projectDetailsSectionRef}
            highlighted={hasAiSectionHighlight(
              "project_title",
              "project_type",
              "project_subtype",
              "description",
              "agreement_mode",
              "recurrence_pattern",
              "recurrence_interval"
            )}
            emphasis={projectDetailsReviewPulse}
          >
            <div className="space-y-5">
              <div
                data-testid="maintenance-settings-card"
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="text-sm font-semibold text-slate-900">How this agreement works</div>
                <div className="mt-1 text-sm text-slate-600">
                  Choose whether this is a standard one-time agreement or a recurring service agreement.
                </div>

                <div className="mt-4 grid gap-3">
                  <button
                    type="button"
                    onClick={() => handleMaintenanceModeChange("standard")}
                    disabled={locked}
                    className={`rounded-xl border px-4 py-3 text-left transition ${
                      !isMaintenanceMode
                        ? "border-indigo-300 bg-indigo-50"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                    } disabled:opacity-60`}
                  >
                    <div className="font-semibold text-slate-900">Standard Agreement</div>
                    <div className="mt-1 text-sm text-slate-600">
                      One-time project with normal milestone planning.
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleMaintenanceModeChange("maintenance")}
                    disabled={locked}
                    className={`rounded-xl border px-4 py-3 text-left transition ${
                      isMaintenanceMode
                        ? "border-emerald-300 bg-emerald-50"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                    } disabled:opacity-60`}
                  >
                    <div className="font-semibold text-slate-900">Maintenance / Recurring Service</div>
                    <div className="mt-1 text-sm text-slate-600">
                      Generate repeat service occurrences while keeping the same approval, invoice, and payment flow.
                    </div>
                  </button>
                </div>

                {isMaintenanceMode ? (
                  <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50/40 p-3">
                    <div
                      data-testid="maintenance-summary"
                      className="rounded-md border border-emerald-200 bg-white px-3 py-3 text-sm text-slate-700"
                    >
                      <div className="font-semibold text-slate-900">{recurringSummaryText}</div>
                      <div className="mt-1 text-xs text-slate-600">
                        {recurrenceStartDate
                          ? `Starts ${recurrenceStartDate}`
                          : "Pick a start date to generate the first service occurrence."}
                        {nextOccurrenceDate ? ` • Next service: ${nextOccurrenceDate}` : ""}
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                          Frequency
                        </label>
                        <select
                          data-testid="maintenance-frequency-select"
                          value={recurrencePattern}
                          disabled={locked}
                          onChange={(e) =>
                            handleMaintenanceFieldPatch("recurrence_pattern", e.target.value)
                          }
                          className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                        >
                          <option value="weekly">Weekly</option>
                          <option value="monthly">Monthly</option>
                          <option value="quarterly">Quarterly</option>
                          <option value="yearly">Yearly</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                          Interval
                        </label>
                        <input
                          data-testid="maintenance-interval-input"
                          type="number"
                          min="1"
                          step="1"
                          value={recurrenceInterval}
                          disabled={locked}
                          onChange={(e) =>
                            setDLocal((s) => ({ ...s, recurrence_interval: e.target.value }))
                          }
                          onBlur={(e) =>
                            handleMaintenanceFieldPatch(
                              "recurrence_interval",
                              Math.max(1, Number(e.target.value || 1) || 1)
                            )
                          }
                          className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                          Start Date
                        </label>
                        <input
                          data-testid="maintenance-start-date-input"
                          type="date"
                          value={recurrenceStartDate}
                          disabled={locked}
                          onChange={(e) =>
                            handleMaintenanceFieldPatch("recurrence_start_date", e.target.value)
                          }
                          className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                          End Date
                        </label>
                        <input
                          type="date"
                          value={recurrenceEndDate}
                          disabled={locked}
                          onChange={(e) =>
                            handleMaintenanceFieldPatch("recurrence_end_date", e.target.value || null)
                          }
                          className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                          Maintenance Status
                        </label>
                        <select
                          value={maintenanceStatus}
                          disabled={locked}
                          onChange={(e) =>
                            handleMaintenanceFieldPatch("maintenance_status", e.target.value)
                          }
                          className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                        >
                          <option value="active">Active</option>
                          <option value="paused">Paused</option>
                          <option value="completed">Completed</option>
                          <option value="cancelled">Cancelled</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                          Summary Label
                        </label>
                        <input
                          type="text"
                          value={recurringSummaryLabel}
                          disabled={locked}
                          onChange={(e) =>
                            setDLocal((s) => ({ ...s, recurring_summary_label: e.target.value }))
                          }
                          onBlur={(e) =>
                            handleMaintenanceFieldPatch("recurring_summary_label", e.target.value)
                          }
                          placeholder="Monthly HVAC Maintenance"
                          className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                        />
                      </div>
                    </div>

                    <div className="mt-3">
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={autoGenerateNextOccurrence}
                          disabled={locked}
                          onChange={(e) =>
                            handleMaintenanceFieldPatch(
                              "auto_generate_next_occurrence",
                              e.target.checked
                            )
                          }
                        />
                        Auto-generate the next service occurrence
                      </label>
                    </div>

                    <div className="mt-3">
                      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Service Window Notes
                      </label>
                      <textarea
                        value={dLocal?.service_window_notes || ""}
                        disabled={locked}
                        onChange={(e) =>
                          setDLocal((s) => ({ ...s, service_window_notes: e.target.value }))
                        }
                        onBlur={(e) =>
                          handleMaintenanceFieldPatch("service_window_notes", e.target.value)
                        }
                        rows={3}
                        placeholder="Example: Second Tuesday of each month, 8am-12pm."
                        className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                      />
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <label className="block text-sm font-medium text-slate-900">Project Type</label>
                      {getAiSuggestedIndicator("project_type") ? (
                        <span
                          data-testid="agreement-project-type-ai-indicator"
                          className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800"
                        >
                          {getAiSuggestedIndicator("project_type")}
                        </span>
                      ) : null}
                    </div>
                    {!locked && handleCreateNewType ? (
                      <button
                        type="button"
                        onClick={handleCreateNewType}
                        className="text-[11px] font-medium text-indigo-700 hover:underline"
                      >
                        Add Type
                      </button>
                    ) : null}
                  </div>
                  <select
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                    name="project_type"
                    value={dLocal.project_type || ""}
                    onChange={locked ? undefined : handleStep1LocalChange}
                    disabled={locked}
                  >
                    <option value="">— Select Type —</option>
                    {augmentedProjectTypeOptions.map((t) => (
                      <option key={String(t.id ?? t.value)} value={String(t.value)}>
                        {String(t.label)}
                      </option>
                    ))}
                  </select>
                  <div className="mt-1 text-[11px] text-slate-500">
                    {selectedProjectType?.owner_type
                      ? `Source: ${
                          selectedProjectType.owner_type === "system"
                            ? "Built-in taxonomy"
                            : "Custom taxonomy"
                        }`
                      : "Choose the main category for this job."}
                  </div>
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <label className="block text-sm font-medium text-slate-900">Subtype</label>
                      {getAiSuggestedIndicator("project_subtype") ? (
                        <span
                          data-testid="agreement-project-subtype-ai-indicator"
                          className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800"
                        >
                          {getAiSuggestedIndicator("project_subtype")}
                        </span>
                      ) : null}
                    </div>
                    {!locked && handleCreateNewSubtype ? (
                      <button
                        type="button"
                        onClick={handleCreateNewSubtype}
                        className="text-[11px] font-medium text-indigo-700 hover:underline"
                      >
                        Add Subtype
                      </button>
                    ) : null}
                  </div>
                  <select
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100 disabled:text-slate-500"
                    name="project_subtype"
                    value={dLocal.project_subtype || ""}
                    onChange={locked ? undefined : handleStep1LocalChange}
                    disabled={locked || !safeTrim(dLocal.project_type)}
                  >
                    <option value="">
                      {safeTrim(dLocal.project_type) ? "— Select Subtype —" : "Select Type first"}
                    </option>
                    {augmentedProjectSubtypeOptions.map((st) => (
                      <option key={String(st.id ?? st.value)} value={String(st.value)}>
                        {String(st.label)}
                      </option>
                    ))}
                  </select>
                  <div className="mt-1 text-[11px] text-slate-500">
                    {selectedProjectSubtype?.owner_type
                      ? `Source: ${
                          selectedProjectSubtype.owner_type === "system"
                            ? "Built-in taxonomy"
                            : "Custom taxonomy"
                        }`
                      : safeTrim(dLocal.project_type)
                      ? "Subtype helps tailor templates, scope guidance, and milestones."
                      : "Choose a type first to unlock subtype options."}
                  </div>
                </div>
              </div>

              <div>
                <div className="mb-1 flex items-center gap-2">
                  <label className="block text-sm font-medium text-slate-900">Project Title</label>
                  {getAiSuggestedIndicator("project_title") ? (
                    <span
                      data-testid="agreement-project-title-ai-indicator"
                      className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800"
                    >
                      {getAiSuggestedIndicator("project_title")}
                    </span>
                  ) : null}
                </div>
                <input
                  data-testid="agreement-project-title-input"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  name="project_title"
                  value={dLocal.project_title}
                  onChange={locked ? undefined : handleStep1LocalChange}
                  placeholder="e.g., Master Bedroom Addition"
                  disabled={locked}
                />
                <div className="mt-1 text-[11px] text-slate-500">
                  Keep it short and recognizable so the customer can identify the job quickly.
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-900">
                  Scope of Work / Description
                </label>
                <div className="mb-2 text-xs leading-5 text-slate-600">
                  Describe what is included so the customer understands the job clearly and milestone planning stays accurate.
                </div>

                <textarea
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  rows={6}
                  name="description"
                  value={dLocal.description || ""}
                  onChange={locked ? undefined : handleStep1LocalChange}
                  placeholder="Example: Remove existing materials, prepare surfaces, install new materials, complete finish work, and clean the job site..."
                  disabled={locked}
                />

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs text-slate-600">
                    {startMode === "ai"
                      ? "Use AI to draft the first version, then refine the scope here."
                      : "AI can turn a rough idea into a clearer, stronger scope when you want help."}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        aiCredits?.loading
                          ? "bg-slate-100 text-slate-700"
                          : "bg-emerald-100 text-emerald-800"
                      }`}
                      title="AI tools are included with your account"
                    >
                      AI Included
                    </span>

                    <button
                      type="button"
                      onClick={refreshAiCredits}
                      className="rounded border border-slate-200 px-2 py-1 text-[11px] hover:bg-slate-50 disabled:opacity-60"
                      disabled={locked}
                    >
                      Refresh
                    </button>
                  </div>
                </div>

                <div className="mt-3 flex w-full flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => runAiDescription("improve")}
                    disabled={locked || aiBusy || !safeTrim(dLocal.description) || Boolean(appliedTemplateId)}
                    className="rounded border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
                    data-testid="agreement-ai-improve-scope-button"
                  >
                    {aiBusy ? "Working…" : "Improve Existing Scope"}
                  </button>

                  <button
                    type="button"
                    onClick={() => runAiDescription("generate")}
                    disabled={locked || aiBusy || !hasSomeContext || Boolean(appliedTemplateId)}
                    className="rounded border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
                    data-testid="agreement-ai-generate-scope-button"
                  >
                    {aiBusy ? "Working…" : "Generate Scope Draft"}
                  </button>
                </div>

                <div className="mt-2 text-[11px] text-slate-500">
                  {appliedTemplateId
                    ? "A template is applied. Use the template-driven scope, milestones, and clarification flow instead of generating a new AI structure here."
                    : "Review and edit the final scope so it accurately reflects the work you are agreeing to perform."}
                </div>

                {aiErr ? <div className="mt-2 text-xs text-red-600">{aiErr}</div> : null}

                {aiPreview ? (
                  <div className="mt-3 rounded-md border bg-indigo-50 p-3">
                    <div className="mb-2 text-xs font-semibold text-indigo-900">
                      AI Suggested Scope Draft
                    </div>

                    <div className="whitespace-pre-wrap text-sm text-indigo-900">{aiPreview}</div>

                    <div className="mt-2 text-[11px] text-indigo-900/80">
                      Review this draft before using it.
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => applyAiDescription("replace")}
                        disabled={locked}
                        className="rounded bg-indigo-600 px-3 py-1.5 text-xs text-white hover:bg-indigo-700 disabled:opacity-60"
                      >
                        Replace Description
                      </button>

                      <button
                        type="button"
                        onClick={() => applyAiDescription("append")}
                        disabled={locked}
                        className="rounded border border-slate-200 px-3 py-1.5 text-xs disabled:opacity-60"
                      >
                        Append to Description
                      </button>

                      <button
                        type="button"
                        onClick={() => setAiPreview("")}
                        className="rounded border border-slate-200 px-3 py-1.5 text-xs"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </StepSection>
            <StepSection
              title="Customer"
              description="Select the customer for this agreement, or add one quickly if you need to keep moving."
              className={supportSectionClass}
              highlighted={hasAiSectionHighlight("homeowner", "customer_contact")}
            >
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <CustomerSection
                  locked={locked}
                  dLocal={dLocal}
                  homeownerOptions={homeownerOptions}
                  empty={empty}
                  peopleLoadedOnce={peopleLoadedOnce}
                  reloadPeople={reloadPeople}
                  onLocalChange={handleStep1LocalChange}
                  customerAddrLoading={customerAddrLoading}
                  customerAddrMissing={customerAddrMissing}
                  selectedCustomer={selectedCustomer}
                  showQuickAdd={showQuickAdd}
                  setShowQuickAdd={setShowQuickAdd}
                  qaName={qaName}
                  setQaName={setQaName}
                  qaEmail={qaEmail}
                  setQaEmail={setQaEmail}
                  qaBusy={qaBusy}
                  onQuickAdd={onQuickAdd}
                />
              </div>
            </StepSection>

            <StepSection
              title="Location"
              description="Confirm where the work is happening so documents, compliance, and scheduling stay aligned."
              className={supportSectionClass}
              highlighted={hasAiSectionHighlight(
                "address_line1",
                "address_line2",
                "address_city",
                "address_state",
                "address_postal_code"
              )}
            >
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <AddressSection
                  locked={locked}
                  addrSearch={addrSearch}
                  setAddrSearch={setAddrSearch}
                  dLocal={dLocal}
                  setDLocal={setDLocal}
                  isNewAgreement={isNewAgreement}
                  cacheKey={cacheKey}
                  writeCache={writeCache}
                  patchAgreement={patchAgreement}
                  persistAddressNow={persistAddressNow}
                  schedulePatch={schedulePatch}
                  onLocalChange={handleStep1LocalChange}
                />
              </div>
            </StepSection>

            <StepSection
              title="Payment Timing"
              description="Choose when payments happen. You can confirm escrow versus direct pay during final review once pricing is complete."
              className={supportSectionClass}
              highlighted={hasAiSectionHighlight("payment_structure", "retainage_percent")}
            >
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="text-sm font-semibold text-slate-900">Payment Structure</div>
                <div className="mt-1 text-sm text-slate-600">
                  Pick the timing model that fits how this project will be billed.
                </div>

                <div className="mt-4 grid gap-3">
                  <button
                    type="button"
                    onClick={() => handlePaymentStructureChange("simple")}
                    disabled={locked}
                    className={`rounded-xl border px-4 py-3 text-left transition ${
                      paymentStructure === "simple"
                        ? "border-indigo-300 bg-indigo-50"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                    } disabled:opacity-60`}
                  >
                    <div className="font-semibold text-slate-900">Simple Payments</div>
                    <div className="mt-1 text-sm text-slate-600">
                      Get paid when milestones are completed.
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handlePaymentStructureChange("progress")}
                    disabled={locked}
                    className={`rounded-xl border px-4 py-3 text-left transition ${
                      paymentStructure === "progress"
                        ? "border-indigo-300 bg-indigo-50"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                    } disabled:opacity-60`}
                  >
                    <div className="font-semibold text-slate-900">Progress Payments</div>
                    <div className="mt-1 text-sm text-slate-600">
                      Use draw requests and retainage once the agreement is signed.
                    </div>
                  </button>
                </div>

                {paymentStructure === "progress" ? (
                  <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Retainage %
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={retainagePercent}
                      disabled={locked}
                      onChange={(e) =>
                        setDLocal((s) => ({ ...s, retainage_percent: e.target.value }))
                      }
                      onBlur={(e) => handleRetainageChange(e.target.value)}
                      className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                    />
                    <div className="mt-2 text-xs text-slate-500">
                      Retainage is applied later when draw requests are created after signing.
                    </div>
                  </div>
                ) : null}
              </div>
            </StepSection>
          </div>


        <div className="flex justify-end gap-2 border-t border-slate-200 pt-5">
          <button
            data-testid="agreement-save-draft-button"
            type="button"
            onClick={() => saveStep1(false)}
            disabled={locked}
            className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            Save Draft
          </button>

          {locked ? (
            <button
              type="button"
              onClick={goNextNoSave}
              className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              onClick={() => saveStep1(true)}
              className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Save &amp; Next
            </button>
          )}
        </div>
      </div>

      <SaveTemplateModal
        open={showSaveTemplateModal}
        onClose={() => setShowSaveTemplateModal(false)}
        onSubmit={onSubmitSaveAsTemplate}
        busy={savingTemplate}
        defaultName={defaultTemplateName}
        defaultDescription={safeTrim(dLocal?.description)}
        projectType={safeTrim(dLocal?.project_type)}
        projectSubtype={safeTrim(dLocal?.project_subtype)}
        milestoneCount={agreement?.milestone_count ?? agreement?.milestones?.length ?? null}
      />
    </>
  );
}
