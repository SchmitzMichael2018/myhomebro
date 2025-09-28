// src/components/AgreementEdit.jsx
// v2025-09-27 — save Project title + Agreement fields; in-app PDF viewer; same UI

import React, { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import api from "../api";

import MilestoneEditModal from "./MilestoneEditModal";
import AttachmentSection from "./AttachmentSection";
import PdfPreviewModal from "./PdfPreviewModal";

// Align with the create wizard options (edit should feel identical).  See wizard.  :contentReference[oaicite:6]{index=6}
const PROJECT_TYPES = ["Remodel", "Repair", "Installation", "Painting", "Outdoor", "Inspection", "Custom", "DIY Help"];
const PROJECT_SUBTYPES = [
  "Interior","Exterior","Roofing","Flooring","Electrical","Plumbing","HVAC","Windows/Doors","Drywall","Insulation",
  "Carpentry","Masonry","Concrete","Landscaping","Kitchen","Bathroom","Garage","Fence/Deck/Patio","Lighting",
  "Appliances","Waterproofing","Siding","Solar","Pool/Spa","Gutter","Whole-Home","Other",
];

const isLockedAgreementState = (s) => {
  if (!s) return false;
  const up = String(s).trim().toUpperCase();
  return ["SIGNED","EXECUTED","ACTIVE","APPROVED","ARCHIVED"].includes(up);
};
const pick = (...vals) => vals.find(v => v !== undefined && v !== null && v !== "") ?? "";
const money = (n) => `$${Number(n || 0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const getStatus = (m) => (pick(m.status_label, m.status, m.state, m.phase) || "").toLowerCase();
const getIsLate = (m) => !!pick(m.is_late, m.late, m.overdue);

const API = {
  agreementDetail: (id) => `/projects/agreements/${id}/`,
  agreementMs:     (id) => `/projects/agreements/${id}/milestones/`,
  agreementPatch:  (id) => `/projects/agreements/${id}/`,
  // ⬇️ patch the linked Project so the list reflects the new title
  projectPatch:    (id) => `/projects/projects/${id}/`,
  milestoneDelete: (id) => `/projects/milestones/${id}/`,
  milestoneComplete:(id)=> `/projects/milestones/${id}/complete/`,
  previewPdf:      (id) => `/projects/agreements/${id}/preview_pdf/`,
  signContractor:  (id) => `/projects/agreements/${id}/sign_contractor/`,
  dispatch:        (id) => `/projects/agreements/${id}/dispatch/`,
  createAmendment: (id) => `/projects/agreements/${id}/amendments/`,
};

// Open PDFs in the in-app, frame-exempt viewer route (not the static viewer file).  :contentReference[oaicite:7]{index=7}
const VIEW_TOS     = `/pdf/viewer/?file=${encodeURIComponent("/static/legal/terms_of_service.pdf")}`;
const VIEW_PRIVACY = `/pdf/viewer/?file=${encodeURIComponent("/static/legal/privacy_policy.pdf")}`;

export default function AgreementEdit() {
  const [agreement, setAgreement] = useState(null);
  const [milestones, setMilestones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeMs, setActiveMs] = useState(null);

  const [form, setForm] = useState({
    title: "",
    project_type: "",
    project_subtype: "",
    description: "",
    warranty_type: "DEFAULT",
    warranty_text_snapshot: "",
  });

  // PDF modal
  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdfUrl, setPdfUrl] = useState("");

  // Sign/dispatch
  const [tosAck, setTosAck] = useState(false);
  const [privacyAck, setPrivacyAck] = useState(false);
  const [esignAck, setEsignAck] = useState(false);
  const [signatureFile, setSignatureFile] = useState(null);
  const [signing, setSigning] = useState(false);
  const [sendEmail, setSendEmail] = useState(true);
  const [sendSms, setSendSms] = useState(true);
  const [message, setMessage] = useState("Hi! Please review and sign the agreement. Thank you.");
  const [dispatching, setDispatching] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  // /agreements/:id/edit
  const agreementId = useMemo(() => {
    const parts = window.location.pathname.split("/").filter(Boolean);
    const idx = parts.findIndex((p) => p === "agreements");
    return idx !== -1 ? parts[idx + 1] : null;
  }, []);

  const readOnly = useMemo(() => isLockedAgreementState(agreement?.state || agreement?.status), [agreement]);

  const typeOptions = useMemo(() => {
    const base = PROJECT_TYPES.slice();
    const cur = form.project_type?.trim();
    return cur && !base.includes(cur) ? [cur, ...base] : base;
  }, [form.project_type]);

  const subtypeOptions = useMemo(() => {
    const base = PROJECT_SUBTYPES.slice();
    const cur = form.project_subtype?.trim();
    return cur && !base.includes(cur) ? [cur, ...base] : base;
  }, [form.project_subtype]);

  const load = useCallback(async () => {
    if (!agreementId) return;
    setLoading(true);
    try {
      const [{ data: a }, { data: ms }] = await Promise.all([
        api.get(API.agreementDetail(agreementId)),
        api.get(API.agreementMs(agreementId)),
      ]);
      setAgreement(a || null);
      setForm({
        title: a?.title || a?.project_title || "",   // wizard used projectName → project.title  :contentReference[oaicite:8]{index=8}
        project_type: a?.project_type || "",
        project_subtype: a?.project_subtype || "",
        description: a?.description || a?.job_description || "",
        warranty_type: (a?.warranty_type || (a?.use_default_warranty ? "DEFAULT" : "CUSTOM") || "DEFAULT").toUpperCase(),
        warranty_text_snapshot: a?.warranty_text_snapshot || a?.custom_warranty_text || "",
      });
      setMilestones(Array.isArray(ms) ? ms : []);
      setSendEmail(Boolean(a?.homeowner_email));
      setSendSms(Boolean(a?.homeowner_phone));
    } catch (e) {
      console.error(e);
      toast.error("Failed to load agreement.");
    } finally {
      setLoading(false);
    }
  }, [agreementId]);

  useEffect(() => { load(); }, [load]);

  const onChange        = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  const onTypeChange    = (e) => setForm((f) => ({ ...f, project_type: e.target.value }));
  const onSubtypeChange = (e) => setForm((f) => ({ ...f, project_subtype: e.target.value }));

  /** Save both Agreement and Project title so the list reflects the change */
  const saveAgreement = async () => {
    if (!agreement?.id) return;
    try {
      // 1) PATCH the Agreement (type/subtype/description/warranty)
      const agPatch = {
        project_type: form.project_type || null,
        project_subtype: form.project_subtype || null,
        description: form.description || "",
        use_default_warranty: form.warranty_type !== "CUSTOM",
        custom_warranty_text: form.warranty_type === "CUSTOM" ? (form.warranty_text_snapshot || "") : "",
        // keep a copy of title on agreement in case your serializer stores it there too
        title: form.title || "",
        project_title: form.title || "",
      };
      await api.patch(API.agreementPatch(agreement.id), agPatch);

      // 2) PATCH the linked Project’s title (wizard created it there).  :contentReference[oaicite:9]{index=9}
      const projectId = agreement?.project;
      if (projectId) {
        await api.patch(API.projectPatch(projectId), { title: form.title || "" });
      }

      toast.success("Agreement saved.");
      await load();
    } catch (e) {
      console.error(e);
      const data = e?.response?.data;
      if (data && typeof data === "object") {
        const k = Object.keys(data)[0];
        const d = Array.isArray(data[k]) ? data[k][0] : data[k] || data.detail;
        toast.error(`Save failed: ${k} — ${String(d)}`);
      } else {
        toast.error("Failed to save agreement.");
      }
    }
  };

  const openMsEdit = (m) => {
    setActiveMs({
      ...m,
      agreement_state: agreement?.state || agreement?.status,
      agreement_status: agreement?.status || agreement?.state,
      agreement_number: agreement?.number || agreement?.id,
      escrow_funded: !!agreement?.escrow_funded,
      escrowFunded: !!agreement?.escrow_funded,
    });
  };

  const removeMilestone = async (m) => {
    if (readOnly) { toast("Delete is only available while the agreement is in Draft."); return; }
    if (!window.confirm(`Delete milestone "${m.title}"?`)) return;
    try {
      await api.delete(API.milestoneDelete(m.id));
      toast.success("Milestone deleted.");
      await load();
    } catch (e) {
      console.error(e);
      toast.error("Failed to delete milestone.");
    }
  };

  const canComplete = useMemo(() =>
    !!(agreement && (agreement.status || agreement.state)) &&
    !!agreement?.escrow_funded &&
    ["SIGNED","EXECUTED","ACTIVE","APPROVED"].includes(
      String(agreement.status || agreement.state).toUpperCase()
    ), [agreement]);

  const markComplete = async (id) => {
    if (!canComplete) {
      if (!agreement?.escrow_funded) toast("You can’t complete a milestone until escrow is funded.");
      else toast("Agreement must be signed/executed before completing milestones.");
      return;
    }
    try {
      await api.post(API.milestoneComplete(id)).catch(() =>
        api.patch(`/projects/milestones/${id}/`, { status: "Complete" })
      );
      toast.success("Milestone marked complete → submitted for review");
      await load();
    } catch (e) {
      console.error(e);
      toast.error("Could not mark complete.");
    }
  };

  /** In-app PDF viewer (frame-exempt) */
  const previewPdf = async () => {
    setPreviewing(true);
    try {
      const { data } = await api.post(API.previewPdf(agreement.id), {});
      const url = data?.pdf_url;
      if (url) {
        setPdfUrl(url);
        setPdfOpen(true);    // show PdfPreviewModal (uses /pdf/viewer/ under the hood)  :contentReference[oaicite:10]{index=10}
      } else {
        toast("PDF generated, but no URL returned.");
      }
    } catch (e) {
      console.error(e);
      toast.error("Failed to generate preview PDF.");
    } finally {
      setPreviewing(false);
    }
  };

  const signAsContractor = async () => {
    if (!tosAck || !privacyAck || !esignAck) {
      toast("Please acknowledge ToS, Privacy Policy, and the ESIGN Act.");
      return;
    }
    setSigning(true);
    try {
      const fd = new FormData();
      fd.append("tos_ack", String(tosAck));
      fd.append("privacy_ack", String(privacyAck));
      fd.append("esign_ack", String(esignAck));
      if (signatureFile) fd.append("signature_file", signatureFile);
      await api.post(API.signContractor(agreement.id), fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Signed as Contractor.");
      await load();
    } catch (e) {
      console.error(e);
      toast.error("Signing failed.");
    } finally {
      setSigning(false);
    }
  };

  const dispatchToHomeowner = async () => {
    if (!sendEmail && !sendSms) { toast("Choose at least one channel."); return; }
    setDispatching(true);
    try {
      await api.post(API.dispatch(agreement.id), { channels: { email: sendEmail, sms: sendSms }, message });
      toast.success("Sent to homeowner.");
    } catch (e) {
      console.error(e);
      toast.error("Could not send to homeowner.");
    } finally {
      setDispatching(false);
    }
  };

  const addAmendment = async () => {
    try {
      const { data } = await api.post(API.createAmendment(agreement.id), {});
      toast.success("Amendment started.");
      const amendId = data?.id || data?.amendment_id;
      if (amendId) window.location.href = `/agreements/${agreement.id}/amendments/${amendId}/edit`;
    } catch (e) {
      console.error(e);
      toast("Amendment endpoint not configured yet.");
    }
  };

  return (
    <div className="p-5">
      {loading ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : !agreement ? (
        <div className="text-sm text-gray-500">Agreement not found.</div>
      ) : (
        <>
          {/* Header */}
          <div className="mb-5 flex items-center justify-between">
            <div className="text-lg font-semibold">Edit Agreement #{agreement.number || agreement.id}</div>
            <div className="text-sm text-gray-500">Status: <strong className="uppercase">{agreement.state || agreement.status || "DRAFT"}</strong></div>
          </div>

          {/* Details */}
          <div className="rounded-xl border bg-white">
            <div className="border-b bg-gray-50 px-4 py-3 text-sm font-medium">Agreement Details</div>
            <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium text-gray-700">Agreement Title</label>
                <input
                  type="text" name="title" value={form.title} onChange={onChange} readOnly={readOnly}
                  className={`w-full rounded border px-3 py-2 text-sm ${readOnly ? "bg-gray-50 text-gray-600" : ""}`}
                  placeholder="Project Name (e.g., Kitchen Remodel)"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Project Type</label>
                <select
                  name="project_type" value={form.project_type} onChange={onTypeChange} disabled={readOnly}
                  className={`w-full rounded border px-3 py-2 text-sm ${readOnly ? "bg-gray-50 text-gray-600" : "bg-white"}`}
                >
                  <option value="">— Select Type —</option>
                  {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Project Subtype</label>
                <select
                  name="project_subtype" value={form.project_subtype} onChange={onSubtypeChange} disabled={readOnly}
                  className={`w-full rounded border px-3 py-2 text-sm ${readOnly ? "bg-gray-50 text-gray-600" : "bg-white"}`}
                >
                  <option value="">— Select Subtype —</option>
                  {subtypeOptions.map((st) => <option key={st} value={st}>{st}</option>)}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium text-gray-700">Description</label>
                <textarea
                  name="description" rows={4} value={form.description} onChange={onChange} readOnly={readOnly}
                  className={`w-full rounded border px-3 py-2 text-sm ${readOnly ? "bg-gray-50 text-gray-600" : ""}`}
                  placeholder="Scope of work, materials, exclusions, notes…"
                />
              </div>
            </div>
            {!readOnly && (
              <div className="flex justify-end gap-2 px-4 pb-4">
                <button onClick={saveAgreement} className="rounded bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700">Save Agreement</button>
              </div>
            )}
          </div>

          {/* Warranty */}
          <div className="mt-6 rounded-xl border bg-white">
            <div className="border-b bg-gray-50 px-4 py-3 text-sm font-medium">Warranty</div>
            <div className="p-4">
              <div className="mb-3 flex gap-6">
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="warranty_type" value="DEFAULT" checked={form.warranty_type === "DEFAULT"} onChange={onChange} disabled={readOnly}/> Use Default Warranty (read-only preview)
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="warranty_type" value="CUSTOM" checked={form.warranty_type === "CUSTOM"} onChange={onChange} disabled={readOnly}/> Custom Warranty Text
                </label>
              </div>

              {form.warranty_type === "DEFAULT" ? (
                <div className="rounded-md border bg-gray-50 p-3 text-sm text-gray-700">
                  {agreement?.default_warranty_text ||
                    "Contractor warrants workmanship for one (1) year from substantial completion. Manufacturer warranties apply where applicable. Warranty excludes damage caused by misuse, neglect, unauthorized modifications, or normal wear. Remedy is limited to repair or replacement at Contractor’s discretion."}
                </div>
              ) : (
                <textarea
                  name="warranty_text_snapshot" rows={5} value={form.warranty_text_snapshot} onChange={onChange} readOnly={readOnly}
                  className={`w-full rounded border px-3 py-2 text-sm ${readOnly ? "bg-gray-50 text-gray-600" : ""}`}
                  placeholder="Enter your custom warranty terms here…"
                />
              )}
            </div>
            {!readOnly && (
              <div className="flex justify-end gap-2 px-4 pb-4">
                <button onClick={saveAgreement} className="rounded bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700">
                  Save Warranty
                </button>
              </div>
            )}
          </div>

          {/* Attachments & Addenda */}
          <div className="mt-6 rounded-xl border bg-white">
            <div className="border-b bg-gray-50 px-4 py-3 text-sm font-medium">Attachments &amp; Addenda</div>
            <div className="p-4">
              <AttachmentSection agreementId={agreement.id} onChange={() => {}} />
            </div>
          </div>

          {/* Milestones */}
          <div className="mt-6 rounded-xl border bg-white">
            <div className="border-b bg-gray-50 px-4 py-3 text-sm font-medium">Milestones</div>
            <div className="p-4">
              <div className="overflow-hidden rounded-lg border">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr className="text-left text-xs uppercase text-gray-500">
                      <th className="px-4 py-3">Title</th>
                      <th className="px-4 py-3">Agreement #</th>
                      <th className="px-4 py-3">Project</th>
                      <th className="px-4 py-3">Customer</th>
                      <th className="px-4 py-3">Due / Date</th>
                      <th className="px-4 py-3 text-right">Amount</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {milestones.length ? milestones.map((m) => {
                      const due = pick(m.end_date, m.completion_date, m.start_date, m.scheduled_for, m.date, "—");
                      const rawStatus = getStatus(m) || "—";
                      const late = getIsLate(m);
                      return (
                        <tr key={m.id} className="odd:bg-white/50 even:bg-white/30 hover:bg-white">
                          <td className="px-4 py-3 font-medium">
                            <div className="flex items-center gap-2">
                              <span>{m.title}</span>
                              {late && <span className="px-2 py-0.5 rounded text-xs bg-red-100 text-red-700">late</span>}
                            </div>
                          </td>
                          <td className="px-4 py-3">#{agreement.number || agreement.id}</td>
                          <td className="px-4 py-3">{agreement.project_title || form.title || "—"}</td>
                          <td className="px-4 py-3">{agreement.homeowner_name || "—"}</td>
                          <td className="px-4 py-3">{due}</td>
                          <td className="px-4 py-3 text-right">{money(m.amount)}</td>
                          <td className="px-4 py-3"><span className="text-gray-700">{rawStatus}</span></td>
                          <td className="px-4 py-3">
                            <div className="flex gap-2">
                              <button type="button" disabled={!canComplete} onClick={() => markComplete(m.id)}
                                      className={`px-3 py-1.5 text-sm rounded-md border bg-transparent ${canComplete ? "border-gray-300 text-gray-700 hover:bg-gray-50" : "border-gray-200 text-gray-400 opacity-50 cursor-not-allowed"}`}>
                                ✓ Complete
                              </button>
                              {!readOnly ? (
                                <button type="button" onClick={() => openMsEdit(m)}
                                        className="px-3 py-1.5 text-sm rounded-md border bg-transparent border-blue-300 text-blue-700 hover:bg-blue-50">
                                  Edit
                                </button>
                              ) : <span className="text-sm text-gray-400">Edit (locked)</span>}
                              {!readOnly ? (
                                <button type="button" onClick={() => removeMilestone(m)}
                                        className="px-3 py-1.5 text-sm rounded-md border bg-transparent border-rose-300 text-rose-700 hover:bg-rose-50">
                                  Delete
                                </button>
                              ) : <span className="text-sm text-gray-400">Delete (locked)</span>}
                            </div>
                          </td>
                        </tr>
                      );
                    }) : (
                      <tr><td colSpan={8} className="px-4 py-6 text-center text-sm text-gray-500">No milestones.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Review & Sign */}
          <div className="mt-6 rounded-xl border bg-white">
            <div className="border-b bg-gray-50 px-4 py-3 text-sm font-medium">Review &amp; Sign</div>
            <div className="p-4 space-y-4">
              <div className="flex items-center gap-3">
                <button onClick={previewPdf} disabled={previewing} className="rounded bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:bg-gray-300">
                  {previewing ? "Generating PDF…" : "Generate Preview PDF"}
                </button>
                <a href={VIEW_TOS} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline">Open Terms of Service</a>
                <a href={VIEW_PRIVACY} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline">Open Privacy Policy</a>
                <button onClick={addAmendment} className="ml-auto rounded border border-amber-300 text-amber-700 px-3 py-2 text-sm hover:bg-amber-50">
                  + Add Amendment
                </button>
              </div>

              <div className="rounded-md border p-3">
                <div className="text-sm font-medium mb-2">Legal Acknowledgements</div>
                <label className="flex items-center gap-2 text-sm mb-1">
                  <input type="checkbox" checked={tosAck} onChange={(e)=>setTosAck(e.target.checked)} /> I have read and agree to the <a href={VIEW_TOS} target="_blank" rel="noopener" className="text-blue-600 hover:underline">Terms of Service</a>.
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={privacyAck} onChange={(e)=>setPrivacyAck(e.target.checked)} /> I have read the <a href={VIEW_PRIVACY} target="_blank" rel="noopener" className="text-blue-600 hover:underline">Privacy Policy</a>.
                </label>
              </div>

              <div className="rounded-md border p-3">
                <div className="text-sm font-medium mb-2">Electronic Signature</div>
                <label className="flex items-center gap-2 text-sm mb-2">
                  <input type="checkbox" checked={esignAck} onChange={(e)=>setEsignAck(e.target.checked)} /> I agree that my electronic signature has the same legal effect as a handwritten signature (U.S. ESIGN Act).
                </label>
                <div className="flex items-center gap-3">
                  <input type="file" accept="image/*,.png,.jpg,.jpeg,.pdf" onChange={(e)=>setSignatureFile(e.target.files?.[0] || null)} className="text-sm" />
                </div>
                <div className="mt-3">
                  <button onClick={signAsContractor} disabled={signing} className="rounded bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-black disabled:bg-gray-300">
                    {signing ? "Signing…" : "Sign as Contractor"}
                  </button>
                </div>
              </div>

              <div className="rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">Send to Homeowner</div>
                  <div className="text-xs text-gray-500">{agreement?.homeowner_name ? `Recipient: ${agreement.homeowner_name}` : ""}</div>
                </div>
                <div className="mt-2 flex items-center gap-6 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={sendEmail} onChange={(e)=>setSendEmail(e.target.checked)} disabled={!agreement?.homeowner_email} />
                    Email {agreement?.homeowner_email ? <span className="text-gray-500">({agreement.homeowner_email})</span> : <span className="text-gray-400">(no email)</span>}
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={sendSms} onChange={(e)=>setSendSms(e.target.checked)} disabled={!agreement?.homeowner_phone} />
                    Text {agreement?.homeowner_phone ? <span className="text-gray-500">({agreement.homeowner_phone})</span> : <span className="text-gray-400">(no phone)</span>}
                  </label>
                </div>
                <div className="mt-3">
                  <label className="mb-1 block text-xs text-gray-600">Message (optional)</label>
                  <textarea rows={2} value={message} onChange={(e)=>setMessage(e.target.value)} className="w-full rounded border px-3 py-2 text-sm" placeholder="Add a short note…" />
                </div>
                <div className="mt-3">
                  <button onClick={dispatchToHomeowner} disabled={dispatching} className="rounded border border-emerald-300 text-emerald-700 px-3 py-2 text-sm hover:bg-emerald-50 disabled:opacity-60">
                    {dispatching ? "Sending…" : "Send to Homeowner"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Modals */}
          <MilestoneEditModal
            open={!!activeMs}
            milestone={activeMs}
            onClose={() => setActiveMs(null)}
            onSaved={async () => { await load(); setActiveMs(null); toast.success("Milestone updated."); }}
            onMarkComplete={markComplete}
          />
          <PdfPreviewModal
            open={pdfOpen}
            onClose={() => setPdfOpen(false)}
            fileUrl={pdfUrl}
            title={`Agreement #${agreement.number || agreement.id} — Preview`}
          />
        </>
      )}
    </div>
  );
}
