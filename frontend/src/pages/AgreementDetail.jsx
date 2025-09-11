// src/pages/AgreementDetail.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "../api";

// Optional (kept if you’re using these already)
import InvoiceModal from "../components/InvoiceModal";
import AgreementStatus from "../components/AgreementStatus";
import SignatureModal from "../components/SignatureModal";

// ✅ Self-wrapping modal — no <Elements> needed in this file
import EscrowPromptModal from "../components/EscrowPromptModal";

/* --------------------- helpers --------------------- */
const toMoney = (v) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
};

function parseHMS(hms) {
  // "HH:MM:SS" -> "HH:MM:SS"; safely handle missing/invalid
  if (!hms || typeof hms !== "string" || !/^\d{2}:\d{2}:\d{2}$/.test(hms)) {
    return "00:00:00";
  }
  return hms;
}

/** Normalize API agreement (supports both nested and flat serializers) */
function normalizeAgreement(raw) {
  if (!raw || typeof raw !== "object") {
    return {
      id: null,
      title: "Untitled Project",
      homeownerName: "—",
      homeownerEmail: "—",
      totalCost: 0,
      isSigned: false,
      escrowFunded: false,
      invoices: [],
      milestones: [],
      raw,
    };
  }

  const title =
    raw.project_title ||
    raw.title ||
    raw.project?.title ||
    "Untitled Project";

  const homeownerName =
    raw.homeowner_name ||
    raw.project?.homeowner?.full_name ||
    raw.homeowner?.full_name ||
    "—";

  const homeownerEmail =
    raw.homeowner_email ||
    raw.project?.homeowner?.email ||
    raw.homeowner?.email ||
    "—";

  const totalCost =
    toMoney(raw.total_cost) ||
    toMoney(raw.project?.total_cost) ||
    0;

  const isSigned =
    !!raw.is_fully_signed ||
    !!raw.project_signed ||
    (!!raw.signed_by_contractor && !!raw.signed_by_homeowner);

  const escrowFunded = !!raw.escrow_funded;

  const invoices = Array.isArray(raw.invoices)
    ? raw.invoices
    : Array.isArray(raw.milestone_invoices)
    ? raw.milestone_invoices
    : [];

  const milestonesRaw = Array.isArray(raw.milestones)
    ? raw.milestones
    : Array.isArray(raw.milestone_set)
    ? raw.milestone_set
    : [];

  const milestones = milestonesRaw.map((m, i) => {
    const amount = toMoney(m.amount);
    const start = m.start || m.start_date || null;
    const end = m.end || m.completion_date || null;
    const duration =
      m.duration_minutes != null
        ? `${String(Math.floor(m.duration_minutes / 60)).padStart(2, "0")}:${String(m.duration_minutes % 60).padStart(2, "0")}:00`
        : parseHMS(m.duration);
    return {
      id: m.id || i,
      title: m.title || "—",
      amount,
      start,
      end,
      duration,
      status: m.status || (m.completed ? "completed" : "pending"),
      description: m.description || "",
      order: m.order ?? i + 1,
    };
  });

  const id = raw.id ?? raw.project?.agreement ?? null;

  return {
    id,
    title,
    homeownerName,
    homeownerEmail,
    totalCost,
    isSigned,
    escrowFunded,
    invoices,
    milestones,
    raw,
  };
}

/* --------------------- component --------------------- */
export default function AgreementDetail({ initialAgreement = null, isMagicLink = false }) {
  const params = useParams();
  const navigate = useNavigate();
  const paramId = params?.id ? String(params.id) : null;

  const [rawAgreement, setRawAgreement] = useState(initialAgreement || null);
  const [loading, setLoading] = useState(!initialAgreement);
  const [error, setError] = useState("");

  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const [invoiceModalItems, setInvoiceModalItems] = useState([]);
  const [invoiceModalCategory, setInvoiceModalCategory] = useState("");

  const [signatureOpen, setSignatureOpen] = useState(false);
  const [signatureBusy, setSignatureBusy] = useState(false);

  const [escrowOpen, setEscrowOpen] = useState(false);
  const [clientSecret, setClientSecret] = useState("");

  const norm = useMemo(() => normalizeAgreement(rawAgreement), [rawAgreement]);

  const resolvedId = useMemo(() => {
    if (paramId) return paramId;
    if (initialAgreement?.id) return String(initialAgreement.id);
    return norm.id ? String(norm.id) : null;
  }, [paramId, initialAgreement, norm.id]);

  async function fetchAgreement() {
    if (!resolvedId) return;
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get(`/projects/agreements/${resolvedId}/`);
      setRawAgreement(data);
    } catch (e) {
      console.error(e);
      setError("Failed to load agreement.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (initialAgreement && isMagicLink && !paramId) {
      setRawAgreement(initialAgreement);
      setLoading(false);
      return;
    }
    fetchAgreement();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedId]);

  function openInvoices(list, category) {
    setInvoiceModalItems(Array.isArray(list) ? list : []);
    setInvoiceModalCategory(category || "Invoices");
    setInvoiceModalOpen(true);
  }

  function closeInvoices() {
    setInvoiceModalOpen(false);
    fetchAgreement();
  }

  async function startEscrow() {
    if (!resolvedId) return;
    try {
      const { data } = await api.post(`/projects/agreements/${resolvedId}/fund_escrow/`);
      if (data?.client_secret) {
        setClientSecret(data.client_secret);
        setEscrowOpen(true); // Self-wrapping modal will handle Elements
      } else {
        alert("Escrow start did not return a client secret.");
      }
    } catch (e) {
      console.error(e);
      alert("Could not start escrow funding.");
    }
  }

  async function handleSign(typedName) {
    if (!resolvedId) return;
    setSignatureBusy(true);
    try {
      await api.patch(`/projects/agreements/${resolvedId}/sign/`, {
        typed_name: typedName,
        accepted: true,
        signed_at: new Date().toISOString(),
      });
      // Immediately start escrow intent after signing
      const { data } = await api.post(`/projects/agreements/${resolvedId}/fund_escrow/`);
      if (data?.client_secret) {
        setClientSecret(data.client_secret);
        setEscrowOpen(true);
      }
      fetchAgreement();
    } catch (e) {
      console.error(e);
      alert("Failed to sign agreement.");
    } finally {
      setSignatureBusy(false);
    }
  }

  async function downloadPDF() {
    if (!resolvedId) return;
    try {
      const token = localStorage.getItem("access");
      const res = await fetch(`/api/projects/agreements/${resolvedId}/pdf/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("PDF download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `agreement_${resolvedId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      alert("Failed to download PDF.");
    }
  }

  if (loading) return <div className="p-6 text-center">Loading…</div>;
  if (error) return <div className="p-6 text-center text-red-600">{error}</div>;
  if (!norm.id) return <div className="p-6 text-center text-gray-600">Agreement not found.</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <button onClick={() => navigate("/agreements")} className="text-blue-600 hover:underline">← Back</button>

      {/* Header */}
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

      {/* Status (raw object passed so existing component logic still works) */}
      {typeof AgreementStatus === "function" && <AgreementStatus agreement={rawAgreement} />}

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        {!norm.isSigned && (
          <button
            onClick={() => setSignatureOpen(true)}
            className="px-4 py-2 rounded bg-green-600 text-white hover:bg-green-700"
          >
            Sign Agreement
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

      {/* Milestones */}
      <div className="bg-white rounded shadow p-6">
        <h3 className="text-lg font-semibold mb-3">Milestones</h3>
        {norm.milestones.length === 0 ? (
          <p className="text-gray-500">No milestones found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border rounded">
              <thead className="bg-gray-50">
                <tr>
                  <th className="p-2 text-left border">#</th>
                  <th className="p-2 text-left border">Title</th>
                  <th className="p-2 text-right border">Amount</th>
                  <th className="p-2 text-left border">Start</th>
                  <th className="p-2 text-left border">End</th>
                  <th className="p-2 text-left border">Duration</th>
                  <th className="p-2 text-left border">Status</th>
                </tr>
              </thead>
              <tbody>
                {norm.milestones.map((m, idx) => (
                  <tr key={m.id || idx} className="odd:bg-white even:bg-gray-50">
                    <td className="p-2 border">{m.order ?? idx + 1}</td>
                    <td className="p-2 border">{m.title}</td>
                    <td className="p-2 border text-right">${toMoney(m.amount).toFixed(2)}</td>
                    <td className="p-2 border">{m.start || "—"}</td>
                    <td className="p-2 border">{m.end || "—"}</td>
                    <td className="p-2 border">{m.duration}</td>
                    <td className="p-2 border capitalize">{String(m.status).replaceAll("_", " ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Invoices */}
      <div className="bg-white rounded shadow p-6">
        <h3 className="text-lg font-semibold mb-3">Invoices</h3>
        {norm.invoices.length === 0 ? (
          <p className="text-gray-500">No invoices yet.</p>
        ) : (
          <>
            <div className="mb-2 text-sm text-gray-600">
              Total: $
              {norm.invoices.reduce((s, inv) => s + toMoney(inv.amount), 0).toFixed(2)}
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm border rounded">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="p-2 text-left border">#</th>
                    <th className="p-2 text-left border">Project</th>
                    <th className="p-2 text-right border">Amount</th>
                    <th className="p-2 text-left border">Status</th>
                    <th className="p-2 text-left border">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {norm.invoices.map((inv, i) => (
                    <tr key={inv.id || i} className="odd:bg-white even:bg-gray-50">
                      <td className="p-2 border">{inv.id || i + 1}</td>
                      <td className="p-2 border">{inv.project_title || norm.title}</td>
                      <td className="p-2 border text-right">${toMoney(inv.amount).toFixed(2)}</td>
                      <td className="p-2 border capitalize">
                        {String(inv.status || "pending").replaceAll("_", " ")}
                      </td>
                      <td className="p-2 border">
                        <button
                          onClick={() => openInvoices([inv], "Invoice")}
                          className="px-2 py-1 rounded bg-gray-600 text-white hover:bg-gray-700"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Modals */}
      {typeof InvoiceModal === "function" && (
        <InvoiceModal
          visible={invoiceModalOpen}
          onClose={closeInvoices}
          invoices={invoiceModalItems}
          category={invoiceModalCategory}
        />
      )}
      {typeof SignatureModal === "function" && (
        <SignatureModal
          visible={signatureOpen}
          onClose={() => setSignatureOpen(false)}
          onSubmit={handleSign}
          loading={signatureBusy}
        />
      )}

      {/* ✅ Self-wrapping Escrow modal (no <Elements> required here) */}
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
