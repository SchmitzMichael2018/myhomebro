// src/pages/AgreementDetail.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../api";
import SignatureModal from "../components/SignatureModal";
import EscrowPromptModal from "../components/EscrowPromptModal";
import AttachmentManager from "../components/AttachmentManager";
import { useAuth } from "../context/AuthContext";

const toMoney = (v) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
};

function normalizeAgreement(raw) {
  if (!raw || typeof raw !== "object") return { id: null, title: "—", invoices: [], milestones: [] };
  return {
    id: raw.id ?? null,
    title: raw.title || raw.project_title || raw.project?.title || "—",
    homeownerName: raw.homeowner_name || raw.homeowner?.full_name || "—",
    homeownerEmail: raw.homeowner_email || raw.homeowner?.email || "—",
    totalCost: toMoney(raw.total_cost ?? raw.project?.total_cost ?? 0),
    isSigned:
      !!raw.is_fully_signed ||
      (!!raw.signed_by_contractor && !!raw.signed_by_homeowner),
    escrowFunded: !!raw.escrow_funded,
    invoices: raw.invoices || raw.invoice_set || [],
    milestones: raw.milestones || raw.milestone_set || [],
    raw,
  };
}

export default function AgreementDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [agreement, setAgreement] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sigOpen, setSigOpen] = useState(false);
  const [escrowOpen, setEscrowOpen] = useState(false);
  const [clientSecret, setClientSecret] = useState("");

  const norm = useMemo(() => normalizeAgreement(agreement), [agreement]);

  const isContractor =
    user?.role === "contractor" || user?.is_contractor;

  const signingRole = isContractor ? "contractor" : "homeowner";

  const fetchAgreement = async () => {
    try {
      setLoading(true);
      const { data } = await api.get(`/projects/agreements/${id}/`);
      setAgreement(data);
    } catch (e) {
      console.error(e);
      toast.error("Failed to load agreement.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAgreement();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleSigned = async () => {
    await fetchAgreement();
  };

  const startEscrow = async () => {
    try {
      const { data } = await api.post(`/projects/agreements/${id}/fund_escrow/`);
      if (data?.client_secret) {
        setClientSecret(data.client_secret);
        setEscrowOpen(true);
      } else {
        toast.error("Escrow initiation failed.");
      }
    } catch {
      toast.error("Could not start escrow.");
    }
  };

  const downloadPDF = async () => {
    try {
      const token = localStorage.getItem("access");
      const res = await fetch(`/api/projects/agreements/${id}/pdf/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `agreement_${id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      toast.error("PDF download failed.");
    }
  };

  if (loading) return <div className="p-6">Loading…</div>;
  if (!norm.id) return <div className="p-6">Agreement not found.</div>;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <button onClick={() => navigate("/agreements")} className="text-blue-600 hover:underline">
        ← Back
      </button>

      <div className="bg-blue-50 border-l-4 border-blue-600 p-4 rounded shadow-sm">
        <h2 className="text-2xl font-bold mb-1">{norm.title}</h2>
        <p>
          <strong>Homeowner:</strong> {norm.homeownerName}{" "}
          <span className="text-gray-500">({norm.homeownerEmail})</span>
        </p>
        <p><strong>Total Cost:</strong> ${norm.totalCost.toFixed(2)}</p>
        <p>
          <strong>Status:</strong>{" "}
          {norm.escrowFunded ? "✅ Escrow Funded" : norm.isSigned ? "❌ Awaiting Funding" : "❌ Not Signed"}
        </p>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        {!norm.isSigned && (
          <button
            onClick={() => setSigOpen(true)}
            className="px-4 py-2 rounded bg-green-600 text-white hover:bg-green-700"
          >
            Open Signature
          </button>
        )}
        {norm.isSigned && !norm.escrowFunded && (
          <button
            onClick={startEscrow}
            className="px-4 py-2 rounded bg-yellow-500 text-white hover:bg-yellow-600"
          >
            Fund Escrow
          </button>
        )}
        <button
          onClick={downloadPDF}
          className="px-4 py-2 rounded bg-blue-700 text-white hover:bg-blue-800"
        >
          Download PDF
        </button>
      </div>

      {/* NEW: Attachments & Addenda */}
      <AttachmentManager agreementId={id} canEdit={isContractor} />

      {/* Milestones */}
      <div className="bg-white rounded shadow p-6">
        <h3 className="text-lg font-semibold mb-3">Milestones</h3>
        {(!norm.milestones || norm.milestones.length === 0) ? (
          <p className="text-gray-500">No milestones found.</p>
        ) : (
          <ul className="space-y-1">
            {norm.milestones.map((m) => (
              <li key={m.id} className="text-sm">
                • {m.title} — ${toMoney(m.amount).toFixed(2)} ({m.status})
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Invoices */}
      <div className="bg-white rounded shadow p-6">
        <h3 className="text-lg font-semibold mb-3">Invoices</h3>
        {(!norm.invoices || norm.invoices.length === 0) ? (
          <p className="text-gray-500">No invoices yet.</p>
        ) : (
          <ul className="space-y-1">
            {norm.invoices.map((inv) => (
              <li key={inv.id} className="text-sm">
                • #{inv.id} — ${toMoney(inv.amount).toFixed(2)} ({inv.status})
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Modals */}
      <SignatureModal
        isOpen={sigOpen}
        onClose={() => setSigOpen(false)}
        agreement={agreement}
        signingRole={signingRole}
        onSigned={handleSigned}
      />

      <EscrowPromptModal
        visible={escrowOpen}
        onClose={() => setEscrowOpen(false)}
        stripeClientSecret={clientSecret}
        onSuccess={() => {
          setEscrowOpen(false);
          fetchAgreement();
        }}
      />
    </div>
  );
}
