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
import PaymentModeSection from "./step1/PaymentModeSection.jsx";
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

function StepSection({
  title,
  description = "",
  children,
  className = "",
  highlighted = false,
  highlightLabel = "AI updated",
}) {
  return (
    <section
      className={`rounded-2xl border bg-white p-5 shadow-sm transition-all ${
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
  if (
    agreement?.selected_template?.id ||
    agreement?.selected_template_id ||
    assistantTopTemplatePreview?.id ||
    (Array.isArray(assistantTemplateRecommendations) && assistantTemplateRecommendations.length)
  ) {
    return "template";
  }
  if (assistantGuidedFlow?.guided_question) return "ai";
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

  const hasAiSectionHighlight = (...keys) =>
    keys.some((key) => Boolean(aiHighlightKeys?.[key]));

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

  function activateStartMode(mode, { committed = true } = {}) {
    setStartMode(mode);
    setStartModeCommitted(committed);
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
  const shouldOpenTemplateDetails = startMode === "template" || hasTemplateApplied;

  useEffect(() => {
    if (hasTemplateApplied && startMode !== "template") {
      activateStartMode("template");
    }
  }, [hasTemplateApplied, startMode]);

  useEffect(() => {
    if (isAiAssistantActive && startMode !== "ai") {
      activateStartMode("ai");
    }
  }, [isAiAssistantActive, startMode]);

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

  const paymentMode = normalizePaymentMode(dLocal?.payment_mode);
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

  async function handlePaymentModeChange(mode) {
    if (locked) return;

    const normalized = normalizePaymentMode(mode);

    setDLocal((s) => ({ ...s, payment_mode: normalized }));
    if (!isNewAgreement) {
      writeCache({ payment_mode: normalized });
    }

    await patchAgreement({ payment_mode: normalized }, { silent: true });
  }

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

  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);

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

  async function handleDeselectAppliedTemplate() {
    if (locked) return;
    if (!agreementId) return;

    const templateName =
      safeTrim(agreement?.selected_template?.name) ||
      safeTrim(agreement?.selected_template_name_snapshot) ||
      safeTrim(dLocal?.selected_template?.name) ||
      safeTrim(dLocal?.selected_template_name_snapshot) ||
      "this template";

    toast.error(
      `Cannot deselect ${templateName} here because its scope, milestones, or clarifications may already be applied. Leaving the template attached prevents the agreement from silently remaining template-shaped with no template metadata.`
    );
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
  const shouldDeemphasizeManualReview = startModeCommitted && startMode !== "manual";
  const reviewGuidanceText =
    startMode === "ai"
      ? "AI will help prefill these details. Review and edit them below after the first suggestion."
      : startMode === "template"
      ? "Your template choice can prefill these details. Review and adjust them below as needed."
      : "";
  const supportSectionClass = shouldDeemphasizeManualReview
    ? "border-slate-200 bg-slate-50/40 shadow-none"
    : "";

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

        {assistantTemplateRecommendations.length ? (
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
                <button
                  type="button"
                  data-testid="step1-change-start-mode"
                  onClick={() => setStartModeCommitted(false)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Change start mode
                </button>
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

        <section
          className={`rounded-2xl border shadow-sm ${
            startMode === "template"
              ? "border-indigo-200 bg-indigo-50/40"
              : shouldDeemphasizeManualReview
              ? "border-slate-200 bg-slate-50/50"
              : "border-slate-200 bg-white"
          }`}
        >
          <div className="flex items-center justify-between gap-3 px-5 py-4">
            <div>
              <div className="text-base font-semibold text-slate-900">Templates</div>
              <div className="mt-1 text-sm text-slate-600">
                Reuse a saved agreement structure if this project follows a familiar pattern.
              </div>
            </div>
            <span
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${
                startMode === "template"
                  ? "border border-indigo-200 bg-white text-indigo-700"
                  : "bg-slate-100 text-slate-600"
              }`}
            >
              {startMode === "template" ? "Template mode" : "Available"}
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
              appliedTemplateId={appliedTemplateId}
              onDeselectAppliedTemplate={handleDeselectAppliedTemplate}
              onTemplateApplied={handleTemplateApplied}
            />
          </div>
        </section>

        {reviewGuidanceText ? (
          <div
            data-testid="step1-review-guidance"
            className={`rounded-xl border px-4 py-3 text-sm ${
              startMode === "ai"
                ? "border-indigo-200 bg-indigo-50/70 text-indigo-900"
                : "border-sky-200 bg-sky-50/70 text-sky-900"
            }`}
          >
            <div className="font-semibold">
              {startMode === "ai" ? "AI setup comes first" : "Template setup comes first"}
            </div>
            <div className="mt-1 text-xs opacity-90">{reviewGuidanceText}</div>
          </div>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.95fr)] xl:items-start">
          <div className="space-y-6">
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
              title="Project Address"
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
          </div>

          <div className="space-y-6">
            <StepSection
              title="Project Basics"
              description="Choose how this agreement should behave before you move into milestone planning."
              className={supportSectionClass}
              highlighted={hasAiSectionHighlight(
                "project_title",
                "project_type",
                "project_subtype",
                "description",
                "agreement_mode",
                "recurrence_pattern",
                "recurrence_interval"
              )}
            >
              <div
                data-testid="maintenance-settings-card"
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
              <div className="text-sm font-semibold text-slate-900">Agreement Mode</div>
              <div className="mt-1 text-sm text-slate-600">
                Use maintenance mode for recurring service agreements that generate repeat visits over time.
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
                    <div className="font-semibold text-slate-900">
                      {recurringSummaryText}
                    </div>
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
                      placeholder="Example: Second Tuesday of each month, 8am–12pm."
                      className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                    />
                  </div>
                </div>
              ) : null}
              </div>
            </StepSection>

            <StepSection
              title="Payment Setup"
              description="Set the payment structure now so milestone planning and final review stay aligned."
              className={supportSectionClass}
              highlighted={hasAiSectionHighlight("payment_mode", "payment_structure", "retainage_percent")}
            >
              <div className="space-y-4">
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="text-sm font-semibold text-slate-900">Payment Structure</div>
                  <div className="mt-1 text-sm text-slate-600">
                    How will you get paid for this project?
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
                        Get paid when milestones are completed
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
                        Get paid based on progress, with approvals and retainage
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
                        This retainage is used when draw requests are created after signing.
                      </div>
                    </div>
                  ) : null}
                </div>

                <PaymentModeSection
                  locked={locked}
                  paymentMode={paymentMode}
                  onChangeMode={handlePaymentModeChange}
                />
              </div>
            </StepSection>
          </div>
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
