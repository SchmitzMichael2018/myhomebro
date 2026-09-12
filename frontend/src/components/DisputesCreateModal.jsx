// src/components/DisputesCreateModal.jsx
import React, { useEffect, useState } from "react";
import api from "../api";
import { toast } from "react-hot-toast";

/**
 * DisputesCreateModal
 * - Step 1: pick Agreement (+ optional Milestone)
 * - Step 2: reason/description
 * - Step 3: upload evidence and review qualification status
 */
const money = (n) =>
  Number(n || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });

export default function DisputesCreateModal({ open, onClose }) {
  const [step, setStep] = useState(1);
  const [agreements, setAgreements] = useState([]);
  const [milestones, setMilestones] = useState([]);
  const [agreementId, setAgreementId] = useState("");
  const [milestoneId, setMilestoneId] = useState("");
  const [reason, setReason] = useState("");
  const [description, setDescription] = useState("");
  const [expectedResult, setExpectedResult] = useState("");
  const [requestedResolution, setRequestedResolution] = useState("");
  const [evidenceUnavailableReason, setEvidenceUnavailableReason] = useState("");
  const [created, setCreated] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;

    setStep(1);
    setAgreementId("");
    setMilestoneId("");
    setReason("");
    setDescription("");
    setExpectedResult("");
    setRequestedResolution("");
    setEvidenceUnavailableReason("");
    setCreated(null);

    (async () => {
      try {
        const { data } = await api.get("/projects/agreements/");
        const list = Array.isArray(data) ? data : data?.results || [];
        setAgreements(list);
      } catch {
        toast.error("Failed to load agreements.");
      }
    })();
  }, [open]);

  const loadMilestones = async (agId) => {
    try {
      if (!agId) {
        setMilestones([]);
        return;
      }
      const { data } = await api.get(`/projects/milestones/?agreement=${agId}`);
      const list = Array.isArray(data) ? data : data?.results || [];
      setMilestones(list);
    } catch {
      setMilestones([]);
    }
  };

  const createDispute = async () => {
    if (!agreementId || !reason.trim()) {
      toast.error("Pick an agreement and enter a reason.");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        agreement: Number(agreementId),
        milestone: milestoneId ? Number(milestoneId) : null,
        initiator: "contractor",
        reason: reason.trim(),
        description: description.trim(),
        expected_result: expectedResult.trim(),
        requested_resolution: requestedResolution.trim(),
        evidence_unavailable_reason: evidenceUnavailableReason.trim(),
      };
      const { data } = await api.post("/projects/disputes/", payload);
      setCreated(data);
      toast.success("Resolution case created.");
      setStep(3);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not create dispute.");
    } finally {
      setBusy(false);
    }
  };

  const uploadFile = async (kind, file) => {
    if (!created?.id || !file) return;
    const form = new FormData();
    form.append("file", file);
    form.append("kind", kind);
    try {
      // ✅ BACKEND ROUTE is /attachments (correct)
      await api.post(`/projects/disputes/${created.id}/attachments/`, form);
      const refreshed = await api.get(`/projects/disputes/${created.id}/`);
      setCreated(refreshed.data);
      toast.success("Uploaded.");
    } catch {
      toast.error("Upload failed.");
    }
  };

  if (!open) return null;

  return (
    <div className="mhb-modal-overlay" role="dialog" aria-modal="true">
      <div className="mhb-modal-card" style={{ width: "min(900px, 96vw)" }}>
        <div className="mhb-modal-header">
          <h2 data-testid="dispute-create-title">
            {step === 1 && "Start a Resolution Case - Select Agreement"}
            {step === 2 && "Describe the Resolution Case"}
            {step === 3 && "Evidence & Next Steps"}
          </h2>
          <button className="mhb-modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="mhb-modal-body" style={{ display: "grid", gap: 12 }}>
          {step === 1 && (
            <>
              <div>
                <label htmlFor="mhb-disputescreatemodal-137" className="block text-sm text-slate-600 mb-1">Agreement</label>
                <select id="mhb-disputescreatemodal-137"
                  data-testid="dispute-agreement-select"
                  className="w-full border rounded px-3 py-2"
                  value={agreementId}
                  onChange={(e) => {
                    setAgreementId(e.target.value);
                    loadMilestones(e.target.value);
                  }}
                >
                  <option value="">Select an agreement…</option>
                  {agreements.map((a) => (
                    <option key={a.id} value={a.id}>
                      #{a.id} — {a.project_title || a.title || "Agreement"}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="mhb-disputescreatemodal-157" className="block text-sm text-slate-600 mb-1">Milestone (optional)</label>
                <select id="mhb-disputescreatemodal-157"
                  className="w-full border rounded px-3 py-2"
                  value={milestoneId}
                  onChange={(e) => setMilestoneId(e.target.value)}
                  disabled={!milestones.length}
                >
                  <option value="">— none —</option>
                  {milestones.map((m) => (
                    <option key={m.id} value={m.id}>
                      #{m.order || m.id} — {m.title} ({money(m.amount)})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end">
                <button className="mhb-btn primary" disabled={!agreementId} onClick={() => setStep(2)}>
                  Continue
                </button>
              </div>
              <div>
                <label className="block text-sm text-slate-600 mb-1">What did the agreement or milestone require?</label>
                <textarea className="w-full border rounded px-3 py-2" rows={3} value={expectedResult} onChange={(e) => setExpectedResult(e.target.value)} placeholder="Describe the expected result or requirement." />
              </div>
              <div>
                <label className="block text-sm text-slate-600 mb-1">What correction or resolution is requested?</label>
                <textarea className="w-full border rounded px-3 py-2" rows={3} value={requestedResolution} onChange={(e) => setRequestedResolution(e.target.value)} placeholder="Inspection, correction, revised deadline, payment allocation, etc." />
              </div>
              <div>
                <label className="block text-sm text-slate-600 mb-1">If evidence is unavailable or not applicable, explain why</label>
                <textarea className="w-full border rounded px-3 py-2" rows={2} value={evidenceUnavailableReason} onChange={(e) => setEvidenceUnavailableReason(e.target.value)} placeholder="Photos are not always required—for example, for delays or missed appointments." />
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div>
                <label htmlFor="mhb-disputescreatemodal-184" className="block text-sm text-slate-600 mb-1">Reason</label>
                <input id="mhb-disputescreatemodal-184"
                  data-testid="dispute-reason-input"
                  className="w-full border rounded px-3 py-2"
                  placeholder="e.g., Work not approved / quality dispute / scope issue"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="mhb-disputescreatemodal-194" className="block text-sm text-slate-600 mb-1">Details</label>
                <textarea id="mhb-disputescreatemodal-194"
                  className="w-full border rounded px-3 py-2"
                  rows={5}
                  placeholder="Provide as much detail as possible…"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="flex justify-between">
                <button className="mhb-btn" onClick={() => setStep(1)}>
                  Back
                </button>
                <button
                  data-testid="dispute-submit-button"
                  className="mhb-btn primary"
                  disabled={!reason.trim() || busy}
                  onClick={createDispute}
                >
                  {busy ? "Submitting…" : "Submit Resolution Case"}
                </button>
              </div>
            </>
          )}

          {step === 3 && created && (
            <>
              <div className="text-slate-700">
                Resolution case <strong>#{created.id}</strong> was recorded with no filing fee. {created?.payment_hold?.status === "no_hold"
                  ? "This is a documentation-only case; MyHomeBro is not holding funds."
                  : "Only the identified payment source is on a temporary administrative hold while qualification is reviewed."}
              </div>
              {created?.missing_information?.length ? <div className="rounded border border-amber-300 bg-amber-50 p-3 text-amber-950"><strong>Information still needed</strong><ul className="mt-2 list-disc pl-5">{created.missing_information.map((item) => <li key={item}>{item}</li>)}</ul></div> : <div className="rounded border border-emerald-300 bg-emerald-50 p-3 text-emerald-950"><strong>Qualification information is complete.</strong> The contractor can now respond to the claims.</div>}
              <div className="text-sm text-slate-600">Upload information that helps explain the issue. Photos are helpful when relevant, but they are not universally required.</div>
              <div className="grid md:grid-cols-2 gap-8">
                {["agreement", "milestone", "photo", "receipt"].map((k) => (
                  <div key={k} className="mhb-glass" style={{ padding: 12 }}>
                    <div className="font-bold mb-1 capitalize">{k} upload</div>
                    <input type="file" onChange={(e) => uploadFile(k, e.target.files?.[0])} />
                  </div>
                ))}
              </div>
              <div className="flex justify-between mt-2">
                <button className="mhb-btn" onClick={() => setStep(2)}>
                  Back
                </button>
                <button className="mhb-btn primary" onClick={onClose}>
                  Done
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
