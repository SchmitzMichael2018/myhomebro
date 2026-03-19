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

  const [addrSearch, setAddrSearch] = useState("");
  const patchTimerRef = useRef(null);
  const lastPatchedRef = useRef({});

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
      const msg =
        e?.response?.data?.detail ||
        e?.response?.data?.error ||
        "Could not save changes.";
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
    if (isNewAgreement) return;

    try {
      const payload = {
        payment_mode: dLocal?.payment_mode || "",
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
    remaining: null,
    total: null,
    used: null,
    enabled: false,
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

  const aiBlockedByCredits =
    aiCredits.loading ? false : aiCredits.remaining != null && aiCredits.remaining <= 0;

  async function runAiDescription(mode) {
    if (locked) return;

    setAiErr("");
    setAiPreview("");
    setAiBusy(true);

    try {
      if (aiBlockedByCredits) {
        toast.error("No AI credits remaining.");
        return;
      }

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

      const remainingFromAi =
        res?.data?.remaining_credits ??
        res?.data?.ai_credits?.free_remaining ??
        res?.data?.ai_credits?.remaining ??
        res?.data?.ai_credits_remaining ??
        null;

      const totalFromAi =
        res?.data?.ai_credits?.free_total ?? res?.data?.ai_credits?.total ?? null;

      const usedFromAi =
        res?.data?.ai_credits?.free_used ?? res?.data?.ai_credits?.used ?? null;

      if (remainingFromAi != null) {
        setAiCredits((prev) => ({
          ...prev,
          loading: false,
          remaining: Number(remainingFromAi),
          total: totalFromAi != null ? Number(totalFromAi) : prev.total,
          used: usedFromAi != null ? Number(usedFromAi) : prev.used,
          enabled: Number(remainingFromAi) > 0,
        }));
      } else {
        await refreshAiCredits();
      }
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

  async function handlePaymentModeChange(mode) {
    if (locked) return;

    const normalized = normalizePaymentMode(mode);

    setDLocal((s) => ({ ...s, payment_mode: normalized }));
    if (!isNewAgreement) {
      writeCache({ payment_mode: normalized });
    }

    await patchAgreement({ payment_mode: normalized }, { silent: true });
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
    if (aiBlockedByCredits) {
      toast.error("No AI credits remaining.");
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

  return (
    <>
      <div className="rounded-lg border bg-white p-4">
        <div className="mb-2 text-sm text-gray-600">
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

        {last400 ? (
          <div className="mb-3">
            <div className="text-sm font-semibold text-red-700">
              Server response (400)
            </div>
            <PrettyJson data={last400} />
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-3">
          <TemplateSearchSection
            locked={locked}
            agreementId={agreementId}
            dLocal={dLocal}
            onLocalChange={handleStep1LocalChange}
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
            aiBlockedByCredits={aiBlockedByCredits}
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

            <PaymentModeSection
              locked={locked}
              paymentMode={paymentMode}
              onChangeMode={handlePaymentModeChange}
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
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
