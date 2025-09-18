// src/components/DisputesCreateModal.jsx
import React, { useEffect, useState } from "react";
import api from "../api";
import { toast } from "react-hot-toast";

/**
 * DisputesCreateModal
 * - Step 1: pick Agreement (+ optional Milestone)
 * - Step 2: reason/description
 * - Step 3: confirm fee & pay (freezes escrow)
 * - Step 4: upload evidence (agreements, milestone docs, photos, receipts)
 */
export default function DisputesCreateModal({ open, onClose }) {
  const [step, setStep] = useState(1);
  const [agreements, setAgreements] = useState([]);
  const [milestones, setMilestones] = useState([]);
  const [agreementId, setAgreementId] = useState("");
  const [milestoneId, setMilestoneId] = useState("");
  const [reason, setReason] = useState("");
  const [description, setDescription] = useState("");
  const [created, setCreated] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(1); setAgreementId(""); setMilestoneId("");
    setReason(""); setDescription(""); setCreated(null);

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
      if (!agId) { setMilestones([]); return; }
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
      };
      const { data } = await api.post("/projects/disputes/", payload);
      setCreated(data);
      toast.success("Dispute created.");
      setStep(3);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not create dispute.");
    } finally {
      setBusy(false);
    }
  };

  const payFee = async () => {
    if (!created?.id) return;
    setBusy(true);
    try {
      await api.post(`/projects/disputes/${created.id}/pay_fee/`);
      toast.success("Fee paid — escrow frozen.");
      setStep(4);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Payment failed.");
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
      await api.post(`/projects/disputes/${created.id}/attachments/`, form);
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
          <h2>
            {step === 1 && "Start a Dispute — Select Agreement"}
            {step === 2 && "Describe the Dispute"}
            {step === 3 && "Dispute Fee"}
            {step === 4 && "Upload Evidence"}
          </h2>
          <button className="mhb-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="mhb-modal-body" style={{ display: "grid", gap: 12 }}>
          {step === 1 && (
            <>
              <div>
                <label className="block text-sm text-slate-600 mb-1">Agreement</label>
                <select
                  className="w-full border rounded px-3 py-2"
                  value={agreementId}
                  onChange={(e) => { setAgreementId(e.target.value); loadMilestones(e.target.value); }}
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
                <label className="block text-sm text-slate-600 mb-1">Milestone (optional)</label>
                <select
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
            </>
          )}

          {step === 2 && (
            <>
              <div>
                <label className="block text-sm text-slate-600 mb-1">Reason</label>
                <input
                  className="w-full border rounded px-3 py-2"
                  placeholder="e.g., Work not approved / quality dispute / scope issue"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm text-slate-600 mb-1">Details</label>
                <textarea
                  className="w-full border rounded px-3 py-2"
                  rows={5}
                  placeholder="Provide as much detail as possible…"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="flex justify-between">
                <button className="mhb-btn" onClick={() => setStep(1)}>Back</button>
                <button className="mhb-btn primary" disabled={!reason.trim() || busy} onClick={createDispute}>
                  {busy ? "Submitting…" : "Submit Dispute"}
                </button>
              </div>
            </>
          )}

          {step === 3 && created && (
            <>
              <div className="text-slate-700">
                Dispute <strong>#{created.id}</strong> created. A fee of{" "}
                <strong>{money(created.fee_amount || 0)}</strong> is required to proceed and freeze escrow.
              </div>
              <div className="flex justify-end">
                <button className="mhb-btn primary" onClick={payFee} disabled={busy}>
                  {busy ? "Processing…" : "Pay Fee & Freeze Escrow"}
                </button>
              </div>
            </>
          )}

          {step === 4 && created && (
            <>
              <div className="text-slate-700">
                Escrow is now <strong>frozen</strong>. Upload supporting evidence (agreements, milestone docs, photos, receipts).
              </div>
              <div className="grid md:grid-cols-2 gap-8">
                {["agreement", "milestone", "photo", "receipt"].map((k) => (
                  <div key={k} className="mhb-glass" style={{ padding: 12 }}>
                    <div className="font-bold mb-1 capitalize">{k} upload</div>
                    <input type="file" onChange={(e) => uploadFile(k, e.target.files?.[0])} />
                  </div>
                ))}
              </div>
              <div className="flex justify-between mt-2">
                <button className="mhb-btn" onClick={() => setStep(2)}>Back</button>
                <button className="mhb-btn primary" onClick={onClose}>Done</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
