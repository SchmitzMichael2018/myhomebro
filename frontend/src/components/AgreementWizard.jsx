// frontend/src/components/AgreementWizard.jsx
// v2026-03-18-draft-friendly-template-flow-final
//
// Updates:
// - draft creation is forgiving for Step 1
// - sends temporary fallback title/description only for first draft creation
// - preserves user-entered values after draft exists
// - supports template-first flow without blocking on description
// - updates onTemplateApplied callback to hydrate Step 1 from returned agreement
// - refreshes agreement + milestones after template apply
// - keeps existing wizard structure intact

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../api";

import Step1Details from "./Step1Details.jsx";
import Step2Milestones from "./Step2Milestones.jsx";
import Step3WarrantyAttachments from "./Step3WarrantyAttachments.jsx";
import Step4Finalize from "./Step4Finalize.jsx";
import { useAssistantDock } from "./AssistantDock.jsx";
import { WorkflowHint } from "./WorkflowHint.jsx";
import {
  buildAssistantHandoffSignature,
  getAssistantHandoff,
  isBlankAssistantValue,
  mergeAssistantFields,
} from "../lib/assistantHandoff.js";
import { getAiPanelConfigForStep } from "../lib/agreementWizardAiPanel.js";
import { trackOnboardingEvent } from "../lib/onboardingAnalytics.js";
import { getAgreementWizardHint } from "../lib/workflowHints.js";
import useAiFieldHighlights from "../hooks/useAiFieldHighlights.js";
import ContractorPageSurface from "./dashboard/ContractorPageSurface.jsx";

/* ---------------- helpers ---------------- */

const STEP_MIN = 1;
const STEP_MAX = 4;

function clampStep(v) {
  const n = Number(v || 1);
  if (!Number.isFinite(n)) return 1;
  return Math.min(STEP_MAX, Math.max(STEP_MIN, Math.floor(n)));
}

function safeStr(v) {
  return v == null ? "" : String(v).trim();
}

function money(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return 0;
  return n;
}

function sum(arr, key = "amount") {
  const list = Array.isArray(arr) ? arr : [];
  return list.reduce((a, x) => a + money(x?.[key]), 0);
}

function toDateOnly(v) {
  if (!v) return "";
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function normalizeOptionRows(data) {
  const rows = Array.isArray(data)
    ? data
    : Array.isArray(data?.results)
    ? data.results
    : Array.isArray(data?.options)
    ? data.options
    : Array.isArray(data?.items)
    ? data.items
    : Array.isArray(data?.rows)
    ? data.rows
    : Array.isArray(data?.project_types)
    ? data.project_types
    : Array.isArray(data?.project_subtypes)
    ? data.project_subtypes
    : [];

  return rows
    .map((row) => ({
      id: row?.id ?? row?.pk ?? null,
      value: safeStr(row?.value ?? row?.name ?? row?.label ?? row?.slug ?? row?.code),
      label: safeStr(row?.label ?? row?.name ?? row?.value ?? row?.title ?? row?.slug ?? row?.code),
      name: safeStr(row?.name ?? row?.label ?? row?.value ?? row?.title ?? row?.slug ?? row?.code),
      project_type:
        row?.project_type ??
        row?.project_type_name ??
        row?.project_type_label ??
        row?.project_type_value ??
        null,
      is_system: !!row?.is_system,
      is_active: row?.is_active !== false,
      owner_type: row?.owner_type || (row?.is_system ? "system" : "contractor"),
    }))
    .filter((row) => row.value && row.label);
}

function deriveAgreementId(payload, routeParamId) {
  const fromPayload =
    payload?.id ?? payload?.agreement_id ?? payload?.pk ?? payload?.agreementId ?? null;

  const n1 = Number(fromPayload);
  if (Number.isFinite(n1) && n1 > 0) return n1;

  const n2 = Number(routeParamId);
  if (Number.isFinite(n2) && n2 > 0) return n2;

  return null;
}

function normalizeAgreement(next, prev, routeParamId) {
  const nextObj = next && typeof next === "object" ? next : null;
  const prevObj = prev && typeof prev === "object" ? prev : null;

  const id =
    deriveAgreementId(nextObj, routeParamId) ??
    deriveAgreementId(prevObj, routeParamId) ??
    null;

  const merged = {
    ...(prevObj || {}),
    ...(nextObj || {}),
  };

  if (id) merged.id = id;
  if (merged.agreement_id == null && id) merged.agreement_id = id;

  if (nextObj && !Object.prototype.hasOwnProperty.call(nextObj, "payment_mode")) {
    if (prevObj && Object.prototype.hasOwnProperty.call(prevObj, "payment_mode")) {
      merged.payment_mode = prevObj.payment_mode;
    }
  }

  const sigKeys = [
    "require_contractor_signature",
    "require_customer_signature",
    "waive_contractor_signature",
    "waive_customer_signature",
  ];
  for (const k of sigKeys) {
    if (nextObj && !Object.prototype.hasOwnProperty.call(nextObj, k)) {
      if (prevObj && Object.prototype.hasOwnProperty.call(prevObj, k)) {
        merged[k] = prevObj[k];
      }
    }
  }

  const signedKeys = [
    "contractor_signed",
    "contractor_signed_at",
    "homeowner_signed",
    "homeowner_signed_at",
    "customer_signed",
    "customer_signed_at",
    "signed_by_contractor",
    "signed_by_homeowner",
  ];
  for (const k of signedKeys) {
    if (nextObj && !Object.prototype.hasOwnProperty.call(nextObj, k)) {
      if (prevObj && Object.prototype.hasOwnProperty.call(prevObj, k)) {
        merged[k] = prevObj[k];
      }
    }
  }

  return merged;
}

/* ---------------- defaults ---------------- */

const DEFAULT_WARRANTY = `MyHomeBro — 12-Month Workmanship Warranty

Contractor warrants that workmanship performed under this Agreement will be free from defects in labor for a period of twelve (12) months from the date of completion, excluding:
- Normal wear and tear
- Damage from misuse, neglect, or unauthorized modification
- Manufacturer defects in materials or products provided by others
- Acts of God, flooding, fire, or other events beyond Contractor control

Contractor’s obligation under this warranty is limited to repair or replacement of defective workmanship, at Contractor’s discretion, and does not include incidental or consequential damages.`;

const EMPTY_DLOCAL = {
  homeowner: "",
  project_title: "",
  project_type: "",
  project_subtype: "",
  agreement_mode: "standard",
  recurring_service_enabled: false,
  recurrence_pattern: "monthly",
  recurrence_interval: "1",
  recurrence_start_date: "",
  recurrence_end_date: "",
  maintenance_status: "active",
  auto_generate_next_occurrence: true,
  service_window_notes: "",
  recurring_summary_label: "",
  next_occurrence_date: "",
  payment_mode: "escrow",
  payment_structure: "simple",
  retainage_percent: "0.00",
  description: "",
  address_line1: "",
  address_line2: "",
  address_city: "",
  address_state: "",
  address_postal_code: "",
};

const EMPTY_MLOCAL = {
  id: null,
  title: "",
  description: "",
  start: "",
  end: "",
  amount: "",
};

/* ---------------- component ---------------- */

export default function AgreementWizard() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  const agreementIdParamRaw = params?.id;
  const agreementIdParam = agreementIdParamRaw ? Number(agreementIdParamRaw) : null;
  const { isOpen: isAssistantDockOpen, openAssistant } = useAssistantDock();

  const step = clampStep(searchParams.get("step") || 1);
  const assistantHandoff = useMemo(() => getAssistantHandoff(location.state), [location.state]);
  const assistantHandoffSignature = useMemo(
    () => buildAssistantHandoffSignature(assistantHandoff),
    [assistantHandoff]
  );
  const activationJourney = Boolean(location.state?.activationJourney);

  const [agreement, setAgreementState] = useState(null);
  const [loadingAgreement, setLoadingAgreement] = useState(false);

  const [dLocal, setDLocal] = useState(EMPTY_DLOCAL);

  const [milestones, setMilestones] = useState([]);
  const [mLocal, setMLocal] = useState(EMPTY_MLOCAL);
  const [editMilestone, setEditMilestone] = useState(null);

  const [projectTypes, setProjectTypes] = useState([]);
  const [projectSubtypes, setProjectSubtypes] = useState([]);
  const [taxonomyLoading, setTaxonomyLoading] = useState(false);

  const [useDefaultWarranty, setUseDefaultWarranty] = useState(true);
  const [customWarranty, setCustomWarranty] = useState("");
  const [attachments, setAttachments] = useState([]);

  const [ackReviewed, setAckReviewed] = useState(false);
  const [ackTos, setAckTos] = useState(false);
  const [ackEsign, setAckEsign] = useState(false);
  const [typedName, setTypedName] = useState("");

  const [last400, setLast400] = useState(null);

  const [people, setPeople] = useState([]);
  const [peopleLoadedOnce, setPeopleLoadedOnce] = useState(false);

  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [qaName, setQaName] = useState("");
  const [qaEmail, setQaEmail] = useState("");
  const [qaBusy, setQaBusy] = useState(false);
  const [assistantAppliedSummary, setAssistantAppliedSummary] = useState("");
  const [step1AiEntryOpen, setStep1AiEntryOpen] = useState(false);
  const [step1AiSetupRequest, setStep1AiSetupRequest] = useState(null);
  const [wizardSessionState, setWizardSessionState] = useState({
    hasPreviewedPdf: false,
  });
  const [aiFeedbackByStep, setAiFeedbackByStep] = useState({});
  const { highlights: step1AiHighlights, markUpdated: markStep1AiUpdated } = useAiFieldHighlights({
    durationMs: 5000,
  });

  const didInitialFetchRef = useRef(false);
  const appliedAssistantSignatureRef = useRef("");

  const agreementId = useMemo(
    () => deriveAgreementId(agreement, agreementIdParam),
    [agreement, agreementIdParam]
  );

  const totals = useMemo(() => {
    const agreementTotal =
      agreement?.display_total ??
      agreement?.total ??
      agreement?.amount ??
      agreement?.total_cost;

    const normalizedAgreementTotal = Number(agreementTotal);
    return {
      totalAmt: Number.isFinite(normalizedAgreementTotal)
        ? normalizedAgreementTotal
        : sum(milestones, "amount"),
    };
  }, [agreement, milestones]);
  const wizardSummary = useMemo(() => {
    const selectedCustomer = (people || []).find(
      (person) => String(person?.id || "") === String(dLocal.homeowner || "")
    );
    const customerLabel = selectedCustomer
      ? safeStr(selectedCustomer.company_name) && safeStr(selectedCustomer.full_name || selectedCustomer.name)
        ? `${safeStr(selectedCustomer.company_name)} (${safeStr(selectedCustomer.full_name || selectedCustomer.name)})`
        : safeStr(selectedCustomer.company_name) ||
          safeStr(selectedCustomer.full_name || selectedCustomer.name) ||
          safeStr(selectedCustomer.email)
      : "";
    const paymentModeLabel =
      dLocal.payment_structure === "progress"
        ? "Progress payments"
        : step >= 4
        ? dLocal.payment_mode === "direct"
          ? "Direct pay"
          : dLocal.payment_mode === "escrow"
          ? "Escrow"
          : ""
        : "";

    return {
      projectTitle: dLocal.project_title || agreement?.project_title || agreement?.title || "",
      customerLabel,
      milestoneCount: milestones.length,
      totalLabel:
        Number.isFinite(Number(totals.totalAmt)) && Number(totals.totalAmt) > 0
          ? Number(totals.totalAmt).toLocaleString(undefined, {
              style: "currency",
              currency: "USD",
            })
          : "",
      paymentModeLabel,
    };
  }, [agreement, dLocal.homeowner, dLocal.payment_mode, dLocal.payment_structure, dLocal.project_title, milestones.length, people, step, totals.totalAmt]);

  const setAgreement = useCallback(
    (nextPayload) => {
      setAgreementState((prev) => normalizeAgreement(nextPayload, prev, agreementIdParam));
    },
    [agreementIdParam]
  );

  const lastStepFetchRef = useRef({ step: null, at: 0 });

  const resetWizardForNewAgreement = useCallback(() => {
    setAgreementState(null);
    setLoadingAgreement(false);

    setDLocal({ ...EMPTY_DLOCAL });
    setMilestones([]);
    setMLocal({ ...EMPTY_MLOCAL });
    setEditMilestone(null);

    setProjectTypes([]);
    setProjectSubtypes([]);
    setTaxonomyLoading(false);

    setUseDefaultWarranty(true);
    setCustomWarranty("");
    setAttachments([]);

    setAckReviewed(false);
    setAckTos(false);
    setAckEsign(false);
    setTypedName("");

    setLast400(null);

    setShowQuickAdd(false);
    setQaName("");
    setQaEmail("");
    setQaBusy(false);
    setWizardSessionState({ hasPreviewedPdf: false });
    setAiFeedbackByStep({});

    didInitialFetchRef.current = false;
    lastStepFetchRef.current = { step: null, at: 0 };
  }, []);

  const goStep = (n) => {
    const next = clampStep(n);
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set("step", String(next));
      return p;
    });
  };

  const stepTabs = useMemo(
    () => [
      { n: 1, label: "Step 1 Details" },
      { n: 2, label: "Step 2 Milestones" },
      { n: 3, label: "Step 3 Warranty" },
      { n: 4, label: "Step 4 Finalize" },
    ],
    []
  );

  const loadProjectTypes = useCallback(async () => {
    try {
      const { data } = await api.get("/projects/project-types/", {
        params: { mode: "options", _ts: Date.now() },
        headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
      });

      const normalized = normalizeOptionRows(data);
      setProjectTypes(normalized);
    } catch (err) {
      console.warn("loadProjectTypes failed:", err);
      console.log("project-types error response:", err?.response?.data);
      toast.error("Could not load project types.");
      setProjectTypes([]);
    }
  }, []);

  const loadProjectSubtypes = useCallback(async (projectTypeName = "") => {
    try {
      const params = { mode: "options", _ts: Date.now() };
      if (safeStr(projectTypeName)) params.project_type = safeStr(projectTypeName);

      const { data } = await api.get("/projects/project-subtypes/", {
        params,
        headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
      });

      const normalized = normalizeOptionRows(data);
      setProjectSubtypes(normalized);
    } catch (err) {
      console.warn("loadProjectSubtypes failed:", err);
      console.log("project-subtypes error response:", err?.response?.data);
      toast.error("Could not load project subtypes.");
      setProjectSubtypes([]);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadTaxonomy() {
      try {
        setTaxonomyLoading(true);
        await loadProjectTypes();
        await loadProjectSubtypes(dLocal?.project_type || "");
      } finally {
        if (mounted) setTaxonomyLoading(false);
      }
    }

    loadTaxonomy();
    return () => {
      mounted = false;
    };
  }, [loadProjectTypes, loadProjectSubtypes, dLocal?.project_type]);

  useEffect(() => {
    loadProjectSubtypes(dLocal?.project_type || "");
  }, [dLocal?.project_type, loadProjectSubtypes]);

  const projectTypeOptions = useMemo(() => {
    return (projectTypes || []).map((row) => ({
      id: row.id,
      value: row.value,
      label: row.label,
      owner_type: row.owner_type,
      is_system: row.is_system,
    }));
  }, [projectTypes]);

  const projectSubtypeOptions = useMemo(() => {
    return (projectSubtypes || []).map((row) => ({
      id: row.id,
      value: row.value,
      label: row.label,
      owner_type: row.owner_type,
      is_system: row.is_system,
      project_type: row.project_type,
    }));
  }, [projectSubtypes]);

  const fetchAgreement = useCallback(
    async (id) => {
      if (!id) return;
      setLoadingAgreement(true);
      setLast400(null);

      try {
        const { data } = await api.get(`/projects/agreements/${id}/`, {
          params: { _ts: Date.now() },
          headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
        });

        setAgreement(data);

        setDLocal((prev) => ({
          ...prev,
          homeowner: data?.homeowner != null ? String(data.homeowner) : prev.homeowner,
          project_title: data?.project_title || data?.title || data?.project?.title || prev.project_title,
          project_type: data?.project_type || prev.project_type,
          project_subtype: data?.project_subtype ?? prev.project_subtype,
          agreement_mode: data?.agreement_mode || prev.agreement_mode || "standard",
          recurring_service_enabled:
            data?.recurring_service_enabled ?? prev.recurring_service_enabled ?? false,
          recurrence_pattern: data?.recurrence_pattern || prev.recurrence_pattern || "monthly",
          recurrence_interval:
            data?.recurrence_interval != null
              ? String(data.recurrence_interval)
              : prev.recurrence_interval || "1",
          recurrence_start_date: data?.recurrence_start_date || prev.recurrence_start_date || "",
          recurrence_end_date: data?.recurrence_end_date || prev.recurrence_end_date || "",
          maintenance_status: data?.maintenance_status || prev.maintenance_status || "active",
          auto_generate_next_occurrence:
            data?.auto_generate_next_occurrence ?? prev.auto_generate_next_occurrence ?? true,
          service_window_notes: data?.service_window_notes ?? prev.service_window_notes ?? "",
          recurring_summary_label:
            data?.recurring_summary_label ?? prev.recurring_summary_label ?? "",
          next_occurrence_date: data?.next_occurrence_date || prev.next_occurrence_date || "",
          payment_mode: data?.payment_mode || prev.payment_mode,
          payment_structure: data?.payment_structure || prev.payment_structure || "simple",
          retainage_percent:
            data?.retainage_percent != null
              ? String(data.retainage_percent)
              : prev.retainage_percent || "0.00",
          description: data?.description || prev.description,

          address_line1:
            data?.address_line1 ||
            data?.project_address_line1 ||
            prev.address_line1,

          address_line2:
            data?.address_line2 ||
            data?.project_address_line2 ||
            prev.address_line2,

          address_city:
            data?.address_city ||
            data?.city ||
            data?.project_address_city ||
            prev.address_city,

          address_state:
            data?.address_state ||
            data?.state ||
            data?.project_address_state ||
            prev.address_state,

          address_postal_code:
            data?.address_postal_code ||
            data?.postal_code ||
            data?.project_postal_code ||
            prev.address_postal_code,
        }));

        setAckReviewed(!!data?.contractor_ack_reviewed);
        setAckTos(!!data?.contractor_ack_tos);
        setAckEsign(!!data?.contractor_ack_esign);

        const warrantyType = String(data?.warranty_type || "").toLowerCase();
        const snap = data?.warranty_text_snapshot;
        if (warrantyType === "custom") {
          setUseDefaultWarranty(false);
          setCustomWarranty(typeof snap === "string" ? snap : "");
        } else {
          setUseDefaultWarranty(true);
          setCustomWarranty(typeof snap === "string" && snap.trim() ? snap : "");
        }
      } catch (err) {
        toast.error(err?.response?.data?.detail || "Unable to load agreement.");
      } finally {
        setLoadingAgreement(false);
      }
    },
    [setAgreement]
  );

  useEffect(() => {
    if (agreementIdParam) return;
    resetWizardForNewAgreement();
  }, [agreementIdParam, resetWizardForNewAgreement]);

  useEffect(() => {
    if (!agreementIdParam) return;
    if (didInitialFetchRef.current) return;
    didInitialFetchRef.current = true;
    fetchAgreement(agreementIdParam);
  }, [agreementIdParam, fetchAgreement]);

  useEffect(() => {
    if (!agreementId) return;
    if (![2, 3, 4].includes(step)) return;

    const now = Date.now();
    const last = lastStepFetchRef.current;
    const shouldFetch = last.step !== step || now - (last.at || 0) > 2000;
    if (!shouldFetch) return;

    lastStepFetchRef.current = { step, at: now };
    fetchAgreement(agreementId);
  }, [step, agreementId, fetchAgreement]);

  const refreshAgreement = useCallback(async () => {
    if (!agreementId) return;
    await fetchAgreement(agreementId);
  }, [agreementId, fetchAgreement]);

  const reloadPeople = async () => {
    try {
      const candidates = ["/projects/homeowners/", "/projects/homeowners"];
      let data = null;

      for (const url of candidates) {
        try {
          const res = await api.get(url, {
            params: { _ts: Date.now(), page_size: 250 },
            headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
          });
          data = res?.data;
          break;
        } catch (err) {
          if (err?.response?.status === 404) continue;
          throw err;
        }
      }

      const list = Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : [];
      setPeople(list);
      setPeopleLoadedOnce(true);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Unable to load customers.");
    }
  };

  useEffect(() => {
    reloadPeople();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!assistantHandoffSignature || assistantHandoffSignature === appliedAssistantSignatureRef.current) {
      return;
    }

    const prefill = assistantHandoff.prefillFields || {};
    const draftPayload = assistantHandoff.draftPayload || {};

    const mappedDraft = {
      homeowner:
        draftPayload.homeowner != null
          ? String(draftPayload.homeowner)
          : prefill.homeowner_id != null
          ? String(prefill.homeowner_id)
          : "",
      project_title:
        draftPayload.project_title || draftPayload.title || prefill.project_title || "",
      project_type: draftPayload.project_type || prefill.project_type || "",
      project_subtype: draftPayload.project_subtype || prefill.project_subtype || "",
      agreement_mode: draftPayload.agreement_mode || prefill.agreement_mode || "",
      recurring_service_enabled:
        draftPayload.recurring_service_enabled ?? prefill.recurring_service_enabled ?? "",
      recurrence_pattern: draftPayload.recurrence_pattern || prefill.recurrence_pattern || "",
      recurrence_interval:
        draftPayload.recurrence_interval != null
          ? String(draftPayload.recurrence_interval)
          : prefill.recurrence_interval != null
          ? String(prefill.recurrence_interval)
          : "",
      recurrence_start_date:
        draftPayload.recurrence_start_date || prefill.recurrence_start_date || "",
      recurrence_end_date:
        draftPayload.recurrence_end_date || prefill.recurrence_end_date || "",
      maintenance_status: draftPayload.maintenance_status || prefill.maintenance_status || "",
      auto_generate_next_occurrence:
        draftPayload.auto_generate_next_occurrence ?? prefill.auto_generate_next_occurrence ?? "",
      service_window_notes:
        draftPayload.service_window_notes || prefill.service_window_notes || "",
      recurring_summary_label:
        draftPayload.recurring_summary_label || prefill.recurring_summary_label || "",
      payment_mode: draftPayload.payment_mode || prefill.payment_mode || "",
      description:
        draftPayload.description || draftPayload.project_summary || prefill.project_summary || "",
      address_line1: draftPayload.address_line1 || prefill.address_line1 || "",
      address_line2: draftPayload.address_line2 || prefill.address_line2 || "",
      address_city: draftPayload.city || draftPayload.address_city || prefill.city || "",
      address_state: draftPayload.state || draftPayload.address_state || prefill.state || "",
      address_postal_code:
        draftPayload.postal_code ||
        draftPayload.address_postal_code ||
        prefill.postal_code ||
        "",
    };

    let appliedDraftKeys = [];
    setDLocal((prev) => {
      const { next, appliedKeys } = mergeAssistantFields(prev, mappedDraft);
      appliedDraftKeys = appliedKeys;
      return next;
    });

    const nextQaName =
      prefill.customer_name || prefill.full_name || draftPayload.homeowner_name || "";
    const nextQaEmail = prefill.email || draftPayload.email || "";

    if (isBlankAssistantValue(dLocal?.homeowner) && !isBlankAssistantValue(nextQaName)) {
      setQaName((prev) => {
        if (!isBlankAssistantValue(prev)) return prev;
        return nextQaName;
      });
      setShowQuickAdd(true);
    }
    if (!isBlankAssistantValue(nextQaEmail)) {
      setQaEmail((prev) => {
        if (!isBlankAssistantValue(prev)) return prev;
        return nextQaEmail;
      });
    }

    if (assistantHandoff.wizardStepTarget) {
      goStep(assistantHandoff.wizardStepTarget);
    }

    const appliedLabels = [];
    const hasCustomerPrefill =
      !isBlankAssistantValue(nextQaName) || !isBlankAssistantValue(nextQaEmail);
    if (appliedDraftKeys.length) appliedLabels.push("agreement fields");
    if (hasCustomerPrefill) appliedLabels.push("customer details");
    setAssistantAppliedSummary(
      appliedLabels.length
        ? `AI prefilled some ${appliedLabels.join(" and ")} based on your request.`
        : ""
    );
    setAiFeedbackByStep((prev) => ({
      ...prev,
      1: appliedLabels.length
        ? `Updated ${appliedLabels.join(" and ")} from your AI request.`
        : prev[1] || "",
    }));
    markStep1AiUpdated([
      ...appliedDraftKeys,
      ...(hasCustomerPrefill ? ["homeowner", "customer_contact"] : []),
    ]);

    if (assistantHandoff.templateRecommendations?.length) {
      trackOnboardingEvent({
        eventType: "template_selected",
        step: "first_job",
        context: {
          recommendation_count: assistantHandoff.templateRecommendations.length,
          top_template_id: assistantHandoff.templateRecommendations[0]?.id || null,
        },
        once: true,
      });
    }

    if (assistantHandoff.estimatePreview && Object.keys(assistantHandoff.estimatePreview).length) {
      trackOnboardingEvent({
        eventType: "estimate_preview_viewed",
        step: "first_job",
        context: {
          confidence: assistantHandoff.estimatePreview.confidence_level || "",
        },
        once: true,
      });
    }

    appliedAssistantSignatureRef.current = assistantHandoffSignature;
  }, [
    assistantHandoff,
    assistantHandoffSignature,
    dLocal?.homeowner,
    goStep,
    markStep1AiUpdated,
  ]);

  const homeownerOptions = useMemo(() => {
    return (people || []).map((h) => {
      const company = safeStr(h.company_name);
      const contact = safeStr(h.full_name || h.name);
      const label =
        company && contact
          ? `${company} (${contact})`
          : company || contact || h.email || `Customer #${h.id}`;
      return { value: String(h.id), label };
    });
  }, [people]);

  const onLocalChange = (e) => {
    const name = e?.target?.name;
    const value = e?.target?.value;
    if (!name) return;

    setDLocal((prev) => {
      const next = { ...prev, [name]: value };

      if (name === "project_type" && safeStr(prev.project_type) !== safeStr(value)) {
        next.project_subtype = "";
      }

      return next;
    });
  };

  const onQuickAdd = async () => {
    const name = safeStr(qaName);
    const email = safeStr(qaEmail);

    if (!name && !email) {
      toast.error("Enter a name or email.");
      return;
    }

    setQaBusy(true);
    try {
      const payload = { full_name: name || "", email: email || "" };
      const { data } = await api.post(`/projects/homeowners/`, payload);
      toast.success("Customer added.");
      await reloadPeople();

      if (data?.id) {
        setDLocal((prev) => ({ ...prev, homeowner: String(data.id) }));
      }

      setQaName("");
      setQaEmail("");
      setShowQuickAdd(false);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Unable to add customer.");
    } finally {
      setQaBusy(false);
    }
  };

  function buildStep1Payload({ forDraftCreate = false } = {}) {
    const selectedType =
      projectTypes.find((row) => safeStr(row.value) === safeStr(dLocal.project_type)) || null;

    const selectedSubtype =
      projectSubtypes.find((row) => safeStr(row.value) === safeStr(dLocal.project_subtype)) || null;

    const rawTitle = dLocal.project_title || "";
    const rawDescription = dLocal.description || "";

    const fallbackTitle = "Draft Agreement";
    const fallbackDescription =
      "Draft agreement. Details will be completed after template selection or manual entry.";

    return {
      homeowner: dLocal.homeowner ? Number(dLocal.homeowner) : null,
      title: forDraftCreate ? rawTitle || fallbackTitle : rawTitle,
      project_title: forDraftCreate ? rawTitle || fallbackTitle : rawTitle,
      project_type: dLocal.project_type || "",
      project_subtype: dLocal.project_subtype || "",
      project_type_ref: selectedType?.id || null,
      project_subtype_ref: selectedSubtype?.id || null,
      agreement_mode: dLocal.agreement_mode || "standard",
      recurring_service_enabled:
        dLocal.agreement_mode === "maintenance"
          ? true
          : !!dLocal.recurring_service_enabled,
      recurrence_pattern:
        dLocal.agreement_mode === "maintenance" ? dLocal.recurrence_pattern || "monthly" : "",
      recurrence_interval:
        dLocal.agreement_mode === "maintenance"
          ? Number(dLocal.recurrence_interval || 1) || 1
          : 1,
      recurrence_start_date:
        dLocal.agreement_mode === "maintenance" ? dLocal.recurrence_start_date || null : null,
      recurrence_end_date:
        dLocal.agreement_mode === "maintenance" ? dLocal.recurrence_end_date || null : null,
      maintenance_status:
        dLocal.agreement_mode === "maintenance" ? dLocal.maintenance_status || "active" : "active",
      auto_generate_next_occurrence:
        dLocal.agreement_mode === "maintenance" ? dLocal.auto_generate_next_occurrence !== false : false,
      service_window_notes:
        dLocal.agreement_mode === "maintenance" ? dLocal.service_window_notes || "" : "",
      recurring_summary_label:
        dLocal.agreement_mode === "maintenance" ? dLocal.recurring_summary_label || "" : "",
      payment_mode: dLocal.payment_mode || "escrow",
      payment_structure: dLocal.payment_structure || "simple",
      retainage_percent:
        String(dLocal.payment_structure || "simple").toLowerCase() === "progress"
          ? dLocal.retainage_percent || "0.00"
          : "0.00",
      description: forDraftCreate ? rawDescription || fallbackDescription : rawDescription,

      address_line1: dLocal.address_line1 || "",
      address_line2: dLocal.address_line2 || "",

      city: dLocal.address_city || "",
      state: dLocal.address_state || "",
      postal_code: dLocal.address_postal_code || "",

      address_city: dLocal.address_city || "",
      address_state: dLocal.address_state || "",
      address_postal_code: dLocal.address_postal_code || "",
    };
  }

  const ensureAgreementExists = async () => {
    const existingId = deriveAgreementId(agreement, agreementIdParam);
    if (existingId) return existingId;

    try {
      const payload = buildStep1Payload({ forDraftCreate: true });
      payload.is_draft = true;
      payload.wizard_step = 1;

      const { data } = await api.post(`/projects/agreements/`, payload);
      setAgreement(data);

      const newId = deriveAgreementId(data, agreementIdParam);
      if (!newId) {
        toast.error("Draft created but API did not return an agreement id.");
        return null;
      }

      toast.success(`Draft created (Agreement #${newId}).`);
      navigate(`/app/agreements/${newId}/wizard?step=1`, { replace: true });
      return newId;
    } catch (err) {
      const data = err?.response?.data;
      setLast400(data || { detail: "Create failed." });
      toast.error(data?.detail || "Unable to create draft agreement.");
      return null;
    }
  };

  const saveStep1 = async (goNext = false) => {
    setLast400(null);
    const id = await ensureAgreementExists();
    if (!id) return;

    try {
      const payload = buildStep1Payload({ forDraftCreate: false });
      const { data } = await api.patch(`/projects/agreements/${id}/`, payload);
      setAgreement(data);
      toast.success("Step 1 saved.");
      if (goNext) goStep(2);
    } catch (err) {
      const data = err?.response?.data;
      setLast400(data || { detail: "Save failed." });
      toast.error(data?.detail || "Unable to save Step 1.");
    }
  };

  const loadMilestones = useCallback(async () => {
    if (!agreementId) return;

    try {
      const tryUrls = [
        `/projects/milestones/?agreement=${agreementId}`,
        `/projects/milestones/?agreement_id=${agreementId}`,
        `/projects/milestones/`,
      ];

      let list = null;
      for (const url of tryUrls) {
        try {
          const res = await api.get(url, { params: { _ts: Date.now() } });
          const data = res?.data;
          const arr = Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : null;
          if (arr) {
            list = arr;
            break;
          }
        } catch (err) {
          if (err?.response?.status === 404) continue;
          throw err;
        }
      }

      if (!Array.isArray(list)) list = [];

      const filtered = list.filter(
        (m) => String(m?.agreement || m?.agreement_id || "") === String(agreementId)
      );

      const mapped = filtered.map((m) => ({
        ...m,
        id: m.id,
        title: m.title || "",
        description: m.description || "",
        amount: m.amount != null ? Number(m.amount) : 0,
        start_date: toDateOnly(m.start_date || m.start || ""),
        completion_date: toDateOnly(m.completion_date || m.end_date || m.end || ""),
        due_date: toDateOnly(m.due_date || ""),
        status: m.status,
        status_display: m.status_display,
      }));

      setMilestones(mapped);
    } catch (err) {
      console.warn("loadMilestones failed:", err);
    }
  }, [agreementId]);

  const warnRefreshAfterMutation = useCallback((actionLabel = "saved") => {
    toast(`Milestone ${actionLabel}, but the latest agreement data could not be refreshed.`);
  }, []);

  const refreshAfterMilestoneMutation = useCallback(
    async (actionLabel = "saved") => {
      try {
        await loadMilestones();
        await refreshAgreement();
        return true;
      } catch (err) {
        console.warn("refreshAfterMilestoneMutation failed:", err);
        warnRefreshAfterMutation(actionLabel);
        return false;
      }
    },
    [loadMilestones, refreshAgreement, warnRefreshAfterMutation]
  );

  useEffect(() => {
    loadMilestones();
  }, [loadMilestones]);

  const onMLocalChange = (name, value) => {
    setMLocal((prev) => ({ ...prev, [name]: value }));
  };

  const saveMilestone = async (data) => {
    if (!agreementId) throw new Error("Agreement not created yet.");

    const payload = {
      agreement: agreementId,
      title: safeStr(data.title),
      description: safeStr(data.description),
      start_date: data.start ? data.start : null,
      completion_date: data.end ? data.end : null,
      amount: Number(data.amount || 0),
      ...(data.allow_overlap ? { allow_overlap: true } : {}),
    };

    const { data: created } = await api.post(`/projects/milestones/`, payload);
    setMLocal({ ...EMPTY_MLOCAL });
    const refreshed = await refreshAfterMilestoneMutation("saved");
    return { milestone: created, refreshed };
  };

  const deleteMilestone = async (milestoneId) => {
    if (!milestoneId) return;

    try {
      await api.delete(`/projects/milestones/${milestoneId}/`);
    } catch (err) {
      if (err?.response?.status !== 404) {
        throw err;
      }
    }

    const refreshed = await refreshAfterMilestoneMutation("deleted");
    return { milestoneId, refreshed };
  };

  const updateMilestone = async (patchData) => {
    const mid = patchData?.id;
    if (!mid) throw new Error("Missing milestone id.");

    const payload = {
      title: patchData.title,
      description: patchData.description,
      start_date: patchData.start_date || patchData.start || null,
      completion_date: patchData.completion_date || patchData.end || null,
      amount: patchData.amount != null ? Number(patchData.amount) : null,
    };

    if (patchData?.allow_overlap === true) {
      payload.allow_overlap = true;
    }

    if (!payload.completion_date && patchData?.end_date) {
      payload.completion_date = patchData.end_date;
    }

    const { data: updated } = await api.patch(`/projects/milestones/${mid}/`, payload);
    const refreshed = await refreshAfterMilestoneMutation("updated");
    return { milestone: updated, refreshed };
  };

  const refreshAttachments = async () => {
    if (!agreementId) return;

    try {
      const candidates = [
        `/projects/agreements/${agreementId}/attachments/`,
        `/projects/agreements/${agreementId}/attachments`,
        `/projects/attachments/?agreement=${agreementId}`,
        `/projects/attachments/?agreement_id=${agreementId}`,
      ];

      let data = null;
      for (const url of candidates) {
        try {
          const res = await api.get(url, { params: { _ts: Date.now() } });
          data = res?.data;
          break;
        } catch (err) {
          if (err?.response?.status === 404) continue;
          throw err;
        }
      }

      const list = Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : [];
      setAttachments(list);
    } catch (err) {
      console.warn("refreshAttachments failed:", err);
    }
  };

  useEffect(() => {
    refreshAttachments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agreementId]);

  const saveWarranty = async () => {
    const id = await ensureAgreementExists();
    if (!id) return;

    try {
      const payload = {
        use_default_warranty: !!useDefaultWarranty,
        custom_warranty_text: useDefaultWarranty ? "" : customWarranty || "",
      };
      const { data } = await api.patch(`/projects/agreements/${id}/`, payload);
      setAgreement(data);
      toast.success("Warranty saved.");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Unable to save warranty.");
    }
  };

  const unsignContractor = async () => {
    if (!agreementId) return;

    try {
      await api.post(`/projects/agreements/${agreementId}/contractor_unsign/`);
      toast.success("Contractor signature removed.");
      await fetchAgreement(agreementId);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Unable to unsign contractor.");
    }
  };

  const handleTemplateApplied = useCallback(
    async (nextAgreement, payload = null) => {
      const hydratedAgreement =
        nextAgreement ||
        payload?.agreement ||
        payload?.data?.agreement ||
        null;

      if (hydratedAgreement) {
        setAgreement(hydratedAgreement);

        setDLocal((prev) => ({
          ...prev,
          homeowner:
            hydratedAgreement?.homeowner != null
              ? String(hydratedAgreement.homeowner)
              : prev.homeowner,
          project_title:
            hydratedAgreement?.project_title ||
            hydratedAgreement?.title ||
            hydratedAgreement?.project?.title ||
            prev.project_title,
          project_type: hydratedAgreement?.project_type ?? prev.project_type,
          project_subtype: hydratedAgreement?.project_subtype ?? prev.project_subtype,
          agreement_mode:
            hydratedAgreement?.agreement_mode ?? prev.agreement_mode ?? "standard",
          recurring_service_enabled:
            hydratedAgreement?.recurring_service_enabled ?? prev.recurring_service_enabled ?? false,
          recurrence_pattern:
            hydratedAgreement?.recurrence_pattern ?? prev.recurrence_pattern ?? "monthly",
          recurrence_interval:
            hydratedAgreement?.recurrence_interval != null
              ? String(hydratedAgreement.recurrence_interval)
              : prev.recurrence_interval ?? "1",
          recurrence_start_date:
            hydratedAgreement?.recurrence_start_date ?? prev.recurrence_start_date ?? "",
          recurrence_end_date:
            hydratedAgreement?.recurrence_end_date ?? prev.recurrence_end_date ?? "",
          maintenance_status:
            hydratedAgreement?.maintenance_status ?? prev.maintenance_status ?? "active",
          auto_generate_next_occurrence:
            hydratedAgreement?.auto_generate_next_occurrence ??
            prev.auto_generate_next_occurrence ??
            true,
          service_window_notes:
            hydratedAgreement?.service_window_notes ?? prev.service_window_notes ?? "",
          recurring_summary_label:
            hydratedAgreement?.recurring_summary_label ?? prev.recurring_summary_label ?? "",
          next_occurrence_date:
            hydratedAgreement?.next_occurrence_date ?? prev.next_occurrence_date ?? "",
          description: hydratedAgreement?.description ?? prev.description,
          payment_mode: hydratedAgreement?.payment_mode || prev.payment_mode,
          payment_structure:
            hydratedAgreement?.payment_structure || prev.payment_structure || "simple",
          retainage_percent:
            hydratedAgreement?.retainage_percent != null
              ? String(hydratedAgreement.retainage_percent)
              : prev.retainage_percent || "0.00",
          address_line1:
            hydratedAgreement?.address_line1 ||
            hydratedAgreement?.project_address_line1 ||
            prev.address_line1,
          address_line2:
            hydratedAgreement?.address_line2 ||
            hydratedAgreement?.project_address_line2 ||
            prev.address_line2,
          address_city:
            hydratedAgreement?.address_city ||
            hydratedAgreement?.city ||
            hydratedAgreement?.project_address_city ||
            prev.address_city,
          address_state:
            hydratedAgreement?.address_state ||
            hydratedAgreement?.state ||
            hydratedAgreement?.project_address_state ||
            prev.address_state,
          address_postal_code:
            hydratedAgreement?.address_postal_code ||
            hydratedAgreement?.postal_code ||
            hydratedAgreement?.project_postal_code ||
            prev.address_postal_code,
        }));
      }

      await refreshAgreement();
      await loadMilestones();

      const returnedTemplate =
        payload?.agreement?.selected_template ||
        hydratedAgreement?.selected_template ||
        null;

      if (returnedTemplate?.id) {
        setAgreement((prev) => ({
          ...(prev || {}),
          selected_template: returnedTemplate,
          selected_template_id: returnedTemplate.id,
          selected_template_name_snapshot: returnedTemplate.name || "",
        }));
      }
    },
    [refreshAgreement, loadMilestones, setAgreement]
  );
  const wizardHint = useMemo(
    () => getAgreementWizardHint({ step, agreement }),
    [agreement, step]
  );
  const aiPanelConfig = useMemo(
    () =>
      getAiPanelConfigForStep(step, {
        agreement,
        dLocal,
        milestones,
        sessionState: wizardSessionState,
        aiUpdateFeedback:
          aiFeedbackByStep[step] ||
          (step === 1 ? assistantAppliedSummary : ""),
      }),
    [
      agreement,
      assistantAppliedSummary,
      aiFeedbackByStep,
      dLocal,
      milestones,
      step,
      wizardSessionState,
    ]
  );
  const assistantContext = useMemo(
    () => ({
      current_route: `/app/agreements/${agreementId || "new"}/wizard?step=${step}`,
      agreement_id: agreementId || null,
      agreement_summary: {
        title: dLocal.project_title || agreement?.project_title || agreement?.title || "",
        project_title: dLocal.project_title || agreement?.project_title || agreement?.title || "",
        project_summary: dLocal.description || agreement?.description || "",
        description: dLocal.description || agreement?.description || "",
        customer_name:
          homeownerOptions.find((option) => option.value === dLocal.homeowner)?.label || "",
        project_type: dLocal.project_type || agreement?.project_type || "",
        project_subtype: dLocal.project_subtype || agreement?.project_subtype || "",
        agreement_mode: dLocal.agreement_mode || agreement?.agreement_mode || "standard",
        recurrence_pattern: dLocal.recurrence_pattern || agreement?.recurrence_pattern || "",
        recurrence_interval: dLocal.recurrence_interval || agreement?.recurrence_interval || "",
        next_occurrence_date: dLocal.next_occurrence_date || agreement?.next_occurrence_date || "",
        milestone_count: milestones.length,
        ready_to_finalize: step >= 4,
        pending_clarifications: [],
        status: agreement?.status || "draft",
      },
      template_id:
        agreement?.selected_template?.id ||
        agreement?.selected_template_id ||
        null,
      template_summary: {
        name:
          agreement?.selected_template?.name ||
          agreement?.selected_template_name_snapshot ||
          "",
      },
      milestone_summary: {
        count: milestones.length,
        suggested_titles: milestones.map((item) => item?.title).filter(Boolean),
      },
      ai_panel: aiPanelConfig,
    }),
    [
      agreement,
      agreementId,
      aiPanelConfig,
      dLocal.description,
      dLocal.homeowner,
      dLocal.project_subtype,
      dLocal.project_title,
      dLocal.project_type,
      homeownerOptions,
      milestones,
      step,
    ]
  );
  const handleAssistantAction = useCallback(
    (plan) => {
      if (plan?.wizard_step_target && plan.wizard_step_target !== step) {
        goStep(plan.wizard_step_target);
        return true;
      }
      const actionKey =
        String(
          plan?.assistant_action_key ||
            plan?.action_key ||
            plan?.next_action?.action_key ||
            ""
        ).trim();
      if (step === 1 && actionKey === "refine_and_setup") {
        const prompt = String(plan?.prompt || "").trim();
        if (!prompt) return true;
        setStep1AiEntryOpen(true);
        setStep1AiSetupRequest({ prompt, nonce: Date.now() });
        return true;
      }
      if (plan?.next_action?.action_key === "review_clarifications") {
        goStep(2);
        return true;
      }
      return false;
    },
    [step]
  );

  useEffect(() => {
    if (!step1AiEntryOpen || step !== 1) return;
    openAssistant({
      title: aiPanelConfig.entryTitle,
      context: assistantContext,
      onAction: handleAssistantAction,
    });
    setStep1AiEntryOpen(false);
  }, [
    aiPanelConfig.entryTitle,
    assistantContext,
    handleAssistantAction,
    openAssistant,
    step,
    step1AiEntryOpen,
  ]);

  useEffect(() => {
    if (!isAssistantDockOpen) return;
    openAssistant({
      title: aiPanelConfig.entryTitle,
      context: assistantContext,
      onAction: handleAssistantAction,
    });
  }, [
    aiPanelConfig.entryTitle,
    assistantContext,
    handleAssistantAction,
    isAssistantDockOpen,
    openAssistant,
  ]);

  return (
    <ContractorPageSurface
      eyebrow="Core"
      title="Agreement Wizard"
      subtitle={`${agreementId ? `Agreement #${agreementId}` : "Draft agreement"} · Step ${step} of 4`}
      actions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="agreement-wizard-ask-ai-button"
            onClick={() =>
              openAssistant({
                title: aiPanelConfig.entryTitle,
                context: assistantContext,
                onAction: handleAssistantAction,
              })
            }
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            Ask AI
          </button>
          {agreementId ? (
            <button
              type="button"
              onClick={() => navigate(`/app/agreements/${agreementId}`)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
            >
              View Agreement
            </button>
          ) : null}
        </div>
      }
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div
            data-testid="agreement-wizard-heading"
            className="sr-only"
          >
            Agreement Wizard
          </div>
          <div
            data-testid="agreement-wizard-subtitle"
            className="sr-only"
          >
            {agreementId ? `Agreement #${agreementId}` : "Draft agreement"} · Step {step} of 4
          </div>
        </div>

        <div className="flex items-center gap-2" />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {stepTabs.map(({ n, label }) => (
          <button
            key={n}
            type="button"
            onClick={() => goStep(n)}
            className={`rounded-full border px-3 py-2 text-xs font-semibold transition ${
              step === n
                ? "border-indigo-600 bg-indigo-600 text-white"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <WorkflowHint
        hint={wizardHint}
        testId="agreement-wizard-hint"
        className="mt-4"
      />

      {(wizardSummary.projectTitle ||
        wizardSummary.customerLabel ||
        wizardSummary.milestoneCount > 0 ||
        wizardSummary.totalLabel ||
        wizardSummary.paymentModeLabel) ? (
        <div className="mt-4 flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          {wizardSummary.projectTitle ? (
            <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-800">
              {wizardSummary.projectTitle}
            </span>
          ) : null}
          {wizardSummary.customerLabel ? (
            <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">
              Customer: {wizardSummary.customerLabel}
            </span>
          ) : null}
          {wizardSummary.milestoneCount > 0 ? (
            <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">
              {wizardSummary.milestoneCount} milestone{wizardSummary.milestoneCount === 1 ? "" : "s"}
            </span>
          ) : null}
          {wizardSummary.totalLabel ? (
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-800">
              {wizardSummary.totalLabel}
            </span>
          ) : null}
          {wizardSummary.paymentModeLabel ? (
            <span className="rounded-full bg-sky-50 px-3 py-1 text-sm font-medium text-sky-800">
              {wizardSummary.paymentModeLabel}
            </span>
          ) : null}
        </div>
      ) : null}

      {assistantAppliedSummary ? (
        <div
          data-testid="agreement-assistant-prefill-banner"
          className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900"
        >
          {assistantAppliedSummary}
        </div>
      ) : null}

      {activationJourney && agreementId ? (
        <div
          data-testid="first-agreement-success-banner"
          className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
        >
          <div className="font-semibold">Your first agreement is ready.</div>
          <div className="mt-1">
            Next steps: send the agreement, assign subcontractors if needed, and start tracking progress.
          </div>
        </div>
      ) : null}

      {loadingAgreement ? (
        <div className="mt-6 text-sm text-slate-500">Loading agreement details…</div>
      ) : null}

      {taxonomyLoading ? (
        <div className="mt-2 text-xs text-slate-500">Loading project taxonomy…</div>
      ) : null}

      {step === 1 ? (
        <div className="mt-6">
          <Step1Details
            agreement={agreement}
            paymentModeValue={dLocal.payment_mode}
            isEdit={!!agreementId}
            agreementId={agreementId}
            dLocal={dLocal}
            setDLocal={setDLocal}
            people={people}
            peopleLoadedOnce={peopleLoadedOnce}
            reloadPeople={reloadPeople}
            showQuickAdd={showQuickAdd}
            setShowQuickAdd={setShowQuickAdd}
            qaName={qaName}
            setQaName={setQaName}
            qaEmail={qaEmail}
            setQaEmail={setQaEmail}
            qaBusy={qaBusy}
            setQaBusy={setQaBusy}
            onQuickAdd={onQuickAdd}
            saveStep1={saveStep1}
            last400={last400}
            onLocalChange={onLocalChange}
            homeownerOptions={homeownerOptions}
            projectTypeOptions={projectTypeOptions}
            projectSubtypeOptions={projectSubtypeOptions}
            onTemplateApplied={handleTemplateApplied}
            refreshAgreement={refreshAgreement}
            assistantGuidedFlow={assistantHandoff.guidedFlow}
            assistantTemplateRecommendations={assistantHandoff.templateRecommendations}
            assistantTopTemplatePreview={assistantHandoff.topTemplatePreview}
            assistantProactiveRecommendations={assistantHandoff.proactiveRecommendations}
            assistantPredictiveInsights={assistantHandoff.predictiveInsights}
            assistantProposedActions={assistantHandoff.proposedActions}
            assistantConfirmationRequiredActions={assistantHandoff.confirmationRequiredActions}
            aiHighlightKeys={step1AiHighlights}
            isAiAssistantActive={isAssistantDockOpen}
            aiSetupRequest={step1AiSetupRequest}
            onAiModeActiveChange={setStep1AiEntryOpen}
          />
        </div>
      ) : null}

      {step === 2 ? (
        <div className="mt-6">
          <Step2Milestones
            agreementId={agreementId}
            milestones={milestones}
            mLocal={mLocal}
            onLocalChange={onLocalChange}
            onMLocalChange={onMLocalChange}
            saveMilestone={saveMilestone}
            deleteMilestone={deleteMilestone}
            editMilestone={editMilestone}
            setEditMilestone={setEditMilestone}
            updateMilestone={updateMilestone}
            onBack={() => goStep(1)}
            onNext={() => goStep(3)}
            reloadMilestones={loadMilestones}
            refreshAgreement={refreshAgreement}
            assistantSuggestedMilestones={assistantHandoff.suggestedMilestones}
            assistantClarificationQuestions={assistantHandoff.clarificationQuestions}
            assistantEstimatePreview={assistantHandoff.estimatePreview}
            assistantProactiveRecommendations={assistantHandoff.proactiveRecommendations}
            assistantPredictiveInsights={assistantHandoff.predictiveInsights}
            assistantGuidedFlow={assistantHandoff.guidedFlow}
            onAiUpdateFeedback={(message) =>
              setAiFeedbackByStep((prev) => ({ ...prev, 2: message || "" }))
            }
          />
        </div>
      ) : null}

      {step === 3 ? (
        <div className="mt-6">
          <Step3WarrantyAttachments
            agreement={agreement}
            agreementId={agreementId}
            DEFAULT_WARRANTY={DEFAULT_WARRANTY}
            useDefaultWarranty={useDefaultWarranty}
            setUseDefaultWarranty={setUseDefaultWarranty}
            customWarranty={customWarranty}
            setCustomWarranty={setCustomWarranty}
            saveWarranty={saveWarranty}
            attachments={attachments}
            refreshAttachments={refreshAttachments}
            refreshAgreement={refreshAgreement}
            onBack={() => goStep(2)}
            onNext={() => goStep(4)}
          />
        </div>
      ) : null}

      {step === 4 ? (
        <div className="mt-6">
          <Step4Finalize
            agreement={agreement}
            dLocal={dLocal}
            id={agreementId}
            milestones={milestones}
            totals={totals}
            hasPreviewed={true}
            ackReviewed={ackReviewed}
            setAckReviewed={setAckReviewed}
            ackTos={ackTos}
            setAckTos={setAckTos}
            ackEsign={ackEsign}
            setAckEsign={setAckEsign}
            typedName={typedName}
            setTypedName={setTypedName}
            canSign={true}
            signing={false}
            signContractor={async () => {}}
            submitSign={async () => {}}
            attachments={attachments}
            defaultWarrantyText={DEFAULT_WARRANTY}
            customWarranty={customWarranty}
            useDefaultWarranty={useDefaultWarranty}
            goBack={() => goStep(3)}
            isEdit={!!agreementId}
            unsignContractor={unsignContractor}
            onAgreementUpdated={(updated) => setAgreement(updated)}
            refreshAgreement={refreshAgreement}
            onPreviewViewed={() =>
              setWizardSessionState((prev) => ({ ...prev, hasPreviewedPdf: true }))
            }
            postSendGuidance={aiPanelConfig.nextGuidance}
          />
        </div>
      ) : null}
    </ContractorPageSurface>
  );
}
