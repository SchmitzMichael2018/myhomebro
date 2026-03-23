// src/pages/AgreementDetail.jsx
// v2026-03-02 — ✅ PDF Versions UI:
// - Reads agreement.current_pdf_url + agreement.pdf_versions (AgreementPDFVersion history)
// - Adds "PDF Versions" panel with Open/Download for each version
// - Uses credentialed fetch() for downloads so /media files work with auth cookies
//
// v2026-02-15 — ✅ Direct Pay aware:
// - Detect agreement.payment_mode ("escrow" vs "direct")
// - Hide escrow-only actions/modals for Direct Pay agreements
// - Adjust status display + show Payment Mode badge
// - Skip funding_preview (escrow fee summary) when Direct Pay

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import api, { getAccessToken } from "../api";
import SignatureModal from "../components/SignatureModal";
import EscrowPromptModal from "../components/EscrowPromptModal";
import AttachmentManager from "../components/AttachmentManager";
import SendFundingLinkButton from "../components/SendFundingLinkButton";
import { useAuth } from "../context/AuthContext";
import PdfPreviewModal from "../components/PdfPreviewModal";
import RefundEscrowModal from "../components/RefundEscrowModal";
import AssignSubcontractorInline from "../components/AssignSubcontractorInline";

// ✅ Assignment UI
import AssignEmployeeInline from "../components/AssignEmployeeInline";
import {
  assignAgreementToSubaccount,
  unassignAgreementFromSubaccount,
} from "../api/assignments";

const pick = (...vals) =>
  vals.find((v) => v !== undefined && v !== null && v !== "") ?? "";

const toMoney = (v) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
};

const formatMoney = (v) =>
  `$${Number(toMoney(v)).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const RefundedBadge = () => (
  <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border border-emerald-200 bg-emerald-50 text-emerald-800">
    ✅ Refunded
  </span>
);

const milestoneStatusLabel = (m) => {
  const raw = String(pick(m?.status, m?.state) || "").trim();
  if (raw) return raw;
  if (m?.is_invoiced) return "Invoiced";
  if (m?.completed) return "Completed";
  return "Incomplete";
};

const isRefundedMilestone = (m) =>
  String(pick(m?.descope_status, m?.descopeStatus) || "").toLowerCase() ===
  "refunded";

function normalizePaymentMode(val) {
  const s = String(val || "").trim().toLowerCase();
  if (!s) return "escrow";
  if (s.includes("direct")) return "direct";
  return "escrow";
}

function paymentModeLabel(mode) {
  const m = normalizePaymentMode(mode);
  return m === "direct" ? "Direct Pay" : "Escrow (Protected)";
}

function PaymentModeBadge({ mode }) {
  const m = normalizePaymentMode(mode);
  const cls =
    m === "direct"
      ? "border-slate-200 bg-slate-50 text-slate-800"
      : "border-emerald-200 bg-emerald-50 text-emerald-800";
  const text = m === "direct" ? "⚡ Direct Pay" : "🛡️ Escrow";
  return (
    <span
      className={`ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${cls}`}
      title={
        m === "direct"
          ? "Direct Pay: invoices are paid via Stripe pay links (no escrow hold)."
          : "Escrow: customer funds escrow; milestone approvals release funds."
      }
    >
      {text}
    </span>
  );
}

function fmtDateTime(val) {
  if (!val) return "";
  try {
    const d = new Date(val);
    if (!Number.isFinite(d.getTime())) return String(val);
    return d.toLocaleString();
  } catch {
    return String(val);
  }
}

function shortSha(sha) {
  const s = String(sha || "").trim();
  if (!s) return "";
  return s.length > 12 ? `${s.slice(0, 12)}…` : s;
}

function formatInviteDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function normalizeAgreement(raw) {
  if (!raw || typeof raw !== "object")
    return { id: null, title: "—", invoices: [], milestones: [] };

  const payment_mode = normalizePaymentMode(
    pick(raw.payment_mode, raw.paymentMode, raw.raw?.payment_mode)
  );

  const isDirectPay = payment_mode === "direct";

  const pdf_versions = Array.isArray(raw.pdf_versions) ? raw.pdf_versions : [];
  // Sort descending by version_number first, then created_at
  const pdfVersionsSorted = [...pdf_versions].sort((a, b) => {
    const av = Number(a?.version_number ?? a?.version ?? 0);
    const bv = Number(b?.version_number ?? b?.version ?? 0);
    if (bv !== av) return bv - av;
    const at = new Date(a?.created_at || 0).getTime();
    const bt = new Date(b?.created_at || 0).getTime();
    return bt - at;
  });

  return {
    id: raw.id ?? null,
    title: raw.title || raw.project_title || raw.project?.title || "—",
    homeownerName: raw.homeowner_name || raw.homeowner?.full_name || "—",
    homeownerEmail: raw.homeowner_email || raw.homeowner?.email || "—",
    totalCost: toMoney(raw.total_cost ?? raw.project?.total_cost ?? 0),
    isSigned:
      !!raw.is_fully_signed ||
      (!!raw.signed_by_contractor && !!raw.signed_by_homeowner),

    payment_mode,
    isDirectPay,

    // Escrow-only
    escrowFunded: !!raw.escrow_funded,

    invoices: raw.invoices || raw.invoice_set || [],
    milestones: raw.milestones || raw.milestone_set || [],

    // ✅ PDF versioning
    currentPdfUrl: pick(raw.current_pdf_url, raw.pdf_file_url, raw.pdf_url, ""),
    currentPdfVersion:
      raw.pdf_version != null ? Number(raw.pdf_version) : null,
    pdfVersions: pdfVersionsSorted,

    raw,
  };
}

// Download helper for /media URLs that may require cookies.
// Uses fetch() directly (NOT axios api instance) so "/media/..." doesn't get prefixed with "/api".
async function downloadWithCredentials(url, filename) {
  if (!url) throw new Error("Missing URL");
  const abs =
    String(url).startsWith("http")
      ? String(url)
      : `${window.location.origin}${String(url).startsWith("/") ? "" : "/"}${url}`;

  const res = await fetch(abs, { credentials: "include" });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Download failed (${res.status}). ${txt?.slice(0, 200) || ""}`);
  }
  const blob = await res.blob();
  const objectUrl = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename || "file.pdf";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(objectUrl);
}

function openInNewTab(url) {
  if (!url) return;
  const abs =
    String(url).startsWith("http")
      ? String(url)
      : `${window.location.origin}${String(url).startsWith("/") ? "" : "/"}${url}`;
  window.open(abs, "_blank", "noopener,noreferrer");
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

  // Refund modal state
  const [refundOpen, setRefundOpen] = useState(false);
  const [subcontractorsLoading, setSubcontractorsLoading] = useState(false);
  const [pendingInvitations, setPendingInvitations] = useState([]);
  const [acceptedSubcontractors, setAcceptedSubcontractors] = useState([]);
  const [inviteFormOpen, setInviteFormOpen] = useState(false);
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [invitationForm, setInvitationForm] = useState({
    invite_email: "",
    invite_name: "",
    invited_message: "",
  });

  // ✅ PDF Versions panel
  const [versionsOpen, setVersionsOpen] = useState(true);
  const [warranties, setWarranties] = useState([]);
  const [warrantiesLoading, setWarrantiesLoading] = useState(false);
  const [warrantyEditorOpen, setWarrantyEditorOpen] = useState(false);
  const [warrantySaving, setWarrantySaving] = useState(false);
  const [editingWarrantyId, setEditingWarrantyId] = useState(null);
  const [warrantyForm, setWarrantyForm] = useState({
    title: "",
    coverage_details: "",
    exclusions: "",
    start_date: "",
    end_date: "",
    status: "active",
    applies_to: "full_agreement",
  });

  const norm = useMemo(() => normalizeAgreement(agreement), [agreement]);

  const isContractor =
    user?.role === "contractor" ||
    user?.role === "contractor_owner" ||
    user?.type === "contractor" ||
    user?.is_contractor ||
    !!getAccessToken();
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

  const fetchSubcontractorInvitations = async () => {
    if (!id || !isContractor) return;
    try {
      setSubcontractorsLoading(true);
      const { data } = await api.get(
        `/projects/agreements/${id}/subcontractor-invitations/`
      );
      setPendingInvitations(data?.pending_invitations || []);
      setAcceptedSubcontractors(data?.accepted_subcontractors || []);
    } catch (err) {
      console.error(err);
      toast.error("Failed to load subcontractor invitations.");
    } finally {
      setSubcontractorsLoading(false);
    }
  };

  useEffect(() => {
    fetchSubcontractorInvitations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isContractor]);

  const fetchWarranties = async () => {
    if (!id) return;
    try {
      setWarrantiesLoading(true);
      const { data } = await api.get("/projects/warranties/", {
        params: { agreement: id },
      });
      setWarranties(Array.isArray(data) ? data : data?.results || []);
    } catch (e) {
      console.error(e);
      toast.error("Failed to load warranty records.");
    } finally {
      setWarrantiesLoading(false);
    }
  };

  useEffect(() => {
    fetchWarranties();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!norm?.id) return;
    try {
      localStorage.setItem("activeAgreementTitle", norm.title || "");
    } catch {
      /* ignore */
    }
  }, [norm?.id, norm?.title]);

  // Funding preview (escrow only)
  useEffect(() => {
    const fetchFundingPreview = async () => {
      if (!id) return;

      // ✅ Direct Pay: do not load escrow funding preview
      if (norm.isDirectPay) {
        setFundingPreview(null);
        setFundingError("");
        setFundingLoading(false);
        return;
      }

      setFundingLoading(true);
      setFundingError("");
      try {
        const { data } = await api.get(
          `/projects/agreements/${id}/funding_preview/`
        );
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
  }, [id, norm.isDirectPay]);

  const handleSigned = async () => {
    await fetchAgreement();
  };

  const startEscrow = async () => {
    if (norm.isDirectPay) {
      toast("This agreement is Direct Pay (no escrow funding).");
      return;
    }

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
      // Keep your existing endpoint-based download (works even if media auth is tricky)
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

  // ✅ Assignment handlers
  const assignAgreement = async (subId) => {
    await assignAgreementToSubaccount(norm.id, subId);
    toast.success("Agreement assigned.");
  };

  const unassignAgreement = async (subId) => {
    await unassignAgreementFromSubaccount(norm.id, subId);
    toast.success("Agreement unassigned.");
  };

  const resetWarrantyForm = () => {
    setEditingWarrantyId(null);
    setWarrantyForm({
      title: "",
      coverage_details: "",
      exclusions: "",
      start_date: "",
      end_date: "",
      status: "active",
      applies_to: "full_agreement",
    });
  };

  const openWarrantyEditor = (warranty = null) => {
    if (warranty) {
      setEditingWarrantyId(warranty.id);
      setWarrantyForm({
        title: warranty.title || "",
        coverage_details: warranty.coverage_details || "",
        exclusions: warranty.exclusions || "",
        start_date: warranty.start_date || "",
        end_date: warranty.end_date || "",
        status: warranty.status || "active",
        applies_to: warranty.applies_to || "full_agreement",
      });
    } else {
      resetWarrantyForm();
    }
    setWarrantyEditorOpen(true);
  };

  const saveWarrantyRecord = async () => {
    if (!norm.id) return;
    if (!warrantyForm.title.trim()) {
      toast.error("Warranty title is required.");
      return;
    }

    try {
      setWarrantySaving(true);
      const payload = {
        agreement: Number(norm.id),
        title: warrantyForm.title.trim(),
        coverage_details: warrantyForm.coverage_details.trim(),
        exclusions: warrantyForm.exclusions.trim(),
        start_date: warrantyForm.start_date || null,
        end_date: warrantyForm.end_date || null,
        status: warrantyForm.status,
        applies_to: warrantyForm.applies_to || "",
      };

      if (editingWarrantyId) {
        await api.patch(`/projects/warranties/${editingWarrantyId}/`, payload);
        toast.success("Warranty updated.");
      } else {
        await api.post("/projects/warranties/", payload);
        toast.success("Warranty created.");
      }

      setWarrantyEditorOpen(false);
      resetWarrantyForm();
      await fetchWarranties();
    } catch (e) {
      console.error(e);
      toast.error(
        e?.response?.data?.detail || "Failed to save warranty record."
      );
    } finally {
      setWarrantySaving(false);
    }
  };

  if (loading) return <div className="p-6">Loading…</div>;
  if (!norm.id) return <div className="p-6">Agreement not found.</div>;

  const submitInvitation = async () => {
    if (!invitationForm.invite_email.trim()) {
      toast.error("Subcontractor email is required.");
      return;
    }

    try {
      setInviteSubmitting(true);
      const { data } = await api.post(
        `/projects/agreements/${id}/subcontractor-invitations/`,
        invitationForm
      );
      toast.success("Subcontractor invitation created.");
      setInvitationForm({
        invite_email: "",
        invite_name: "",
        invited_message: "",
      });
      setInviteFormOpen(false);
      await fetchSubcontractorInvitations();
      if (data?.invite_url) {
        try {
          await navigator.clipboard.writeText(data.invite_url);
          toast.success("Invitation link copied.");
        } catch {
          // Clipboard access is optional.
        }
      }
    } catch (err) {
      console.error(err);
      toast.error(
        err?.response?.data?.invite_email?.[0] ||
          err?.response?.data?.detail ||
          "Failed to create subcontractor invitation."
      );
    } finally {
      setInviteSubmitting(false);
    }
  };

  const revokeInvitation = async (invitationId) => {
    try {
      await api.post(
        `/projects/agreements/${id}/subcontractor-invitations/${invitationId}/revoke/`,
        {}
      );
      toast.success("Invitation revoked.");
      await fetchSubcontractorInvitations();
    } catch (err) {
      console.error(err);
      toast.error(
        err?.response?.data?.detail || "Failed to revoke invitation."
      );
    }
  };

  const copyInviteLink = async (inviteUrl) => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      toast.success("Invitation link copied.");
    } catch {
      toast.error("Unable to copy the invitation link.");
    }
  };

  const assignMilestoneSubcontractor = async (milestoneId, invitationId) => {
    const { data } = await api.patch(`/projects/milestones/${milestoneId}/`, {
      assigned_subcontractor_invitation: invitationId,
    });
    setAgreement((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        milestones: (prev.milestones || []).map((milestone) =>
          milestone.id === milestoneId ? { ...milestone, ...data } : milestone
        ),
      };
    });
    toast.success("Subcontractor assigned.");
  };

  const unassignMilestoneSubcontractor = async (milestoneId) => {
    const { data } = await api.patch(`/projects/milestones/${milestoneId}/`, {
      assigned_subcontractor_invitation: null,
    });
    setAgreement((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        milestones: (prev.milestones || []).map((milestone) =>
          milestone.id === milestoneId ? { ...milestone, ...data } : milestone
        ),
      };
    });
    toast.success("Subcontractor unassigned.");
  };

  const clearMilestoneReviewRequest = async (milestoneId) => {
    const { data } = await api.post(
      `/projects/milestones/${milestoneId}/clear-subcontractor-review/`,
      {}
    );
    setAgreement((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        milestones: (prev.milestones || []).map((milestone) =>
          milestone.id === milestoneId ? { ...milestone, ...data } : milestone
        ),
      };
    });
    toast.success("Review request cleared.");
  };

  const statusText = norm.isDirectPay
    ? norm.isSigned
      ? "✅ Signed — Direct Pay"
      : "❌ Not Signed — Direct Pay"
    : norm.escrowFunded
    ? "✅ Escrow Funded"
    : norm.isSigned
    ? "❌ Awaiting Funding"
    : "❌ Not Signed";

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <button
        onClick={() => navigate("/agreements")}
        className="text-blue-600 hover:underline"
      >
        ← Back
      </button>

      <div className="bg-blue-50 border-l-4 border-blue-600 p-4 rounded shadow-sm">
        <h2 className="text-2xl font-bold mb-1">
          {norm.title}
          <PaymentModeBadge mode={norm.payment_mode} />
        </h2>
        <p>
          <strong>Customer:</strong> {norm.homeownerName}{" "}
          <span className="text-gray-500">({norm.homeownerEmail})</span>
        </p>
        <p>
          <strong>Total Cost:</strong> ${norm.totalCost.toFixed(2)}
        </p>
        <p>
          <strong>Payment Mode:</strong> {paymentModeLabel(norm.payment_mode)}
        </p>
        <p>
          <strong>Status:</strong> {statusText}
        </p>

        {norm.isDirectPay && (
          <div className="mt-2 text-xs text-slate-700">
            Direct Pay agreements don&apos;t use escrow. When milestones are
            invoiced, you&apos;ll create a Stripe pay link for each invoice in
            the <b>Invoices</b> section.
          </div>
        )}
      </div>

      {/* ✅ NEW: Agreement assignment selector */}
      {isContractor && (
        <AssignEmployeeInline
          label="Assign Entire Agreement"
          help="Assigning an agreement makes all milestones visible to that employee unless a milestone is explicitly assigned to someone else."
          onAssign={(subId) => assignAgreement(subId)}
          onUnassign={(subId) => unassignAgreement(subId)}
        />
      )}

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

        {/* Escrow-only actions */}
        {!norm.isDirectPay && isContractor && norm.isSigned && !norm.escrowFunded && (
          <SendFundingLinkButton
            agreementId={norm.id}
            isFullySigned={norm.isSigned}
            className="mr-2"
          />
        )}

        {!norm.isDirectPay && norm.isSigned && !norm.escrowFunded && (
          <button
            onClick={startEscrow}
            className="px-4 py-2 rounded bg-yellow-500 text-white hover:bg-yellow-600"
          >
            Fund Escrow
          </button>
        )}

        {!norm.isDirectPay && norm.escrowFunded && (
          <button
            onClick={() => setRefundOpen(true)}
            className="px-4 py-2 rounded bg-rose-600 text-white hover:bg-rose-700"
            title="Refund Control Center (unreleased escrow only)."
          >
            Refund Escrow
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

        {isContractor && (
          <button
            data-testid="invite-subcontractor-button"
            type="button"
            onClick={() => setInviteFormOpen((open) => !open)}
            className="px-4 py-2 rounded bg-slate-900 text-white hover:bg-slate-950"
          >
            {inviteFormOpen ? "Close Invite Form" : "Invite Subcontractor"}
          </button>
        )}
      </div>

      {isContractor && (
        <div
          data-testid="subcontractor-section"
          className="bg-white rounded shadow p-6 space-y-4"
        >
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h3 className="text-lg font-semibold">Subcontractors</h3>
              <div className="text-xs text-gray-500">
                Invite collaborators for this agreement. Financial controls stay with the contractor owner.
              </div>
            </div>
          </div>

          {inviteFormOpen && (
            <div className="rounded border bg-gray-50 p-4 grid gap-3 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium mb-1">Email</label>
                <input
                  data-testid="subcontractor-email-input"
                  type="email"
                  className="w-full rounded border px-3 py-2 text-sm"
                  value={invitationForm.invite_email}
                  onChange={(e) =>
                    setInvitationForm((prev) => ({
                      ...prev,
                      invite_email: e.target.value,
                    }))
                  }
                  placeholder="subcontractor@example.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Name</label>
                <input
                  className="w-full rounded border px-3 py-2 text-sm"
                  value={invitationForm.invite_name}
                  onChange={(e) =>
                    setInvitationForm((prev) => ({
                      ...prev,
                      invite_name: e.target.value,
                    }))
                  }
                  placeholder="Optional name"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium mb-1">Message</label>
                <textarea
                  className="w-full rounded border px-3 py-2 text-sm"
                  rows={3}
                  value={invitationForm.invited_message}
                  onChange={(e) =>
                    setInvitationForm((prev) => ({
                      ...prev,
                      invited_message: e.target.value,
                    }))
                  }
                  placeholder="Optional note for the subcontractor"
                />
              </div>
              <div className="md:col-span-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setInviteFormOpen(false)}
                  className="px-4 py-2 rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  data-testid="subcontractor-submit-button"
                  type="button"
                  disabled={inviteSubmitting}
                  onClick={submitInvitation}
                  className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {inviteSubmitting ? "Sending…" : "Send Invitation"}
                </button>
              </div>
            </div>
          )}

          {subcontractorsLoading ? (
            <div className="text-sm text-gray-500">Loading subcontractors…</div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-2">
              <div>
                <h4 className="text-sm font-semibold text-gray-900">
                  Pending Invitations
                </h4>
                {pendingInvitations.length === 0 ? (
                  <div className="mt-2 text-sm text-gray-500">
                    No pending invitations for this agreement.
                  </div>
                ) : (
                  <div className="mt-3 space-y-3">
                    {pendingInvitations.map((invitation) => (
                      <div
                        key={invitation.id}
                        data-testid={`pending-subcontractor-${invitation.id}`}
                        className="rounded border bg-gray-50 p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-gray-900">
                              {invitation.invite_name || invitation.invite_email}
                            </div>
                            <div className="text-xs text-gray-500">
                              {invitation.invite_email}
                            </div>
                            <div className="mt-1 text-xs text-gray-500">
                              Invited {formatInviteDate(invitation.invited_at)}
                            </div>
                          </div>
                          <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">
                            Pending
                          </span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {invitation.invite_url ? (
                            <button
                              type="button"
                              onClick={() => copyInviteLink(invitation.invite_url)}
                              className="px-3 py-1.5 rounded border border-gray-300 bg-white text-sm text-gray-700 hover:bg-gray-50"
                            >
                              Copy Invite Link
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => revokeInvitation(invitation.id)}
                            className="px-3 py-1.5 rounded border border-rose-200 bg-white text-sm text-rose-700 hover:bg-rose-50"
                          >
                            Revoke
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h4 className="text-sm font-semibold text-gray-900">
                  Accepted Subcontractors
                </h4>
                {acceptedSubcontractors.length === 0 ? (
                  <div className="mt-2 text-sm text-gray-500">
                    No subcontractors have accepted this agreement yet.
                  </div>
                ) : (
                  <div className="mt-3 space-y-3">
                    {acceptedSubcontractors.map((subcontractor) => (
                      <div
                        key={subcontractor.id}
                        data-testid={`accepted-subcontractor-${subcontractor.id}`}
                        className="rounded border bg-gray-50 p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-gray-900">
                              {subcontractor.accepted_name ||
                                subcontractor.invite_name ||
                                subcontractor.invite_email}
                            </div>
                            <div className="text-xs text-gray-500">
                              {subcontractor.invite_email}
                            </div>
                            <div className="mt-1 text-xs text-gray-500">
                              Accepted {formatInviteDate(subcontractor.accepted_at)}
                            </div>
                          </div>
                          <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                            Accepted
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ✅ PDF Versions */}
      <div className="bg-white rounded shadow p-6 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-lg font-semibold">PDF Versions</h3>
          <button
            className="text-sm text-blue-700 hover:underline"
            onClick={() => setVersionsOpen((v) => !v)}
          >
            {versionsOpen ? "Hide" : "Show"}
          </button>
        </div>

        {versionsOpen && (
          <>
            <div className="rounded border bg-gray-50 p-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="text-sm font-medium text-gray-900">
                    Current PDF{" "}
                    {norm.currentPdfVersion != null ? (
                      <span className="text-xs text-gray-500">
                        (v{norm.currentPdfVersion})
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs text-gray-500">
                    Uses Agreement.pdf_file (latest). If version history exists, it is listed below.
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    className="px-3 py-1.5 rounded bg-slate-800 text-white hover:bg-slate-900 text-sm"
                    onClick={() => {
                      if (!norm.currentPdfUrl) {
                        toast("No current PDF URL available yet.");
                        return;
                      }
                      openInNewTab(norm.currentPdfUrl);
                    }}
                  >
                    Open
                  </button>
                  <button
                    className="px-3 py-1.5 rounded bg-blue-700 text-white hover:bg-blue-800 text-sm"
                    onClick={async () => {
                      if (!norm.currentPdfUrl) {
                        toast("No current PDF URL available yet.");
                        return;
                      }
                      try {
                        await downloadWithCredentials(
                          norm.currentPdfUrl,
                          `agreement_${norm.id}_current.pdf`
                        );
                        toast.success("Downloaded.");
                      } catch (e) {
                        console.error(e);
                        toast.error("Download failed.");
                      }
                    }}
                  >
                    Download
                  </button>
                </div>
              </div>
            </div>

            {(!norm.pdfVersions || norm.pdfVersions.length === 0) ? (
              <div className="text-sm text-gray-500">
                No historical PDF versions found yet. (This will populate after the new PDF generator writes AgreementPDFVersion rows.)
              </div>
            ) : (
              <div className="space-y-2">
                {norm.pdfVersions.map((v) => {
                  const verNum = Number(v?.version_number ?? 0);
                  const kind = String(v?.kind || "").toLowerCase();
                  const fileUrl = v?.file_url || v?.fileUrl || "";
                  const sigLine = [
                    v?.signed_by_contractor ? "Contractor signed" : "Contractor not signed",
                    v?.signed_by_homeowner ? "Customer signed" : "Customer not signed",
                  ].join(" • ");

                  return (
                    <div
                      key={v.id ?? `${verNum}-${v.created_at ?? ""}`}
                      className="rounded border p-3 bg-white"
                    >
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-[240px]">
                          <div className="text-sm font-semibold text-gray-900">
                            v{verNum || "—"}{" "}
                            {kind ? (
                              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border border-slate-200 bg-slate-50 text-slate-800">
                                {kind}
                              </span>
                            ) : null}
                          </div>
                          <div className="text-xs text-gray-500">
                            Created: {fmtDateTime(v?.created_at) || "—"}
                          </div>
                          <div className="text-xs text-gray-500">
                            SHA: {shortSha(v?.sha256) || "—"}
                          </div>
                          <div className="text-xs text-gray-500">
                            {sigLine}
                          </div>
                        </div>

                        <div className="flex gap-2">
                          <button
                            className="px-3 py-1.5 rounded bg-slate-800 text-white hover:bg-slate-900 text-sm"
                            onClick={() => {
                              if (!fileUrl) {
                                toast("No file URL for this version.");
                                return;
                              }
                              openInNewTab(fileUrl);
                            }}
                          >
                            Open
                          </button>
                          <button
                            className="px-3 py-1.5 rounded bg-blue-700 text-white hover:bg-blue-800 text-sm"
                            onClick={async () => {
                              if (!fileUrl) {
                                toast("No file URL for this version.");
                                return;
                              }
                              try {
                                await downloadWithCredentials(
                                  fileUrl,
                                  `agreement_${norm.id}_v${verNum || "x"}_${kind || "pdf"}.pdf`
                                );
                                toast.success("Downloaded.");
                              } catch (e) {
                                console.error(e);
                                toast.error("Download failed.");
                              }
                            }}
                          >
                            Download
                          </button>
                        </div>
                      </div>

                      {(v?.contractor_signature_name || v?.homeowner_signature_name) && (
                        <div className="mt-2 text-xs text-gray-600">
                          <span className="font-semibold">Names:</span>{" "}
                          {v?.contractor_signature_name ? `Contractor: ${v.contractor_signature_name}` : "Contractor: —"}{" "}
                          |{" "}
                          {v?.homeowner_signature_name ? `Customer: ${v.homeowner_signature_name}` : "Customer: —"}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      <div
        data-testid="agreement-warranties-section"
        className="bg-white rounded shadow p-6 space-y-4"
      >
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3
              data-testid="agreement-warranties-heading"
              className="text-lg font-semibold"
            >
              Warranty Records
            </h3>
            <div className="text-xs text-gray-500">
              Phase 1 records active warranty coverage linked to this agreement.
              It does not change the signed PDF warranty snapshot.
            </div>
          </div>

          {isContractor && (
            <button
              data-testid="agreement-add-warranty-button"
              type="button"
              onClick={() => openWarrantyEditor()}
              className="px-4 py-2 rounded bg-slate-800 text-white hover:bg-slate-900"
            >
              Add Warranty
            </button>
          )}
        </div>

        {warrantyEditorOpen && (
          <div className="rounded border bg-gray-50 p-4 grid gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-1">Title</label>
              <input
                data-testid="warranty-title-input"
                className="w-full rounded border px-3 py-2 text-sm"
                value={warrantyForm.title}
                onChange={(e) =>
                  setWarrantyForm((prev) => ({ ...prev, title: e.target.value }))
                }
                placeholder="e.g., 12-Month Workmanship Warranty"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-1">
                Coverage Details
              </label>
              <textarea
                className="w-full rounded border px-3 py-2 text-sm"
                rows={4}
                value={warrantyForm.coverage_details}
                onChange={(e) =>
                  setWarrantyForm((prev) => ({
                    ...prev,
                    coverage_details: e.target.value,
                  }))
                }
                placeholder="What does this warranty cover?"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-1">Exclusions</label>
              <textarea
                className="w-full rounded border px-3 py-2 text-sm"
                rows={3}
                value={warrantyForm.exclusions}
                onChange={(e) =>
                  setWarrantyForm((prev) => ({
                    ...prev,
                    exclusions: e.target.value,
                  }))
                }
                placeholder="List exclusions or limitations."
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Start Date</label>
              <input
                className="w-full rounded border px-3 py-2 text-sm"
                type="date"
                value={warrantyForm.start_date}
                onChange={(e) =>
                  setWarrantyForm((prev) => ({
                    ...prev,
                    start_date: e.target.value,
                  }))
                }
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">End Date</label>
              <input
                className="w-full rounded border px-3 py-2 text-sm"
                type="date"
                value={warrantyForm.end_date}
                onChange={(e) =>
                  setWarrantyForm((prev) => ({
                    ...prev,
                    end_date: e.target.value,
                  }))
                }
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Status</label>
              <select
                className="w-full rounded border px-3 py-2 text-sm"
                value={warrantyForm.status}
                onChange={(e) =>
                  setWarrantyForm((prev) => ({ ...prev, status: e.target.value }))
                }
              >
                <option value="active">Active</option>
                <option value="expired">Expired</option>
                <option value="void">Void</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Applies To</label>
              <select
                className="w-full rounded border px-3 py-2 text-sm"
                value={warrantyForm.applies_to}
                onChange={(e) =>
                  setWarrantyForm((prev) => ({
                    ...prev,
                    applies_to: e.target.value,
                  }))
                }
              >
                <option value="full_agreement">Full Agreement</option>
                <option value="workmanship">Workmanship</option>
                <option value="materials">Materials</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div className="md:col-span-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setWarrantyEditorOpen(false);
                  resetWarrantyForm();
                }}
                className="px-4 py-2 rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                data-testid="warranty-save-button"
                type="button"
                onClick={saveWarrantyRecord}
                disabled={warrantySaving}
                className="px-4 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                {warrantySaving ? "Saving…" : editingWarrantyId ? "Update Warranty" : "Save Warranty"}
              </button>
            </div>
          </div>
        )}

        {warrantiesLoading ? (
          <div className="text-sm text-gray-500">Loading warranty records…</div>
        ) : warranties.length === 0 ? (
          <div className="text-sm text-gray-500">
            No warranty records added yet.
          </div>
        ) : (
          <div className="space-y-3">
            {warranties.map((warranty) => (
              <div
                key={warranty.id}
                data-testid={`warranty-card-${warranty.id}`}
                className="rounded border p-4 bg-gray-50"
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">
                      {warranty.title}
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      {warranty.applies_to
                        ? `Applies to: ${String(warranty.applies_to)
                            .replaceAll("_", " ")
                            .replace(/^\w/, (c) => c.toUpperCase())}`
                        : "Applies to: —"}
                    </div>
                    <div className="text-xs text-gray-500">
                      {warranty.start_date || "—"} to {warranty.end_date || "—"}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="inline-flex rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-700">
                      {String(warranty.status || "active")
                        .replaceAll("_", " ")
                        .replace(/^\w/, (c) => c.toUpperCase())}
                    </span>
                    {isContractor && (
                      <button
                        type="button"
                        onClick={() => openWarrantyEditor(warranty)}
                        className="px-3 py-1.5 rounded border border-gray-300 bg-white text-sm text-gray-700 hover:bg-gray-50"
                      >
                        Edit
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div>
                    <div className="text-xs font-semibold text-gray-500">
                      Coverage
                    </div>
                    <div className="text-sm text-gray-700 whitespace-pre-wrap">
                      {warranty.coverage_details || "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-gray-500">
                      Exclusions
                    </div>
                    <div className="text-sm text-gray-700 whitespace-pre-wrap">
                      {warranty.exclusions || "—"}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Attachments */}
      <AttachmentManager agreementId={id} canEdit={isContractor} />

      {/* Milestones */}
      <div className="bg-white rounded shadow p-6 space-y-3">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <h3 className="text-lg font-semibold">Milestones</h3>
          <div className="text-xs text-gray-500">
            Assign individual milestones to override agreement assignment.
          </div>
        </div>

        {!norm.milestones || norm.milestones.length === 0 ? (
          <p className="text-gray-500">No milestones found.</p>
        ) : (
          <div className="space-y-3">
            {norm.milestones.map((m) => {
              const refunded = isRefundedMilestone(m);
              const label = milestoneStatusLabel(m);

              return (
                <div
                  key={m.id}
                  data-testid={`milestone-card-${m.id}`}
                  className="border rounded-lg p-3 bg-gray-50"
                >
                  <div className="text-sm">
                    <span className="font-semibold">{m.title}</span> — $
                    {toMoney(m.amount).toFixed(2)}
                    {refunded ? <RefundedBadge /> : null}
                    <span className="text-gray-500"> ({label})</span>
                  </div>

                  <div className="mt-2 text-sm text-gray-600">
                    <span className="font-semibold text-gray-900">
                      Subcontractor:
                    </span>{" "}
                    {m.assigned_subcontractor_display || "Unassigned"}
                  </div>

                  <div
                    data-testid={`milestone-review-state-${m.id}`}
                    className="mt-2 text-sm text-gray-600"
                  >
                    <span className="font-semibold text-gray-900">Review:</span>{" "}
                    {m.subcontractor_review_requested
                      ? "Requested"
                      : "Not requested"}
                    {m.subcontractor_review_requested_at ? (
                      <span className="text-gray-500">
                        {" "}
                        ({fmtDateTime(m.subcontractor_review_requested_at)})
                      </span>
                    ) : null}
                  </div>

                  {m.subcontractor_review_note ? (
                    <div className="mt-1 text-sm text-gray-600 whitespace-pre-wrap">
                      <span className="font-semibold text-gray-900">
                        Review note:
                      </span>{" "}
                      {m.subcontractor_review_note}
                    </div>
                  ) : null}

                  {isContractor && (
                    <div className="mt-3">
                      <AssignSubcontractorInline
                        acceptedSubcontractors={acceptedSubcontractors}
                        currentAssignment={m.assigned_subcontractor}
                        onAssign={(invitationId) =>
                          assignMilestoneSubcontractor(m.id, invitationId)
                        }
                        onUnassign={() => unassignMilestoneSubcontractor(m.id)}
                      />
                      {m.subcontractor_review_requested ? (
                        <button
                          type="button"
                          data-testid={`milestone-review-clear-${m.id}`}
                          onClick={() => clearMilestoneReviewRequest(m.id)}
                          className="mt-3 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                        >
                          Clear Review Request
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Project Totals & Fee Summary (Contractor View) */}
      {!norm.isDirectPay && (
        <div className="bg-white rounded shadow p-6 border border-dashed border-gray-300 bg-gray-50">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-base font-semibold text-gray-900">
              Project Totals &amp; Fee Summary (Contractor View)
            </h3>
            {fundingPreview && (
              <div className="text-[11px] text-gray-500 text-right space-y-0.5">
                {tierLabel && <div>{tierLabel}</div>}
                {ratePercent && (
                  <div>Current platform rate: {ratePercent}% + $1</div>
                )}
                {fundingPreview.high_risk_applied && (
                  <div className="text-[11px] text-amber-700">
                    High-risk surcharge applied for this project type.
                  </div>
                )}
              </div>
            )}
          </div>

          {fundingLoading ? (
            <div className="text-xs text-gray-500">
              Loading fee &amp; escrow summary…
            </div>
          ) : fundingError ? (
            <div className="text-xs text-red-600">{fundingError}</div>
          ) : fundingPreview ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <SummaryCard
                  label="Project Price (Customer Pays)"
                  value={formatMoney(fundingPreview.project_amount)}
                />
                <SummaryCard
                  label="MyHomeBro Platform Fee"
                  value={
                    ratePercent
                      ? `${formatMoney(
                          fundingPreview.platform_fee
                        )} @ ${ratePercent}% + $1`
                      : formatMoney(fundingPreview.platform_fee)
                  }
                />
                <SummaryCard
                  label="Your Estimated Take-Home (Before Stripe)"
                  value={formatMoney(fundingPreview.contractor_payout)}
                />
                <SummaryCard
                  label="Total Escrow Deposit"
                  value={formatMoney(fundingPreview.homeowner_escrow)}
                />
              </div>
              <p className="mt-2 text-[11px] text-gray-500">
                This summary shows your estimated take-home after the MyHomeBro
                platform fee. Stripe processing fees (card/ACH) may slightly
                adjust the final payout. If these numbers don&apos;t look right,
                update your milestone amounts or total project price before
                sending for signature.
              </p>
            </>
          ) : (
            <div className="text-xs text-gray-500">
              Fee summary not available yet.
            </div>
          )}
        </div>
      )}

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

      <SignatureModal
        isOpen={sigOpen}
        onClose={() => setSigOpen(false)}
        agreement={agreement}
        signingRole={signingRole}
        onSigned={handleSigned}
      />

      {/* Escrow-only modals */}
      {!norm.isDirectPay && (
        <>
          <EscrowPromptModal
            visible={escrowOpen}
            onClose={() => setEscrowOpen(false)}
            stripeClientSecret={clientSecret}
            onSuccess={() => {
              setEscrowOpen(false);
              fetchAgreement();
            }}
          />

          <RefundEscrowModal
            open={refundOpen}
            onClose={() => setRefundOpen(false)}
            agreementId={norm.id}
            agreementLabel={norm.title}
            onRefunded={() => {
              fetchAgreement();
            }}
          />
        </>
      )}

      <PdfPreviewModal
        open={pdfOpen}
        onClose={() => {
          setPdfOpen(false);
          if (pdfUrl) URL.revokeObjectURL(pdfUrl);
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
      <div className="text-sm font-medium whitespace-pre-wrap text-gray-900 break-words">
        {value}
      </div>
    </div>
  );
}
