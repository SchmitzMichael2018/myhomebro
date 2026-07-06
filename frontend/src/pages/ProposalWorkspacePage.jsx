import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Camera, Check, FileSignature, FileUp, Mail, Mic, Phone, Plus, Ruler, Save, StickyNote, Trash2, X } from "lucide-react";
import toast from "react-hot-toast";

import api from "../api";
import ContractorPageSurface from "../components/dashboard/ContractorPageSurface.jsx";
import { writeSessionAssistantHandoff } from "../lib/assistantHandoff.js";

const NAV = [
  ["overview", "Overview"],
  ["appointment", "Appointment"],
  ["customer", "Customer"],
  ["site", "Site Visit"],
  ["measurements", "Measurements"],
  ["photos", "Photos"],
  ["documents", "Documents"],
  ["estimate", "Estimate Builder"],
  ["scope", "Scope"],
  ["notes", "Notes"],
  ["history", "History"],
];

const EMPTY_MEASUREMENT = {
  label: "",
  location: "",
  quantity: "",
  unit: "",
  notes: "",
};

const EMPTY_LINE_ITEM = {
  category: "labor",
  description: "",
  quantity: "1",
  unit: "",
  unit_price: "",
  notes: "",
};

const LINE_ITEM_CATEGORIES = [
  ["labor", "Labor"],
  ["materials", "Materials"],
  ["equipment", "Equipment"],
  ["subcontractor", "Subcontractor"],
  ["incidentals_reserve", "Incidentals Reserve"],
  ["tax", "Tax"],
  ["discount", "Discount"],
  ["allowance", "Allowance"],
  ["other", "Other"],
];

const WALKTHROUGH_CHECKLIST = [
  "Exterior reviewed",
  "Interior reviewed",
  "Measurements complete",
  "Photos complete",
  "Customer requests documented",
  "Existing damage documented",
];

function field(value, fallback = "-") {
  return value == null || value === "" ? fallback : String(value);
}

function money(value) {
  const num = Number(value || 0);
  return Number.isFinite(num)
    ? num.toLocaleString("en-US", { style: "currency", currency: "USD" })
    : "$0.00";
}

function formatDateTime(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return String(value);
  }
}

function statusTone(status) {
  const value = String(status || "").toLowerCase();
  if (["ready", "sent", "viewed", "accepted", "converted"].includes(value)) return "border-emerald-300 bg-emerald-50 text-emerald-800";
  if (["site_visit", "in_progress", "revision_requested"].includes(value)) return "border-amber-300 bg-amber-50 text-amber-800";
  if (["declined", "expired"].includes(value)) return "border-rose-300 bg-rose-50 text-rose-800";
  return "border-slate-300 bg-slate-50 text-slate-700";
}

function safeHref(kind, value, subject = "", body = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  if (kind === "email") {
    const params = new URLSearchParams();
    if (subject) params.set("subject", subject);
    if (body) params.set("body", body);
    return `mailto:${text}${params.toString() ? `?${params.toString()}` : ""}`;
  }
  if (kind === "sms") return `sms:${text}`;
  return `tel:${text}`;
}

function compactText(value) {
  return String(value || "").trim();
}

function sectionBlock(title, value) {
  const text = compactText(value);
  return text ? `${title}\n${text}` : "";
}

function proposalLineItemLabel(item) {
  const qty = compactText(item.quantity);
  const unit = compactText(item.unit);
  const unitPrice = compactText(item.unit_price);
  const total = compactText(item.total);
  const quantityLabel = [qty, unit].filter(Boolean).join(" ");
  const priceLabel = unitPrice ? ` @ ${money(unitPrice)}` : "";
  const totalLabel = total ? ` = ${money(total)}` : "";
  return [
    compactText(item.category_label || item.category || "Line item"),
    compactText(item.description),
    quantityLabel || null,
    `${priceLabel}${totalLabel}`.trim() || null,
  ].filter(Boolean).join(" - ");
}

function buildProposalAgreementScope(proposal) {
  const measurements = Array.isArray(proposal.measurements) ? proposal.measurements : [];
  const attachments = Array.isArray(proposal.attachments) ? proposal.attachments : [];
  const lineItems = Array.isArray(proposal.line_items) ? proposal.line_items : [];

  const measurementLines = measurements
    .map((item) => {
      const quantity = [compactText(item.quantity), compactText(item.unit)].filter(Boolean).join(" ");
      const location = compactText(item.location);
      const notes = compactText(item.notes);
      return [`- ${compactText(item.label) || "Measurement"}`, location ? `(${location})` : "", quantity, notes ? `- ${notes}` : ""]
        .filter(Boolean)
        .join(" ");
    })
    .join("\n");

  const attachmentLines = attachments
    .map((item) => `- ${compactText(item.original_name || item.caption || item.attachment_type || "Attachment")}`)
    .join("\n");

  const lineItemLines = lineItems.map((item) => `- ${proposalLineItemLabel(item)}`).join("\n");

  return [
    sectionBlock("Project Summary", proposal.project_summary),
    sectionBlock("Site Visit Notes", proposal.site_visit_notes),
    sectionBlock("Customer Requests", proposal.customer_requests),
    sectionBlock("Site Conditions", proposal.site_conditions),
    sectionBlock("Included Work", proposal.included_work),
    sectionBlock("Excluded Work", proposal.excluded_work),
    sectionBlock("Assumptions", proposal.assumptions),
    sectionBlock("Allowances", proposal.allowances),
    measurementLines ? `Measurements\n${measurementLines}` : "",
    attachmentLines ? `Referenced Photos and Documents\n${attachmentLines}` : "",
    lineItemLines ? `Estimate Line Items\n${lineItemLines}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function primeAgreementWizardForProposalDraft() {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return;
    window.sessionStorage.setItem("mhb_step1_cache_new_start_mode", "manual");
    window.sessionStorage.setItem("mhb_step1_cache_new_start_mode_committed", "1");
    window.sessionStorage.setItem("mhb_step1_cache_new_start_mode_source", "session");
  } catch {
    // ignore storage failures
  }
}

function Section({ id, active, title, children }) {
  if (!active) return null;
  return (
    <section id={id} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 md:p-5" data-testid={`proposal-section-${id}`}>
      <h2 className="text-lg font-bold text-slate-950">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function InfoGrid({ rows }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
          <dd className="mt-1 whitespace-pre-wrap text-sm font-semibold text-slate-900">{field(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function TextAreaField({ label, value, onChange, rows = 4, testId }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      <textarea
        data-testid={testId}
        className="mt-1 min-h-[104px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
        rows={rows}
        value={value || ""}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export default function ProposalWorkspacePage() {
  const { proposalId } = useParams();
  const navigate = useNavigate();
  const [proposal, setProposal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [active, setActive] = useState("overview");
  const [draft, setDraft] = useState({});
  const [measurementForm, setMeasurementForm] = useState(EMPTY_MEASUREMENT);
  const [lineItemForm, setLineItemForm] = useState(EMPTY_LINE_ITEM);
  const [editingLineItemId, setEditingLineItemId] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [walkthroughMode, setWalkthroughMode] = useState(false);
  const [walkthroughMeasurementOpen, setWalkthroughMeasurementOpen] = useState(false);
  const [quickNoteOpen, setQuickNoteOpen] = useState(false);

  const photos = useMemo(
    () => (proposal?.attachments || []).filter((item) => item.attachment_type === "photo"),
    [proposal]
  );
  const documents = useMemo(
    () => (proposal?.attachments || []).filter((item) => item.attachment_type !== "photo"),
    [proposal]
  );
  const totals = proposal?.totals || {};

  function createAgreementFromProposal() {
    if (!proposal) return;
    const workspaceProposal = { ...proposal, ...draft };
    const scopeText = buildProposalAgreementScope(workspaceProposal);
    const proposalTotal = compactText(totals.total || "0.00");
    const incidentalsReserve = compactText(totals.incidentals_reserve || "0.00");
    const lineItems = Array.isArray(proposal.line_items) ? proposal.line_items : [];
    const measurements = Array.isArray(proposal.measurements) ? proposal.measurements : [];
    const attachments = Array.isArray(proposal.attachments) ? proposal.attachments : [];

    const handoff = {
      assistantPrefill: {
        project_title: workspaceProposal.project_title || "",
        project_summary: workspaceProposal.project_summary || "",
        customer_name: workspaceProposal.customer_name || "",
        email: workspaceProposal.customer_email || "",
        address_line1: workspaceProposal.service_location || "",
        incidentals_reserve_amount: incidentalsReserve,
      },
      assistantDraftPayload: {
        source: "proposal",
        proposal_id: proposal.id,
        source_type: proposal.source_type || "",
        source_id: proposal.source_id || null,
        opportunity_id: proposal.contractor_opportunity_id || null,
        estimate_appointment_id: proposal.estimate_appointment_id || null,
        project_title: workspaceProposal.project_title || "",
        title: workspaceProposal.project_title || "",
        project_type: workspaceProposal.project_type || "",
        project_subtype: workspaceProposal.project_subtype || "",
        project_summary: workspaceProposal.project_summary || "",
        description: scopeText || workspaceProposal.project_summary || "",
        scope_of_work: scopeText || workspaceProposal.project_summary || "",
        customer_name: workspaceProposal.customer_name || "",
        homeowner_name: workspaceProposal.customer_name || "",
        email: workspaceProposal.customer_email || "",
        customer_email: workspaceProposal.customer_email || "",
        customer_phone: workspaceProposal.customer_phone || "",
        service_location: workspaceProposal.service_location || "",
        address_line1: workspaceProposal.service_location || "",
        payment_mode: Number(incidentalsReserve || 0) > 0 ? "escrow" : "",
        incidentals_reserve_amount: incidentalsReserve,
        proposal_total: proposalTotal,
        proposal_totals: totals,
        proposal_line_items: lineItems,
        proposal_measurements: measurements,
        proposal_attachments: attachments,
        site_visit_notes: workspaceProposal.site_visit_notes || "",
        included_work: workspaceProposal.included_work || "",
        excluded_work: workspaceProposal.excluded_work || "",
        assumptions: workspaceProposal.assumptions || "",
        allowances: workspaceProposal.allowances || "",
      },
      assistantContext: {
        source: "proposal",
        source_label: "Proposal Workspace",
        proposal_id: proposal.id,
        source_type: proposal.source_type || "",
        source_id: proposal.source_id || null,
        customer_name: workspaceProposal.customer_name || "",
        service_location: workspaceProposal.service_location || "",
        proposal_total: proposalTotal,
        incidentals_reserve_amount: incidentalsReserve,
        line_item_count: lineItems.length,
        measurement_count: measurements.length,
        attachment_count: attachments.length,
      },
      assistantEstimatePreview: {
        source: "proposal",
        confidence_level: "contractor-entered",
        suggested_total_price: proposalTotal,
        incidentals_reserve_amount: incidentalsReserve,
        line_items: lineItems.map((item) => ({
          category: item.category,
          label: item.category_label,
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          unit_price: item.unit_price,
          total: item.total,
          notes: item.notes,
        })),
      },
      assistantWizardStepTarget: 1,
      assistantIntent: "proposal_to_agreement",
    };

    writeSessionAssistantHandoff(handoff);
    primeAgreementWizardForProposalDraft();
    toast.success("Proposal data loaded into the Agreement Wizard.");
    navigate("/app/agreements/new/wizard?step=1", { state: handoff });
  }

  async function loadProposal() {
    setLoading(true);
    try {
      const { data } = await api.get(`/projects/proposals/${proposalId}/`);
      setProposal(data);
      setDraft({
        status: data.status || "draft",
        customer_preferred_contact: data.customer_preferred_contact || "",
        site_visit_notes: data.site_visit_notes || "",
        access_notes: data.access_notes || "",
        risk_notes: data.risk_notes || "",
        customer_requests: data.customer_requests || "",
        site_conditions: data.site_conditions || "",
        quick_checklist: Array.isArray(data.quick_checklist) ? data.quick_checklist : [],
        included_work: data.included_work || "",
        excluded_work: data.excluded_work || "",
        assumptions: data.assumptions || "",
        allowances: data.allowances || "",
        internal_notes: data.internal_notes || "",
      });
    } catch (error) {
      console.error(error);
      toast.error("Could not load proposal.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProposal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposalId]);

  function patchDraft(key, value) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function saveProposal(payload, success = "Proposal saved.") {
    setSaving(true);
    try {
      const { data } = await api.patch(`/projects/proposals/${proposalId}/`, payload);
      setProposal(data);
      setDraft((prev) => ({ ...prev, ...payload }));
      toast.success(success);
    } catch (error) {
      console.error(error);
      toast.error(error?.response?.data?.detail || "Could not save proposal.");
    } finally {
      setSaving(false);
    }
  }

  async function addMeasurement(event) {
    event?.preventDefault?.();
    try {
      const { data } = await api.post(`/projects/proposals/${proposalId}/measurements/`, measurementForm);
      setProposal((prev) => ({ ...prev, measurements: [...(prev?.measurements || []), data] }));
      setMeasurementForm(EMPTY_MEASUREMENT);
      setWalkthroughMeasurementOpen(false);
      toast.success("Measurement added.");
    } catch (error) {
      console.error(error);
      toast.error("Could not add measurement.");
    }
  }

  async function deleteMeasurement(id) {
    await api.delete(`/projects/proposals/${proposalId}/measurements/${id}/`);
    setProposal((prev) => ({
      ...prev,
      measurements: (prev?.measurements || []).filter((item) => item.id !== id),
    }));
    toast.success("Measurement removed.");
  }

  function resetLineItemForm() {
    setLineItemForm(EMPTY_LINE_ITEM);
    setEditingLineItemId(null);
  }

  function patchLineItemForm(key, value) {
    setLineItemForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submitLineItem(event) {
    event.preventDefault();
    try {
      if (editingLineItemId) {
        const { data } = await api.patch(`/projects/proposals/${proposalId}/line-items/${editingLineItemId}/`, lineItemForm);
        setProposal((prev) => ({
          ...prev,
          totals: data.totals || prev?.totals,
          line_items: (prev?.line_items || []).map((item) => (item.id === editingLineItemId ? data.line_item : item)),
        }));
        toast.success("Line item updated.");
      } else {
        const { data } = await api.post(`/projects/proposals/${proposalId}/line-items/`, lineItemForm);
        setProposal((prev) => ({
          ...prev,
          totals: data.totals || prev?.totals,
          line_items: [...(prev?.line_items || []), data.line_item],
        }));
        toast.success("Line item added.");
      }
      resetLineItemForm();
    } catch (error) {
      console.error(error);
      toast.error("Could not save line item.");
    }
  }

  function editLineItem(item) {
    setEditingLineItemId(item.id);
    setLineItemForm({
      category: item.category || "labor",
      description: item.description || "",
      quantity: item.quantity || "1",
      unit: item.unit || "",
      unit_price: item.unit_price || "",
      notes: item.notes || "",
    });
  }

  async function deleteLineItem(id) {
    try {
      const { data } = await api.delete(`/projects/proposals/${proposalId}/line-items/${id}/`);
      setProposal((prev) => ({
        ...prev,
        totals: data?.totals || prev?.totals,
        line_items: (prev?.line_items || []).filter((item) => item.id !== id),
      }));
      if (editingLineItemId === id) resetLineItemForm();
      toast.success("Line item removed.");
    } catch (error) {
      console.error(error);
      toast.error("Could not remove line item.");
    }
  }

  async function uploadAttachment(event, type) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const body = new FormData();
    body.append("file", file);
    body.append("attachment_type", type);
    body.append("category", type === "photo" ? "before" : "customer_file");
    body.append("caption", "");
    try {
      const { data } = await api.post(`/projects/proposals/${proposalId}/attachments/`, body, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setProposal((prev) => ({ ...prev, attachments: [data, ...(prev?.attachments || [])] }));
      toast.success(type === "photo" ? "Photo uploaded." : "Document uploaded.");
    } catch (error) {
      console.error(error);
      toast.error("Upload failed.");
    } finally {
      event.target.value = "";
      setUploading(false);
    }
  }

  async function deleteAttachment(id) {
    await api.delete(`/projects/proposals/${proposalId}/attachments/${id}/`);
    setProposal((prev) => ({
      ...prev,
      attachments: (prev?.attachments || []).filter((item) => item.id !== id),
    }));
    toast.success("Attachment removed.");
  }

  async function toggleChecklistItem(label) {
    const current = Array.isArray(draft.quick_checklist) ? draft.quick_checklist : [];
    const next = current.includes(label) ? current.filter((item) => item !== label) : [...current, label];
    patchDraft("quick_checklist", next);
    await saveProposal({ quick_checklist: next }, "Checklist updated.");
  }

  const emailHref = safeHref("email", proposal?.customer_email, `Re: ${proposal?.project_title || "Your project"}`);
  const telHref = safeHref("tel", proposal?.customer_phone);
  const smsHref = safeHref("sms", proposal?.customer_phone);
  const recentPhotos = photos.slice(0, 3);
  const recentMeasurements = (proposal?.measurements || []).slice(-3).reverse();
  const recentNotes = [
    draft.site_visit_notes ? { label: "General note", value: draft.site_visit_notes } : null,
    draft.customer_requests ? { label: "Customer requests", value: draft.customer_requests } : null,
    draft.risk_notes ? { label: "Risk note", value: draft.risk_notes } : null,
  ].filter(Boolean);

  if (loading) {
    return (
      <ContractorPageSurface eyebrow="Proposal Workspace" title="Loading proposal" subtitle="Preparing the pre-agreement workspace.">
        <div className="rounded-xl bg-white p-8 text-sm font-semibold text-slate-600 ring-1 ring-slate-200" data-testid="proposal-loading">
          Loading proposal...
        </div>
      </ContractorPageSurface>
    );
  }

  if (!proposal) {
    return (
      <ContractorPageSurface eyebrow="Proposal Workspace" title="Proposal not found" subtitle="This proposal could not be loaded.">
        <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white" onClick={() => navigate("/app/opportunities")}>
          Back to Opportunities
        </button>
      </ContractorPageSurface>
    );
  }

  if (walkthroughMode) {
    const checklist = Array.isArray(draft.quick_checklist) ? draft.quick_checklist : [];
    return (
      <div className="min-h-screen bg-slate-950 px-3 py-3 text-white md:px-5" data-testid="proposal-walkthrough-mode">
        <header className="sticky top-0 z-50 -mx-3 border-b border-white/10 bg-slate-950/95 px-3 py-3 backdrop-blur md:-mx-5 md:px-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-bold uppercase tracking-[0.2em] text-blue-200/80">Walkthrough Mode</div>
              <h1 className="mt-1 truncate text-2xl font-black text-white">{proposal.project_title || "Proposal"}</h1>
              <p className="mt-1 text-sm font-semibold text-slate-300">{proposal.customer_name || "Customer"} - {proposal.service_location || "Site visit"}</p>
            </div>
            <button
              type="button"
              data-testid="exit-walkthrough-mode"
              onClick={() => setWalkthroughMode(false)}
              className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-black text-slate-950 shadow-sm"
            >
              <X size={18} /> Exit
            </button>
          </div>
        </header>

        <main className="mx-auto max-w-4xl space-y-4 py-4">
          <section className="rounded-2xl bg-white p-4 text-slate-950 shadow-xl" data-testid="walkthrough-primary-actions">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex min-h-20 cursor-pointer items-center justify-center gap-3 rounded-2xl bg-blue-600 px-4 py-4 text-lg font-black text-white shadow-sm">
                <Camera size={24} /> Take Photo
                <input type="file" accept="image/*" className="hidden" data-testid="walkthrough-photo-upload" onChange={(event) => uploadAttachment(event, "photo")} />
              </label>
              <button
                type="button"
                data-testid="walkthrough-add-measurement"
                onClick={() => setWalkthroughMeasurementOpen((value) => !value)}
                className="flex min-h-20 items-center justify-center gap-3 rounded-2xl bg-emerald-600 px-4 py-4 text-lg font-black text-white shadow-sm"
              >
                <Ruler size={24} /> Add Measurement
              </button>
              <button
                type="button"
                data-testid="walkthrough-quick-note"
                onClick={() => setQuickNoteOpen((value) => !value)}
                className="flex min-h-20 items-center justify-center gap-3 rounded-2xl bg-amber-500 px-4 py-4 text-lg font-black text-slate-950 shadow-sm"
              >
                <StickyNote size={24} /> Quick Note
              </button>
              <button
                type="button"
                disabled
                title="Voice notes are a placeholder for a future phase."
                className="flex min-h-20 cursor-not-allowed items-center justify-center gap-3 rounded-2xl bg-slate-200 px-4 py-4 text-lg font-black text-slate-500"
              >
                <Mic size={24} /> Voice Note
              </button>
              <label className="flex min-h-20 cursor-pointer items-center justify-center gap-3 rounded-2xl bg-slate-900 px-4 py-4 text-lg font-black text-white shadow-sm sm:col-span-2">
                <FileUp size={24} /> Attach Document
                <input type="file" className="hidden" data-testid="walkthrough-document-upload" onChange={(event) => uploadAttachment(event, "document")} />
              </label>
            </div>
          </section>

          {walkthroughMeasurementOpen ? (
            <section className="rounded-2xl bg-white p-4 text-slate-950 shadow-xl" data-testid="walkthrough-measurement-panel">
              <h2 className="text-lg font-black">Add Measurement</h2>
              <form onSubmit={addMeasurement} className="mt-3 grid gap-3 sm:grid-cols-2">
                {["label", "location", "quantity", "unit"].map((key) => (
                  <input
                    key={key}
                    data-testid={`walkthrough-measurement-${key}`}
                    className="min-h-12 rounded-xl border border-slate-300 px-4 py-3 text-base font-semibold"
                    placeholder={key === "quantity" ? "Quantity" : key.charAt(0).toUpperCase() + key.slice(1)}
                    value={measurementForm[key]}
                    onChange={(event) => setMeasurementForm((prev) => ({ ...prev, [key]: event.target.value }))}
                  />
                ))}
                <textarea
                  className="min-h-24 rounded-xl border border-slate-300 px-4 py-3 text-base font-semibold sm:col-span-2"
                  placeholder="Notes"
                  value={measurementForm.notes}
                  onChange={(event) => setMeasurementForm((prev) => ({ ...prev, notes: event.target.value }))}
                />
                <button type="submit" className="min-h-12 rounded-xl bg-emerald-600 px-4 py-3 text-base font-black text-white sm:col-span-2">
                  Save Measurement
                </button>
              </form>
            </section>
          ) : null}

          {quickNoteOpen ? (
            <section className="rounded-2xl bg-white p-4 text-slate-950 shadow-xl" data-testid="walkthrough-note-panel">
              <h2 className="text-lg font-black">Quick Note</h2>
              <textarea
                data-testid="walkthrough-note-input"
                className="mt-3 min-h-36 w-full rounded-xl border border-slate-300 px-4 py-3 text-base font-semibold"
                value={draft.site_visit_notes || ""}
                onChange={(event) => patchDraft("site_visit_notes", event.target.value)}
                placeholder="Capture site observations, customer comments, or follow-up items."
              />
              <button
                type="button"
                data-testid="walkthrough-save-note"
                onClick={() => saveProposal({ site_visit_notes: draft.site_visit_notes || "" }, "Quick note saved.")}
                className="mt-3 min-h-12 w-full rounded-xl bg-blue-600 px-4 py-3 text-base font-black text-white"
              >
                Save Quick Note
              </button>
            </section>
          ) : null}

          <section className="rounded-2xl bg-white p-4 text-slate-950 shadow-xl" data-testid="walkthrough-checklist">
            <h2 className="text-lg font-black">Checklist</h2>
            <div className="mt-3 grid gap-2">
              {WALKTHROUGH_CHECKLIST.map((item) => {
                const checked = checklist.includes(item);
                return (
                  <button
                    key={item}
                    type="button"
                    data-testid={`walkthrough-check-${item.toLowerCase().replaceAll(" ", "-")}`}
                    onClick={() => toggleChecklistItem(item)}
                    className={`flex min-h-12 items-center gap-3 rounded-xl px-4 py-3 text-left text-base font-black ${
                      checked ? "bg-emerald-50 text-emerald-900 ring-2 ring-emerald-300" : "bg-slate-100 text-slate-800"
                    }`}
                  >
                    <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${checked ? "bg-emerald-600 text-white" : "bg-white ring-1 ring-slate-300"}`}>
                      {checked ? <Check size={18} /> : null}
                    </span>
                    {item}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl bg-white p-4 text-slate-950 shadow-xl" data-testid="walkthrough-recent-captures">
            <h2 className="text-lg font-black">Recent Captures</h2>
            <div className="mt-3 grid gap-3">
              {recentPhotos.length ? (
                <div>
                  <div className="text-sm font-black uppercase tracking-wide text-slate-500">Photos</div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {recentPhotos.map((item) => (
                      <button key={item.id} type="button" onClick={() => { setWalkthroughMode(false); setActive("photos"); }} className="rounded-xl bg-slate-100 p-2 text-left">
                        {item.url ? <img src={item.url} alt={item.caption || item.original_name || "Recent photo"} className="h-20 w-full rounded-lg object-cover" /> : null}
                        <div className="mt-1 truncate text-xs font-bold">{item.caption || item.original_name || "Photo"}</div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {recentMeasurements.length ? (
                <div>
                  <div className="text-sm font-black uppercase tracking-wide text-slate-500">Measurements</div>
                  <div className="mt-2 space-y-2">
                    {recentMeasurements.map((item) => (
                      <button key={item.id} type="button" onClick={() => { setWalkthroughMode(false); setActive("measurements"); }} className="w-full rounded-xl bg-slate-100 px-3 py-2 text-left">
                        <div className="font-black">{item.label}</div>
                        <div className="text-sm font-semibold text-slate-600">{item.quantity} {item.unit} - {field(item.location)}</div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {recentNotes.length ? (
                <div>
                  <div className="text-sm font-black uppercase tracking-wide text-slate-500">Notes</div>
                  <div className="mt-2 space-y-2">
                    {recentNotes.slice(0, 3).map((item) => (
                      <button key={item.label} type="button" onClick={() => { setWalkthroughMode(false); setActive("site"); }} className="w-full rounded-xl bg-slate-100 px-3 py-2 text-left">
                        <div className="font-black">{item.label}</div>
                        <div className="line-clamp-2 text-sm font-semibold text-slate-600">{item.value}</div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {!recentPhotos.length && !recentMeasurements.length && !recentNotes.length ? (
                <div className="rounded-xl bg-slate-100 p-4 text-sm font-bold text-slate-600">No captures yet. Start with a photo, measurement, or quick note.</div>
              ) : null}
            </div>
          </section>
        </main>
      </div>
    );
  }

  return (
    <ContractorPageSurface
      eyebrow="Proposal Workspace"
      title={proposal.project_title || "Proposal Workspace"}
      subtitle="Capture site visit details, measurements, photos, documents, scope, and internal notes before agreement drafting."
      actions={
        <>
          <button
            type="button"
            data-testid="enter-walkthrough-mode"
            className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-black text-white shadow-sm hover:bg-blue-500"
            onClick={() => setWalkthroughMode(true)}
          >
            Enter Walkthrough Mode
          </button>
          <button
            type="button"
            data-testid="proposal-create-agreement-action"
            className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-2 text-sm font-black text-white shadow-sm hover:bg-slate-800"
            onClick={createAgreementFromProposal}
          >
            <FileSignature size={16} /> Create Agreement from Proposal
          </button>
          <button
            type="button"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50"
            onClick={() => navigate("/app/opportunities")}
          >
            Opportunities
          </button>
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)_280px]" data-testid="proposal-workspace">
        <aside className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200 lg:sticky lg:top-4 lg:self-start" data-testid="proposal-nav">
          <nav className="grid grid-cols-2 gap-2 lg:grid-cols-1">
            {NAV.map(([key, label]) => (
              <button
                key={key}
                type="button"
                data-testid={`proposal-nav-${key}`}
                onClick={() => setActive(key)}
                className={`rounded-lg px-3 py-2 text-left text-sm font-bold ${
                  active === key ? "bg-blue-600 text-white" : "bg-slate-50 text-slate-700 hover:bg-slate-100"
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 space-y-4">
          <Section id="overview" active={active === "overview"} title="Overview">
            <div className="flex flex-wrap items-center gap-3">
              <span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusTone(proposal.status)}`} data-testid="proposal-status">
                {proposal.status_label}
              </span>
              <select
                data-testid="proposal-status-select"
                value={draft.status}
                onChange={(event) => patchDraft("status", event.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
              >
                <option value="draft">Draft</option>
                <option value="site_visit">Site Visit</option>
                <option value="in_progress">Proposal In Progress</option>
                <option value="ready">Proposal Ready</option>
                <option value="sent">Proposal Sent</option>
                <option value="viewed">Viewed</option>
                <option value="accepted">Accepted</option>
                <option value="declined">Declined</option>
                <option value="revision_requested">Revision Requested</option>
                <option value="expired">Expired</option>
                <option value="converted">Converted</option>
              </select>
              <button
                type="button"
                data-testid="proposal-save-status"
                onClick={() => saveProposal({ status: draft.status }, "Status updated.")}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-bold text-white disabled:opacity-60"
              >
                <Save size={16} /> Save
              </button>
            </div>
            <div className="mt-4">
              <InfoGrid
                rows={[
                  ["Opportunity", `${proposal.source_type} #${proposal.source_id}`],
                  ["Customer", proposal.customer_name],
                  ["Appointment", proposal.appointment ? formatDateTime(proposal.appointment.scheduled_start) : "No appointment linked"],
                  ["Project summary", proposal.project_summary],
                  ["Current next action", proposal.status === "draft" ? "Capture site visit details." : "Continue proposal preparation."],
                ]}
              />
            </div>
          </Section>

          <Section id="appointment" active={active === "appointment"} title="Estimate Appointment">
            {proposal.appointment ? (
              <InfoGrid
                rows={[
                  ["Date and time", formatDateTime(proposal.appointment.scheduled_start)],
                  ["Type", proposal.appointment.appointment_type_label],
                  ["Status", proposal.appointment.status],
                  ["Requested by", proposal.appointment.requested_by],
                  ["Timezone", proposal.appointment.timezone],
                  ["Notes", proposal.appointment.notes],
                ]}
              />
            ) : (
              <div className="rounded-lg bg-slate-50 p-4 text-sm font-semibold text-slate-600 ring-1 ring-slate-200">
                No estimate appointment is linked yet.
              </div>
            )}
          </Section>

          <Section id="customer" active={active === "customer"} title="Customer">
            <InfoGrid
              rows={[
                ["Customer", proposal.customer_name],
                ["Phone", proposal.customer_phone],
                ["Email", proposal.customer_email],
                ["Address", proposal.service_location],
                ["Preferred contact", draft.customer_preferred_contact || "Not set"],
              ]}
            />
            <div className="mt-4 flex flex-wrap gap-2" data-testid="proposal-customer-actions">
              <a className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold ${telHref ? "bg-slate-900 text-white" : "pointer-events-none bg-slate-100 text-slate-400"}`} href={telHref || "#"}><Phone size={16} /> Call</a>
              <a className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold ${emailHref ? "bg-blue-600 text-white" : "pointer-events-none bg-slate-100 text-slate-400"}`} href={emailHref || "#"}><Mail size={16} /> Email</a>
              <a className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold ${smsHref ? "bg-emerald-600 text-white" : "pointer-events-none bg-slate-100 text-slate-400"}`} href={smsHref || "#"}>Text</a>
              <button
                type="button"
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700"
                onClick={() => {
                  navigator.clipboard?.writeText(`${proposal.customer_name}\n${proposal.customer_email}\n${proposal.customer_phone}\n${proposal.service_location}`);
                  toast.success("Customer details copied.");
                }}
              >
                Copy
              </button>
            </div>
          </Section>

          <Section id="site" active={active === "site"} title="Site Visit">
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5" data-testid="proposal-mobile-capture-actions">
              <button type="button" onClick={() => setActive("photos")} className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-sm font-bold text-blue-800"><Camera size={16} /> Take Photo</button>
              <button type="button" onClick={() => setActive("measurements")} className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800"><Ruler size={16} /> Add Measurement</button>
              <button type="button" onClick={() => patchDraft("site_visit_notes", `${draft.site_visit_notes || ""}${draft.site_visit_notes ? "\n" : ""}`)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm font-bold text-amber-800"><StickyNote size={16} /> Quick Note</button>
              <button type="button" disabled className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-bold text-slate-400">Voice Note</button>
              <button type="button" onClick={() => setActive("documents")} className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700"><FileUp size={16} /> Attach File</button>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <TextAreaField label="General notes" testId="proposal-site-notes" value={draft.site_visit_notes} onChange={(value) => patchDraft("site_visit_notes", value)} />
              <TextAreaField label="Access notes" value={draft.access_notes} onChange={(value) => patchDraft("access_notes", value)} />
              <TextAreaField label="Risk notes" value={draft.risk_notes} onChange={(value) => patchDraft("risk_notes", value)} />
              <TextAreaField label="Customer requests" value={draft.customer_requests} onChange={(value) => patchDraft("customer_requests", value)} />
              <TextAreaField label="Conditions" value={draft.site_conditions} onChange={(value) => patchDraft("site_conditions", value)} />
            </div>
            <button
              type="button"
              data-testid="proposal-save-site-visit"
              onClick={() => saveProposal({
                site_visit_notes: draft.site_visit_notes,
                access_notes: draft.access_notes,
                risk_notes: draft.risk_notes,
                customer_requests: draft.customer_requests,
                site_conditions: draft.site_conditions,
              }, "Site visit saved.")}
              disabled={saving}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
            >
              <Save size={16} /> Save Site Visit
            </button>
          </Section>

          <Section id="measurements" active={active === "measurements"} title="Measurements">
            <form onSubmit={addMeasurement} className="grid gap-3 rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200 md:grid-cols-5" data-testid="proposal-measurement-form">
              {["label", "location", "quantity", "unit"].map((key) => (
                <input
                  key={key}
                  data-testid={`proposal-measurement-${key}`}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder={key === "quantity" ? "Quantity" : key.charAt(0).toUpperCase() + key.slice(1)}
                  value={measurementForm[key]}
                  onChange={(event) => setMeasurementForm((prev) => ({ ...prev, [key]: event.target.value }))}
                />
              ))}
              <button type="submit" className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white">
                <Plus size={16} /> Add
              </button>
              <textarea
                className="md:col-span-5 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Notes"
                value={measurementForm.notes}
                onChange={(event) => setMeasurementForm((prev) => ({ ...prev, notes: event.target.value }))}
              />
            </form>
            <div className="mt-4 space-y-2" data-testid="proposal-measurement-list">
              {(proposal.measurements || []).length ? proposal.measurements.map((item) => (
                <div key={item.id} className="flex flex-col gap-2 rounded-lg bg-white p-3 ring-1 ring-slate-200 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="font-bold text-slate-900">{item.label}</div>
                    <div className="text-sm text-slate-600">{field(item.location)} - {item.quantity} {item.unit}</div>
                    {item.notes ? <div className="text-sm text-slate-500">{item.notes}</div> : null}
                  </div>
                  <button type="button" onClick={() => deleteMeasurement(item.id)} className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-3 py-2 text-sm font-bold text-rose-700">
                    <Trash2 size={15} /> Remove
                  </button>
                </div>
              )) : (
                <div className="rounded-lg bg-slate-50 p-4 text-sm font-semibold text-slate-600 ring-1 ring-slate-200">No measurements yet.</div>
              )}
            </div>
          </Section>

          <Section id="photos" active={active === "photos"} title="Photos">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white">
              <Camera size={16} /> {uploading ? "Uploading..." : "Upload Photo"}
              <input type="file" accept="image/*" className="hidden" data-testid="proposal-photo-upload" onChange={(event) => uploadAttachment(event, "photo")} />
            </label>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="proposal-photo-gallery">
              {photos.length ? photos.map((item) => (
                <div key={item.id} className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
                  {item.url ? <img src={item.url} alt={item.caption || item.original_name || "Proposal photo"} className="h-40 w-full rounded-md object-cover" /> : null}
                  <div className="mt-2 text-sm font-bold text-slate-900">{item.caption || item.original_name || "Photo"}</div>
                  <button type="button" onClick={() => deleteAttachment(item.id)} className="mt-2 text-sm font-bold text-rose-700">Remove</button>
                </div>
              )) : <div className="rounded-lg bg-slate-50 p-4 text-sm font-semibold text-slate-600 ring-1 ring-slate-200">No photos uploaded yet.</div>}
            </div>
          </Section>

          <Section id="documents" active={active === "documents"} title="Documents">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white">
              <FileUp size={16} /> {uploading ? "Uploading..." : "Upload Document"}
              <input type="file" className="hidden" data-testid="proposal-document-upload" onChange={(event) => uploadAttachment(event, "document")} />
            </label>
            <div className="mt-4 space-y-2" data-testid="proposal-document-list">
              {documents.length ? documents.map((item) => (
                <div key={item.id} className="flex items-center justify-between rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
                  <a href={item.url || "#"} className="font-bold text-blue-700" target="_blank" rel="noreferrer">{item.original_name || "Document"}</a>
                  <button type="button" onClick={() => deleteAttachment(item.id)} className="text-sm font-bold text-rose-700">Remove</button>
                </div>
              )) : <div className="rounded-lg bg-slate-50 p-4 text-sm font-semibold text-slate-600 ring-1 ring-slate-200">No documents uploaded yet.</div>}
            </div>
          </Section>

          <Section id="estimate" active={active === "estimate"} title="Estimate Builder">
            <div className="rounded-lg bg-blue-50 p-3 text-sm font-semibold text-blue-900 ring-1 ring-blue-100">
              Proposal pricing stays here until a later conversion phase. No agreements, payments, assignments, PDFs, or customer sends are created from this builder.
            </div>
            <form onSubmit={submitLineItem} className="mt-4 grid gap-3 rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200 md:grid-cols-6" data-testid="proposal-line-item-form">
              <select
                data-testid="proposal-line-category"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold md:col-span-2"
                value={lineItemForm.category}
                onChange={(event) => patchLineItemForm("category", event.target.value)}
              >
                {LINE_ITEM_CATEGORIES.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <input
                data-testid="proposal-line-description"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-4"
                placeholder="Description"
                value={lineItemForm.description}
                onChange={(event) => patchLineItemForm("description", event.target.value)}
              />
              <input
                data-testid="proposal-line-quantity"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Qty"
                value={lineItemForm.quantity}
                onChange={(event) => patchLineItemForm("quantity", event.target.value)}
              />
              <input
                data-testid="proposal-line-unit"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Unit"
                value={lineItemForm.unit}
                onChange={(event) => patchLineItemForm("unit", event.target.value)}
              />
              <input
                data-testid="proposal-line-unit-price"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Unit price"
                value={lineItemForm.unit_price}
                onChange={(event) => patchLineItemForm("unit_price", event.target.value)}
              />
              <input
                data-testid="proposal-line-notes"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
                placeholder="Notes"
                value={lineItemForm.notes}
                onChange={(event) => patchLineItemForm("notes", event.target.value)}
              />
              <div className="flex gap-2">
                <button type="submit" className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white">
                  <Plus size={16} /> {editingLineItemId ? "Update" : "Add"}
                </button>
                {editingLineItemId ? (
                  <button type="button" onClick={resetLineItemForm} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700">
                    Cancel
                  </button>
                ) : null}
              </div>
            </form>

            <div className="mt-4 overflow-hidden rounded-lg ring-1 ring-slate-200" data-testid="proposal-line-item-list">
              {(proposal.line_items || []).length ? (
                <div className="divide-y divide-slate-200">
                  {(proposal.line_items || []).map((item) => (
                    <div key={item.id} className="grid gap-3 bg-white p-3 md:grid-cols-[minmax(0,1fr)_120px_120px_120px_auto] md:items-center">
                      <div className="min-w-0">
                        <div className="text-xs font-black uppercase tracking-wide text-slate-500">{item.category_label}</div>
                        <div className="font-bold text-slate-950">{item.description}</div>
                        {item.notes ? <div className="text-sm text-slate-500">{item.notes}</div> : null}
                      </div>
                      <div className="text-sm font-semibold text-slate-700">{item.quantity} {item.unit}</div>
                      <div className="text-sm font-semibold text-slate-700">{money(item.unit_price)}</div>
                      <div className="text-base font-black text-slate-950">{money(item.total)}</div>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => editLineItem(item)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700">Edit</button>
                        <button type="button" onClick={() => deleteLineItem(item.id)} className="rounded-lg border border-rose-200 px-3 py-2 text-sm font-bold text-rose-700">Remove</button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-slate-50 p-4 text-sm font-semibold text-slate-600">No estimate line items yet.</div>
              )}
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="proposal-estimate-totals">
              {[
                ["Subtotal", totals.subtotal],
                ["Tax", totals.tax],
                ["Discounts", totals.discounts],
                ["Incidentals Reserve", totals.incidentals_reserve],
                ["Total", totals.total],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg bg-slate-950 px-3 py-3 text-white">
                  <div className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</div>
                  <div className="mt-1 text-lg font-black">{money(value)}</div>
                </div>
              ))}
            </div>
          </Section>

          <Section id="scope" active={active === "scope"} title="Scope">
            <div className="grid gap-4 md:grid-cols-2">
              <TextAreaField label="Included work" testId="proposal-included-work" value={draft.included_work} onChange={(value) => patchDraft("included_work", value)} />
              <TextAreaField label="Excluded work" value={draft.excluded_work} onChange={(value) => patchDraft("excluded_work", value)} />
              <TextAreaField label="Assumptions" value={draft.assumptions} onChange={(value) => patchDraft("assumptions", value)} />
              <TextAreaField label="Allowances" value={draft.allowances} onChange={(value) => patchDraft("allowances", value)} />
            </div>
            <button
              type="button"
              data-testid="proposal-save-scope"
              onClick={() => saveProposal({
                included_work: draft.included_work,
                excluded_work: draft.excluded_work,
                assumptions: draft.assumptions,
                allowances: draft.allowances,
              }, "Scope saved.")}
              disabled={saving}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
            >
              <Save size={16} /> Save Scope
            </button>
          </Section>

          <Section id="notes" active={active === "notes"} title="Internal Notes">
            <TextAreaField label="Contractor notes" testId="proposal-internal-notes" value={draft.internal_notes} onChange={(value) => patchDraft("internal_notes", value)} rows={8} />
            <button
              type="button"
              data-testid="proposal-save-notes"
              onClick={() => saveProposal({ internal_notes: draft.internal_notes }, "Notes saved.")}
              disabled={saving}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
            >
              <Save size={16} /> Save Notes
            </button>
          </Section>

          <Section id="history" active={active === "history"} title="History">
            <div className="space-y-2" data-testid="proposal-history">
              {(proposal.activity || []).length ? proposal.activity.map((item) => (
                <div key={item.id} className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
                  <div className="font-bold text-slate-900">{item.message}</div>
                  <div className="text-xs font-semibold text-slate-500">{formatDateTime(item.created_at)}</div>
                </div>
              )) : <div className="rounded-lg bg-slate-50 p-4 text-sm font-semibold text-slate-600 ring-1 ring-slate-200">No proposal history yet.</div>}
            </div>
          </Section>
        </main>

        <aside className="rounded-xl bg-slate-950 p-4 text-white shadow-sm lg:sticky lg:top-4 lg:self-start" data-testid="proposal-summary-rail">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Summary</div>
          <div className="mt-2 text-lg font-bold">{proposal.customer_name || "Customer"}</div>
          <div className="mt-1 text-sm text-slate-300">{proposal.service_location || "No service location"}</div>
          <div className="mt-4 rounded-lg bg-white/10 p-3">
            <div className="text-xs font-semibold uppercase text-slate-400">Next action</div>
            <div className="mt-1 text-sm font-bold">{proposal.status === "draft" ? "Capture site visit details" : "Continue proposal preparation"}</div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-white/10 p-2"><div className="text-lg font-bold">{proposal.measurements?.length || 0}</div><div className="text-xs text-slate-300">Measures</div></div>
            <div className="rounded-lg bg-white/10 p-2"><div className="text-lg font-bold">{photos.length}</div><div className="text-xs text-slate-300">Photos</div></div>
            <div className="rounded-lg bg-white/10 p-2"><div className="text-lg font-bold">{documents.length}</div><div className="text-xs text-slate-300">Docs</div></div>
          </div>
          <div className="mt-4 rounded-lg bg-white/10 p-3" data-testid="proposal-summary-totals">
            <div className="text-xs font-semibold uppercase text-slate-400">Proposal Total</div>
            <div className="mt-1 text-2xl font-black">{money(totals.total)}</div>
            <div className="mt-3 space-y-1 text-sm text-slate-300">
              <div className="flex justify-between gap-3"><span>Subtotal</span><span className="font-bold text-white">{money(totals.subtotal)}</span></div>
              <div className="flex justify-between gap-3"><span>Tax</span><span className="font-bold text-white">{money(totals.tax)}</span></div>
              <div className="flex justify-between gap-3"><span>Incidentals</span><span className="font-bold text-white">{money(totals.incidentals_reserve)}</span></div>
              <div className="flex justify-between gap-3"><span>Discounts</span><span className="font-bold text-white">-{money(totals.discounts)}</span></div>
            </div>
          </div>
          <button
            type="button"
            data-testid="proposal-summary-create-agreement"
            onClick={createAgreementFromProposal}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-black text-slate-950 hover:bg-slate-100"
          >
            <FileSignature size={16} /> Create Agreement
          </button>
          <div className="mt-2 text-xs leading-5 text-slate-400">
            Opens the existing Agreement Wizard with this proposal as editable draft input.
          </div>
        </aside>
      </div>
    </ContractorPageSurface>
  );
}
