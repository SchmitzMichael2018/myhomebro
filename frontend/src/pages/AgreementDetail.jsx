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
import { useParams, useNavigate, useLocation } from "react-router-dom";
import toast from "react-hot-toast";
import api, {
  approveDrawRequest,
  createAgreementDrawRequest,
  getAccessToken,
  getAgreementDrawRequests,
  getAgreementExternalPayments,
  recordDrawExternalPayment,
  releaseDrawRequest,
  rejectDrawRequest,
  requestDrawChanges,
  submitDrawRequest,
} from "../api";
import SignatureModal from "../components/SignatureModal";
import EscrowPromptModal from "../components/EscrowPromptModal";
import AttachmentManager from "../components/AttachmentManager";
import SendFundingLinkButton from "../components/SendFundingLinkButton";
import { useAuth } from "../context/AuthContext";
import PdfPreviewModal from "../components/PdfPreviewModal";
import RefundEscrowModal from "../components/RefundEscrowModal";
import AssignSubcontractorInline from "../components/AssignSubcontractorInline";
import AssignReviewerInline from "../components/AssignReviewerInline";
import SupportRequestModal from "../components/SupportRequestModal";

// ✅ Assignment UI
import AssignEmployeeInline from "../components/AssignEmployeeInline";
import { WorkflowHint } from "../components/WorkflowHint.jsx";
import ContractorPageSurface from "../components/dashboard/ContractorPageSurface.jsx";
import { normalizeProjectClass } from "../utils/projectClass.js";
import { getAgreementDetailHint } from "../lib/workflowHints.js";
import { ProjectModeBadge, projectModeLabel } from "../components/projectMode.jsx";
import { MilestoneRoleBadge, MilestoneSafetyBadges, InspectionStatusBadge, deriveMilestoneRoleLabel } from "../components/milestoneRole.jsx";
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

function normalizePaymentStructure(val) {
  const s = String(val || "").trim().toLowerCase();
  return s === "progress" ? "progress" : "simple";
}

function projectClassLabel(val) {
  return normalizeProjectClass(val) === "commercial" ? "Commercial" : "Residential";
}

function paymentModeLabel(mode) {
  const m = normalizePaymentMode(mode);
  return m === "direct" ? "Direct Pay" : "Escrow (Protected)";
}

function paymentProtectionLabel(value) {
  const s = String(value || "").trim();
  if (!s) return "Escrow Preferred";
  return s;
}

function paymentProtectionTone(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized.includes("required")) return "border-rose-200 bg-rose-50 text-rose-800";
  if (normalized.includes("recommended")) return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-emerald-200 bg-emerald-50 text-emerald-800";
}

function drawWorkflowStatus(draw) {
  return String(draw?.workflow_status || draw?.status || "").trim().toLowerCase();
}

function drawWorkflowLabel(draw) {
  return (
    draw?.workflow_status_label ||
    String(draw?.workflow_status || draw?.status || "draft").replaceAll("_", " ")
  );
}

function formatApiError(error, fallback) {
  const data = error?.response?.data;
  if (!data) return fallback;
  if (typeof data === "string") return data;
  if (typeof data?.detail === "string") return data.detail;
  const firstEntry = Object.entries(data).find(([, value]) => value != null);
  if (!firstEntry) return fallback;
  const [field, value] = firstEntry;
  const message = Array.isArray(value) ? value[0] : value;
  if (typeof message === "string") return `${field.replaceAll("_", " ")}: ${message}`;
  return fallback;
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

function formatPayoutStatus(value) {
  return String(value || "not_eligible")
    .replaceAll("_", " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

function formatExecutionMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "automatic") return "Automatic";
  if (normalized === "manual") return "Manual";
  return "";
}

function payoutOrchestrationLabel(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "blocked") return "Blocked";
  if (normalized === "ready") return "Ready for contractor release";
  if (normalized === "scheduled") return "Scheduled";
  if (normalized === "processing") return "Processing";
  if (normalized === "paid") return "Paid";
  if (normalized === "failed") return "Failed";
  if (normalized === "cancelled") return "Cancelled";
  if (normalized === "not_due") return "Not yet due";
  return String(value || "Not yet due").replaceAll("_", " ");
}

function normalizeAdminTab(tab) {
  const normalized = String(tab || "").trim().toLowerCase();
  if (!normalized) return "overview";
  if (normalized === "pricing" || normalized === "financials") return "financials";
  if (["overview", "milestones", "communication", "disputes", "ai", "audit"].includes(normalized)) {
    return normalized;
  }
  return "overview";
}

function adminTabToQuery(tab) {
  const normalized = normalizeAdminTab(tab);
  if (normalized === "overview") return "";
  if (normalized === "financials") return "pricing";
  return normalized;
}

function adminRiskToneLabel(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "high") return { tone: "bad", label: "High" };
  if (normalized === "medium") return { tone: "warn", label: "Medium" };
  return { tone: "good", label: "Low" };
}

function titleCase(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
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
    project_mode: raw.project_mode || raw.raw?.project_mode || "full_service",
    homeowner_participation_notes:
      raw.homeowner_participation_notes || raw.raw?.homeowner_participation_notes || "",
    homeowner_responsibilities:
      raw.homeowner_responsibilities || raw.raw?.homeowner_responsibilities || "",
    contractor_responsibilities:
      raw.contractor_responsibilities || raw.raw?.contractor_responsibilities || "",
    excluded_work: raw.excluded_work || raw.raw?.excluded_work || "",
    collaboration_summary: raw.collaboration_summary || raw.raw?.collaboration_summary || "",
    responsibility_matrix:
      raw.responsibility_matrix || raw.raw?.responsibility_matrix || {},
    homeowner_acknowledgements:
      raw.homeowner_acknowledgements || raw.raw?.homeowner_acknowledgements || [],
    inspection_summary:
      raw.inspection_summary || raw.raw?.inspection_summary || {},
    rescue_project_summary:
      raw.rescue_project_summary || raw.raw?.rescue_project_summary || {},
    totalCost: toMoney(raw.total_cost ?? raw.project?.total_cost ?? 0),
    status: raw.status || raw.workflow_status || raw.state || "draft",
    isSigned:
      !!raw.is_fully_signed ||
      (!!raw.signed_by_contractor && !!raw.signed_by_homeowner),

    payment_mode,
    payment_protection: raw.payment_protection || raw.raw?.payment_protection || {},
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

function AdminAgreementCommandCenter({
  agreement,
  norm,
  id,
  adminTab,
  onBackToList,
  onNavigateTab,
  onRefreshPricing,
  onResendSignature,
  onGoToFeeAudit,
  fundingPreview,
  adminAiContext,
  adminAiLoading,
  agreementOpsMsg,
}) {
  const contractValue = toMoney(norm?.totalCost || agreement?.total_cost || 0);
  const funded = toMoney(
    pick(
      agreement?.escrow_funded_amount,
      agreement?.escrow_funded_total,
      fundingPreview?.homeowner_escrow,
      0
    )
  );
  const released = toMoney(
    pick(
      agreement?.escrow_released_amount,
      agreement?.escrow_released_total,
      fundingPreview?.released_amount,
      0
    )
  );
  const refunded = toMoney(agreement?.escrow_refunded_amount || 0);
  const pendingRelease = Math.max(funded - released - refunded, 0);
  const platformFeeEstimate = toMoney(
    pick(fundingPreview?.platform_fee, agreement?.platform_fee_estimate, agreement?.platform_fee, 0)
  );
  const openDisputes = Number(
    agreement?.open_disputes_count || agreement?.dispute_count || agreement?.disputes_count || 0
  );
  const contractorLabel =
    pick(
      agreement?.contractor_name,
      agreement?.contractor?.business_name,
      agreement?.contractor?.name,
      agreement?.contractor?.display_name,
      agreement?.assigned_contractor_name
    ) || "—";
  const customerLabel = norm?.homeownerName || agreement?.homeowner_name || "—";
  const statusLabel = titleCase(agreement?.status || agreement?.workflow_status || agreement?.state || "draft");
  const riskTone = adminRiskToneLabel(
    openDisputes > 0 || pendingRelease > contractValue * 0.5
      ? "high"
      : pendingRelease > contractValue * 0.2 || String(agreement?.pricing_strategy || "").toLowerCase() === "requires_sub_quote"
        ? "medium"
        : "low"
  );
  const tabs = [
    ["overview", "Overview"],
    ["financials", "Financials"],
    ["milestones", "Milestones"],
    ["communication", "Communication"],
    ["disputes", "Disputes"],
    ["ai", "AI Context"],
    ["audit", "Audit Log"],
  ];
  const milestones = Array.isArray(norm?.milestones) ? norm.milestones : [];
  const disputeRows = Array.isArray(agreement?.disputes) ? agreement.disputes : [];
  const canonicalTab = normalizeAdminTab(adminTab);
  const activeFinancials = canonicalTab === "financials";
  const activeOverview = canonicalTab === "overview";
  const activeMilestones = canonicalTab === "milestones";
  const activeCommunication = canonicalTab === "communication";
  const activeDisputes = canonicalTab === "disputes";
  const activeAi = canonicalTab === "ai";
  const activeAudit = canonicalTab === "audit";

  const setTab = (nextTab) => {
    const queryTab = adminTabToQuery(nextTab);
    onNavigateTab(queryTab ? `?tab=${encodeURIComponent(queryTab)}` : "");
  };

  return (
    <ContractorPageSurface
      eyebrow="Admin"
      title="Admin Agreement Detail"
      subtitle="Command center for financial, operational, communication, and audit review."
      actions={
        <button
          onClick={onBackToList}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
        >
          Back to Admin Agreements
        </button>
      }
    >
      <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-3xl font-bold tracking-tight text-slate-950">
                {norm?.title || agreement?.project_title || `Agreement #${id}`}
              </h2>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-extrabold text-slate-700">
                #{id}
              </span>
              <span className={`rounded-full border px-2.5 py-1 text-[11px] font-extrabold ${riskTone.tone === "bad" ? "border-rose-200 bg-rose-50 text-rose-800" : riskTone.tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
                Risk {riskTone.label}
              </span>
            </div>
            <div className="text-sm text-slate-700">
              <span className="font-semibold text-slate-900">Status:</span> {statusLabel}
              <span className="mx-2 text-slate-300">|</span>
              <span className="font-semibold text-slate-900">Contractor:</span> {contractorLabel}
              <span className="mx-2 text-slate-300">|</span>
              <span className="font-semibold text-slate-900">Customer:</span> {customerLabel}
            </div>
          </div>
          <div className="grid min-w-[320px] grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <SummaryCard label="Contract Value" value={formatMoney(contractValue)} className="border-slate-200 bg-slate-50" />
            <SummaryCard label="Funded" value={formatMoney(funded)} className="border-slate-200 bg-slate-50" />
            <SummaryCard label="Released" value={formatMoney(released)} className="border-slate-200 bg-slate-50" />
            <SummaryCard label="Pending Release" value={formatMoney(pendingRelease)} className="border-slate-200 bg-slate-50" />
            <SummaryCard label="Platform Fee Estimate" value={formatMoney(platformFeeEstimate)} className="border-slate-200 bg-slate-50" />
            <SummaryCard label="Risk Level" value={riskTone.label} className="border-slate-200 bg-slate-50" />
          </div>
        </div>
      </section>

      <div className="mt-5 flex flex-wrap gap-2" data-testid="admin-agreement-tabs">
        {tabs.map(([tab, label]) => {
          const active = canonicalTab === tab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setTab(tab)}
              className={[
                "rounded-full border px-4 py-2 text-sm font-extrabold transition",
                active
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
              ].join(" ")}
            >
              {label}
            </button>
          );
        })}
      </div>

      {agreementOpsMsg ? (
        <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-900">
          {agreementOpsMsg}
        </div>
      ) : null}

      {activeOverview ? (
        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-extrabold text-slate-900">Project Summary</div>
            <div className="mt-2 text-sm text-slate-700 whitespace-pre-wrap">
              {agreement?.description || agreement?.scope_description || agreement?.summary || "No project summary saved yet."}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-extrabold text-slate-900">Party Summary</div>
            <div className="mt-2 text-sm text-slate-700">
              Contractor: {contractorLabel}
            </div>
            <div className="mt-1 text-sm text-slate-700">
              Customer: {customerLabel}
            </div>
            <div className="mt-1 text-sm text-slate-700">
              Agreement ID: {id}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-extrabold text-slate-900">Signature / PDF Status</div>
            <div className="mt-2 text-sm text-slate-700">
              Signature: {norm?.isSigned ? "Signed" : "Pending"}
            </div>
            <div className="mt-1 text-sm text-slate-700">
              PDF versions: {Array.isArray(norm?.pdfVersions) ? norm.pdfVersions.length : 0}
            </div>
            <div className="mt-1 text-sm text-slate-700">
              Current PDF: {norm?.currentPdfUrl ? "Available" : "Not available"}
            </div>
          </div>
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 shadow-sm">
            <div className="text-sm font-extrabold text-slate-900">Admin Notes</div>
            <div className="mt-2 text-sm text-slate-600">
              Admin-only notes placeholder.
            </div>
          </div>
        </div>
      ) : null}

      {activeFinancials ? (
        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-extrabold text-slate-900">Escrow Summary</div>
            <div className="mt-2 grid gap-2 text-sm text-slate-700">
              <div>Funded: {formatMoney(funded)}</div>
              <div>Released: {formatMoney(released)}</div>
              <div>Pending Release: {formatMoney(pendingRelease)}</div>
              <div>Refunded: {formatMoney(refunded)}</div>
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-extrabold text-slate-900">Milestone Payment Breakdown</div>
            <div className="mt-2 space-y-2 text-sm text-slate-700">
              {milestones.length ? milestones.slice(0, 6).map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                  <span className="font-semibold text-slate-900">{m.title || `Milestone #${m.id}`}</span>
                  <span>{formatMoney(m.amount || 0)}</span>
                </div>
              )) : <div>No milestone rows available.</div>}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-extrabold text-slate-900">Platform Revenue Estimate</div>
            <div className="mt-2 text-sm text-slate-700">
              {platformFeeEstimate ? formatMoney(platformFeeEstimate) : "Not available yet."}
            </div>
            {fundingPreview?.rate != null ? (
              <div className="mt-1 text-xs text-slate-500">
                Current rate: {(Number(fundingPreview.rate) * 100).toFixed(2)}% + $1
              </div>
            ) : null}
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-extrabold text-slate-900">Actions</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onRefreshPricing(id)}
                className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-extrabold text-white hover:bg-slate-800"
              >
                Recalculate Pricing
              </button>
              <button
                type="button"
                onClick={onGoToFeeAudit}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-extrabold text-slate-700 hover:bg-slate-50"
              >
                View Fee Audit
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeMilestones ? (
        <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm font-extrabold text-slate-900">Milestones</div>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left">Milestone</th>
                  <th className="px-3 py-2 text-left">Amount</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Due</th>
                  <th className="px-3 py-2 text-left">Approval / Release</th>
                </tr>
              </thead>
              <tbody>
                {milestones.length ? milestones.map((m) => (
                  <tr key={m.id} className="border-b border-slate-100">
                    <td className="px-3 py-2 font-semibold text-slate-900">{m.title || `Milestone #${m.id}`}</td>
                    <td className="px-3 py-2">{formatMoney(m.amount || 0)}</td>
                    <td className="px-3 py-2">{milestoneStatusLabel(m)}</td>
                    <td className="px-3 py-2">{m.due_date || m.completion_date || "—"}</td>
                    <td className="px-3 py-2">
                      {m.approved_at ? "Approved" : "Pending"} / {m.released_at ? "Released" : "Not released"}
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-slate-600">No milestone rows available.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {activeCommunication ? (
        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-extrabold text-slate-900">Communication History</div>
            <div className="mt-2 text-sm text-slate-600">
              Email and notification history placeholder.
            </div>
            {agreement?.last_sms_event?.summary ? (
              <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm text-slate-700">
                Last message: {agreement.last_sms_event.summary}
              </div>
            ) : null}
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-extrabold text-slate-900">Communication Actions</div>
            <div className="mt-3 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={onResendSignature}
                className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-extrabold text-white hover:bg-slate-800"
              >
                Resend Signature Request
              </button>
              <SendFundingLinkButton
                agreementId={id}
                isFullySigned={!!norm?.isSigned}
                amount={contractValue}
                label="Resend Payment Link"
                variant="secondary"
              />
            </div>
          </div>
        </div>
      ) : null}

      {activeDisputes ? (
        <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm font-extrabold text-slate-900">Related Disputes</div>
          <div className="mt-2 text-sm text-slate-600">
            {disputeRows.length ? `${disputeRows.length} related dispute(s) available.` : "No dispute rows included in this agreement payload."}
          </div>
          <div className="mt-3 space-y-2">
            {disputeRows.slice(0, 4).map((d) => (
              <div key={d.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-semibold text-slate-900">Dispute #{d.id}</div>
                  <div className="text-xs font-extrabold text-slate-700">{isDisputeTerminal(d.status) ? "Resolved — read only" : titleCase(d.status || "open")}</div>
                </div>
                <div className="mt-2 text-xs text-slate-600">
                  {d.summary || d.reason || "No summary available."}
                </div>
                <div className="mt-3 flex gap-2">
                  <button type="button" className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-slate-800">
                    View
                  </button>
                  {isDisputeTerminal(d.status) ? (
                    <button type="button" className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50">
                      Archive
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {activeAi ? (
        <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-extrabold text-slate-900">AI Context</div>
              <div className="mt-1 text-sm text-slate-600">
                Saved AI title, template, confidence, and reasons.
              </div>
            </div>
            <button
              type="button"
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-extrabold text-slate-700 hover:bg-slate-50"
              onClick={() => toast("AI Review placeholder.")}
            >
              Run AI Review
            </button>
          </div>

          {adminAiContext ? (
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Suggested title</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{adminAiContext.suggested_title || "Not available"}</div>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Template</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{adminAiContext.template_name || "Not available"}</div>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Confidence</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{adminAiContext.confidence || "Not available"}</div>
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
              No AI context saved for this agreement.
            </div>
          )}

          {adminAiContext?.reason ? (
            <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm text-slate-700">
              <span className="font-extrabold text-slate-900">Reason:</span> {adminAiContext.reason}
            </div>
          ) : null}

          {adminAiLoading ? (
            <div className="mt-3 text-sm text-slate-600">Loading AI context…</div>
          ) : null}
        </div>
      ) : null}

      {activeAudit ? (
        <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm font-extrabold text-slate-900">Audit Log</div>
          <div className="mt-2 text-sm text-slate-600">
            Timeline placeholder using agreement timestamps and document history.
          </div>
          <div className="mt-4 space-y-2 text-sm">
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">Created: {fmtDateTime(agreement?.created_at)}</div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">Updated: {fmtDateTime(agreement?.updated_at)}</div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">Signed: {fmtDateTime(agreement?.signed_at || agreement?.signed_date)}</div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">PDF versions tracked: {Array.isArray(norm?.pdfVersions) ? norm.pdfVersions.length : 0}</div>
          </div>
        </div>
      ) : null}
    </ContractorPageSurface>
  );
}

export default function AgreementDetail({ adminMode = false }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, ready, isAuthed } = useAuth();
  const isAdminMode = !!adminMode;
  const activeTab = useMemo(() => new URLSearchParams(location.search).get("tab") || "", [location.search]);
  const adminTab = useMemo(() => normalizeAdminTab(activeTab), [activeTab]);

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
  const [supportOpen, setSupportOpen] = useState(false);
  const [drawRows, setDrawRows] = useState([]);
  const [drawLoading, setDrawLoading] = useState(false);
  const [drawMilestones, setDrawMilestones] = useState([]);
  const [drawModalOpen, setDrawModalOpen] = useState(false);
  const [drawSaving, setDrawSaving] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentTargetDraw, setPaymentTargetDraw] = useState(null);
  const [externalPayments, setExternalPayments] = useState([]);
  const [externalPaymentsLoading, setExternalPaymentsLoading] = useState(false);
  const [agreementOpsMsg, setAgreementOpsMsg] = useState("");
  const [agreementOpBusy, setAgreementOpBusy] = useState("");
  const [adminAiContext, setAdminAiContext] = useState(null);
  const [adminAiLoading, setAdminAiLoading] = useState(false);
  const [drawForm, setDrawForm] = useState({ title: "", notes: "", percents: {} });
  const [paymentForm, setPaymentForm] = useState({
    gross_amount: "",
    retainage_withheld_amount: "",
    net_amount: "",
    payment_method: "ach",
    payment_date: "",
    reference_number: "",
    notes: "",
    proof_file: null,
  });
  const [subcontractorsLoading, setSubcontractorsLoading] = useState(false);
  const [pendingInvitations, setPendingInvitations] = useState([]);
  const [acceptedSubcontractors, setAcceptedSubcontractors] = useState([]);
  const [eligibleReviewers, setEligibleReviewers] = useState([]);
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
  const [completionResponseNotes, setCompletionResponseNotes] = useState({});
  const [completionDecisionBusy, setCompletionDecisionBusy] = useState({});
  const [payoutDecisionBusy, setPayoutDecisionBusy] = useState({});
  const [payoutReleaseTarget, setPayoutReleaseTarget] = useState(null);
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
  const paymentStructure = useMemo(
    () => normalizePaymentStructure(agreement?.payment_structure),
    [agreement?.payment_structure]
  );
  const isProgressPayments = paymentStructure === "progress";
  const isExecuted = Boolean(agreement?.signature_is_satisfied || agreement?.is_fully_signed);

  const isContractor =
    !isAdminMode &&
    (user?.role === "contractor" ||
      user?.role === "contractor_owner" ||
      user?.type === "contractor" ||
      user?.is_contractor ||
      !!getAccessToken());
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

  async function refreshAgreementPricing(agreementId) {
    setAgreementOpsMsg("");
    setAgreementOpBusy(`pricing-${agreementId}`);
    try {
      const res = await api.post(`/projects/admin/agreements/${agreementId}/refresh-pricing/`);
      setAgreementOpsMsg(res.data?.detail || "Pricing guidance refreshed.");
      navigate(`/app/admin/agreements/${agreementId}?tab=pricing`);
    } catch (err) {
      console.error("Admin pricing refresh error:", err);
      setAgreementOpsMsg("Failed to refresh pricing guidance.");
    } finally {
      setAgreementOpBusy("");
    }
  }

  async function resendAgreementSignature(agreementId) {
    setAgreementOpsMsg("");
    setAgreementOpBusy(`signature-${agreementId}`);
    try {
      const res = await api.post(`/projects/admin/agreements/${agreementId}/resend-signature/`);
      setAgreementOpsMsg(res.data?.detail || "Signature invite resent.");
    } catch (err) {
      console.error("Admin resend signature error:", err);
      setAgreementOpsMsg(
        err?.response?.data?.detail || "Failed to resend the agreement signature invite."
      );
    } finally {
      setAgreementOpBusy("");
    }
  }

  useEffect(() => {
    fetchAgreement();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!isProgressPayments || !isExecuted) {
      setDrawRows([]);
      setExternalPayments([]);
      return;
    }
    fetchDraws();
    fetchExternalPayments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isExecuted, isProgressPayments]);

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

  const fetchDraws = async () => {
    if (!id || !isProgressPayments || !isExecuted) {
      setDrawRows([]);
      return;
    }
    try {
      setDrawLoading(true);
      const data = await getAgreementDrawRequests(id);
      setDrawRows(Array.isArray(data?.results) ? data.results : []);
    } catch (e) {
      console.error(e);
      toast.error(formatApiError(e, "Failed to load draw requests."));
      setDrawRows([]);
    } finally {
      setDrawLoading(false);
    }
  };

  const fetchExternalPayments = async () => {
    if (!id || !isProgressPayments || !isExecuted) {
      setExternalPayments([]);
      return;
    }
    try {
      setExternalPaymentsLoading(true);
      const data = await getAgreementExternalPayments(id);
      setExternalPayments(Array.isArray(data?.results) ? data.results : []);
    } catch (e) {
      console.error(e);
      toast.error(formatApiError(e, "Failed to load external payments."));
      setExternalPayments([]);
    } finally {
      setExternalPaymentsLoading(false);
    }
  };

  const fetchDrawMilestones = async () => {
    if (!id) return [];
    try {
      const { data } = await api.get("/projects/milestones/", {
        params: { agreement: id, _ts: Date.now() },
      });
      const rows = Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : [];
      setDrawMilestones(rows);
      return rows;
    } catch (e) {
      console.error(e);
      toast.error("Failed to load milestones for draw creation.");
      return [];
    }
  };

  useEffect(() => {
    fetchSubcontractorInvitations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isContractor]);

  const fetchEligibleReviewers = async () => {
    if (!isContractor) return;
    try {
      const { data } = await api.get("/projects/subaccounts/");
      const rows = Array.isArray(data?.results) ? data.results : data || [];
      setEligibleReviewers(
        rows
          .filter((item) =>
            ["employee_milestones", "employee_supervisor"].includes(
              String(item.role || "")
            )
          )
          .map((item) => ({
            id: item.id,
            display_name: item.display_name || item.email || "Team Member",
            email: item.email || item.user?.email || "",
            role: item.role || "",
          }))
      );
    } catch (err) {
      console.error(err);
      setEligibleReviewers([]);
    }
  };

  useEffect(() => {
    fetchEligibleReviewers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isContractor]);

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
      if (!ready || !isAuthed) {
        setFundingPreview(null);
        setFundingError("");
        setFundingLoading(false);
        return;
      }

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
  }, [id, norm.isDirectPay, ready, isAuthed]);

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

  const openCreateDrawModal = async () => {
    const rows = await fetchDrawMilestones();
    const nextPercents = {};
    rows.forEach((row) => {
      nextPercents[String(row.id)] = "0";
    });
    setDrawForm({
      title: `Draw ${drawRows.length + 1}`,
      notes: "",
      percents: nextPercents,
    });
    setDrawModalOpen(true);
  };

  const submitCreateDraw = async () => {
    try {
      setDrawSaving(true);
      const lineItems = (drawMilestones || [])
        .map((milestone) => ({
          milestone_id: milestone.id,
          description: milestone.title || `Milestone ${milestone.id}`,
          scheduled_value: milestone.amount || "0.00",
          percent_complete: drawForm.percents[String(milestone.id)] || "0",
        }))
        .filter((row) => Number(row.percent_complete || 0) > 0);

      if (!lineItems.length) {
        toast.error("Enter percent complete for at least one milestone.");
        return;
      }

      await createAgreementDrawRequest(id, {
        title: drawForm.title,
        notes: drawForm.notes,
        line_items: lineItems,
      });
      toast.success("Draw request created.");
      setDrawModalOpen(false);
      await fetchDraws();
    } catch (e) {
      console.error(e);
      toast.error(formatApiError(e, "Failed to create draw request."));
    } finally {
      setDrawSaving(false);
    }
  };

  const runDrawAction = async (drawId, action) => {
    try {
      let result = null;
      if (action === "submit") result = await submitDrawRequest(drawId);
      if (action === "approve") result = await approveDrawRequest(drawId);
      if (action === "release") result = await releaseDrawRequest(drawId);
      if (action === "reject") result = await rejectDrawRequest(drawId);
      if (action === "changes") result = await requestDrawChanges(drawId);
      const successMessage =
        action === "release"
          ? "Escrow funds marked as released."
          : result?.email_delivery?.message || "Draw updated.";
      toast.success(successMessage);
      await fetchDraws();
      await fetchExternalPayments();
    } catch (e) {
      console.error(e);
      toast.error(formatApiError(e, "Failed to update draw."));
    }
  };

  const copyDrawReviewLink = async (draw) => {
    const url = String(draw?.public_review_url || "").trim();
    if (!url) {
      toast.error("Owner review link is not ready yet.");
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Owner review link copied.");
    } catch {
      toast.error("Unable to copy the owner review link.");
    }
  };

  const openDrawReviewLink = (draw) => {
    const url = String(draw?.public_review_url || "").trim();
    if (!url) {
      toast.error("Owner review link is not ready yet.");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const openExternalPaymentModal = (draw) => {
    setPaymentTargetDraw(draw);
    setPaymentForm({
      gross_amount: draw?.gross_amount || "",
      retainage_withheld_amount: draw?.retainage_amount || "0.00",
      net_amount: draw?.net_amount || "",
      payment_method: "ach",
      payment_date: new Date().toISOString().slice(0, 10),
      reference_number: "",
      notes: "",
      proof_file: null,
    });
    setPaymentModalOpen(true);
  };

  const submitExternalPayment = async () => {
    if (!paymentTargetDraw?.id) return;
    try {
      setPaymentSaving(true);
      const formData = new FormData();
      formData.append("gross_amount", paymentForm.gross_amount || "0.00");
      formData.append(
        "retainage_withheld_amount",
        paymentForm.retainage_withheld_amount || "0.00"
      );
      formData.append("net_amount", paymentForm.net_amount || "0.00");
      formData.append("payment_method", paymentForm.payment_method || "ach");
      formData.append("payment_date", paymentForm.payment_date);
      formData.append("reference_number", paymentForm.reference_number || "");
      formData.append("notes", paymentForm.notes || "");
      if (paymentForm.proof_file) {
        formData.append("proof_file", paymentForm.proof_file);
      }
      await recordDrawExternalPayment(paymentTargetDraw.id, formData);
      toast.success("External payment recorded.");
      setPaymentModalOpen(false);
      await fetchDraws();
      await fetchExternalPayments();
    } catch (e) {
      console.error(e);
      toast.error(formatApiError(e, "Failed to record external payment."));
    } finally {
      setPaymentSaving(false);
    }
  };

  useEffect(() => {
    if (!isAdminMode || adminTab !== "ai" || !id) {
      setAdminAiContext(null);
      setAdminAiLoading(false);
      return undefined;
    }

    let cancelled = false;

    const loadAdminAiContext = async () => {
      try {
        setAdminAiLoading(true);
        const { data } = await api.get(`/projects/admin/agreements/${id}/ai-context/`);
        if (!cancelled) setAdminAiContext(data);
      } catch (error) {
        console.error("Admin AI context load error:", error);
        if (!cancelled) setAdminAiContext(null);
      } finally {
        if (!cancelled) setAdminAiLoading(false);
      }
    };

    loadAdminAiContext();

    return () => {
      cancelled = true;
    };
  }, [adminTab, id, isAdminMode]);

  if (loading) return <div className="p-6">Loading…</div>;
  if (!norm.id) return <div className="p-6">Agreement not found.</div>;

  if (isAdminMode) {
    return (
      <AdminAgreementCommandCenter
        agreement={agreement}
        norm={norm}
        id={id}
        adminTab={adminTab}
        onBackToList={() => navigate("/app/admin?view=agreements")}
        onNavigateTab={(suffix) => navigate(`/app/admin/agreements/${id}${suffix || ""}`)}
        onRefreshPricing={refreshAgreementPricing}
        onResendSignature={resendAgreementSignature}
        onGoToFeeAudit={() => navigate("/app/admin?view=fee_audit")}
        fundingPreview={fundingPreview}
        adminAiContext={adminAiContext}
        adminAiLoading={adminAiLoading}
        agreementOpsMsg={agreementOpsMsg}
      />
    );
  }

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

  const assignMilestoneSubcontractor = async (
    milestoneId,
    invitationId,
    options = {}
  ) => {
    const payload = { invitation_id: invitationId };
    if (options.complianceAction) {
      payload.compliance_action = options.complianceAction;
    }
    if (options.overrideReason) {
      payload.override_reason = options.overrideReason;
    }
    if (options.agreedPay !== undefined && options.agreedPay !== "") {
      payload.agreed_pay = options.agreedPay;
    }
    if (options.paymentReleaseMode) {
      payload.payment_release_mode = options.paymentReleaseMode;
    }
    if (options.sendAgreement !== undefined) {
      payload.send_agreement = options.sendAgreement;
    }
    const { data } = await api.post(
      `/projects/milestones/${milestoneId}/assign-subcontractor/`,
      payload
    );
    const milestonePayload = data?.milestone || data;
    if (!milestonePayload?.id) {
      return data;
    }
    setAgreement((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        milestones: (prev.milestones || []).map((milestone) =>
          milestone.id === milestoneId
            ? { ...milestone, ...milestonePayload }
            : milestone
        ),
      };
    });
    if (options.complianceAction === "request_license") {
      toast.success("License request sent and assignment marked pending.");
    } else if (options.complianceAction === "assign_anyway") {
      toast.success("Subcontractor assigned with override.");
    } else {
      toast.success("Subcontractor assigned.");
    }
    return data;
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

  const assignDelegatedReviewer = async (milestoneId, subaccountId) => {
    const { data } = await api.patch(`/projects/milestones/${milestoneId}/`, {
      delegated_reviewer_subaccount: subaccountId,
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
    toast.success("Delegated reviewer assigned.");
  };

  const clearDelegatedReviewer = async (milestoneId) => {
    const { data } = await api.patch(`/projects/milestones/${milestoneId}/`, {
      delegated_reviewer_subaccount: null,
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
    toast.success("Delegated reviewer cleared.");
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

  const approveSubcontractorCompletion = async (milestoneId) => {
    try {
      setCompletionDecisionBusy((prev) => ({ ...prev, [milestoneId]: true }));
      const response_note = (completionResponseNotes[milestoneId] || "").trim();
      const { data } = await api.post(
        `/projects/milestones/${milestoneId}/approve-work/`,
        { response_note }
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
      setCompletionResponseNotes((prev) => ({ ...prev, [milestoneId]: "" }));
      toast.success("Subcontractor submission marked reviewed.");
    } catch (err) {
      console.error(err);
      toast.error(
        err?.response?.data?.detail ||
          "Failed to approve subcontractor submission."
      );
    } finally {
      setCompletionDecisionBusy((prev) => ({ ...prev, [milestoneId]: false }));
    }
  };

  const requestReleaseSubcontractorPayment = (milestone) => {
    const payoutAgreement = milestone?.subcontractor_milestone_agreement;
    if (!payoutAgreement?.id) {
      toast.error("No subcontractor payment terms were found for this milestone.");
      return;
    }
    setPayoutReleaseTarget({
      agreementId: payoutAgreement.id,
      milestoneId: milestone.id,
      milestoneTitle: milestone.title || "Milestone",
      subcontractorName:
        payoutAgreement.subcontractor_display_name ||
        payoutAgreement.subcontractor_email ||
        "Subcontractor",
      amount: payoutAgreement.agreed_pay || milestone.payout_amount || "",
    });
  };

  const confirmReleaseSubcontractorPayment = async () => {
    if (!payoutReleaseTarget?.agreementId) return;
    const { agreementId, milestoneId } = payoutReleaseTarget;
    try {
      setPayoutDecisionBusy((prev) => ({ ...prev, [milestoneId]: true }));
      const { data } = await api.post(
        `/projects/subcontractor-agreements/${agreementId}/release-payment/`,
        {}
      );
      setAgreement((prev) => {
        if (!prev) return prev;
        const updatedMilestone = data?.milestone || {};
        return {
          ...prev,
          milestones: (prev.milestones || []).map((milestone) =>
            milestone.id === milestoneId ? { ...milestone, ...updatedMilestone } : milestone
          ),
        };
      });
      setPayoutReleaseTarget(null);
      toast.success("Subcontractor payment released.");
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || "Failed to release subcontractor payment.");
    } finally {
      setPayoutDecisionBusy((prev) => ({ ...prev, [milestoneId]: false }));
    }
  };

  const executeMilestonePayout = async (milestoneId) => {
    try {
      setPayoutDecisionBusy((prev) => ({ ...prev, [milestoneId]: true }));
      const { data } = await api.post(
        `/projects/milestones/${milestoneId}/execute-subcontractor-payout/`,
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
      toast.success("Subcontractor payout executed.");
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || "Failed to execute subcontractor payout.");
    } finally {
      setPayoutDecisionBusy((prev) => ({ ...prev, [milestoneId]: false }));
    }
  };

  const retryMilestonePayout = async (milestoneId) => {
    try {
      setPayoutDecisionBusy((prev) => ({ ...prev, [milestoneId]: true }));
      const { data } = await api.post(
        `/projects/milestones/${milestoneId}/retry-subcontractor-payout/`,
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
      toast.success("Subcontractor payout retried.");
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || "Failed to retry subcontractor payout.");
    } finally {
      setPayoutDecisionBusy((prev) => ({ ...prev, [milestoneId]: false }));
    }
  };

  const resetMilestonePayout = async (milestoneId) => {
    try {
      setPayoutDecisionBusy((prev) => ({ ...prev, [milestoneId]: true }));
      const { data } = await api.post(
        `/projects/milestones/${milestoneId}/reset-subcontractor-payout/`,
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
      toast.success("Subcontractor payout reset to ready.");
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || "Failed to reset subcontractor payout.");
    } finally {
      setPayoutDecisionBusy((prev) => ({ ...prev, [milestoneId]: false }));
    }
  };

  const rejectSubcontractorCompletion = async (milestoneId) => {
    try {
      setCompletionDecisionBusy((prev) => ({ ...prev, [milestoneId]: true }));
      const response_note = (completionResponseNotes[milestoneId] || "").trim();
      const { data } = await api.post(
        `/projects/milestones/${milestoneId}/send-back-work/`,
        { response_note }
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
      setCompletionResponseNotes((prev) => ({ ...prev, [milestoneId]: "" }));
      toast.success("Sent back for changes.");
    } catch (err) {
      console.error(err);
      toast.error(
        err?.response?.data?.detail ||
          "Failed to send subcontractor submission back."
      );
    } finally {
      setCompletionDecisionBusy((prev) => ({ ...prev, [milestoneId]: false }));
    }
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
  const workspaceStatus = String(
    agreement?.status || agreement?.workflow_status || agreement?.state || ""
  )
    .trim()
    .toLowerCase();
  const isDraftWorkspace = workspaceStatus === "draft" || !workspaceStatus;
  const milestones = Array.isArray(norm?.milestones) ? norm.milestones : [];
  const agreementHint = getAgreementDetailHint({
    agreement,
    norm,
    milestones,
  });
  const backUrl = isAdminMode ? "/app/admin?view=agreements" : "/agreements";
  const pageEyebrow = isAdminMode ? "Admin" : "Core";
  const pageTitle = isAdminMode ? "Admin Agreement Detail" : "Contract Workspace";
  const pageSubtitle = isAdminMode
    ? "Review agreement details, pricing signals, and agreement history without contractor workflow actions."
    : "Manage signatures, funding, assignments, documents, milestones, and invoices after the agreement is sent.";

  return (
    <ContractorPageSurface
      eyebrow={pageEyebrow}
      title={pageTitle}
      subtitle={pageSubtitle}
      actions={
        <button
          onClick={() => navigate(backUrl)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
        >
          {isAdminMode ? "Back to Admin Agreements" : "Back to Agreements"}
        </button>
      }
    >
      <button
        onClick={() => navigate(backUrl)}
        className="hidden"
      >
        ← Back
      </button>

      <section className="rounded-[28px] border border-sky-200 bg-gradient-to-br from-sky-50 to-white p-6 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-3xl font-bold tracking-tight text-slate-950">
                {norm.title}
              </h2>
              <PaymentModeBadge mode={norm.payment_mode} />
              <ProjectModeBadge
                mode={norm.project_mode}
                dataTestId="agreement-detail-project-mode-badge"
              />
            </div>
            <div className="text-sm text-slate-600">
              <span className="font-semibold text-slate-900">{norm.homeownerName}</span>
              {norm.homeownerEmail && norm.homeownerEmail !== "—" ? (
                <span className="ml-2 text-slate-500">{norm.homeownerEmail}</span>
              ) : null}
            </div>
            {norm.isDirectPay && (
              <div className="max-w-2xl text-xs text-slate-600">
                Direct Pay agreements don&apos;t use escrow. Payment collection happens through invoice pay links as milestones are invoiced.
              </div>
            )}
          </div>

          <div className="grid min-w-[280px] grid-cols-1 gap-3 sm:grid-cols-2">
            <SummaryCard label="Status" value={statusText} className="border-sky-200 bg-white" />
            <SummaryCard
              label="Payment Mode"
              value={paymentModeLabel(norm.payment_mode)}
              className="border-sky-200 bg-white"
            />
            <SummaryCard
              label="Payment Protection"
              value={
                <span
                  className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-extrabold ${paymentProtectionTone(norm.payment_protection?.label)}`}
                >
                  {paymentProtectionLabel(norm.payment_protection?.label)}
                </span>
              }
              className="border-sky-200 bg-white"
            />
            <SummaryCard
              label="Project Mode"
              value={<ProjectModeBadge mode={norm.project_mode} />}
              className="border-sky-200 bg-white"
            />
            <SummaryCard
              label="Customer"
              value={norm.homeownerName}
              className="border-sky-200 bg-white"
            />
            <SummaryCard
              label="Project Total"
              value={formatMoney(norm.totalCost)}
              className="border-sky-200 bg-white"
            />
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Project Mode
            </div>
            <div className="mt-1 text-lg font-semibold text-slate-900">
              {projectModeLabel(norm.project_mode)}
            </div>
          </div>
          <ProjectModeBadge mode={norm.project_mode} />
        </div>
        {["assisted_diy", "consultation", "inspection_only"].includes(String(norm.project_mode || "").toLowerCase().replaceAll(" ", "_")) ? (
          <div
            className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
            data-testid="agreement-project-mode-safety-notice"
          >
            <div className="font-semibold">Assisted DIY / Collaboration</div>
            <div className="mt-1">
              Some project phases may require licensed professionals depending on local law, project scope, or safety requirements.
              Customer participation is limited to non-restricted activities unless otherwise agreed and allowed by law.
              Contractor may refuse unsafe or non-compliant homeowner participation.
            </div>
          </div>
        ) : null}
        <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-slate-800" data-testid="agreement-payment-protection-summary">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
                Payment Protection
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-900">
                {paymentProtectionLabel(norm.payment_protection?.label)}
              </div>
            </div>
            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-extrabold ${paymentProtectionTone(norm.payment_protection?.label)}`}>
              {paymentProtectionLabel(norm.payment_protection?.label)}
            </span>
          </div>
          <div className="mt-2 text-sm text-slate-700">
            {norm.payment_protection?.reason || "Escrow milestone payments help protect both homeowners and contractors."}
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Homeowner participation</div>
            <div className="mt-1 text-sm text-slate-700 whitespace-pre-wrap">
              {norm.homeowner_participation_notes || "Not specified"}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Homeowner responsibilities</div>
            <div className="mt-1 text-sm text-slate-700 whitespace-pre-wrap">
              {norm.homeowner_responsibilities || "Not specified"}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Contractor responsibilities</div>
            <div className="mt-1 text-sm text-slate-700 whitespace-pre-wrap">
              {norm.contractor_responsibilities || "Not specified"}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Excluded work</div>
            <div className="mt-1 text-sm text-slate-700 whitespace-pre-wrap">
              {norm.excluded_work || "Not specified"}
            </div>
          </div>
        </div>
      </section>

      {["assisted_diy", "consultation", "inspection_only"].includes(String(norm.project_mode || "").toLowerCase().replaceAll(" ", "_")) ? (
        <section data-testid="agreement-detail-responsibility-matrix" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Responsibility Matrix
              </div>
              <div className="mt-1 text-lg font-semibold text-slate-900">
                How responsibilities are split across this project
              </div>
            </div>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
              {norm.collaboration_summary || "Collaborative project"}
            </span>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {[
              ["homeowner_responsibilities", "Homeowner Responsibilities", "amber"],
              ["contractor_responsibilities", "Contractor Responsibilities", "blue"],
              ["shared_responsibilities", "Shared Responsibilities", "violet"],
              ["excluded_work", "Excluded Work", "slate"],
            ].map(([key, title, tone]) => {
              const section = norm.responsibility_matrix?.[key] || {};
              const milestones = Array.isArray(section?.milestones) ? section.milestones : [];
              return (
                <div key={key} data-testid={`agreement-detail-responsibility-${key}`} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="text-sm font-semibold text-slate-900">{title}</div>
                    <span
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                        tone === "amber"
                          ? "border-amber-200 bg-amber-50 text-amber-800"
                          : tone === "blue"
                          ? "border-blue-200 bg-blue-50 text-blue-700"
                          : tone === "violet"
                          ? "border-violet-200 bg-violet-50 text-violet-700"
                          : "border-slate-200 bg-slate-100 text-slate-700"
                      }`}
                    >
                      {Number(section?.count || milestones.length || 0).toLocaleString()} milestone{Number(section?.count || milestones.length || 0) === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="mt-2 text-sm text-slate-700 whitespace-pre-wrap">
                    {section?.summary || "Not specified"}
                  </div>
                  {milestones.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {milestones.slice(0, 6).map((m) => (
                        <span key={m.id || m.title} className="rounded-full border border-white bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 shadow-sm">
                          {m.title}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          {Array.isArray(norm.homeowner_acknowledgements) && norm.homeowner_acknowledgements.length ? (
            <div data-testid="agreement-detail-homeowner-acknowledgements" className="mt-4 rounded-xl border border-sky-200 bg-sky-50 p-4">
              <div className="text-sm font-semibold text-slate-900">Homeowner Acknowledgements</div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {norm.homeowner_acknowledgements.map((item) => (
                  <div key={item.key || item.label} className="rounded-lg border border-white bg-white p-3 shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-slate-900">{item.label}</div>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                          item.acknowledged
                            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                            : "border-slate-200 bg-slate-100 text-slate-700"
                        }`}
                      >
                        {item.acknowledged ? "Acknowledged" : "Pending"}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-600 whitespace-pre-wrap">{item.detail || "No details available."}</div>
                    {item.acknowledged_at ? (
                      <div className="mt-2 text-xs text-slate-500">Acknowledged at {fmtDateTime(item.acknowledged_at)}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {Array.isArray(norm.inspection_summary?.items) && norm.inspection_summary.items.length ? (
            <div data-testid="agreement-detail-inspection-checkpoints" className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-sm font-semibold text-slate-900">Inspection Checkpoints</div>
              <div className="mt-1 text-xs text-slate-600">
                Requested: {Number(norm.inspection_summary.requested_count || 0).toLocaleString()} · Passed: {Number(norm.inspection_summary.passed_count || 0).toLocaleString()} · Revision required: {Number(norm.inspection_summary.revision_required_count || 0).toLocaleString()}
              </div>
              <div className="mt-3 space-y-2">
                {norm.inspection_summary.items.slice(0, 6).map((item) => (
                  <div key={item.id || item.title} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-slate-900">{item.title}</div>
                      <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                        {item.status_label || item.status}
                      </span>
                    </div>
                    {item.notes ? <div className="mt-1 text-xs text-slate-600 whitespace-pre-wrap">{item.notes}</div> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {norm.rescue_project_summary?.is_rescue_project || norm.rescue_project_summary?.summary ? (
            <div data-testid="agreement-detail-rescue-project-summary" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="text-sm font-semibold text-amber-900">Rescue / Partial Completion Notes</div>
              <div className="mt-2 text-sm text-amber-900 whitespace-pre-wrap">
                {norm.rescue_project_summary?.summary || "Project already started context applies."}
              </div>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {norm.rescue_project_summary?.takeover_notes ? (
                  <div className="rounded-lg border border-white bg-white p-3 text-sm text-slate-700 shadow-sm">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Homeowner provided work</div>
                    <div className="mt-1 whitespace-pre-wrap">{norm.rescue_project_summary.takeover_notes}</div>
                  </div>
                ) : null}
                {norm.rescue_project_summary?.contractor_takeover_notes ? (
                  <div className="rounded-lg border border-white bg-white p-3 text-sm text-slate-700 shadow-sm">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Contractor takeover</div>
                    <div className="mt-1 whitespace-pre-wrap">{norm.rescue_project_summary.contractor_takeover_notes}</div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {isDraftWorkspace ? (
        <div
          data-testid="agreement-detail-draft-notice"
          className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-sm"
        >
          <div className="font-semibold">This agreement is still being drafted.</div>
          <div className="mt-1">
            Use the wizard to finish setup before managing contract activity.
          </div>
          <button
            type="button"
            data-testid="agreement-detail-back-to-wizard-button"
            onClick={() => navigate(isAdminMode ? backUrl : `/app/agreements/${id}/wizard?step=1`)}
            className="mt-3 rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100"
          >
            {isAdminMode ? "Back to Admin Agreements" : "Back to Wizard"}
          </button>
        </div>
      ) : null}

      {isAdminMode && activeTab === "ai" ? (
        <section
          id="admin-agreement-ai-context"
          data-testid="admin-agreement-ai-context"
          className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5 shadow-sm"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-extrabold uppercase tracking-wide text-indigo-700">
                Admin AI Context
              </div>
              <div className="mt-1 text-lg font-semibold text-slate-900">
                Agreement AI notes and pricing signals
              </div>
              <div className="mt-1 text-sm text-slate-700">
                Review the source lead and AI hints without leaving the admin agreement context.
              </div>
            </div>
            <span className="rounded-full border border-indigo-200 bg-white px-2.5 py-1 text-[11px] font-extrabold text-indigo-700">
              {adminAiLoading ? "Loading..." : "Loaded"}
            </span>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-indigo-200 bg-white p-3">
              <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
                Suggested title
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-900">
                {adminAiContext?.suggested_title || "Not available"}
              </div>
            </div>
            <div className="rounded-xl border border-indigo-200 bg-white p-3">
              <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
                Template
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-900">
                {adminAiContext?.template_name || "Not available"}
              </div>
            </div>
            <div className="rounded-xl border border-indigo-200 bg-white p-3">
              <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
                Confidence
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-900">
                {adminAiContext?.confidence || "Not available"}
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-indigo-200 bg-white p-3 text-sm text-slate-700">
            <div className="font-extrabold text-slate-900">Reason</div>
            <div className="mt-1">
              {adminAiContext?.reason || "No AI recommendation notes were saved for this agreement."}
            </div>
          </div>

          {Array.isArray(adminAiContext?.pricing_confidence_levels) &&
          adminAiContext.pricing_confidence_levels.length ? (
            <div className="mt-4 text-sm text-slate-700">
              <span className="font-extrabold text-slate-900">Pricing confidence:</span>{" "}
              {adminAiContext.pricing_confidence_levels.join(", ")}
            </div>
          ) : null}

          {Array.isArray(adminAiContext?.pricing_sources) && adminAiContext.pricing_sources.length ? (
            <div className="mt-3">
              <div className="text-sm font-extrabold text-slate-900">Pricing sources</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {adminAiContext.pricing_sources.slice(0, 4).map((source, index) => (
                  <span
                    key={`${source}-${index}`}
                    className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] font-semibold text-indigo-800"
                  >
                    {source}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}


      {false ? (
      <details
        className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm"
        data-testid="agreement-sms-automation"
      >
        <summary className="cursor-pointer list-none font-semibold text-slate-900">
          SMS Automation
        </summary>
        {agreement?.last_sms_automation_decision ? (
          <div className="mt-2 space-y-1">
            <div>
              Last decision:{" "}
              <span className="font-semibold text-slate-900">
                {agreement.last_sms_automation_decision.reason_code}
              </span>
            </div>
            <div className="text-xs text-slate-500">
              {agreement.last_sms_automation_decision.message_preview || "No message preview available."}
            </div>
          </div>
        ) : (
          <div className="mt-2 text-sm text-slate-600">
            No SMS automation decisions for this agreement yet.
          </div>
        )}
        {Array.isArray(agreement?.recent_sms_automation_decisions) &&
        agreement.recent_sms_automation_decisions.length ? (
          <div className="mt-3 space-y-2">
            {agreement.recent_sms_automation_decisions.slice(0, 4).map((item) => (
              <div
                key={item.id || `${item.event_type}-${item.created_at}`}
                className="rounded-lg bg-slate-50 px-3 py-2"
              >
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  {item.event_type}
                </div>
                <div className="mt-1 text-sm text-slate-800">
                  {item.reason_code} · {item.channel_decision}
                  {item.sent ? " · sent" : item.deferred ? " · deferred" : ""}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </details>
      ) : null}

      <WorkflowHint
        hint={agreementHint}
        testId="agreement-detail-hint"
      />

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3">
          <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">
            Primary Actions
          </h3>
          <div className="mt-1 text-sm text-slate-600">
            Handle signatures, documents, and the next key job action from one place.
          </div>
        </div>
        <div className="flex flex-wrap gap-3 items-start">
        {!norm.isSigned && (
          <button
            onClick={() => setSigOpen(true)}
            className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            Sign
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
            className="rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-600"
          >
            Fund Escrow
          </button>
        )}

        {!norm.isDirectPay && norm.escrowFunded && (
          <button
            onClick={() => setRefundOpen(true)}
            className="rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-700"
            title="Refund Control Center (unreleased escrow only)."
          >
            Refund Escrow
          </button>
        )}

        <button
          onClick={previewPdf}
          className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          Preview PDF
        </button>

        <button
          onClick={downloadPDF}
          className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-950"
        >
          Download PDF
        </button>

        <button
          type="button"
          data-testid="agreement-support-button"
          onClick={() => setSupportOpen(true)}
          className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Support
        </button>

        {isContractor && (
          <button
            data-testid="invite-subcontractor-button"
            type="button"
            onClick={() => setInviteFormOpen((open) => !open)}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            {inviteFormOpen ? "Close Invite Form" : "Invite Subcontractor"}
          </button>
        )}
      </div>
      </div>

      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Assignment / Team</h3>
          <div className="mt-1 text-sm text-slate-600">
            Manage who owns the agreement and who is helping deliver the work.
          </div>
        </div>

      {/* ✅ NEW: Agreement assignment selector */}
      {isContractor && (
        <AssignEmployeeInline
          label="Assign Entire Agreement"
          help="Assigning an agreement makes all milestones visible to that employee unless a milestone is explicitly assigned to someone else."
          onAssign={(subId) => assignAgreement(subId)}
          onUnassign={(subId) => unassignAgreement(subId)}
          assignButtonLabel="Assign Owner"
          unassignButtonLabel="Remove Owner"
        />
      )}

      {isContractor && (
        <div
          data-testid="subcontractor-section"
          className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4"
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
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Documents</h3>
          <div className="mt-1 text-sm text-slate-600">
            Keep the live PDF, attachments, and warranty records together so document review feels like one workflow.
          </div>
        </div>

      {/* ✅ PDF Versions */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-3">
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
        className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4"
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
      </section>

      {/* Milestones */}
      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Milestones</h3>
          <div className="mt-1 text-sm text-slate-600">
            Track execution, assignment overrides, review state, and payout readiness in one place.
          </div>
        </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-3">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <h3 className="text-lg font-semibold">Milestone Control</h3>
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
              const roleLabel = deriveMilestoneRoleLabel({ projectMode: norm.project_mode, milestone: m });
              const payoutOrchestration =
                m.subcontractor_payout_orchestration ||
                m.subcontractor_milestone_agreement?.payout_orchestration ||
                {};
              const payoutState = String(
                payoutOrchestration.payout_state ||
                  payoutOrchestration.next_status ||
                  m.payout_status ||
                  ""
              ).toLowerCase();
              const payoutMode =
                m.subcontractor_milestone_agreement?.payment_release_mode_label ||
                m.subcontractor_milestone_agreement?.payment_release_mode ||
                "";
              const payoutAmount =
                payoutOrchestration.payout_amount ||
                m.payout_amount ||
                m.subcontractor_milestone_agreement?.agreed_pay ||
                m.amount;

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
                    <MilestoneRoleBadge
                      role={m.milestone_role}
                      projectMode={norm.project_mode}
                      milestone={m}
                      className="ml-2"
                      dataTestId={`agreement-milestone-role-${m.id}`}
                      title={roleLabel}
                    />
                    <MilestoneSafetyBadges
                      projectMode={norm.project_mode}
                      milestone={m}
                      className="ml-2"
                      dataTestId={`agreement-milestone-safety-${m.id}`}
                    />
                    <InspectionStatusBadge
                      status={m.inspection_status}
                      className="ml-2"
                      dataTestId={`agreement-milestone-inspection-${m.id}`}
                    />
                  </div>

                  <div className="mt-2 text-sm text-gray-600">
                    <span className="font-semibold text-gray-900">
                      Assigned Worker:
                    </span>{" "}
                    {m.assigned_worker_display || "Unassigned"}
                  </div>

                  <div className="mt-2 text-sm text-gray-600">
                    <span className="font-semibold text-gray-900">Reviewer:</span>{" "}
                    {m.reviewer_display || "Contractor Owner"}
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

                  <div
                    data-testid={`milestone-completion-state-${m.id}`}
                    className="mt-2 text-sm text-gray-600"
                  >
                    <span className="font-semibold text-gray-900">
                      Work submission:
                    </span>{" "}
                    {String(
                      m.work_submission_status ||
                        m.subcontractor_completion_status ||
                        "not_submitted"
                    )
                      .replaceAll("_", " ")
                      .replace(/^\w/, (c) => c.toUpperCase())}
                    {m.work_submitted_at || m.subcontractor_marked_complete_at ? (
                      <span className="text-gray-500">
                        {" "}
                        ({fmtDateTime(m.work_submitted_at || m.subcontractor_marked_complete_at)})
                      </span>
                    ) : null}
                  </div>

                  {m.work_submission_note || m.subcontractor_completion_note ? (
                    <div className="mt-1 text-sm text-gray-600 whitespace-pre-wrap">
                      <span className="font-semibold text-gray-900">
                        Completion note:
                      </span>{" "}
                      {m.work_submission_note || m.subcontractor_completion_note}
                    </div>
                  ) : null}

                  {m.work_review_response_note || m.subcontractor_review_response_note ? (
                    <div className="mt-1 text-sm text-gray-600 whitespace-pre-wrap">
                      <span className="font-semibold text-gray-900">
                        Review response:
                      </span>{" "}
                      {m.work_review_response_note || m.subcontractor_review_response_note}
                    </div>
                  ) : null}

                  {isContractor &&
                  m.assigned_worker &&
                  m.assigned_worker.kind === "subcontractor" ? (
                    <div
                      data-testid={`milestone-payout-state-${m.id}`}
                      className="mt-3 rounded-xl border border-slate-200 bg-white p-4 text-sm text-gray-700"
                    >
                      <span className="font-semibold text-gray-900">Payout:</span>{" "}
                      {m.payout_amount ? formatMoney(m.payout_amount) : "—"}{" "}
                      <span className="text-gray-500">
                        ({formatPayoutStatus(m.payout_status)})
                      </span>
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <div className="rounded-lg bg-slate-50 px-3 py-2">
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Amount
                          </div>
                          <div className="font-semibold text-slate-900">
                            {payoutAmount ? formatMoney(payoutAmount) : "—"}
                          </div>
                        </div>
                        <div className="rounded-lg bg-slate-50 px-3 py-2">
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Release Mode
                          </div>
                          <div className="font-semibold text-slate-900">
                            {payoutMode || "Manual Release"}
                          </div>
                        </div>
                        <div className="rounded-lg bg-slate-50 px-3 py-2 md:col-span-2">
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Status
                          </div>
                          <div className="font-semibold text-slate-900">
                            {payoutOrchestration.safe_summary ||
                              payoutOrchestrationLabel(payoutState)}
                          </div>
                        </div>
                      </div>
                      {Array.isArray(payoutOrchestration.blocking_reasons_labels) &&
                      payoutOrchestration.blocking_reasons_labels.length ? (
                        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-slate-700">
                          <div className="font-semibold text-slate-900">
                            Blocking reasons
                          </div>
                          <ul className="mt-1 list-disc pl-5">
                            {payoutOrchestration.blocking_reasons_labels.map((reason) => (
                              <li key={reason}>{reason}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {m.payout_ready_for_payout_at ? (
                        <div
                          data-testid={`milestone-payout-ready-at-${m.id}`}
                          className="mt-1 text-xs text-emerald-700"
                        >
                          Ready for payout: {fmtDateTime(m.payout_ready_for_payout_at)}
                        </div>
                      ) : null}
                      {m.payout_paid_at ? (
                        <div
                          data-testid={`milestone-payout-paid-at-${m.id}`}
                          className="mt-1 text-xs text-emerald-700"
                        >
                          Paid: {fmtDateTime(m.payout_paid_at)}
                        </div>
                      ) : null}
                      {m.payout_failed_at ? (
                        <div
                          data-testid={`milestone-payout-failed-at-${m.id}`}
                          className="mt-1 text-xs text-rose-700"
                        >
                          Failed: {fmtDateTime(m.payout_failed_at)}
                        </div>
                      ) : null}
                      {m.payout_stripe_transfer_id ? (
                        <div className="mt-1 text-xs text-gray-500">
                          Transfer: {m.payout_stripe_transfer_id}
                        </div>
                      ) : null}
                      {m.payout_execution_mode ? (
                        <div className="mt-1 text-xs text-gray-500">
                          Execution: {formatExecutionMode(m.payout_execution_mode)}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {isContractor && m.payout_failure_reason ? (
                    <div
                      data-testid={`milestone-payout-failure-${m.id}`}
                      className="mt-1 text-sm text-rose-700 whitespace-pre-wrap"
                    >
                      <span className="font-semibold">Payout failure:</span>{" "}
                      {m.payout_failure_reason}
                    </div>
                  ) : null}

                  {isContractor && (
                    <div className="mt-3">
                      <AssignSubcontractorInline
                        acceptedSubcontractors={acceptedSubcontractors}
                        currentAssignment={m.assigned_subcontractor}
                        currentCompliance={m.subcontractor_assignment_compliance}
                        currentAgreement={m.subcontractor_milestone_agreement}
                        milestoneAmount={m.amount}
                        onAssign={(invitationId, options) =>
                          assignMilestoneSubcontractor(m.id, invitationId, options)
                        }
                        onUnassign={() => unassignMilestoneSubcontractor(m.id)}
                      />
                      <div className="mt-3">
                        <AssignReviewerInline
                          reviewers={eligibleReviewers}
                          currentReviewer={m.reviewer}
                          onAssign={(subaccountId) =>
                            assignDelegatedReviewer(m.id, subaccountId)
                          }
                          onClear={() => clearDelegatedReviewer(m.id)}
                        />
                      </div>
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
                      <div className="mt-3 space-y-2 rounded-lg border border-gray-200 bg-white p-4">
                        <div className="text-sm font-semibold text-gray-900">
                          Worker Submission Review
                        </div>
                        <textarea
                          data-testid={`milestone-completion-response-note-${m.id}`}
                          rows={2}
                          value={completionResponseNotes[m.id] || ""}
                          onChange={(e) =>
                            setCompletionResponseNotes((prev) => ({
                              ...prev,
                              [m.id]: e.target.value,
                            }))
                          }
                          className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                          placeholder="Optional response note"
                        />
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            data-testid={`milestone-completion-approve-${m.id}`}
                            onClick={() => approveSubcontractorCompletion(m.id)}
                            disabled={
                              completionDecisionBusy[m.id] ||
                              (m.work_submission_status ||
                                m.subcontractor_completion_status) !==
                                "submitted_for_review"
                            }
                            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                          >
                            {completionDecisionBusy[m.id] ? "Working..." : "Mark Reviewed"}
                          </button>
                          <button
                            type="button"
                            data-testid={`milestone-completion-reject-${m.id}`}
                            onClick={() => rejectSubcontractorCompletion(m.id)}
                            disabled={
                              completionDecisionBusy[m.id] ||
                              (m.work_submission_status ||
                                m.subcontractor_completion_status) !==
                                "submitted_for_review"
                            }
                            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                          >
                            {completionDecisionBusy[m.id] ? "Working..." : "Send Back for Changes"}
                          </button>
                        </div>
                      </div>
                      {payoutState === "ready" || payoutState === "ready_for_payout" ? (
                        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                          <div className="text-sm font-semibold text-emerald-900">
                            Subcontractor payout is ready for contractor release.
                          </div>
                          <div className="mt-1 text-sm text-emerald-800">
                            Amount: {m.payout_amount ? formatMoney(m.payout_amount) : "—"}
                          </div>
                          {payoutOrchestration.can_manual_release ? (
                            <button
                              type="button"
                              data-testid={`milestone-payout-execute-${m.id}`}
                              onClick={() => requestReleaseSubcontractorPayment(m)}
                              disabled={payoutDecisionBusy[m.id]}
                              className="mt-3 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                            >
                              {payoutDecisionBusy[m.id]
                                ? "Processing..."
                                : "Release Subcontractor Payment"}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                      {payoutState === "scheduled" ? (
                        <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50 p-4">
                          <div className="text-sm font-semibold text-indigo-900">
                            Subcontractor payout is scheduled.
                          </div>
                          <div className="mt-1 text-sm text-indigo-800">
                            The system will release this payment after customer approval and payout setup checks.
                          </div>
                        </div>
                      ) : null}
                      {payoutState === "blocked" ? (
                        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
                          <div className="text-sm font-semibold text-amber-900">
                            Subcontractor payout is blocked.
                          </div>
                          <div className="mt-1 text-sm text-amber-800">
                            {payoutOrchestration.safe_summary ||
                              "Review the blocking reasons shown above."}
                          </div>
                        </div>
                      ) : null}
                      {m.payout_status === "failed" ? (
                        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-4">
                          <div className="text-sm font-semibold text-rose-900">
                            Subcontractor payout failed.
                          </div>
                          <div className="mt-1 text-sm text-rose-800">
                            Amount: {m.payout_amount ? formatMoney(m.payout_amount) : "—"}
                          </div>
                          {m.payout_failure_reason ? (
                            <div className="mt-1 text-sm text-rose-800 whitespace-pre-wrap">
                              Reason: {m.payout_failure_reason}
                            </div>
                          ) : null}
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              data-testid={`milestone-payout-retry-${m.id}`}
                              onClick={() => retryMilestonePayout(m.id)}
                              disabled={payoutDecisionBusy[m.id]}
                              className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
                            >
                              {payoutDecisionBusy[m.id] ? "Working..." : "Retry Payout"}
                            </button>
                            <button
                              type="button"
                              data-testid={`milestone-payout-reset-${m.id}`}
                              onClick={() => resetMilestonePayout(m.id)}
                              disabled={payoutDecisionBusy[m.id]}
                              className="rounded-lg border border-rose-300 bg-white px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                            >
                              {payoutDecisionBusy[m.id] ? "Working..." : "Reset Payout"}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      </section>

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

      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Secondary Details</h3>
          <div className="mt-1 text-sm text-slate-600">
            Communication diagnostics and lower-priority agreement details stay available here without competing with the core job controls above.
          </div>
        </div>

        <details
          className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm"
          data-testid="agreement-sms-status"
        >
          <summary className="cursor-pointer list-none font-semibold text-slate-900">
            SMS Status
          </summary>
          <div className="mt-2">
            {agreement?.sms_enabled
              ? "Customer SMS updates are enabled for this agreement."
              : agreement?.sms_opted_out
              ? "Customer has opted out of SMS updates for this agreement."
              : "Customer SMS updates are not enabled for this agreement yet."}
          </div>
          {agreement?.sms_status?.phone_number_e164 ? (
            <div className="mt-1 text-xs text-slate-500">
              Phone: {agreement.sms_status.phone_number_e164}
            </div>
          ) : null}
          {agreement?.last_sms_event?.summary ? (
            <div className="mt-1 text-xs text-slate-500">
              Last SMS event: {agreement.last_sms_event.summary}
            </div>
          ) : null}
        </details>

        <details
          className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm"
          data-testid="agreement-sms-automation"
        >
          <summary className="cursor-pointer list-none font-semibold text-slate-900">
            SMS Automation
          </summary>
          {agreement?.last_sms_automation_decision ? (
            <div className="mt-2 space-y-1">
              <div>
                Last decision:{" "}
                <span className="font-semibold text-slate-900">
                  {agreement.last_sms_automation_decision.reason_code}
                </span>
              </div>
              <div className="text-xs text-slate-500">
                {agreement.last_sms_automation_decision.message_preview ||
                  "No message preview available."}
              </div>
            </div>
          ) : (
            <div className="mt-2 text-sm text-slate-600">
              No SMS automation decisions for this agreement yet.
            </div>
          )}
          {Array.isArray(agreement?.recent_sms_automation_decisions) &&
          agreement.recent_sms_automation_decisions.length ? (
            <div className="mt-3 space-y-2">
              {agreement.recent_sms_automation_decisions.slice(0, 4).map((item) => (
                <div
                  key={item.id || `${item.event_type}-${item.created_at}`}
                  className="rounded-lg bg-slate-50 px-3 py-2"
                >
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    {item.event_type}
                  </div>
                  <div className="mt-1 text-sm text-slate-800">
                    {item.reason_code} · {item.channel_decision}
                    {item.sent ? " · sent" : item.deferred ? " · deferred" : ""}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </details>
      </section>

      {isProgressPayments && (
        <>
          <div className="bg-white rounded shadow p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold mb-1">Draw Requests</h3>
                <p className="text-sm text-gray-500">
                  Create and review progress-payment draws after the agreement is signed.
                </p>
              </div>
              {isExecuted ? (
                <button
                  type="button"
                  onClick={openCreateDrawModal}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
                >
                  Create Draw
                </button>
              ) : null}
            </div>

            {!isExecuted ? (
              <div className="mt-4 rounded-lg border border-dashed border-gray-300 px-4 py-4 text-sm text-gray-500">
                Draw tools unlock after the agreement is fully signed.
              </div>
            ) : drawLoading ? (
              <div className="mt-4 text-sm text-gray-500">Loading draw requests…</div>
            ) : drawRows.length === 0 ? (
              <div className="mt-4 rounded-lg border border-dashed border-gray-300 px-4 py-4 text-sm text-gray-500">
                No draw requests yet.
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {drawRows.map((draw) => (
                  <div key={draw.id} className="rounded-xl border border-gray-200 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="text-sm font-semibold text-gray-900">
                          Draw {draw.draw_number}: {draw.title}
                        </div>
                        <div className="mt-1 text-xs text-gray-500">
                          Status: {drawWorkflowLabel(draw)} • Gross {formatMoney(draw.gross_amount)} •
                          Retainage {formatMoney(draw.retainage_amount)} • Net {formatMoney(draw.net_amount)}
                        </div>
                        {draw.review_email_sent_at ? (
                          <div className="mt-1 text-xs text-emerald-700">
                            Owner review email sent. The public review link is ready to share.
                          </div>
                        ) : null}
                        {draw.homeowner_review_notes ? (
                          <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                            Owner note: {draw.homeowner_review_notes}
                          </div>
                        ) : null}
                        {drawWorkflowStatus(draw) === "payment_pending" ? (
                          <div className={`mt-2 text-xs ${draw?.is_awaiting_release ? "text-teal-700" : "text-indigo-700"}`}>
                            {draw?.is_awaiting_release
                              ? "Owner approval is complete. Payment is pending while this escrow draw waits for release in MyHomeBro."
                              : "Owner approval is complete. Payment is still pending through the draw review page in MyHomeBro."}
                          </div>
                        ) : null}
                        {drawWorkflowStatus(draw) === "paid" ? (
                          <div className="mt-2 text-xs text-emerald-700">
                            {draw?.released_at
                              ? `Payment completed${draw.released_at ? ` on ${fmtDateTime(draw.released_at)}` : ""}.`
                              : `Payment recorded${draw.paid_at ? ` on ${fmtDateTime(draw.paid_at)}` : ""}${draw.paid_via ? ` via ${String(draw.paid_via).toUpperCase()}` : ""}.`}
                          </div>
                        ) : null}
                        {drawWorkflowStatus(draw) === "disputed" ? (
                          <div className="mt-2 text-xs text-rose-700">
                            A payment issue is under review for this draw.
                          </div>
                        ) : null}
                        {draw.notes ? (
                          <div className="mt-2 text-sm text-gray-600 whitespace-pre-wrap">{draw.notes}</div>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {draw.status === "draft" || draw.status === "changes_requested" ? (
                          <button
                            type="button"
                            onClick={() => runDrawAction(draw.id, "submit")}
                            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                          >
                            Submit
                          </button>
                        ) : null}
                        {draw.status === "submitted" ? (
                          <>
                            <button
                              type="button"
                              onClick={() => openDrawReviewLink(draw)}
                              className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
                            >
                              Open Owner Review
                            </button>
                            <button
                              type="button"
                              onClick={() => copyDrawReviewLink(draw)}
                              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              Copy Review Link
                            </button>
                          </>
                        ) : null}
                        {drawWorkflowStatus(draw) === "payment_pending" && !draw?.is_awaiting_release ? (
                          <>
                            <button
                              type="button"
                              onClick={() => openDrawReviewLink(draw)}
                              className="rounded-lg border border-indigo-300 bg-white px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
                            >
                              View Owner Page
                            </button>
                            <button
                              type="button"
                              onClick={() => openExternalPaymentModal(draw)}
                              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              Record Offline Payment
                            </button>
                          </>
                        ) : null}
                        {draw?.is_awaiting_release ? (
                          <>
                            <button
                              type="button"
                              onClick={() => openDrawReviewLink(draw)}
                              className="rounded-lg border border-teal-300 bg-white px-3 py-2 text-xs font-semibold text-teal-700 hover:bg-teal-50"
                            >
                              View Owner Page
                            </button>
                            <button
                              type="button"
                              onClick={() => runDrawAction(draw.id, "release")}
                              className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
                            >
                              Release Funds
                            </button>
                          </>
                        ) : null}
                      </div>
                    </div>

                    {Array.isArray(draw.line_items) && draw.line_items.length ? (
                      <div className="mt-4 overflow-x-auto">
                        <table className="min-w-full text-xs">
                          <thead>
                            <tr className="border-b border-gray-200 text-left text-gray-500">
                              <th className="py-2 pr-3">Line Item</th>
                              <th className="py-2 pr-3">Scheduled Value</th>
                              <th className="py-2 pr-3">% Complete</th>
                              <th className="py-2 pr-3">This Draw</th>
                              <th className="py-2 pr-3">Remaining</th>
                            </tr>
                          </thead>
                          <tbody>
                            {draw.line_items.map((item) => (
                              <tr key={item.id} className="border-b border-gray-100">
                                <td className="py-2 pr-3 text-gray-700">
                                  {item.milestone_title || item.description}
                                </td>
                                <td className="py-2 pr-3">{formatMoney(item.scheduled_value)}</td>
                                <td className="py-2 pr-3">{Number(item.percent_complete || 0).toFixed(2)}%</td>
                                <td className="py-2 pr-3">{formatMoney(item.this_draw_amount)}</td>
                                <td className="py-2 pr-3">{formatMoney(item.remaining_balance)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded shadow p-6">
            <h3 className="text-lg font-semibold mb-1">External Payments</h3>
            <p className="text-sm text-gray-500">
              Read-only records for payments received outside the app.
            </p>
            {externalPaymentsLoading ? (
              <div className="mt-4 text-sm text-gray-500">Loading external payments…</div>
            ) : externalPayments.length === 0 ? (
              <div className="mt-4 rounded-lg border border-dashed border-gray-300 px-4 py-4 text-sm text-gray-500">
                No external payments recorded yet.
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-xs font-semibold text-gray-500">
                      <th className="py-2 pr-3">Draw</th>
                      <th className="py-2 pr-3">Method</th>
                      <th className="py-2 pr-3">Payment Date</th>
                      <th className="py-2 pr-3">Net</th>
                      <th className="py-2 pr-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {externalPayments.map((row) => (
                      <tr key={row.id} className="border-b border-gray-100">
                        <td className="py-3 pr-3 text-gray-700">{row.draw_title || "Unlinked payment"}</td>
                        <td className="py-3 pr-3 text-gray-700 uppercase">{row.payment_method}</td>
                        <td className="py-3 pr-3 text-gray-700">{row.payment_date || "—"}</td>
                        <td className="py-3 pr-3 font-semibold text-gray-900">{formatMoney(row.net_amount)}</td>
                        <td className="py-3 pr-3 text-gray-700">{row.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {!isProgressPayments ? (
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
      ) : null}

      {drawModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-3xl rounded-xl bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-gray-900">Create Draw</div>
                <div className="text-sm text-gray-500">
                  Set percent complete for the schedule-of-values items you want to bill in this draw.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDrawModalOpen(false)}
                className="rounded border px-2 py-1 text-sm"
              >
                Close
              </button>
            </div>

            <div className="mt-4 grid gap-3">
              <input
                type="text"
                value={drawForm.title}
                onChange={(e) => setDrawForm((prev) => ({ ...prev, title: e.target.value }))}
                className="rounded border px-3 py-2 text-sm"
                placeholder="Draw title"
              />
              <textarea
                rows={3}
                value={drawForm.notes}
                onChange={(e) => setDrawForm((prev) => ({ ...prev, notes: e.target.value }))}
                className="rounded border px-3 py-2 text-sm"
                placeholder="Notes"
              />
            </div>

            <div className="mt-4 max-h-[45vh] overflow-y-auto rounded-lg border">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="text-left text-xs font-semibold text-gray-500">
                    <th className="px-3 py-2">Milestone</th>
                    <th className="px-3 py-2">Scheduled Value</th>
                    <th className="px-3 py-2">% Complete</th>
                  </tr>
                </thead>
                <tbody>
                  {drawMilestones.map((milestone) => (
                    <tr key={milestone.id} className="border-t border-gray-100">
                      <td className="px-3 py-2 text-gray-700">{milestone.title}</td>
                      <td className="px-3 py-2 text-gray-700">{formatMoney(milestone.amount)}</td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          value={drawForm.percents[String(milestone.id)] || "0"}
                          onChange={(e) =>
                            setDrawForm((prev) => ({
                              ...prev,
                              percents: {
                                ...prev.percents,
                                [String(milestone.id)]: e.target.value,
                              },
                            }))
                          }
                          className="w-28 rounded border px-3 py-2 text-sm"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDrawModalOpen(false)}
                className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitCreateDraw}
                disabled={drawSaving}
                className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                {drawSaving ? "Creating…" : "Create Draw"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {paymentModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-xl rounded-xl bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-gray-900">Record External Payment</div>
                <div className="text-sm text-gray-500">
                  Save payment context without changing payout execution or escrow behavior.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPaymentModalOpen(false)}
                className="rounded border px-2 py-1 text-sm"
              >
                Close
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700 sm:col-span-2">
                <div className="font-semibold text-slate-900">
                  Expected payment: Gross {formatMoney(paymentTargetDraw?.gross_amount)} • Retainage{" "}
                  {formatMoney(paymentTargetDraw?.retainage_amount)} • Net {formatMoney(paymentTargetDraw?.net_amount)}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  Partial external payments are not supported. Recorded amounts must match this approved draw.
                </div>
              </div>
              <input
                type="number"
                step="0.01"
                value={paymentForm.gross_amount}
                onChange={(e) => setPaymentForm((prev) => ({ ...prev, gross_amount: e.target.value }))}
                className="rounded border px-3 py-2 text-sm"
                placeholder="Amount"
              />
              <select
                value={paymentForm.payment_method}
                onChange={(e) => setPaymentForm((prev) => ({ ...prev, payment_method: e.target.value }))}
                className="rounded border px-3 py-2 text-sm"
              >
                <option value="ach">ACH</option>
                <option value="wire">Wire</option>
                <option value="check">Check</option>
                <option value="cash">Cash</option>
                <option value="other">Other</option>
              </select>
              <input
                type="number"
                step="0.01"
                value={paymentForm.retainage_withheld_amount}
                onChange={(e) =>
                  setPaymentForm((prev) => ({
                    ...prev,
                    retainage_withheld_amount: e.target.value,
                  }))
                }
                className="rounded border px-3 py-2 text-sm"
                placeholder="Retainage withheld"
              />
              <input
                type="number"
                step="0.01"
                value={paymentForm.net_amount}
                onChange={(e) => setPaymentForm((prev) => ({ ...prev, net_amount: e.target.value }))}
                className="rounded border px-3 py-2 text-sm"
                placeholder="Net amount"
              />
              <input
                type="date"
                value={paymentForm.payment_date}
                onChange={(e) => setPaymentForm((prev) => ({ ...prev, payment_date: e.target.value }))}
                className="rounded border px-3 py-2 text-sm"
              />
              <input
                type="text"
                value={paymentForm.reference_number}
                onChange={(e) => setPaymentForm((prev) => ({ ...prev, reference_number: e.target.value }))}
                className="rounded border px-3 py-2 text-sm sm:col-span-2"
                placeholder="Reference number"
              />
              <textarea
                rows={3}
                value={paymentForm.notes}
                onChange={(e) => setPaymentForm((prev) => ({ ...prev, notes: e.target.value }))}
                className="rounded border px-3 py-2 text-sm sm:col-span-2"
                placeholder="Notes"
              />
              <input
                type="file"
                onChange={(e) =>
                  setPaymentForm((prev) => ({
                    ...prev,
                    proof_file: e.target.files?.[0] || null,
                  }))
                }
                className="text-sm sm:col-span-2"
              />
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPaymentModalOpen(false)}
                className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitExternalPayment}
                disabled={paymentSaving}
                className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                {paymentSaving ? "Saving…" : "Record Payment"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {payoutReleaseTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl">
            <div className="text-lg font-semibold text-slate-900">
              Release Subcontractor Payment
            </div>
            <div className="mt-2 text-sm text-slate-600">
              Release {formatMoney(payoutReleaseTarget.amount || 0)} to{" "}
              {payoutReleaseTarget.subcontractorName} for {payoutReleaseTarget.milestoneTitle}?
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPayoutReleaseTarget(null)}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmReleaseSubcontractorPayment}
                disabled={Boolean(payoutDecisionBusy[payoutReleaseTarget.milestoneId])}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {payoutDecisionBusy[payoutReleaseTarget.milestoneId] ? "Releasing..." : "Release Payment"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <SignatureModal
        isOpen={sigOpen}
        onClose={() => setSigOpen(false)}
        agreement={agreement}
        signingRole={signingRole}
        onSigned={handleSigned}
      />

      <SupportRequestModal
        visible={supportOpen}
        onClose={() => setSupportOpen(false)}
        defaultEmail={user?.email || ""}
        defaultCategory="agreement_help"
        defaultSubject={`Help with Agreement #${id}`}
        relatedObjectType="agreement"
        relatedObjectId={String(id || "")}
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
    </ContractorPageSurface>
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
