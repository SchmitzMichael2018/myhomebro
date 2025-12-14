// src/pages/AgreementDetail.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../api";
import SignatureModal from "../components/SignatureModal";
import EscrowPromptModal from "../components/EscrowPromptModal";
import AttachmentManager from "../components/AttachmentManager";
import SendFundingLinkButton from "../components/SendFundingLinkButton";
import { useAuth } from "../context/AuthContext";
import PdfPreviewModal from "../components/PdfPreviewModal";

const toMoney = (v) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
};

const formatMoney = (v) =>
  `$${Number(toMoney(v)).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

function normalizeAgreement(raw) {
  if (!raw || typeof raw !== "object")
    return { id: null, title: "—", invoices: [], milestones: [] };
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

  const [fundingPreview, setFundingPreview] = useState(null);
  const [fundingLoading, setFundingLoading] = useState(false);
  const [fundingError, setFundingError] = useState("");

  // PDF preview state
  const [pdfUrl, setPdfUrl] = useState(null);
  const [pdfOpen, setPdfOpen] = useState(false);

  const norm = useMemo(() => normalizeAgreement(agreement), [agreement]);

  const isContractor = user?.role === "contractor" || user?.is_contractor;
  const signingRole = isContractor ? "contractor" : "homeowner";

  const ratePercent =
    fundingPreview?.rate != null
      ? (Number(fundingPreview.rate) * 100).toFixed(2)
      : null;

  const tierLabel = fundingPreview
    ? fundingPreview.is_intro
      ? "Intro rate (first 60 days)"
      : fundingPreview.tier_name
      ? `Current tier: ${String(fundingPreview.tier_name).toUpperCase()}`
      : ""
    : "";

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

  // Store title for sidebar context (optional)
  useEffect(() => {
    if (!norm?.id) return;
    try {
      localStorage.setItem("activeAgreementTitle", norm.title || "");
    } catch {
      /* ignore */
    }
  }, [norm?.id, norm?.title]);

  useEffect(() => {
    const fetchFundingPreview = async () => {
      if (!id) return;
      setFundingLoading(true);
      setFundingError("");
      try {
        const { data } = await api.get(`/projects/agreements/${id}/funding_preview/`);
        setFundingPreview(data);
      } catch (err) {
        console.error("funding_preview error:", err);
        const msg =
          err?.response?.data?.detail ||
          "Unable to load fee & escrow summary. Totals are still valid, but rate info is unavailable.";
        setFundingError(msg);
        setFundingPreview(null);
      } finally {
        setFundingLoading(false);
      }
    };

    fetchFundingPreview();
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
        toast.error("Unable to start escrow funding.");
      }
    } catch (e) {
      console.error(e);
      toast.error("Failed to start escrow funding.");
    }
  };

  const downloadPDF = async () => {
    try {
      const res = await api.get(`/projects/agreements/${id}/pdf/`, {
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
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

  const previewPdf = async () => {
    try {
      const res = await api.get(`/projects/agreements/${id}/preview_pdf/`, {
        responseType: "blob",
        params: { stream: 1 },
      });

      const blob = new Blob([res.data], { type: "application/pdf" });
      const localUrl = URL.createObjectURL(blob);

      setPdfUrl(localUrl);
      setPdfOpen(true);
    } catch (err) {
      console.error("Preview PDF error:", err);
      toast.error("Unable to preview PDF.");
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
        <p>
          <strong>Total Cost:</strong> ${norm.totalCost.toFixed(2)}
        </p>
        <p>
          <strong>Status:</strong>{" "}
          {norm.escrowFunded ? "✅ Escrow Funded" : norm.isSigned ? "❌ Awaiting Funding" : "❌ Not Signed"}
        </p>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-3 items-start">
        {!norm.isSigned && (
          <button
            onClick={() => setSigOpen(true)}
            className="px-4 py-2 rounded bg-green-600 text-white hover:bg-green-700"
          >
            Open Signature
          </button>
        )}

        {/* Contractor: Send Funding Link */}
        {isContractor && norm.isSigned && !norm.escrowFunded && (
          <SendFundingLinkButton
            agreementId={norm.id}
            isFullySigned={norm.isSigned}
            className="mr-2"
          />
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
          onClick={previewPdf}
          className="px-4 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700"
        >
          Preview PDF
        </button>

        <button
          onClick={downloadPDF}
          className="px-4 py-2 rounded bg-blue-700 text-white hover:bg-blue-800"
        >
          Download PDF
        </button>
      </div>

      {/* Attachments */}
      <AttachmentManager agreementId={id} canEdit={isContractor} />

      {/* Milestones */}
      <div className="bg-white rounded shadow p-6">
        <h3 className="text-lg font-semibold mb-3">Milestones</h3>
        {!norm.milestones || norm.milestones.length === 0 ? (
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

      {/* Project Totals & Fee Summary (Contractor View) */}
      <div className="bg-white rounded shadow p-6 border border-dashed border-gray-300 bg-gray-50">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-base font-semibold text-gray-900">
            Project Totals &amp; Fee Summary (Contractor View)
          </h3>
          {fundingPreview && (
            <div className="text-[11px] text-gray-500 text-right space-y-0.5">
              {tierLabel && <div>{tierLabel}</div>}
              {ratePercent && <div>Current platform rate: {ratePercent}% + $1</div>}
              {fundingPreview.high_risk_applied && (
                <div className="text-[11px] text-amber-700">
                  High-risk surcharge applied for this project type.
                </div>
              )}
            </div>
          )}
        </div>

        {fundingLoading ? (
          <div className="text-xs text-gray-500">Loading fee &amp; escrow summary…</div>
        ) : fundingError ? (
          <div className="text-xs text-red-600">{fundingError}</div>
        ) : fundingPreview ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <SummaryCard label="Project Price (Homeowner Pays)" value={formatMoney(fundingPreview.project_amount)} />
              <SummaryCard
                label="MyHomeBro Platform Fee"
                value={
                  ratePercent
                    ? `${formatMoney(fundingPreview.platform_fee)} @ ${ratePercent}% + $1`
                    : formatMoney(fundingPreview.platform_fee)
                }
              />
              <SummaryCard
                label="Your Estimated Take-Home (Before Stripe)"
                value={formatMoney(fundingPreview.contractor_payout)}
              />
              <SummaryCard label="Total Escrow Deposit" value={formatMoney(fundingPreview.homeowner_escrow)} />
            </div>
            <p className="mt-2 text-[11px] text-gray-500">
              This summary shows your estimated take-home after the MyHomeBro platform fee. Stripe processing fees
              (card/ACH) may slightly adjust the final payout. If these numbers don&apos;t look right, update your
              milestone amounts or total project price before sending for signature.
            </p>
          </>
        ) : (
          <div className="text-xs text-gray-500">Fee summary not available yet.</div>
        )}
      </div>

      {/* Invoices */}
      <div className="bg-white rounded shadow p-6">
        <h3 className="text-lg font-semibold mb-3">Invoices</h3>
        {!norm.invoices || norm.invoices.length === 0 ? (
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

      {/* Signature Modal */}
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

      <PdfPreviewModal
        open={pdfOpen}
        onClose={() => {
          setPdfOpen(false);
          if (pdfUrl) {
            URL.revokeObjectURL(pdfUrl);
          }
        }}
        fileUrl={pdfUrl}
        title={`Agreement #${id} — Preview`}
      />
    </div>
  );
}

function SummaryCard({ label, value, className = "" }) {
  return (
    <div className={`rounded border bg-gray-50 px-3 py-2 h-full ${className}`}>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-sm font-medium whitespace-pre-wrap text-gray-900 break-words">{value}</div>
    </div>
  );
}
