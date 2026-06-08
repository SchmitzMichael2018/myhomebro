import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Eye, Loader2, MessageSquare, PencilLine, Sparkles, Trash2, Plus } from "lucide-react";
import toast from "react-hot-toast";

import api from "../api";
import Modal from "./Modal.jsx";
import { leadSummaryFromRow } from "../lib/leadProposalDraft";

function safeText(value) {
  return String(value || "").trim();
}

function normalize(value) {
  return safeText(value).toLowerCase();
}

function moneyNumber(value) {
  const text = safeText(value).replace(/[^0-9.-]/g, "");
  if (!text) return 0;
  const n = Number.parseFloat(text);
  return Number.isFinite(n) ? n : 0;
}

function formatMoney(value) {
  const n = moneyNumber(value);
  if (!n) return "";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function buildInitialMilestones(row) {
  const snapshot = row?.request_snapshot || {};
  const items = Array.isArray(row?.milestone_preview) && row.milestone_preview.length
    ? row.milestone_preview
    : Array.isArray(snapshot.milestones)
      ? snapshot.milestones
      : [];
  const total = moneyNumber(row?.bid_amount || snapshot.budget || "");
  const equalShare = items.length && total > 0 ? total / items.length : 0;
  return items.map((item, index) => {
    if (typeof item === "string") {
      return {
        id: `${index}-${item}`,
        title: item,
        description: "",
        amount: equalShare ? formatMoney(equalShare) : "",
      };
    }
    return {
      id: `${index}-${item?.title || item?.name || "milestone"}`,
      title: safeText(item?.title || item?.name || item?.label || `Milestone ${index + 1}`),
      description: safeText(item?.description || ""),
      amount: safeText(item?.amount != null ? formatMoney(item.amount) : equalShare ? formatMoney(equalShare) : ""),
    };
  });
}

function deriveDraftFromRow(row) {
  const summary = leadSummaryFromRow(row || {});
  const snapshot = summary.request_snapshot || {};
  const photos = Array.isArray(snapshot.photos) ? snapshot.photos : [];
  const milestoneItems = buildInitialMilestones(row);
  const projectTitle = safeText(summary.project_title || snapshot.project_title || row?.project_title || "Draft Agreement");
  const projectDescription = safeText(
    summary.project_description ||
      snapshot.project_scope_summary ||
      snapshot.refined_description ||
      row?.notes ||
      row?.project_description ||
      ""
  );
  const projectClass = safeText(row?.project_class || snapshot.project_class || "residential") || "residential";
  const paymentMode = safeText(row?.payment_mode || snapshot.payment_mode || "escrow") || "escrow";
  const paymentStructure = safeText(row?.payment_structure || snapshot.payment_structure || "simple") || "simple";
  const totalCostSource = row?.bid_amount || snapshot.budget || "";
  const totalCost = moneyNumber(totalCostSource) > 0 ? formatMoney(totalCostSource) : safeText(snapshot.budget || "");

  return {
    projectTitle,
    projectDescription,
    projectType: safeText(summary.project_type || row?.project_type || snapshot.project_type || ""),
    projectSubtype: safeText(summary.project_subtype || row?.project_subtype || snapshot.project_subtype || ""),
    projectClass,
    propertyType: safeText(summary.property_type || snapshot.property_type || row?.property_type || ""),
    budgetRangeText: safeText(summary.budget_range_text || snapshot.budget_range_text || row?.budget_text || snapshot.budget || ""),
    desiredTimingText: safeText(summary.desired_timing_text || snapshot.desired_timing_text || snapshot.timeline || row?.timeline || row?.preferred_timeline || ""),
    preferredContactMethod: safeText(summary.preferred_contact_method || snapshot.preferred_contact_method || row?.preferred_contact_method || ""),
    contactConsent: Boolean(summary.contact_consent || snapshot.contact_consent || row?.contact_consent),
    customerName: safeText(summary.full_name || row?.customer_name || row?.full_name || ""),
    email: safeText(summary.email || row?.customer_email || row?.email || ""),
    phone: safeText(summary.phone || row?.customer_phone || row?.phone || ""),
    projectAddressLine1: safeText(summary.project_address || row?.project_address || ""),
    projectAddressLine2: safeText(snapshot.project_address_line2 || row?.project_address_line2 || ""),
    projectCity: safeText(summary.city || row?.city || ""),
    projectState: safeText(summary.state || row?.state || ""),
    projectPostalCode: safeText(summary.zip_code || row?.zip_code || ""),
    paymentMode,
    paymentStructure,
    escrowEnabled: paymentMode !== "direct",
    totalCost,
    milestones: milestoneItems,
    photos,
  };
}

function fieldClassName() {
  return "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200";
}

function sectionCardClassName() {
  return "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm";
}

export default function ConvertToAgreementPanel({ open, row, onClose }) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState(() => deriveDraftFromRow(row));
  const [photoPreview, setPhotoPreview] = useState(null);
  const [busyAction, setBusyAction] = useState("");

  useEffect(() => {
    if (open) {
      setDraft(deriveDraftFromRow(row));
      setPhotoPreview(null);
      setBusyAction("");
    }
  }, [open, row?.bid_id]);

  const sourceKind = normalize(row?.source_kind);
  const sourceId = row?.source_id || row?.bid_id || "";
  const customerLabel = draft.customerName || row?.customer_name || "Customer";
  const budgetLabel = draft.budgetRangeText || row?.budget_text || row?.bid_amount_label || "-";
  const timingLabel = draft.desiredTimingText || row?.timeline || row?.preferred_timeline || "-";
  const projectTypeLabel = draft.projectSubtype || draft.projectType || row?.project_type || row?.project_class_label || "Project";
  const sourceSnapshot = row?.request_snapshot || {};

  const totalCostDisplay = useMemo(() => draft.totalCost || "", [draft.totalCost]);
  const scopeCards = useMemo(
    () => [
      { label: "Property Type", value: draft.propertyType || "-" },
      { label: "Budget", value: budgetLabel },
      { label: "Timing", value: timingLabel },
      { label: "Contact Preference", value: draft.preferredContactMethod || "-" },
    ],
    [budgetLabel, draft.preferredContactMethod, draft.propertyType, timingLabel]
  );

  const updateDraft = (patch) => {
    setDraft((current) => ({ ...current, ...patch }));
  };

  const updateMilestone = (index, patch) => {
    setDraft((current) => ({
      ...current,
      milestones: current.milestones.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    }));
  };

  const addMilestone = () => {
    setDraft((current) => ({
      ...current,
      milestones: [
        ...current.milestones,
        { id: `milestone-${Date.now()}`, title: "", description: "", amount: "" },
      ],
    }));
  };

  const removeMilestone = (index) => {
    setDraft((current) => ({
      ...current,
      milestones: current.milestones.filter((_, itemIndex) => itemIndex !== index),
    }));
  };

  const applyAnalysis = (analysis) => {
    if (!analysis || typeof analysis !== "object") return;
    const nextMilestones = Array.isArray(analysis.milestone_outline || analysis.milestones)
      ? analysis.milestone_outline || analysis.milestones
      : [];
    const milestoneDrafts = nextMilestones.length
      ? nextMilestones.map((item, index) => ({
          id: `${index}-${safeText(item?.title || item?.name || item?.label || item || "milestone")}`,
          title: safeText(item?.title || item?.name || item?.label || item || ""),
          description: safeText(item?.description || ""),
          amount: safeText(item?.amount != null ? formatMoney(item.amount) : item?.suggested_amount_fixed != null ? formatMoney(item.suggested_amount_fixed) : ""),
        }))
      : [];

    updateDraft({
      projectTitle: safeText(analysis.suggested_title || analysis.project_title || analysis.title || draft.projectTitle),
      projectDescription: safeText(
        analysis.suggested_description ||
          analysis.description ||
          analysis.project_scope_summary ||
          analysis.refined_description ||
          draft.projectDescription
      ),
      projectType: safeText(analysis.project_type || draft.projectType),
      projectSubtype: safeText(analysis.project_subtype || draft.projectSubtype),
      budgetRangeText: safeText(
        analysis.budget_range_text ||
          (analysis.project_budget != null ? formatMoney(analysis.project_budget) : "") ||
          draft.budgetRangeText
      ),
      desiredTimingText: safeText(
        analysis.desired_timing_text ||
          (analysis.project_timeline_days ? `${analysis.project_timeline_days} days` : "") ||
          draft.desiredTimingText
      ),
      milestones: milestoneDrafts.length ? milestoneDrafts : draft.milestones,
    });
  };

  const analyze = async () => {
    if (!sourceId) return;
    const endpoint =
      sourceKind === "intake"
        ? `/projects/intakes/${sourceId}/analyze/`
        : `/projects/contractor/public-leads/${sourceId}/analyze/`;
    setBusyAction("ai");
    try {
      const { data } = await api.post(endpoint, {});
      const analysis = data?.ai_analysis || data?.result || data?.intake?.ai_analysis_payload || {};
      applyAnalysis(analysis);
      toast.success("AI suggestions updated.");
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || "Could not generate AI suggestions.");
    } finally {
      setBusyAction("");
    }
  };

  const submitAgreement = async () => {
    if (!row?.bid_id && !row?.source_id) return;
    const endpoint =
      sourceKind === "intake"
        ? `/projects/intakes/${sourceId}/convert-to-agreement/`
        : `/projects/contractor/public-leads/${sourceId}/create-agreement/`;
    const payload = {
      draft_payload: {
        project_title: draft.projectTitle,
        project_description: draft.projectDescription,
        description: draft.projectDescription,
        project_type: draft.projectType,
        project_subtype: draft.projectSubtype,
        project_class: draft.projectClass,
        property_type: draft.propertyType,
        budget_range_text: draft.budgetRangeText,
        desired_timing_text: draft.desiredTimingText,
        preferred_contact_method: draft.preferredContactMethod,
        contact_consent: draft.contactConsent,
        project_address_line1: draft.projectAddressLine1,
        project_address_line2: draft.projectAddressLine2,
        project_city: draft.projectCity,
        project_state: draft.projectState,
        project_postal_code: draft.projectPostalCode,
        payment_mode: draft.paymentMode,
        payment_structure: draft.paymentStructure,
        escrow_enabled: draft.escrowEnabled,
        total_cost: draft.totalCost,
        milestones: draft.milestones.map((item, index) => ({
          order: index + 1,
          title: safeText(item.title),
          description: safeText(item.description),
          amount: safeText(item.amount),
        })),
      },
      use_recommended_template: true,
    };

    setBusyAction("submit");
    try {
      const { data } = await api.post(endpoint, payload);
      const target = data?.wizard_url || data?.detail_url || (data?.agreement_id ? `/app/agreements/${data.agreement_id}` : "");
      if (target) {
        toast.success("Agreement draft created.");
        onClose?.();
        navigate(target);
        return;
      }
      toast.success("Agreement created.");
      onClose?.();
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || "Could not create the agreement.");
    } finally {
      setBusyAction("");
    }
  };

  const photoItems = useMemo(() => {
    const list = Array.isArray(draft.photos) ? draft.photos : [];
    return list.filter(Boolean);
  }, [draft.photos]);

  const imageSource = photoPreview?.image_url || photoPreview?.url || "";

  return (
    <>
      <Modal
        visible={open}
        title="Convert to Agreement"
        onClose={onClose}
        testId="convert-to-agreement-panel"
        overlayClassName="items-stretch justify-end md:items-center md:justify-end"
        containerClassName="flex h-full w-full max-w-none flex-col rounded-none bg-white md:ml-auto md:h-[calc(100vh-2rem)] md:max-w-[72rem] md:rounded-l-3xl md:rounded-r-none"
        bodyClassName="flex-1 overflow-y-auto p-0"
      >
        <div className="flex h-full flex-col">
          <div className="border-b border-slate-200 bg-slate-50 px-5 py-4 md:px-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Convert to Agreement</div>
                <h2 data-testid="convert-agreement-header" className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">
                  {customerLabel}
                </h2>
                <div className="mt-2 flex flex-wrap gap-2 text-sm text-slate-600">
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-700">
                    {projectTypeLabel}
                  </span>
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1">
                    Timing: {timingLabel || "-"}
                  </span>
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1">
                    Budget: {budgetLabel || "-"}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={submitAgreement}
                data-testid="convert-agreement-send"
                disabled={busyAction === "submit"}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60"
              >
                {busyAction === "submit" ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                Send Agreement
              </button>
            </div>
          </div>

          <div className="grid gap-5 px-5 py-5 md:grid-cols-[1.5fr_1fr] md:px-6">
            <div className="space-y-5">
              <section className={sectionCardClassName()}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Project Summary</div>
                    <div className="mt-1 text-sm text-slate-600">Edit the title and summary before you send the agreement.</div>
                  </div>
                  <button
                    type="button"
                    onClick={analyze}
                    data-testid="convert-ai-improve"
                    disabled={busyAction === "ai"}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    {busyAction === "ai" ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    Improve with AI
                  </button>
                </div>

                <label className="mt-4 block text-sm font-medium text-slate-700">
                  Title
                  <input
                    data-testid="convert-project-title"
                    value={draft.projectTitle}
                    onChange={(event) => updateDraft({ projectTitle: event.target.value })}
                    className={fieldClassName()}
                  />
                </label>
                <label className="mt-4 block text-sm font-medium text-slate-700">
                  Description
                  <textarea
                    data-testid="convert-project-description"
                    value={draft.projectDescription}
                    onChange={(event) => updateDraft({ projectDescription: event.target.value })}
                    rows={6}
                    className={fieldClassName()}
                  />
                </label>
              </section>

              <section className={sectionCardClassName()}>
                <div className="text-sm font-semibold text-slate-900">Milestone Builder</div>
                <div className="mt-1 text-sm text-slate-600">Keep it simple. You can refine the scope before sending.</div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={analyze}
                    disabled={busyAction === "ai"}
                    data-testid="convert-ai-generate-milestones"
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    {busyAction === "ai" ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    AI generate
                  </button>
                  <button
                    type="button"
                    onClick={addMilestone}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Plus size={14} />
                    Add milestone
                  </button>
                </div>

                <div className="mt-4 space-y-3" data-testid="convert-milestone-list">
                  {draft.milestones.length ? (
                    draft.milestones.map((milestone, index) => (
                      <div key={milestone.id || `${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Milestone {index + 1}</div>
                          <button
                            type="button"
                            onClick={() => removeMilestone(index)}
                            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                          >
                            <Trash2 size={12} />
                            Remove
                          </button>
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-[1.2fr_1fr_160px]">
                          <label className="block text-sm font-medium text-slate-700">
                            Title
                            <input
                              value={milestone.title}
                              onChange={(event) => updateMilestone(index, { title: event.target.value })}
                              className={fieldClassName()}
                            />
                          </label>
                          <label className="block text-sm font-medium text-slate-700">
                            Description
                            <input
                              value={milestone.description}
                              onChange={(event) => updateMilestone(index, { description: event.target.value })}
                              className={fieldClassName()}
                            />
                          </label>
                          <label className="block text-sm font-medium text-slate-700">
                            Amount
                            <input
                              value={milestone.amount}
                              onChange={(event) => updateMilestone(index, { amount: event.target.value })}
                              className={fieldClassName()}
                            />
                          </label>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-600">
                      No milestones yet. Use AI generate or add one manually.
                    </div>
                  )}
                </div>
              </section>

              <section className={sectionCardClassName()}>
                <div className="text-sm font-semibold text-slate-900">Photos</div>
                <div className="mt-1 text-sm text-slate-600">
                  Reference images help you match scope, materials, and site conditions.
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="convert-photo-grid">
                  {photoItems.length ? (
                    photoItems.map((photo, index) => {
                      const key = photo.id || photo.image_url || `${index}`;
                      const imageUrl = photo.image_url || photo.url || "";
                      return (
                        <button
                          type="button"
                          key={key}
                          onClick={() => setPhotoPreview(photo)}
                          className="overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                        >
                          {imageUrl ? (
                            <img
                              src={imageUrl}
                              alt={photo.caption || photo.original_name || "Project photo"}
                              className="h-36 w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-36 items-center justify-center bg-slate-100 text-sm text-slate-500">
                              Preview unavailable
                            </div>
                          )}
                          <div className="p-3">
                            <div className="text-sm font-semibold text-slate-900">{photo.original_name || "Project file"}</div>
                            {photo.caption ? <div className="mt-1 text-xs text-slate-500">{photo.caption}</div> : null}
                            <div className="mt-2 inline-flex items-center gap-2 text-xs font-semibold text-slate-600">
                              <Eye size={12} />
                              View
                            </div>
                          </div>
                        </button>
                      );
                    })
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-600">
                      No photos were attached to this request.
                    </div>
                  )}
                </div>
              </section>
            </div>

            <div className="space-y-5">
              <section className={sectionCardClassName()}>
                <div className="text-sm font-semibold text-slate-900">Scope Snapshot</div>
                <div className="mt-1 text-sm text-slate-600">Read-only summary from the request.</div>
                <div className="mt-4 grid gap-3">
                  {scopeCards.map((item) => (
                    <div key={item.label} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{item.label}</div>
                      <div className="mt-1 text-sm font-semibold text-slate-900">{item.value}</div>
                    </div>
                  ))}
                </div>
              </section>

              <section className={sectionCardClassName()}>
                <div className="text-sm font-semibold text-slate-900">Pricing</div>
                <div className="mt-1 text-sm text-slate-600">Set the total agreement value before you send it.</div>
                <label className="mt-4 block text-sm font-medium text-slate-700">
                  Total cost
                  <input
                    data-testid="convert-total-cost"
                    value={totalCostDisplay}
                    onChange={(event) => updateDraft({ totalCost: event.target.value })}
                    className={fieldClassName()}
                    placeholder="$18,500.00"
                  />
                </label>
              </section>

              <section className={sectionCardClassName()}>
                <div className="text-sm font-semibold text-slate-900">Terms</div>
                <div className="mt-1 text-sm text-slate-600">Choose the agreement path and whether escrow is enabled.</div>
                <label className="mt-4 block text-sm font-medium text-slate-700">
                  Payment type
                  <select
                    data-testid="convert-payment-mode"
                    value={draft.paymentMode}
                    onChange={(event) => updateDraft({ paymentMode: event.target.value, escrowEnabled: event.target.value !== "direct" })}
                    className={fieldClassName()}
                  >
                    <option value="escrow">Escrow (Milestone Hold)</option>
                    <option value="direct">Direct Pay</option>
                  </select>
                </label>
                <label className="mt-4 block text-sm font-medium text-slate-700">
                  Payment structure
                  <select
                    data-testid="convert-payment-structure"
                    value={draft.paymentStructure}
                    onChange={(event) => updateDraft({ paymentStructure: event.target.value })}
                    className={fieldClassName()}
                  >
                    <option value="simple">Simple payments</option>
                    <option value="progress">Progress payments</option>
                  </select>
                </label>
                <label className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">
                  <span>Escrow toggle</span>
                  <input
                    data-testid="convert-escrow-toggle"
                    type="checkbox"
                    checked={draft.escrowEnabled}
                    onChange={(event) =>
                      updateDraft({
                        escrowEnabled: event.target.checked,
                        paymentMode: event.target.checked ? "escrow" : "direct",
                      })
                    }
                    className="h-4 w-4 rounded border-slate-300"
                  />
                </label>
              </section>

              <section className={sectionCardClassName()}>
                <div className="text-sm font-semibold text-slate-900">Customer Info</div>
                <div className="mt-1 text-sm text-slate-600">Display only. You can message them before sending.</div>
                <div className="mt-4 space-y-3 text-sm text-slate-700">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Name</div>
                    <div className="mt-1 font-semibold text-slate-900">{draft.customerName || "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Email</div>
                    <div className="mt-1 font-semibold text-slate-900">{draft.email || "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Phone</div>
                    <div className="mt-1 font-semibold text-slate-900">{draft.phone || "-"}</div>
                  </div>
                  <button
                    type="button"
                    data-testid="convert-customer-message"
                    onClick={() => {
                      if (!draft.email) return;
                      window.location.href = `mailto:${draft.email}?subject=${encodeURIComponent("MyHomeBro agreement draft")}`;
                    }}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <MessageSquare size={14} />
                    Message customer
                  </button>
                </div>
              </section>

              <section className={sectionCardClassName()}>
                <div className="text-sm font-semibold text-slate-900">Request Details</div>
                <div className="mt-1 text-sm text-slate-600">
                  Lead type: {row?.source_kind_label || "Lead"} · Project source: {row?.request_snapshot?.request_path_label || "Project request"}
                </div>
                <div className="mt-4 grid gap-3">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Summary</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">{sourceSnapshot.project_scope_summary || sourceSnapshot.refined_description || row?.notes || "-"}</div>
                  </div>
                </div>
              </section>
            </div>
          </div>

          <div className="border-t border-slate-200 bg-white px-5 py-4 md:px-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={onClose}
                data-testid="convert-agreement-back"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                <ArrowLeft size={16} />
                Back
              </button>
              <button
                type="button"
                onClick={submitAgreement}
                disabled={busyAction === "submit"}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-60"
              >
                {busyAction === "submit" ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                Send Agreement
              </button>
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        visible={Boolean(photoPreview)}
        title={photoPreview?.original_name || "Photo preview"}
        onClose={() => setPhotoPreview(null)}
        containerClassName="max-w-3xl rounded-2xl"
        bodyClassName="max-h-[80vh] overflow-y-auto px-5 py-4"
      >
        <div className="space-y-4">
          {imageSource ? (
            <img
              src={imageSource}
              alt={photoPreview?.caption || photoPreview?.original_name || "Project photo"}
              className="max-h-[65vh] w-full rounded-2xl object-contain"
            />
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600">
              Preview unavailable.
            </div>
          )}
          {photoPreview?.caption ? <div className="text-sm text-slate-600">{photoPreview.caption}</div> : null}
        </div>
      </Modal>
    </>
  );
}
