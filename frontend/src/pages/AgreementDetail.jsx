// src/pages/AgreementDetail.jsx
// v2026-03-02 - PDF History UI:
// - Reads agreement.current_pdf_url + agreement.pdf_versions (AgreementPDFVersion history)
// - Adds PDF History panel with Open/Download for each version
// - Uses credentialed fetch() for downloads so /media files work with auth cookies
//
// v2026-02-15 - Direct Pay aware:
// - Detect agreement.payment_mode ("escrow" vs "direct")
// - Hide escrow-only actions/modals for Direct Pay agreements
// - Adjust status display + show Payment Mode badge
// - Skip funding_preview (escrow fee summary) when Direct Pay

import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
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
} from '../api';
import SignatureModal from '../components/SignatureModal';
import EscrowPromptModal from '../components/EscrowPromptModal';
import AttachmentManager from '../components/AttachmentManager';
import SendFundingLinkButton from '../components/SendFundingLinkButton';
import { useAuth } from '../context/AuthContext';
import PdfPreviewModal from '../components/PdfPreviewModal';
import RefundEscrowModal from '../components/RefundEscrowModal';
import AssignSubcontractorInline from '../components/AssignSubcontractorInline';
import AssignReviewerInline from '../components/AssignReviewerInline';
import SupportRequestModal from '../components/SupportRequestModal';

// Assignment UI
import AssignEmployeeInline from '../components/AssignEmployeeInline';
import { WorkflowHint } from '../components/WorkflowHint.jsx';
import ContractorPageSurface from '../components/dashboard/ContractorPageSurface.jsx';
import { normalizeProjectClass } from '../utils/projectClass.js';
import { getAgreementDetailHint } from '../lib/workflowHints.js';
import {
  ProjectModeBadge,
  projectModeLabel,
} from '../components/projectMode.jsx';
import {
  MilestoneRoleBadge,
  MilestoneSafetyBadges,
  InspectionStatusBadge,
  deriveMilestoneRoleLabel,
} from '../components/milestoneRole.jsx';
import {
  assignAgreementToSubaccount,
  unassignAgreementFromSubaccount,
} from '../api/assignments';
import {
  getMilestoneDisplay,
  isMilestoneCompleted,
  milestoneDisplayPaymentStatus,
  milestoneDisplayProgressPercent,
  milestoneDisplayStatus,
  milestoneStatusKey as getMilestoneStatusKey,
  milestoneStatusTone,
} from '../utils/milestoneDisplay.js';

const pick = (...vals) =>
  vals.find((v) => v !== undefined && v !== null && v !== '') ?? '';

const toMoney = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
};

const formatMoney = (v) =>
  `$${Number(toMoney(v)).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const formatPlanningDate = (value) => {
  if (!value) return 'Not set';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const formatBytes = (value) => {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

function AttachmentLinks({ attachments = [], testId = '' }) {
  const rows = Array.isArray(attachments) ? attachments.filter(Boolean) : [];
  if (!rows.length) return null;
  return (
    <div
      data-testid={testId || undefined}
      className="mt-3 rounded-lg border border-slate-200 bg-white p-3"
    >
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
        Attachments ({rows.length})
      </div>
      <div className="mt-2 space-y-1">
        {rows.map((attachment, index) => {
          const label =
            attachment.filename ||
            attachment.original_filename ||
            attachment.name ||
            `Attachment ${index + 1}`;
          const size = formatBytes(attachment.size);
          return (
            <a
              key={attachment.id || `${label}-${index}`}
              href={attachment.url || attachment.file_url || '#'}
              target="_blank"
              rel="noreferrer"
              className="block text-xs font-semibold text-sky-700 hover:text-sky-900"
            >
              {label}
              {size ? (
                <span className="ml-2 font-normal text-slate-500">{size}</span>
              ) : null}
            </a>
          );
        })}
      </div>
    </div>
  );
}

const RefundedBadge = () => (
  <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border border-emerald-200 bg-emerald-50 text-emerald-800">
    Refunded
  </span>
);

const milestoneStatusLabel = (m) => milestoneDisplayStatus(m);

function isMilestoneComplete(m) {
  return isMilestoneCompleted(m);
}

const milestoneStatusKey = (m) => getMilestoneStatusKey(m);

function milestoneProgressPercent(m) {
  return milestoneDisplayProgressPercent(m);
}

function milestonePaymentStatus(m) {
  return milestoneDisplayPaymentStatus(m);
}

function statusBadgeTone(label) {
  return milestoneStatusTone(label);
}

const isRefundedMilestone = (m) =>
  String(pick(m?.descope_status, m?.descopeStatus) || '').toLowerCase() ===
  'refunded';

function normalizePaymentMode(val) {
  const s = String(val || '')
    .trim()
    .toLowerCase();
  if (!s) return 'escrow';
  if (s.includes('direct')) return 'direct';
  return 'escrow';
}

function normalizePaymentStructure(val) {
  const s = String(val || '')
    .trim()
    .toLowerCase();
  return s === 'progress' ? 'progress' : 'simple';
}

function projectClassLabel(val) {
  return normalizeProjectClass(val) === 'commercial'
    ? 'Commercial'
    : 'Residential';
}

function paymentModeLabel(mode) {
  const m = normalizePaymentMode(mode);
  return m === 'direct' ? 'Direct Pay' : 'Escrow (Milestone Hold)';
}

function paymentProtectionLabel(value) {
  const s = String(value || '').trim();
  if (!s) return 'Escrow Preferred';
  return s;
}

function paymentProtectionTone(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (normalized.includes('required'))
    return 'border-rose-200 bg-rose-50 text-rose-800';
  if (normalized.includes('recommended'))
    return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-emerald-200 bg-emerald-50 text-emerald-800';
}

function agreementTimelineState(norm) {
  const status = String(norm?.status || '')
    .trim()
    .toLowerCase();
  const signed =
    !!norm?.isSigned ||
    ['signed', 'funded', 'in_progress', 'active'].includes(status);
  const escrowRequired =
    String(norm?.payment_mode || '')
      .trim()
      .toLowerCase() !== 'direct';
  const escrowFunded = !!norm?.escrowFunded;
  return signed && (!escrowRequired || escrowFunded) ? 'active' : 'planned';
}

function agreementTimelineLabel(norm) {
  return agreementTimelineState(norm) === 'active'
    ? 'Active Schedule'
    : 'Planned Timeline';
}

function milestoneLifecycleLabel(state) {
  const normalized = String(state || '')
    .trim()
    .toLowerCase();
  if (normalized === 'planned') return 'Planned Timeline';
  if (normalized === 'active') return 'Active Schedule';
  if (normalized === 'overdue') return 'Overdue';
  if (normalized === 'scheduled') return 'Scheduled';
  return 'Planned Timeline';
}

function milestoneLifecycleTone(state) {
  const normalized = String(state || '')
    .trim()
    .toLowerCase();
  if (normalized === 'overdue')
    return 'border-rose-200 bg-rose-50 text-rose-800';
  if (normalized === 'active')
    return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (normalized === 'scheduled')
    return 'border-sky-200 bg-sky-50 text-sky-800';
  return 'border-slate-200 bg-slate-100 text-slate-700';
}

function drawWorkflowStatus(draw) {
  return String(draw?.workflow_status || draw?.status || '')
    .trim()
    .toLowerCase();
}

function drawWorkflowLabel(draw) {
  return (
    draw?.workflow_status_label ||
    String(draw?.workflow_status || draw?.status || 'draft').replaceAll(
      '_',
      ' '
    )
  );
}

function formatApiError(error, fallback) {
  const data = error?.response?.data;
  if (!data) return fallback;
  if (typeof data === 'string') return data;
  if (typeof data?.detail === 'string') return data.detail;
  const firstEntry = Object.entries(data).find(([, value]) => value != null);
  if (!firstEntry) return fallback;
  const [field, value] = firstEntry;
  const message = Array.isArray(value) ? value[0] : value;
  if (typeof message === 'string')
    return `${field.replaceAll('_', ' ')}: ${message}`;
  return fallback;
}

function PaymentModeBadge({ mode }) {
  const m = normalizePaymentMode(mode);
  const cls =
    m === 'direct'
      ? 'border-slate-200 bg-slate-50 text-slate-800'
      : 'border-emerald-200 bg-emerald-50 text-emerald-800';
  const text = m === 'direct' ? '⚡ Direct Pay' : '🛡️ Escrow';
  return (
    <span
      className={`ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${cls}`}
      title={
        m === 'direct'
          ? 'Direct Pay: invoices are paid via Stripe pay links (no escrow hold).'
          : 'Escrow: customer funds escrow; milestone approvals release funds.'
      }
    >
      {text}
    </span>
  );
}

function fmtDateTime(val) {
  if (!val) return '';
  try {
    const d = new Date(val);
    if (!Number.isFinite(d.getTime())) return String(val);
    return d.toLocaleString();
  } catch {
    return String(val);
  }
}

function shortSha(sha) {
  const s = String(sha || '').trim();
  if (!s) return '';
  return s.length > 12 ? `${s.slice(0, 12)}...` : s;
}

function formatInviteDate(value) {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function formatPayoutStatus(value) {
  return String(value || 'not_eligible')
    .replaceAll('_', ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}

function formatExecutionMode(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (normalized === 'automatic') return 'Automatic';
  if (normalized === 'manual') return 'Manual';
  return '';
}

function payoutOrchestrationLabel(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (normalized === 'blocked') return 'Blocked';
  if (normalized === 'ready') return 'Ready for contractor release';
  if (normalized === 'scheduled') return 'Scheduled';
  if (normalized === 'processing') return 'Processing';
  if (normalized === 'paid') return 'Paid';
  if (normalized === 'failed') return 'Failed';
  if (normalized === 'cancelled') return 'Cancelled';
  if (normalized === 'not_due') return 'Not yet due';
  return String(value || 'Not yet due').replaceAll('_', ' ');
}

function normalizeAdminTab(tab) {
  const normalized = String(tab || '')
    .trim()
    .toLowerCase();
  if (!normalized) return 'overview';
  if (normalized === 'pricing' || normalized === 'financials')
    return 'financials';
  if (
    [
      'overview',
      'milestones',
      'communication',
      'disputes',
      'ai',
      'audit',
    ].includes(normalized)
  ) {
    return normalized;
  }
  return 'overview';
}

const WORKSPACE_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'milestones', label: 'Milestones' },
  { id: 'amendments', label: 'Amendments' },
  { id: 'funding', label: 'Funding & Payments' },
  { id: 'signatures', label: 'Signatures & PDF' },
  { id: 'documents', label: 'Documents' },
  { id: 'activity', label: 'Team & Assignments' },
  { id: 'ai', label: 'AI Review' },
];

function normalizeWorkspaceTab(tab) {
  const normalized = String(tab || '')
    .trim()
    .toLowerCase();
  if (normalized === 'payments') return 'funding';
  if (normalized === 'pdf' || normalized === 'signatures-pdf')
    return 'signatures';
  if (WORKSPACE_TABS.some((item) => item.id === normalized)) return normalized;
  return 'overview';
}

function adminTabToQuery(tab) {
  const normalized = normalizeAdminTab(tab);
  if (normalized === 'overview') return '';
  if (normalized === 'financials') return 'pricing';
  return normalized;
}

function adminRiskToneLabel(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (normalized === 'high') return { tone: 'bad', label: 'High' };
  if (normalized === 'medium') return { tone: 'warn', label: 'Medium' };
  return { tone: 'good', label: 'Low' };
}

function titleCase(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function normalizeAgreement(raw) {
  if (!raw || typeof raw !== 'object')
    return { id: null, title: '-', invoices: [], milestones: [] };

  const payment_mode = normalizePaymentMode(
    pick(raw.payment_mode, raw.paymentMode, raw.raw?.payment_mode)
  );

  const isDirectPay = payment_mode === 'direct';

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
    title: raw.title || raw.project_title || raw.project?.title || '-',
    homeownerName: raw.homeowner_name || raw.homeowner?.full_name || '-',
    homeownerEmail: raw.homeowner_email || raw.homeowner?.email || '-',
    project_mode: raw.project_mode || raw.raw?.project_mode || 'full_service',
    homeowner_participation_notes:
      raw.homeowner_participation_notes ||
      raw.raw?.homeowner_participation_notes ||
      '',
    homeowner_responsibilities:
      raw.homeowner_responsibilities ||
      raw.raw?.homeowner_responsibilities ||
      '',
    contractor_responsibilities:
      raw.contractor_responsibilities ||
      raw.raw?.contractor_responsibilities ||
      '',
    excluded_work: raw.excluded_work || raw.raw?.excluded_work || '',
    collaboration_summary:
      raw.collaboration_summary || raw.raw?.collaboration_summary || '',
    responsibility_matrix:
      raw.responsibility_matrix || raw.raw?.responsibility_matrix || {},
    homeowner_acknowledgements:
      raw.homeowner_acknowledgements ||
      raw.raw?.homeowner_acknowledgements ||
      [],
    inspection_summary:
      raw.inspection_summary || raw.raw?.inspection_summary || {},
    rescue_project_summary:
      raw.rescue_project_summary || raw.raw?.rescue_project_summary || {},
    totalCost: toMoney(raw.total_cost ?? raw.project?.total_cost ?? 0),
    status: raw.status || raw.workflow_status || raw.state || 'draft',
    isSigned:
      !!raw.is_fully_signed ||
      (!!raw.signed_by_contractor && !!raw.signed_by_homeowner),

    payment_mode,
    payment_protection:
      raw.payment_protection || raw.raw?.payment_protection || {},
    isDirectPay,

    // Escrow-only
    escrowFunded: !!raw.escrow_funded,

    invoices: raw.invoices || raw.invoice_set || [],
    milestones: raw.milestones || raw.milestone_set || [],
    amendmentRequests: raw.amendment_requests || raw.amendmentRequests || [],

    // PDF versioning
    currentPdfUrl: pick(raw.current_pdf_url, raw.pdf_file_url, raw.pdf_url, ''),
    currentPdfVersion: raw.pdf_version != null ? Number(raw.pdf_version) : null,
    pdfVersions: pdfVersionsSorted,

    raw,
  };
}

function resolveAgreementMilestones({
  agreement,
  norm,
  fallbackRows = [],
  fallbackLoaded = false,
  fallbackLoading = false,
  fallbackError = '',
}) {
  const hasEmbeddedMilestones =
    Array.isArray(agreement?.milestones) ||
    Array.isArray(agreement?.milestone_set);
  const embeddedRows = Array.isArray(norm?.milestones) ? norm.milestones : [];
  const rows = hasEmbeddedMilestones
    ? embeddedRows
    : Array.isArray(fallbackRows)
      ? fallbackRows
      : [];

  return {
    rows,
    dataKnown: hasEmbeddedMilestones || fallbackLoaded,
    loading: !hasEmbeddedMilestones && fallbackLoading,
    error: !hasEmbeddedMilestones ? fallbackError : '',
    source: hasEmbeddedMilestones ? 'agreement' : 'milestones_endpoint',
  };
}

function agreementCustomerId(agreement) {
  const customer =
    agreement?.homeowner ||
    agreement?.customer ||
    agreement?.homeowner_record ||
    agreement?.customer_record;
  if (customer && typeof customer === 'object') {
    return pick(
      customer.id,
      customer.pk,
      customer.homeowner_id,
      customer.customer_id
    );
  }
  return pick(
    agreement?.homeowner_id,
    agreement?.customer_id,
    agreement?.homeowner,
    agreement?.customer
  );
}

// Download helper for /media URLs that may require cookies.
// Uses fetch() directly (NOT axios api instance) so "/media/..." doesn't get prefixed with "/api".
async function downloadWithCredentials(url, filename) {
  if (!url) throw new Error('Missing URL');
  const abs = String(url).startsWith('http')
    ? String(url)
    : `${window.location.origin}${String(url).startsWith('/') ? '' : '/'}${url}`;

  const res = await fetch(abs, { credentials: 'include' });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(
      `Download failed (${res.status}). ${txt?.slice(0, 200) || ''}`
    );
  }
  const blob = await res.blob();
  const objectUrl = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename || 'file.pdf';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(objectUrl);
}

function openInNewTab(url) {
  if (!url) return;
  const abs = String(url).startsWith('http')
    ? String(url)
    : `${window.location.origin}${String(url).startsWith('/') ? '' : '/'}${url}`;
  window.open(abs, '_blank', 'noopener,noreferrer');
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
    pick(
      fundingPreview?.platform_fee,
      agreement?.platform_fee_estimate,
      agreement?.platform_fee,
      0
    )
  );
  const openDisputes = Number(
    agreement?.open_disputes_count ||
      agreement?.dispute_count ||
      agreement?.disputes_count ||
      0
  );
  const contractorLabel =
    pick(
      agreement?.contractor_name,
      agreement?.contractor?.business_name,
      agreement?.contractor?.name,
      agreement?.contractor?.display_name,
      agreement?.assigned_contractor_name
    ) || '-';
  const customerLabel = norm?.homeownerName || agreement?.homeowner_name || '-';
  const statusLabel = titleCase(
    agreement?.status ||
      agreement?.workflow_status ||
      agreement?.state ||
      'draft'
  );
  const riskTone = adminRiskToneLabel(
    openDisputes > 0 || pendingRelease > contractValue * 0.5
      ? 'high'
      : pendingRelease > contractValue * 0.2 ||
          String(agreement?.pricing_strategy || '').toLowerCase() ===
            'requires_sub_quote'
        ? 'medium'
        : 'low'
  );
  const tabs = [
    ['overview', 'Overview'],
    ['financials', 'Financials'],
    ['milestones', 'Milestones'],
    ['communication', 'Communication'],
    ['disputes', 'Disputes'],
    ['ai', 'AI Context'],
    ['audit', 'Audit Log'],
  ];
  const milestones = Array.isArray(norm?.milestones) ? norm.milestones : [];
  const disputeRows = Array.isArray(agreement?.disputes)
    ? agreement.disputes
    : [];
  const canonicalTab = normalizeAdminTab(adminTab);
  const activeFinancials = canonicalTab === 'financials';
  const activeOverview = canonicalTab === 'overview';
  const activeMilestones = canonicalTab === 'milestones';
  const activeCommunication = canonicalTab === 'communication';
  const activeDisputes = canonicalTab === 'disputes';
  const activeAi = canonicalTab === 'ai';
  const activeAudit = canonicalTab === 'audit';

  const setTab = (nextTab) => {
    const queryTab = adminTabToQuery(nextTab);
    onNavigateTab(queryTab ? `?tab=${encodeURIComponent(queryTab)}` : '');
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
              <span
                className={`rounded-full border px-2.5 py-1 text-[11px] font-extrabold ${riskTone.tone === 'bad' ? 'border-rose-200 bg-rose-50 text-rose-800' : riskTone.tone === 'warn' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}
              >
                Risk {riskTone.label}
              </span>
            </div>
            <div className="text-sm text-slate-700">
              <span className="font-semibold text-slate-900">Status:</span>{' '}
              {statusLabel}
              <span className="mx-2 text-slate-300">|</span>
              <span className="font-semibold text-slate-900">
                Contractor:
              </span>{' '}
              {contractorLabel}
              <span className="mx-2 text-slate-300">|</span>
              <span className="font-semibold text-slate-900">
                Customer:
              </span>{' '}
              {customerLabel}
            </div>
          </div>
          <div className="grid min-w-[320px] grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <SummaryCard
              label="Contract Value"
              value={formatMoney(contractValue)}
              className="border-slate-200 bg-slate-50"
            />
            <SummaryCard
              label="Funded"
              value={formatMoney(funded)}
              className="border-slate-200 bg-slate-50"
            />
            <SummaryCard
              label="Released"
              value={formatMoney(released)}
              className="border-slate-200 bg-slate-50"
            />
            <SummaryCard
              label="Pending Release"
              value={formatMoney(pendingRelease)}
              className="border-slate-200 bg-slate-50"
            />
            <SummaryCard
              label="Platform Fee Estimate"
              value={formatMoney(platformFeeEstimate)}
              className="border-slate-200 bg-slate-50"
            />
            <SummaryCard
              label="Risk Level"
              value={riskTone.label}
              className="border-slate-200 bg-slate-50"
            />
          </div>
        </div>
      </section>

      <div
        className="mt-5 flex flex-wrap gap-2"
        data-testid="admin-agreement-tabs"
      >
        {tabs.map(([tab, label]) => {
          const active = canonicalTab === tab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setTab(tab)}
              className={[
                'rounded-full border px-4 py-2 text-sm font-extrabold transition',
                active
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
              ].join(' ')}
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
            <div className="text-sm font-extrabold text-slate-900">
              Project Summary
            </div>
            <div className="mt-2 text-sm text-slate-700 whitespace-pre-wrap">
              {agreement?.description ||
                agreement?.scope_description ||
                agreement?.summary ||
                'No project summary saved yet.'}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-extrabold text-slate-900">
              Party Summary
            </div>
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
            <div className="text-sm font-extrabold text-slate-900">
              Signature / PDF Status
            </div>
            <div className="mt-2 text-sm text-slate-700">
              Signature: {norm?.isSigned ? 'Signed' : 'Pending'}
            </div>
            <div className="mt-1 text-sm text-slate-700">
              PDF versions:{' '}
              {Array.isArray(norm?.pdfVersions) ? norm.pdfVersions.length : 0}
            </div>
            <div className="mt-1 text-sm text-slate-700">
              Current PDF: {norm?.currentPdfUrl ? 'Available' : 'Not available'}
            </div>
          </div>
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 shadow-sm">
            <div className="text-sm font-extrabold text-slate-900">
              Admin Notes
            </div>
            <div className="mt-2 text-sm text-slate-600">
              Admin-only notes placeholder.
            </div>
          </div>
        </div>
      ) : null}

      {activeFinancials ? (
        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-extrabold text-slate-900">
              Escrow Summary
            </div>
            <div className="mt-2 grid gap-2 text-sm text-slate-700">
              <div>Funded: {formatMoney(funded)}</div>
              <div>Released: {formatMoney(released)}</div>
              <div>Pending Release: {formatMoney(pendingRelease)}</div>
              <div>Refunded: {formatMoney(refunded)}</div>
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-extrabold text-slate-900">
              Milestone Payment Breakdown
            </div>
            <div className="mt-2 space-y-2 text-sm text-slate-700">
              {milestones.length ? (
                milestones.slice(0, 6).map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
                  >
                    <span className="font-semibold text-slate-900">
                      {m.title || `Milestone #${m.id}`}
                    </span>
                    <span>{formatMoney(m.amount || 0)}</span>
                  </div>
                ))
              ) : (
                <div>No milestone rows available.</div>
              )}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-extrabold text-slate-900">
              Platform Revenue Estimate
            </div>
            <div className="mt-2 text-sm text-slate-700">
              {platformFeeEstimate
                ? formatMoney(platformFeeEstimate)
                : 'Not available yet.'}
            </div>
            {fundingPreview?.rate != null ? (
              <div className="mt-1 text-xs text-slate-500">
                Current rate: {(Number(fundingPreview.rate) * 100).toFixed(2)}%
                + $1
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
          <div className="text-sm font-extrabold text-slate-900">
            Milestones
          </div>
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
                {milestones.length ? (
                  milestones.map((m) => (
                    <tr key={m.id} className="border-b border-slate-100">
                      <td className="px-3 py-2 font-semibold text-slate-900">
                        {m.title || `Milestone #${m.id}`}
                      </td>
                      <td className="px-3 py-2">
                        {formatMoney(m.amount || 0)}
                      </td>
                      <td className="px-3 py-2">{milestoneStatusLabel(m)}</td>
                      <td className="px-3 py-2">
                        {m.due_date || m.completion_date || '-'}
                      </td>
                      <td className="px-3 py-2">
                        {m.approved_at ? 'Approved' : 'Pending'} /{' '}
                        {m.released_at ? 'Released' : 'Not released'}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-slate-600">
                      No milestone rows available.
                    </td>
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
            <div className="text-sm font-extrabold text-slate-900">
              Communication History
            </div>
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
            <div className="text-sm font-extrabold text-slate-900">
              Communication Actions
            </div>
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
          <div className="text-sm font-extrabold text-slate-900">
            Related Disputes
          </div>
          <div className="mt-2 text-sm text-slate-600">
            {disputeRows.length
              ? `${disputeRows.length} related dispute(s) available.`
              : 'No dispute rows included in this agreement payload.'}
          </div>
          <div className="mt-3 space-y-2">
            {disputeRows.slice(0, 4).map((d) => (
              <div
                key={d.id}
                className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="font-semibold text-slate-900">
                    Dispute #{d.id}
                  </div>
                  <div className="text-xs font-extrabold text-slate-700">
                    {isDisputeTerminal(d.status)
                      ? 'Resolved - read only'
                      : titleCase(d.status || 'open')}
                  </div>
                </div>
                <div className="mt-2 text-xs text-slate-600">
                  {d.summary || d.reason || 'No summary available.'}
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-slate-800"
                  >
                    View
                  </button>
                  {isDisputeTerminal(d.status) ? (
                    <button
                      type="button"
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50"
                    >
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
              <div className="text-sm font-extrabold text-slate-900">
                AI Context
              </div>
              <div className="mt-1 text-sm text-slate-600">
                Saved AI title, template, confidence, and reasons.
              </div>
            </div>
            <button
              type="button"
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-extrabold text-slate-700 hover:bg-slate-50"
              onClick={() => toast('AI Review placeholder.')}
            >
              Run AI Review
            </button>
          </div>

          {adminAiContext ? (
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
                  Suggested title
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900">
                  {adminAiContext.suggested_title || 'Not available'}
                </div>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
                  Template
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900">
                  {adminAiContext.template_name || 'Not available'}
                </div>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
                  Confidence
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900">
                  {adminAiContext.confidence || 'Not available'}
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
              No AI context saved for this agreement.
            </div>
          )}

          {adminAiContext?.reason ? (
            <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm text-slate-700">
              <span className="font-extrabold text-slate-900">Reason:</span>{' '}
              {adminAiContext.reason}
            </div>
          ) : null}

          {adminAiLoading ? (
            <div className="mt-3 text-sm text-slate-600">
              Loading AI context...
            </div>
          ) : null}
        </div>
      ) : null}

      {activeAudit ? (
        <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm font-extrabold text-slate-900">Audit Log</div>
          <div className="mt-2 text-sm text-slate-600">
            Timeline placeholder using agreement timestamps and document
            history.
          </div>
          <div className="mt-4 space-y-2 text-sm">
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
              Created: {fmtDateTime(agreement?.created_at)}
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
              Updated: {fmtDateTime(agreement?.updated_at)}
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
              Signed:{' '}
              {fmtDateTime(agreement?.signed_at || agreement?.signed_date)}
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
              PDF versions tracked:{' '}
              {Array.isArray(norm?.pdfVersions) ? norm.pdfVersions.length : 0}
            </div>
          </div>
        </div>
      ) : null}
    </ContractorPageSurface>
  );
}

function amendmentResponseState(value) {
  return String(value || 'pending')
    .trim()
    .toLowerCase();
}

function isOpenContractorAmendment(amendment) {
  const state = amendmentResponseState(amendment?.response_state);
  const status = String(amendment?.status || '')
    .trim()
    .toLowerCase();
  return (
    state === 'pending' && !['closed', 'cancelled', 'canceled'].includes(status)
  );
}

function isMilestoneAmendmentBlocked(milestone) {
  return (
    String(milestone?.amendment_review_status || '').toLowerCase() ===
      'pending' ||
    Boolean(
      milestone?.amendment_review_request ||
        milestone?.amendment_review_request_id
    )
  );
}

function amendmentLabel(amendment) {
  return (
    amendment?.change_type_label ||
    titleCase(amendment?.change_type || 'Amendment')
  );
}

function AmendmentReviewPanel({
  amendments = [],
  onRespond,
  onMarkViewed,
  busyId = '',
}) {
  const [expandedId, setExpandedId] = useState(amendments[0]?.id || '');
  const [responseDrafts, setResponseDrafts] = useState({});

  useEffect(() => {
    if (!expandedId && amendments[0]?.id) setExpandedId(amendments[0].id);
  }, [amendments, expandedId]);

  const setDraft = (id, patch) => {
    setResponseDrafts((prev) => ({
      ...prev,
      [id]: {
        response_state: 'accepted',
        response_note: '',
        counter_scope: '',
        counter_value_change: '',
        counter_timeline: '',
        counter_milestone_changes: '',
        counter_attachments: [],
        ...prev[id],
        ...patch,
      },
    }));
  };

  if (!amendments.length) return null;

  return (
    <section
      id="contractor-amendments"
      data-testid="contractor-amendment-review-panel"
      className="rounded-2xl border border-amber-300 bg-amber-50 p-5 shadow-sm"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-amber-950">
            Amendment Review
          </h3>
          <p className="mt-1 text-sm text-amber-900">
            Review homeowner change requests before completing affected
            milestones or requesting payment.
          </p>
        </div>
        <span className="rounded-full border border-amber-300 bg-white px-3 py-1 text-xs font-semibold text-amber-900">
          {amendments.filter(isOpenContractorAmendment).length} need response
        </span>
      </div>

      <div className="mt-4 space-y-3">
        {amendments.map((amendment) => {
          const isExpanded = String(expandedId) === String(amendment.id);
          const isPending = isOpenContractorAmendment(amendment);
          const isDescope = amendment.change_type === 'descope_remove_work';
          const draft = responseDrafts[amendment.id] || {
            response_state: 'accepted',
            response_note: '',
            counter_scope: '',
            counter_value_change: '',
            counter_timeline: '',
            counter_milestone_changes: '',
            counter_attachments: [],
          };
          const activity = Array.isArray(amendment.activity_events)
            ? amendment.activity_events
            : [];
          const affectedMilestones = Array.isArray(
            amendment.affected_milestones
          )
            ? amendment.affected_milestones
            : [];

          return (
            <div
              key={amendment.id}
              data-testid={`contractor-amendment-card-${amendment.id}`}
              className="rounded-xl border border-amber-200 bg-white p-4"
            >
              <button
                type="button"
                onClick={() => {
                  setExpandedId(isExpanded ? '' : amendment.id);
                  if (!isExpanded) onMarkViewed?.(amendment);
                }}
                className="flex w-full flex-col gap-2 text-left sm:flex-row sm:items-start sm:justify-between"
              >
                <div>
                  <div className="text-sm font-semibold text-slate-950">
                    {amendmentLabel(amendment)}
                  </div>
                  <div className="mt-1 text-xs text-slate-600">
                    Requested by{' '}
                    {amendment.requested_by_name ||
                      amendment.initiated_by_role ||
                      'homeowner'}{' '}
                    on {fmtDateTime(amendment.created_at) || 'recently'}
                  </div>
                  {amendment.response_due_at ? (
                    <div className="mt-1 text-xs font-semibold text-amber-800">
                      Response due {fmtDateTime(amendment.response_due_at)}
                    </div>
                  ) : null}
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${isPending ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-700'}`}
                >
                  {amendment.response_label ||
                    amendment.status_label ||
                    'Pending'}
                </span>
              </button>

              {isExpanded ? (
                <div className="mt-4 space-y-4">
                  <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                    <div className="font-semibold text-slate-950">
                      Homeowner reason
                    </div>
                    <div className="mt-1 whitespace-pre-wrap">
                      {amendment.justification ||
                        amendment.requested_change ||
                        'No reason provided.'}
                    </div>
                    {amendment.requested_change ? (
                      <div className="mt-3">
                        <div className="font-semibold text-slate-950">
                          Requested change
                        </div>
                        <div className="mt-1 whitespace-pre-wrap">
                          {amendment.requested_change}
                        </div>
                      </div>
                    ) : null}
                    {amendment.requested_changes?.attachment_note ? (
                      <div className="mt-3 text-xs text-slate-600">
                        Attachment note:{' '}
                        {amendment.requested_changes.attachment_note}
                      </div>
                    ) : null}
                  </div>

                  {isDescope ? (
                    <div
                      data-testid={`contractor-amendment-descope-summary-${amendment.id}`}
                      className="grid gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm sm:grid-cols-2 lg:grid-cols-4"
                    >
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                          Original project value
                        </div>
                        <div className="font-semibold text-slate-950">
                          {formatMoney(amendment.original_project_value || 0)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                          Revised project value
                        </div>
                        <div className="font-semibold text-slate-950">
                          {formatMoney(amendment.revised_project_value || 0)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                          Escrow funded
                        </div>
                        <div className="font-semibold text-slate-950">
                          {formatMoney(amendment.escrow_funded_amount || 0)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                          Estimated refundable surplus
                        </div>
                        <div className="font-semibold text-slate-950">
                          {formatMoney(
                            amendment.estimated_refundable_escrow_surplus || 0
                          )}
                        </div>
                      </div>
                      <div className="sm:col-span-2 lg:col-span-4 text-xs text-amber-900">
                        Refund eligibility is created only after both parties
                        approve and required amendment/addendum signatures are
                        complete.
                      </div>
                    </div>
                  ) : null}

                  {affectedMilestones.length ? (
                    <div>
                      <div className="text-sm font-semibold text-slate-950">
                        Affected milestones
                      </div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        {affectedMilestones.map((milestone) => (
                          <div
                            key={milestone.id}
                            className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm"
                          >
                            <div className="font-semibold text-slate-950">
                              {milestone.title || `Milestone #${milestone.id}`}
                            </div>
                            <div className="mt-1 text-xs text-slate-600">
                              {milestone.amount
                                ? formatMoney(milestone.amount)
                                : 'Amount not set'}{' '}
                              - {milestone.status || 'pending'}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div
                    data-testid={`contractor-amendment-activity-${amendment.id}`}
                    className="rounded-lg border border-slate-200 bg-slate-50 p-3"
                  >
                    <div className="text-sm font-semibold text-slate-950">
                      Activity timeline
                    </div>
                    <div className="mt-2 space-y-2">
                      {activity.length ? (
                        activity.map((event) => (
                          <div
                            key={
                              event.id ||
                              `${event.event_type}-${event.created_at}`
                            }
                            className="text-xs text-slate-700"
                          >
                            <span className="font-semibold text-slate-950">
                              {event.event_label || titleCase(event.event_type)}
                            </span>
                            {event.created_at
                              ? ` - ${fmtDateTime(event.created_at)}`
                              : ''}
                            {event.title ? (
                              <span className="block text-slate-600">
                                {event.title}
                              </span>
                            ) : null}
                            {event.metadata?.attachment_count ? (
                              <span className="block text-slate-600">
                                {event.metadata.attachment_count} attachment
                                {event.metadata.attachment_count === 1
                                  ? ''
                                  : 's'}{' '}
                                included
                              </span>
                            ) : null}
                            <AttachmentLinks
                              attachments={event.metadata?.attachments || []}
                              testId={`contractor-amendment-activity-attachments-${amendment.id}-${event.id}`}
                            />
                          </div>
                        ))
                      ) : (
                        <div className="text-xs text-slate-500">
                          No activity events yet.
                        </div>
                      )}
                    </div>
                  </div>

                  {isPending ? (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
                        <label className="text-sm font-semibold text-slate-900">
                          Response
                          <select
                            data-testid={`contractor-amendment-response-state-${amendment.id}`}
                            value={draft.response_state}
                            onChange={(e) =>
                              setDraft(amendment.id, {
                                response_state: e.target.value,
                              })
                            }
                            className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                          >
                            <option value="accepted">Accept</option>
                            <option value="rejected">Reject</option>
                            <option value="countered">Counter</option>
                          </select>
                        </label>
                        <label className="text-sm font-semibold text-slate-900">
                          Notes / reason
                          <textarea
                            data-testid={`contractor-amendment-response-note-${amendment.id}`}
                            value={draft.response_note}
                            onChange={(e) =>
                              setDraft(amendment.id, {
                                response_note: e.target.value,
                              })
                            }
                            rows={3}
                            className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                            placeholder={
                              draft.response_state === 'rejected'
                                ? 'Explain why this request cannot be accepted.'
                                : 'Add a note for the homeowner.'
                            }
                          />
                        </label>
                      </div>

                      {draft.response_state === 'countered' ? (
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          <input
                            data-testid={`contractor-amendment-counter-scope-${amendment.id}`}
                            value={draft.counter_scope}
                            onChange={(e) =>
                              setDraft(amendment.id, {
                                counter_scope: e.target.value,
                              })
                            }
                            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                            placeholder="Revised scope"
                          />
                          <input
                            data-testid={`contractor-amendment-counter-value-${amendment.id}`}
                            value={draft.counter_value_change}
                            onChange={(e) =>
                              setDraft(amendment.id, {
                                counter_value_change: e.target.value,
                              })
                            }
                            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                            placeholder="Revised value change"
                          />
                          <input
                            value={draft.counter_timeline}
                            onChange={(e) =>
                              setDraft(amendment.id, {
                                counter_timeline: e.target.value,
                              })
                            }
                            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                            placeholder="Revised timeline"
                          />
                          <input
                            value={draft.counter_milestone_changes}
                            onChange={(e) =>
                              setDraft(amendment.id, {
                                counter_milestone_changes: e.target.value,
                              })
                            }
                            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                            placeholder="Revised milestone changes"
                          />
                          <div className="md:col-span-2 rounded-lg border border-dashed border-slate-300 bg-white p-3">
                            <label className="text-sm font-semibold text-slate-900">
                              Supporting files
                              <span className="mt-1 block text-xs font-normal leading-5 text-slate-600">
                                Attach estimates, photos, receipts, supplier
                                quotes, or revised scope documents that support
                                your counter-proposal.
                              </span>
                              <input
                                data-testid={`contractor-amendment-counter-attachments-${amendment.id}`}
                                type="file"
                                multiple
                                onChange={(e) => {
                                  const incoming = Array.from(
                                    e.target.files || []
                                  );
                                  setDraft(amendment.id, {
                                    counter_attachments: [
                                      ...(draft.counter_attachments || []),
                                      ...incoming,
                                    ],
                                  });
                                  e.target.value = '';
                                }}
                                className="mt-2 block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-amber-100 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-amber-900"
                              />
                            </label>
                            {draft.counter_attachments?.length ? (
                              <div
                                data-testid={`contractor-amendment-counter-selected-files-${amendment.id}`}
                                className="mt-3 space-y-2"
                              >
                                {draft.counter_attachments.map(
                                  (file, index) => (
                                    <div
                                      key={`${file.name}-${file.size}-${index}`}
                                      className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700"
                                    >
                                      <span className="min-w-0 truncate">
                                        <span className="font-semibold text-slate-950">
                                          {file.name}
                                        </span>
                                        {formatBytes(file.size) ? (
                                          <span className="ml-2 text-slate-500">
                                            {formatBytes(file.size)}
                                          </span>
                                        ) : null}
                                      </span>
                                      <button
                                        type="button"
                                        data-testid={`contractor-amendment-remove-attachment-${amendment.id}-${index}`}
                                        onClick={() => {
                                          const next = (
                                            draft.counter_attachments || []
                                          ).filter(
                                            (_file, fileIndex) =>
                                              fileIndex !== index
                                          );
                                          setDraft(amendment.id, {
                                            counter_attachments: next,
                                          });
                                        }}
                                        className="shrink-0 rounded-md border border-slate-300 px-2 py-1 font-semibold text-slate-700 hover:bg-slate-100"
                                      >
                                        Remove
                                      </button>
                                    </div>
                                  )
                                )}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ) : null}

                      <button
                        type="button"
                        data-testid={`contractor-amendment-submit-response-${amendment.id}`}
                        disabled={busyId === amendment.id}
                        onClick={() => onRespond(amendment, draft)}
                        className="mt-3 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
                      >
                        {busyId === amendment.id
                          ? 'Saving...'
                          : 'Submit Response'}
                      </button>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                      <span className="font-semibold text-slate-950">
                        Contractor response:
                      </span>{' '}
                      {amendment.response_note ||
                        amendment.response_label ||
                        'Response recorded.'}
                      <AttachmentLinks
                        attachments={amendment.counter_attachments || []}
                        testId={`contractor-amendment-counter-attachments-summary-${amendment.id}`}
                      />
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function AgreementDetail({
  adminMode = false,
  initialAgreement = null,
  isMagicLink = false,
}) {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, ready, isAuthed } = useAuth();
  const isAdminMode = !!adminMode;
  const activeTab = useMemo(
    () => new URLSearchParams(location.search).get('tab') || '',
    [location.search]
  );
  const adminTab = useMemo(() => normalizeAdminTab(activeTab), [activeTab]);
  const workspaceTab = useMemo(
    () => normalizeWorkspaceTab(activeTab),
    [activeTab]
  );

  const [agreement, setAgreement] = useState(initialAgreement || null);
  const [loading, setLoading] = useState(!initialAgreement);
  const [sigOpen, setSigOpen] = useState(false);
  const [escrowOpen, setEscrowOpen] = useState(false);
  const [clientSecret, setClientSecret] = useState('');

  const [fundingPreview, setFundingPreview] = useState(null);
  const [fundingLoading, setFundingLoading] = useState(false);
  const [fundingError, setFundingError] = useState('');

  // PDF preview state
  const [pdfUrl, setPdfUrl] = useState(null);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdfPreviewError, setPdfPreviewError] = useState('');

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
  const [workspaceInvoices, setWorkspaceInvoices] = useState([]);
  const [workspaceInvoicesLoaded, setWorkspaceInvoicesLoaded] = useState(false);
  const [workspaceMilestones, setWorkspaceMilestones] = useState([]);
  const [workspaceMilestonesLoading, setWorkspaceMilestonesLoading] =
    useState(false);
  const [workspaceMilestonesLoaded, setWorkspaceMilestonesLoaded] =
    useState(false);
  const [workspaceMilestonesError, setWorkspaceMilestonesError] = useState('');
  const [agreementOpsMsg, setAgreementOpsMsg] = useState('');
  const [agreementOpBusy, setAgreementOpBusy] = useState('');
  const [adminAiContext, setAdminAiContext] = useState(null);
  const [adminAiLoading, setAdminAiLoading] = useState(false);
  const [drawForm, setDrawForm] = useState({
    title: '',
    notes: '',
    percents: {},
  });
  const [paymentForm, setPaymentForm] = useState({
    gross_amount: '',
    retainage_withheld_amount: '',
    net_amount: '',
    payment_method: 'ach',
    payment_date: '',
    reference_number: '',
    notes: '',
    proof_file: null,
  });
  const [subcontractorsLoading, setSubcontractorsLoading] = useState(false);
  const [pendingInvitations, setPendingInvitations] = useState([]);
  const [acceptedSubcontractors, setAcceptedSubcontractors] = useState([]);
  const [eligibleReviewers, setEligibleReviewers] = useState([]);
  const [inviteFormOpen, setInviteFormOpen] = useState(false);
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [invitationForm, setInvitationForm] = useState({
    invite_email: '',
    invite_name: '',
    invited_message: '',
  });

  const [warranties, setWarranties] = useState([]);
  const [warrantiesLoading, setWarrantiesLoading] = useState(false);
  const [warrantyEditorOpen, setWarrantyEditorOpen] = useState(false);
  const [warrantySaving, setWarrantySaving] = useState(false);
  const [editingWarrantyId, setEditingWarrantyId] = useState(null);
  const [completionResponseNotes, setCompletionResponseNotes] = useState({});
  const [completionDecisionBusy, setCompletionDecisionBusy] = useState({});
  const [payoutDecisionBusy, setPayoutDecisionBusy] = useState({});
  const [payoutReleaseTarget, setPayoutReleaseTarget] = useState(null);
  const [amendmentResponseBusy, setAmendmentResponseBusy] = useState('');
  const [viewedAmendmentIds, setViewedAmendmentIds] = useState(new Set());
  const [warrantyForm, setWarrantyForm] = useState({
    title: '',
    coverage_details: '',
    exclusions: '',
    start_date: '',
    end_date: '',
    status: 'active',
    applies_to: 'full_agreement',
  });

  const norm = useMemo(() => normalizeAgreement(agreement), [agreement]);
  const paymentStructure = useMemo(
    () => normalizePaymentStructure(agreement?.payment_structure),
    [agreement?.payment_structure]
  );
  const isProgressPayments = paymentStructure === 'progress';
  const isExecuted = Boolean(
    agreement?.signature_is_satisfied || agreement?.is_fully_signed
  );

  const isContractor =
    !isAdminMode &&
    (user?.role === 'contractor' ||
      user?.role === 'contractor_owner' ||
      user?.type === 'contractor' ||
      user?.is_contractor ||
      !!getAccessToken());
  const signingRole = isContractor ? 'contractor' : 'homeowner';
  const amendmentRequests = Array.isArray(norm?.amendmentRequests)
    ? norm.amendmentRequests
    : [];
  const pendingContractorAmendments = amendmentRequests.filter(
    isOpenContractorAmendment
  );

  const ratePercent =
    fundingPreview?.rate != null
      ? (Number(fundingPreview.rate) * 100).toFixed(2)
      : null;

  const tierLabel = fundingPreview
    ? fundingPreview.is_intro
      ? 'Intro rate (first 60 days)'
      : fundingPreview.tier_name
        ? `Current tier: ${String(fundingPreview.tier_name).toUpperCase()}`
        : ''
    : '';

  const fetchAgreement = async () => {
    if (isMagicLink && initialAgreement) {
      setAgreement(initialAgreement);
      setLoading(false);
      return;
    }
    if (!id) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const { data } = await api.get(`/projects/agreements/${id}/`);
      setAgreement(data);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load agreement.');
    } finally {
      setLoading(false);
    }
  };

  const markAmendmentViewed = async (amendment) => {
    if (!amendment?.id || viewedAmendmentIds.has(amendment.id)) return;
    setViewedAmendmentIds((prev) => new Set([...prev, amendment.id]));
    try {
      await api.post(`/projects/amendment-requests/${amendment.id}/viewed/`);
    } catch (err) {
      console.warn('Unable to mark amendment viewed', err);
    }
  };

  const submitAmendmentResponse = async (amendment, draft) => {
    if (!amendment?.id) return;
    const responseState = draft?.response_state || 'accepted';
    const note = String(draft?.response_note || '').trim();
    if (responseState === 'rejected' && !note) {
      toast.error('Add a reason before rejecting the amendment request.');
      return;
    }
    const payload = {
      response_state: responseState,
      response_note: note,
    };
    if (responseState === 'countered') {
      payload.counter_proposal = {
        revised_scope: draft?.counter_scope || '',
        revised_value_change: draft?.counter_value_change || '',
        revised_timeline: draft?.counter_timeline || '',
        revised_milestone_changes: draft?.counter_milestone_changes || '',
        note,
      };
    }
    try {
      setAmendmentResponseBusy(amendment.id);
      const files =
        responseState === 'countered' &&
        Array.isArray(draft?.counter_attachments)
          ? draft.counter_attachments.filter(Boolean)
          : [];
      if (files.length) {
        const form = new FormData();
        form.append('response_state', payload.response_state);
        form.append('response_note', payload.response_note);
        form.append(
          'counter_proposal',
          JSON.stringify(payload.counter_proposal || {})
        );
        files.forEach((file) => form.append('attachments', file));
        await api.post(
          `/projects/amendment-requests/${amendment.id}/respond/`,
          form
        );
      } else {
        await api.post(
          `/projects/amendment-requests/${amendment.id}/respond/`,
          payload
        );
      }
      toast.success('Amendment response recorded.');
      await fetchAgreement();
    } catch (err) {
      console.error(err);
      toast.error(
        formatApiError(
          err,
          'Could not upload one or more attachments. Please remove unsupported files and try again.'
        )
      );
    } finally {
      setAmendmentResponseBusy('');
    }
  };

  async function refreshAgreementPricing(agreementId) {
    setAgreementOpsMsg('');
    setAgreementOpBusy(`pricing-${agreementId}`);
    try {
      const res = await api.post(
        `/projects/admin/agreements/${agreementId}/refresh-pricing/`
      );
      setAgreementOpsMsg(res.data?.detail || 'Pricing guidance refreshed.');
      navigate(`/app/admin/agreements/${agreementId}?tab=pricing`);
    } catch (err) {
      console.error('Admin pricing refresh error:', err);
      setAgreementOpsMsg('Failed to refresh pricing guidance.');
    } finally {
      setAgreementOpBusy('');
    }
  }

  async function resendAgreementSignature(agreementId) {
    setAgreementOpsMsg('');
    setAgreementOpBusy(`signature-${agreementId}`);
    try {
      const res = await api.post(
        `/projects/admin/agreements/${agreementId}/resend-signature/`
      );
      setAgreementOpsMsg(res.data?.detail || 'Signature invite resent.');
    } catch (err) {
      console.error('Admin resend signature error:', err);
      setAgreementOpsMsg(
        err?.response?.data?.detail ||
          'Failed to resend the agreement signature invite.'
      );
    } finally {
      setAgreementOpBusy('');
    }
  }

  useEffect(() => {
    fetchAgreement();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isMagicLink, initialAgreement]);

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

  useEffect(() => {
    const hasEmbeddedMilestones =
      Array.isArray(agreement?.milestones) ||
      Array.isArray(agreement?.milestone_set);
    if (!id || hasEmbeddedMilestones) {
      setWorkspaceMilestones([]);
      setWorkspaceMilestonesLoaded(Boolean(hasEmbeddedMilestones));
      setWorkspaceMilestonesError('');
      setWorkspaceMilestonesLoading(false);
      return;
    }

    let cancelled = false;
    const fetchWorkspaceMilestones = async () => {
      try {
        setWorkspaceMilestonesLoading(true);
        setWorkspaceMilestonesError('');
        const { data } = await api.get('/projects/milestones/', {
          params: { agreement: id, _ts: Date.now() },
        });
        const rows = Array.isArray(data)
          ? data
          : Array.isArray(data?.results)
            ? data.results
            : [];
        if (!cancelled) {
          setWorkspaceMilestones(rows);
          setWorkspaceMilestonesLoaded(true);
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setWorkspaceMilestones([]);
          setWorkspaceMilestonesLoaded(false);
          setWorkspaceMilestonesError('Milestone data is not available yet.');
        }
      } finally {
        if (!cancelled) setWorkspaceMilestonesLoading(false);
      }
    };

    fetchWorkspaceMilestones();
    return () => {
      cancelled = true;
    };
  }, [agreement?.milestones, agreement?.milestone_set, id]);

  useEffect(() => {
    if (!id) {
      setWorkspaceInvoices([]);
      setWorkspaceInvoicesLoaded(false);
      return;
    }

    let cancelled = false;
    const fetchWorkspaceInvoices = async () => {
      try {
        const { data } = await api.get('/projects/invoices/', {
          params: { agreement: id, page_size: 500, _ts: Date.now() },
        });
        const rows = Array.isArray(data)
          ? data
          : Array.isArray(data?.results)
            ? data.results
            : [];
        if (!cancelled) {
          setWorkspaceInvoices(rows);
          setWorkspaceInvoicesLoaded(true);
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setWorkspaceInvoices([]);
          setWorkspaceInvoicesLoaded(false);
        }
      }
    };

    fetchWorkspaceInvoices();
    return () => {
      cancelled = true;
    };
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
      toast.error('Failed to load subcontractor invitations.');
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
      toast.error(formatApiError(e, 'Failed to load draw requests.'));
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
      toast.error(formatApiError(e, 'Failed to load external payments.'));
      setExternalPayments([]);
    } finally {
      setExternalPaymentsLoading(false);
    }
  };

  const fetchDrawMilestones = async () => {
    if (!id) return [];
    try {
      const { data } = await api.get('/projects/milestones/', {
        params: { agreement: id, _ts: Date.now() },
      });
      const rows = Array.isArray(data)
        ? data
        : Array.isArray(data?.results)
          ? data.results
          : [];
      setDrawMilestones(rows);
      return rows;
    } catch (e) {
      console.error(e);
      toast.error('Failed to load milestones for draw creation.');
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
      const { data } = await api.get('/projects/subaccounts/');
      const rows = Array.isArray(data?.results) ? data.results : data || [];
      setEligibleReviewers(
        rows
          .filter((item) =>
            ['employee_milestones', 'employee_supervisor'].includes(
              String(item.role || '')
            )
          )
          .map((item) => ({
            id: item.id,
            display_name: item.display_name || item.email || 'Team Member',
            email: item.email || item.user?.email || '',
            role: item.role || '',
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
      const { data } = await api.get('/projects/warranties/', {
        params: { agreement: id },
      });
      setWarranties(Array.isArray(data) ? data : data?.results || []);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load warranty records.');
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
      localStorage.setItem('activeAgreementTitle', norm.title || '');
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
        setFundingError('');
        setFundingLoading(false);
        return;
      }

      // Direct Pay: do not load escrow funding preview
      if (norm.isDirectPay) {
        setFundingPreview(null);
        setFundingError('');
        setFundingLoading(false);
        return;
      }

      setFundingLoading(true);
      setFundingError('');
      try {
        const { data } = await api.get(
          `/projects/agreements/${id}/funding_preview/`
        );
        setFundingPreview(data);
      } catch (err) {
        const msg =
          err?.response?.data?.detail ||
          'Unable to load fee & escrow summary. Totals are still valid, but rate info is unavailable.';
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
      toast('This agreement is Direct Pay (no escrow funding).');
      return;
    }

    try {
      const { data } = await api.post(
        `/projects/agreements/${id}/fund_escrow/`
      );
      if (data?.client_secret) {
        setClientSecret(data.client_secret);
        setEscrowOpen(true);
      } else {
        toast.error('Unable to start escrow funding.');
      }
    } catch (e) {
      console.error(e);
      toast.error('Failed to start escrow funding.');
    }
  };

  const downloadPDF = async () => {
    try {
      // Keep your existing endpoint-based download (works even if media auth is tricky)
      const res = await api.get(`/projects/agreements/${id}/pdf/`, {
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `agreement_${id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      toast.error('PDF download failed.');
    }
  };

  const previewPdf = async () => {
    try {
      setPdfPreviewError('');
      const res = await api.get(`/projects/agreements/${id}/preview_pdf/`, {
        responseType: 'blob',
        params: { stream: 1 },
      });

      const blob = new Blob([res.data], { type: 'application/pdf' });
      const localUrl = URL.createObjectURL(blob);

      setPdfUrl(localUrl);
      setPdfOpen(true);
    } catch (err) {
      console.error('Preview PDF error:', err);
      setPdfPreviewError(formatApiError(err, 'Unable to preview PDF.'));
      toast.error('Unable to preview PDF.');
    }
  };

  // Assignment handlers
  const assignAgreement = async (subId) => {
    await assignAgreementToSubaccount(norm.id, subId);
    toast.success('Agreement assigned.');
  };

  const unassignAgreement = async (subId) => {
    await unassignAgreementFromSubaccount(norm.id, subId);
    toast.success('Agreement unassigned.');
  };

  const resetWarrantyForm = () => {
    setEditingWarrantyId(null);
    setWarrantyForm({
      title: '',
      coverage_details: '',
      exclusions: '',
      start_date: '',
      end_date: '',
      status: 'active',
      applies_to: 'full_agreement',
    });
  };

  const openWarrantyEditor = (warranty = null) => {
    if (warranty) {
      setEditingWarrantyId(warranty.id);
      setWarrantyForm({
        title: warranty.title || '',
        coverage_details: warranty.coverage_details || '',
        exclusions: warranty.exclusions || '',
        start_date: warranty.start_date || '',
        end_date: warranty.end_date || '',
        status: warranty.status || 'active',
        applies_to: warranty.applies_to || 'full_agreement',
      });
    } else {
      resetWarrantyForm();
    }
    setWarrantyEditorOpen(true);
  };

  const saveWarrantyRecord = async () => {
    if (!norm.id) return;
    if (!warrantyForm.title.trim()) {
      toast.error('Warranty title is required.');
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
        applies_to: warrantyForm.applies_to || '',
      };

      if (editingWarrantyId) {
        await api.patch(`/projects/warranties/${editingWarrantyId}/`, payload);
        toast.success('Warranty updated.');
      } else {
        await api.post('/projects/warranties/', payload);
        toast.success('Warranty created.');
      }

      setWarrantyEditorOpen(false);
      resetWarrantyForm();
      await fetchWarranties();
    } catch (e) {
      console.error(e);
      toast.error(
        e?.response?.data?.detail || 'Failed to save warranty record.'
      );
    } finally {
      setWarrantySaving(false);
    }
  };

  const openCreateDrawModal = async () => {
    const rows = await fetchDrawMilestones();
    const blockedRows = rows.filter(isMilestoneAmendmentBlocked);
    const billableRows = rows.filter(
      (row) => !isMilestoneAmendmentBlocked(row)
    );
    if (blockedRows.length) {
      toast.error(
        'Some milestones are affected by pending amendments and cannot be included in a draw yet.'
      );
    }
    if (!billableRows.length && rows.length) {
      toast.error(
        'All milestones are blocked by amendment review. Respond to the amendment before requesting payment.'
      );
      return;
    }
    const nextPercents = {};
    billableRows.forEach((row) => {
      nextPercents[String(row.id)] = '0';
    });
    setDrawMilestones(billableRows);
    setDrawForm({
      title: `Draw ${drawRows.length + 1}`,
      notes: '',
      percents: nextPercents,
    });
    setDrawModalOpen(true);
  };

  const submitCreateDraw = async () => {
    try {
      setDrawSaving(true);
      const lineItems = (drawMilestones || [])
        .filter((milestone) => !isMilestoneAmendmentBlocked(milestone))
        .map((milestone) => ({
          milestone_id: milestone.id,
          description: milestone.title || `Milestone ${milestone.id}`,
          scheduled_value: milestone.amount || '0.00',
          percent_complete: drawForm.percents[String(milestone.id)] || '0',
        }))
        .filter((row) => Number(row.percent_complete || 0) > 0);

      if (!lineItems.length) {
        toast.error('Enter percent complete for at least one milestone.');
        return;
      }

      await createAgreementDrawRequest(id, {
        title: drawForm.title,
        notes: drawForm.notes,
        line_items: lineItems,
      });
      toast.success('Draw request created.');
      setDrawModalOpen(false);
      await fetchDraws();
    } catch (e) {
      console.error(e);
      toast.error(formatApiError(e, 'Failed to create draw request.'));
    } finally {
      setDrawSaving(false);
    }
  };

  const runDrawAction = async (drawId, action) => {
    try {
      let result = null;
      if (action === 'submit') result = await submitDrawRequest(drawId);
      if (action === 'approve') result = await approveDrawRequest(drawId);
      if (action === 'release') result = await releaseDrawRequest(drawId);
      if (action === 'reject') result = await rejectDrawRequest(drawId);
      if (action === 'changes') result = await requestDrawChanges(drawId);
      const successMessage =
        action === 'release'
          ? 'Escrow funds marked as released.'
          : result?.email_delivery?.message || 'Draw updated.';
      toast.success(successMessage);
      await fetchDraws();
      await fetchExternalPayments();
    } catch (e) {
      console.error(e);
      toast.error(formatApiError(e, 'Failed to update draw.'));
    }
  };

  const copyDrawReviewLink = async (draw) => {
    const url = String(draw?.public_review_url || '').trim();
    if (!url) {
      toast.error('Owner review link is not ready yet.');
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Owner review link copied.');
    } catch {
      toast.error('Unable to copy the owner review link.');
    }
  };

  const openDrawReviewLink = (draw) => {
    const url = String(draw?.public_review_url || '').trim();
    if (!url) {
      toast.error('Owner review link is not ready yet.');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const openExternalPaymentModal = (draw) => {
    setPaymentTargetDraw(draw);
    setPaymentForm({
      gross_amount: draw?.gross_amount || '',
      retainage_withheld_amount: draw?.retainage_amount || '0.00',
      net_amount: draw?.net_amount || '',
      payment_method: 'ach',
      payment_date: new Date().toISOString().slice(0, 10),
      reference_number: '',
      notes: '',
      proof_file: null,
    });
    setPaymentModalOpen(true);
  };

  const submitExternalPayment = async () => {
    if (!paymentTargetDraw?.id) return;
    try {
      setPaymentSaving(true);
      const formData = new FormData();
      formData.append('gross_amount', paymentForm.gross_amount || '0.00');
      formData.append(
        'retainage_withheld_amount',
        paymentForm.retainage_withheld_amount || '0.00'
      );
      formData.append('net_amount', paymentForm.net_amount || '0.00');
      formData.append('payment_method', paymentForm.payment_method || 'ach');
      formData.append('payment_date', paymentForm.payment_date);
      formData.append('reference_number', paymentForm.reference_number || '');
      formData.append('notes', paymentForm.notes || '');
      if (paymentForm.proof_file) {
        formData.append('proof_file', paymentForm.proof_file);
      }
      await recordDrawExternalPayment(paymentTargetDraw.id, formData);
      toast.success('External payment recorded.');
      setPaymentModalOpen(false);
      await fetchDraws();
      await fetchExternalPayments();
    } catch (e) {
      console.error(e);
      toast.error(formatApiError(e, 'Failed to record external payment.'));
    } finally {
      setPaymentSaving(false);
    }
  };

  useEffect(() => {
    if (!isAdminMode || adminTab !== 'ai' || !id) {
      setAdminAiContext(null);
      setAdminAiLoading(false);
      return undefined;
    }

    let cancelled = false;

    const loadAdminAiContext = async () => {
      try {
        setAdminAiLoading(true);
        const { data } = await api.get(
          `/projects/admin/agreements/${id}/ai-context/`
        );
        if (!cancelled) setAdminAiContext(data);
      } catch (error) {
        console.error('Admin AI context load error:', error);
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

  useEffect(() => {
    if (!isContractor || !pendingContractorAmendments.length) return;
    pendingContractorAmendments.forEach((amendment) => {
      markAmendmentViewed(amendment);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isContractor,
    pendingContractorAmendments.map((row) => row.id).join(','),
  ]);

  useEffect(() => {
    const routeWorkspaceStatus = String(
      agreement?.status || agreement?.workflow_status || agreement?.state || ''
    )
      .trim()
      .toLowerCase();
    const isDraftRoute =
      routeWorkspaceStatus === 'draft' || (!routeWorkspaceStatus && agreement);
    if (isAdminMode || loading || !agreement || !isDraftRoute) return;
    navigate(`/app/agreements/${id}/wizard?step=1`, { replace: true });
  }, [agreement, id, isAdminMode, loading, navigate]);

  if (loading) return <div className="p-6">Loading...</div>;

  if (!norm.id) return <div className="p-6">Agreement not found.</div>;

  if (isAdminMode) {
    return (
      <AdminAgreementCommandCenter
        agreement={agreement}
        norm={norm}
        id={id}
        adminTab={adminTab}
        onBackToList={() => navigate('/app/admin?view=agreements')}
        onNavigateTab={(suffix) =>
          navigate(`/app/admin/agreements/${id}${suffix || ''}`)
        }
        onRefreshPricing={refreshAgreementPricing}
        onResendSignature={resendAgreementSignature}
        onGoToFeeAudit={() => navigate('/app/admin?view=fee_audit')}
        fundingPreview={fundingPreview}
        adminAiContext={adminAiContext}
        adminAiLoading={adminAiLoading}
        agreementOpsMsg={agreementOpsMsg}
      />
    );
  }

  const submitInvitation = async () => {
    if (!invitationForm.invite_email.trim()) {
      toast.error('Subcontractor email is required.');
      return;
    }

    try {
      setInviteSubmitting(true);
      const { data } = await api.post(
        `/projects/agreements/${id}/subcontractor-invitations/`,
        invitationForm
      );
      toast.success('Subcontractor invitation created.');
      setInvitationForm({
        invite_email: '',
        invite_name: '',
        invited_message: '',
      });
      setInviteFormOpen(false);
      await fetchSubcontractorInvitations();
      if (data?.invite_url) {
        try {
          await navigator.clipboard.writeText(data.invite_url);
          toast.success('Invitation link copied.');
        } catch {
          // Clipboard access is optional.
        }
      }
    } catch (err) {
      console.error(err);
      toast.error(
        err?.response?.data?.invite_email?.[0] ||
          err?.response?.data?.detail ||
          'Failed to create subcontractor invitation.'
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
      toast.success('Invitation revoked.');
      await fetchSubcontractorInvitations();
    } catch (err) {
      console.error(err);
      toast.error(
        err?.response?.data?.detail || 'Failed to revoke invitation.'
      );
    }
  };

  const copyInviteLink = async (inviteUrl) => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      toast.success('Invitation link copied.');
    } catch {
      toast.error('Unable to copy the invitation link.');
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
    if (options.agreedPay !== undefined && options.agreedPay !== '') {
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
    if (options.complianceAction === 'request_license') {
      toast.success('License request sent and assignment marked pending.');
    } else if (options.complianceAction === 'assign_anyway') {
      toast.success('Subcontractor assigned with override.');
    } else {
      toast.success('Subcontractor assigned.');
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
    toast.success('Subcontractor unassigned.');
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
    toast.success('Delegated reviewer assigned.');
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
    toast.success('Delegated reviewer cleared.');
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
    toast.success('Review request cleared.');
  };

  const approveSubcontractorCompletion = async (milestoneId) => {
    try {
      setCompletionDecisionBusy((prev) => ({ ...prev, [milestoneId]: true }));
      const response_note = (completionResponseNotes[milestoneId] || '').trim();
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
      setCompletionResponseNotes((prev) => ({ ...prev, [milestoneId]: '' }));
      toast.success('Subcontractor submission marked reviewed.');
    } catch (err) {
      console.error(err);
      toast.error(
        err?.response?.data?.detail ||
          'Failed to approve subcontractor submission.'
      );
    } finally {
      setCompletionDecisionBusy((prev) => ({ ...prev, [milestoneId]: false }));
    }
  };

  const requestReleaseSubcontractorPayment = (milestone) => {
    const payoutAgreement = milestone?.subcontractor_milestone_agreement;
    if (!payoutAgreement?.id) {
      toast.error(
        'No subcontractor payment terms were found for this milestone.'
      );
      return;
    }
    setPayoutReleaseTarget({
      agreementId: payoutAgreement.id,
      milestoneId: milestone.id,
      milestoneTitle: milestone.title || 'Milestone',
      subcontractorName:
        payoutAgreement.subcontractor_display_name ||
        payoutAgreement.subcontractor_email ||
        'Subcontractor',
      amount: payoutAgreement.agreed_pay || milestone.payout_amount || '',
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
            milestone.id === milestoneId
              ? { ...milestone, ...updatedMilestone }
              : milestone
          ),
        };
      });
      setPayoutReleaseTarget(null);
      toast.success('Subcontractor payment released.');
    } catch (err) {
      console.error(err);
      toast.error(
        err?.response?.data?.detail ||
          'Failed to release subcontractor payment.'
      );
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
      toast.success('Subcontractor payout executed.');
    } catch (err) {
      console.error(err);
      toast.error(
        err?.response?.data?.detail || 'Failed to execute subcontractor payout.'
      );
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
      toast.success('Subcontractor payout retried.');
    } catch (err) {
      console.error(err);
      toast.error(
        err?.response?.data?.detail || 'Failed to retry subcontractor payout.'
      );
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
      toast.success('Subcontractor payout reset to ready.');
    } catch (err) {
      console.error(err);
      toast.error(
        err?.response?.data?.detail || 'Failed to reset subcontractor payout.'
      );
    } finally {
      setPayoutDecisionBusy((prev) => ({ ...prev, [milestoneId]: false }));
    }
  };

  const rejectSubcontractorCompletion = async (milestoneId) => {
    try {
      setCompletionDecisionBusy((prev) => ({ ...prev, [milestoneId]: true }));
      const response_note = (completionResponseNotes[milestoneId] || '').trim();
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
      setCompletionResponseNotes((prev) => ({ ...prev, [milestoneId]: '' }));
      toast.success('Sent back for changes.');
    } catch (err) {
      console.error(err);
      toast.error(
        err?.response?.data?.detail ||
          'Failed to send subcontractor submission back.'
      );
    } finally {
      setCompletionDecisionBusy((prev) => ({ ...prev, [milestoneId]: false }));
    }
  };

  const statusText = norm.isDirectPay
    ? norm.isSigned
      ? 'Signed - Direct Pay'
      : 'Not Signed - Direct Pay'
    : norm.escrowFunded
      ? 'Escrow Funded'
      : norm.isSigned
        ? 'Awaiting Funding'
        : 'Not Signed';
  const workspaceStatus = String(
    agreement?.status || agreement?.workflow_status || agreement?.state || ''
  )
    .trim()
    .toLowerCase();
  const isDraftWorkspace = workspaceStatus === 'draft' || !workspaceStatus;
  const resolvedMilestones = resolveAgreementMilestones({
    agreement,
    norm,
    fallbackRows: workspaceMilestones,
    fallbackLoaded: workspaceMilestonesLoaded,
    fallbackLoading: workspaceMilestonesLoading,
    fallbackError: workspaceMilestonesError,
  });
  const milestones = resolvedMilestones.rows;
  const milestoneDataKnown = resolvedMilestones.dataKnown;
  const completedMilestones = milestones.filter(isMilestoneComplete).length;
  const milestoneProgressLabel = resolvedMilestones.loading
    ? 'Loading milestones...'
    : resolvedMilestones.error
      ? resolvedMilestones.error
      : milestones.length
        ? `${completedMilestones} of ${milestones.length} complete`
        : milestoneDataKnown
          ? 'No milestones found'
          : 'No milestone data loaded';
  const embeddedInvoiceRows = Array.isArray(norm.invoices) ? norm.invoices : [];
  const invoiceRows = [
    ...embeddedInvoiceRows,
    ...workspaceInvoices.filter((invoice) => {
      const invoiceId = String(invoice?.id || invoice?.invoice_id || '').trim();
      if (!invoiceId) return true;
      return !embeddedInvoiceRows.some(
        (existing) =>
          String(existing?.id || existing?.invoice_id || '').trim() === invoiceId
      );
    }),
  ];
  const invoiceRowsById = new Map(
    invoiceRows
      .map((invoice) => [
        String(invoice?.id || invoice?.invoice_id || '').trim(),
        invoice,
      ])
      .filter(([invoiceId]) => invoiceId)
  );
  const milestoneDisplaySource = (milestone) => {
    if (!milestone || typeof milestone !== 'object') return milestone;
    const existingInvoice =
      milestone.invoice && typeof milestone.invoice === 'object'
        ? milestone.invoice
        : null;
    const invoiceId = String(
      milestone.invoice_id ||
        (milestone.invoice && typeof milestone.invoice !== 'object'
          ? milestone.invoice
          : '') ||
        ''
    ).trim();
    const matchedInvoice =
      existingInvoice ||
      (invoiceId ? invoiceRowsById.get(invoiceId) : null) ||
      invoiceRows.find((invoice) => {
        const invoiceMilestoneId = String(
          invoice?.milestone_id ||
            invoice?.milestone ||
            invoice?.milestone?.id ||
            ''
        ).trim();
        return invoiceMilestoneId && invoiceMilestoneId === String(milestone.id);
      });
    return matchedInvoice
      ? {
          ...milestone,
          invoice: matchedInvoice,
          invoice_status:
            milestone.invoice_status ||
            matchedInvoice.status ||
            matchedInvoice.invoice_status,
          invoice_paid:
            milestone.invoice_paid ||
            matchedInvoice.invoice_paid ||
            matchedInvoice.status === 'paid',
          paid_at: milestone.paid_at || matchedInvoice.paid_at,
          escrow_released:
            milestone.escrow_released || matchedInvoice.escrow_released,
          escrow_released_at:
            milestone.escrow_released_at || matchedInvoice.escrow_released_at,
        }
      : milestone;
  };
  const openInvoiceRows = invoiceRows.filter((invoice) => {
    const status = String(
      invoice?.status || invoice?.workflow_status || ''
    ).toLowerCase();
    return ![
      'paid',
      'void',
      'voided',
      'cancelled',
      'canceled',
      'refunded',
    ].includes(status);
  });
  const openInvoiceTotal = openInvoiceRows.reduce(
    (sum, invoice) =>
      sum + toMoney(invoice?.amount || invoice?.total || invoice?.total_amount),
    0
  );
  const activeDrawRows = drawRows.filter((draw) => {
    const status = drawWorkflowStatus(draw);
    return ![
      'paid',
      'released',
      'cancelled',
      'canceled',
      'void',
      'voided',
    ].includes(status);
  });
  const hasActionablePayments =
    openInvoiceRows.length > 0 || activeDrawRows.length > 0;
  const paymentActionUrl = `/app/payments?agreement=${id}`;
  const pdfStatusLabel = norm.currentPdfUrl
    ? norm.currentPdfVersion != null
      ? `Current PDF v${norm.currentPdfVersion}`
      : 'Current PDF available'
    : 'No current PDF yet';
  const fundingStatusLabel = norm.isDirectPay
    ? activeDrawRows.length || openInvoiceRows.length
      ? 'Direct Pay - payment activity pending'
      : 'Direct Pay'
    : norm.escrowFunded
      ? 'Escrow funded'
      : norm.isSigned
        ? 'Awaiting escrow funding'
        : 'Funding waits for signatures';
  const readyToSendStatuses = new Set([
    'ready',
    'ready_to_send',
    'ready-to-send',
    'ready_to_send_to_customer',
    'finalized',
  ]);
  const completedStatuses = new Set(['completed', 'closed', 'complete']);
  const archivedStatuses = new Set(['archived', 'cancelled', 'canceled']);
  const milestoneStatusText = (milestone) =>
    String(
      pick(
        milestone?.workflow_status,
        milestone?.lifecycle_state,
        milestone?.milestone_lifecycle_state,
        milestone?.status,
        milestone?.state
      ) || ''
    )
      .trim()
      .toLowerCase();
  const activeMilestones = milestones.filter((milestone) => {
    const status = milestoneStatusText(milestone);
    return [
      'active',
      'in_progress',
      'started',
      'submitted',
      'waiting',
      'pending_review',
    ].some((token) => status.includes(token));
  });
  const completedPaymentReadyMilestones = milestones.filter((milestone) => {
    const status = milestoneStatusText(milestone);
    const completed =
      status.includes('completed') ||
      status.includes('complete') ||
      milestone?.completed;
    const alreadyBilled =
      milestone?.is_invoiced ||
      milestone?.invoice ||
      milestone?.invoice_id ||
      milestone?.draw_request ||
      milestone?.draw_request_id;
    return completed && !alreadyBilled;
  });
  const overallMilestoneProgressPercent =
    milestones.length > 0
      ? Math.round((completedMilestones / milestones.length) * 100)
      : 0;
  const currentMilestone =
    activeMilestones?.[0] ||
    milestones.find((milestone) => milestoneProgressPercent(milestone) < 100) ||
    milestones[0] ||
    null;
  const milestoneCompletionUrlFor = (milestone = currentMilestone) =>
    `/app/milestones?agreement=${id}${
      milestone?.id ? `&milestone=${milestone.id}` : ''
    }`;
  const milestoneCompletionUrl = milestoneCompletionUrlFor(currentMilestone);
  const milestoneViewUrlFor = (milestone) =>
    milestone?.id ? `/app/milestones/${milestone.id}` : milestoneCompletionUrl;
  const currentMilestoneLabel = currentMilestone
    ? `${currentMilestone.order || milestones.indexOf(currentMilestone) + 1}. ${currentMilestone.title || 'Untitled milestone'}`
    : milestoneDataKnown
      ? 'No active milestone'
      : 'Milestone data not loaded';
  const nextPaymentStatus = openInvoiceRows.length
    ? `${openInvoiceRows.length} open invoice${openInvoiceRows.length === 1 ? '' : 's'}`
    : activeDrawRows.length
      ? `${activeDrawRows.length} active draw${activeDrawRows.length === 1 ? '' : 's'}`
      : 'No payment action loaded';
  const milestonePreviewRows = milestones.slice(0, 5);
  const hasLoadedIncompleteMilestones =
    milestoneDataKnown &&
    milestones.length > 0 &&
    completedMilestones < milestones.length;
  const hasLoadedAllMilestonesComplete =
    milestoneDataKnown &&
    milestones.length > 0 &&
    completedMilestones === milestones.length;
  const isReadyToSend =
    readyToSendStatuses.has(workspaceStatus) ||
    readyToSendStatuses.has(
      String(agreement?.contractor_status_key || '')
        .trim()
        .toLowerCase()
    ) ||
    String(agreement?.status_label || agreement?.workflow_status_label || '')
      .toLowerCase()
      .includes('ready to send');
  const isArchivedOrCancelled = archivedStatuses.has(workspaceStatus);
  const isCompletedAgreement =
    completedStatuses.has(workspaceStatus) || hasLoadedAllMilestonesComplete;
  const isFundedOrDirectPay = norm.isDirectPay || norm.escrowFunded;
  const timelineState = agreementTimelineState(norm);
  const agreementHint = getAgreementDetailHint({
    agreement,
    norm,
    milestones,
  });
  const nextAction = pendingContractorAmendments.length
    ? {
        label: 'Review Amendment',
        reason: `${pendingContractorAmendments.length} amendment request${pendingContractorAmendments.length === 1 ? '' : 's'} need attention before affected work or payments move forward.`,
        status: 'Action required',
        effort: '5-10 min',
        cta: 'Open amendments',
        tab: 'amendments',
        secondaryCta: 'Review milestones',
        secondaryTab: 'milestones',
      }
    : isDraftWorkspace
      ? {
          label: 'Continue Draft',
          reason:
            'This agreement is still a draft. Finish the wizard before sending it to the customer.',
          status: 'Draft',
          effort: '10-20 min',
          cta: 'Continue draft',
          href: `/app/agreements/${id}/wizard`,
          secondaryCta: 'Review overview',
          secondaryTab: 'overview',
        }
      : isReadyToSend
        ? {
            label: 'Send Agreement',
            reason:
              'The agreement appears ready for the customer, but it has not been sent from the available workspace state.',
            status: 'Ready to send',
            effort: '2-5 min',
            cta: 'Open signatures',
            tab: 'signatures',
          }
        : !norm.isSigned
          ? {
              label: 'Awaiting Signature',
              reason:
                'The agreement is not fully signed yet, so funding and execution steps should wait.',
              status: 'Waiting on signature',
              effort: '1 min check',
              cta: 'Open signatures',
              tab: 'signatures',
              secondaryCta: 'Review PDF',
              secondaryTab: 'signatures',
            }
          : !norm.isDirectPay && !norm.escrowFunded
            ? {
                label: 'Request Funding',
                reason:
                  'The agreement is signed but escrow has not been funded.',
                status: 'Funding required',
                effort: '2-5 min',
                cta: 'Open funding',
                tab: 'funding',
                secondaryCta: 'Review PDF',
                secondaryTab: 'signatures',
              }
            : completedPaymentReadyMilestones.length
              ? {
                  label: 'Request Payment',
                  reason: `${completedPaymentReadyMilestones.length} completed milestone${completedPaymentReadyMilestones.length === 1 ? '' : 's'} appear ready for payment follow-up from the loaded data.`,
                  status: 'Payment follow-up',
                  effort: '5-10 min',
                  cta: hasActionablePayments
                    ? 'View Payment Details'
                    : 'Review milestones',
                  href: hasActionablePayments
                    ? paymentActionUrl
                    : milestoneCompletionUrl,
                  secondaryCta: 'Review milestones',
                  hrefSecondary: milestoneCompletionUrl,
                }
              : activeMilestones.length
                ? {
                    label: 'Complete Milestone',
                    reason: `${activeMilestones.length} active milestone${activeMilestones.length === 1 ? '' : 's'} need progress or completion handling.`,
                    status: 'Work active',
                    effort: '5-15 min',
                    cta: 'Complete Milestone',
                    href: milestoneCompletionUrl,
                    secondaryCta: hasActionablePayments
                      ? 'View Payment Details'
                      : undefined,
                    hrefSecondary: hasActionablePayments
                      ? paymentActionUrl
                      : undefined,
                  }
                : isFundedOrDirectPay && hasLoadedIncompleteMilestones
                  ? {
                      label: 'Start First Milestone',
                      reason:
                        'Funding or direct-pay readiness is in place and the loaded milestone plan still has work to start.',
                      status: 'Ready to start',
                      effort: '5 min',
                      cta: 'Start in Milestones',
                      href: milestoneCompletionUrl,
                      secondaryCta: 'Review assignments',
                      secondaryTab: 'activity',
                    }
                  : activeDrawRows.length || openInvoiceRows.length
                    ? {
                        label: 'Review Payment Activity',
                        reason:
                          'There are open invoice, draw, or payment items to review.',
                        status: 'Payment pending',
                        effort: '3-10 min',
                        cta: 'Open payments',
                        href: paymentActionUrl,
                        secondaryCta: 'Review milestones',
                        hrefSecondary: milestoneCompletionUrl,
                      }
                    : isCompletedAgreement && !isArchivedOrCancelled
                      ? {
                          label: 'Request Customer Review',
                          reason:
                            'The loaded agreement state looks complete. Follow up with the customer while the project is still fresh.',
                          status: 'Completed',
                          effort: '2 min',
                          cta: 'Review documents',
                          tab: 'documents',
                          secondaryCta: 'Review signatures',
                          secondaryTab: 'signatures',
                        }
                      : hasLoadedIncompleteMilestones
                        ? {
                            label: 'Manage Milestones',
                            reason:
                              'At least one loaded milestone is still incomplete.',
                            status: 'Work in progress',
                            effort: '5-15 min',
                            cta: 'Manage in Milestones',
                            href: milestoneCompletionUrl,
                            secondaryCta: hasActionablePayments
                              ? 'View Payment Details'
                              : undefined,
                            hrefSecondary: hasActionablePayments
                              ? paymentActionUrl
                              : undefined,
                          }
                        : {
                            label: 'Review Agreement Status',
                            reason:
                              'No urgent blockers were detected from the loaded agreement data.',
                            status: isArchivedOrCancelled
                              ? 'Historical record'
                              : 'No blocker detected',
                            effort: '2 min',
                            cta: 'View overview',
                            tab: 'overview',
                            secondaryCta: 'Review PDF',
                            secondaryTab: 'signatures',
                          };
  const nextActionLabel = nextAction.label;
  const backUrl = isAdminMode
    ? '/app/admin?view=agreements'
    : '/app/agreements';
  const customerId = agreementCustomerId(agreement);
  const customerWorkspaceUrl = customerId ? `/app/customers/${customerId}` : '';
  const recordsUrl = '/app/customers/records';
  const paymentsUrl = '/app/payments';
  const hasPaymentNavigation =
    !isAdminMode &&
    (openInvoiceRows.length > 0 ||
      activeDrawRows.length > 0 ||
      norm.isSigned ||
      norm.escrowFunded ||
      norm.isDirectPay);
  const activeDrawTotal = activeDrawRows.reduce(
    (sum, draw) =>
      sum +
      toMoney(
        pick(draw?.net_amount, draw?.gross_amount, draw?.amount, draw?.total)
      ),
    0
  );
  const outstandingBalanceTotal = openInvoiceTotal + activeDrawTotal;
  const invoiceSummaryLabel = openInvoiceRows.length
    ? `${openInvoiceRows.length} open / ${formatMoney(openInvoiceTotal)}`
    : invoiceRows.length
      ? `${invoiceRows.length} invoice${invoiceRows.length === 1 ? '' : 's'} tracked`
      : workspaceInvoicesLoaded
        ? 'No invoices yet'
      : 'No invoices yet';
  const drawSummaryLabel = isProgressPayments
    ? activeDrawRows.length
      ? `${activeDrawRows.length} active / ${formatMoney(activeDrawTotal)}`
      : drawRows.length
        ? `${drawRows.length} draw${drawRows.length === 1 ? '' : 's'} tracked`
        : 'No draw requests yet'
    : '';
  const timelineItems = [
    norm.isSigned
      ? {
          id: 'signed',
          title: 'Agreement signed',
          detail: pick(
            agreement?.signed_at,
            agreement?.homeowner_signed_at,
            agreement?.contractor_signed_at,
            'Signature complete'
          ),
          tone: 'complete',
        }
      : {
          id: 'signature-pending',
          title: 'Signature pending',
          detail: 'Agreement has not been fully signed yet.',
          tone: 'pending',
        },
    norm.isDirectPay || norm.escrowFunded
      ? {
          id: 'funding',
          title: norm.isDirectPay ? 'Direct Pay selected' : 'Funding received',
          detail: norm.isDirectPay
            ? 'Invoice pay links handle collection.'
            : 'Escrow funding is marked ready in the loaded data.',
          tone: 'complete',
        }
      : {
          id: 'funding-pending',
          title: 'Funding pending',
          detail: 'Funding waits for signatures or customer action.',
          tone: 'pending',
        },
    completedMilestones
      ? {
          id: 'milestones-complete',
          title: `${completedMilestones} milestone${completedMilestones === 1 ? '' : 's'} completed`,
          detail: milestoneProgressLabel,
          tone: 'complete',
        }
      : null,
    currentMilestone
      ? {
          id: 'current-milestone',
          title: `${currentMilestone.title || 'Current milestone'}`,
          detail:
            milestoneProgressPercent(currentMilestone) >= 100
              ? 'Complete'
              : 'Current or next milestone',
          tone: 'active',
        }
      : null,
  ].filter(Boolean);
  const documentFileRows = [
    {
      label: 'Agreement PDFs',
      value: Array.isArray(norm.pdfVersions) ? norm.pdfVersions.length : 0,
    },
    { label: 'Photos', value: Number(agreement?.photos_count || 0) },
    { label: 'Warranties', value: warranties.length },
    { label: 'Attachments', value: Number(agreement?.attachments_count || 0) },
  ];
  const hasSmsDetails =
    !!agreement?.sms_enabled ||
    !!agreement?.last_sms_event?.summary ||
    !!agreement?.last_sms_automation_decision ||
    (Array.isArray(agreement?.recent_sms_automation_decisions) &&
      agreement.recent_sms_automation_decisions.length > 0);
  const showDrawRequestsPanel =
    isProgressPayments && (isExecuted || drawLoading || drawRows.length > 0);
  const planningAssumptions =
    agreement?.planning_assumptions &&
    typeof agreement.planning_assumptions === 'object'
      ? agreement.planning_assumptions
      : null;
  const planningCapabilityMix = Array.isArray(
    planningAssumptions?.planning_capability_mix
  )
    ? planningAssumptions.planning_capability_mix
    : [];
  const hasPlanningAssumptions =
    !!planningAssumptions && Object.keys(planningAssumptions).length > 0;
  const pageEyebrow = isAdminMode ? 'Admin' : 'Core';
  const pageTitle = isAdminMode
    ? 'Admin Agreement Detail'
    : 'Agreement Workspace';
  const pageSubtitle = isAdminMode
    ? 'Review agreement details, pricing signals, and agreement history without contractor workflow actions.'
    : 'Manage signatures, funding, assignments, documents, milestones, and invoices after the agreement is sent.';

  const setWorkspaceTab = (tab) => {
    const normalized = normalizeWorkspaceTab(tab);
    navigate(
      `/app/agreements/${id}/workspace${normalized === 'overview' ? '' : `?tab=${normalized}`}`
    );
  };

  const runWorkspaceAction = (action) => {
    if (!action) return;
    if (action.href) {
      navigate(action.href);
      return;
    }
    setWorkspaceTab(action.tab || 'overview');
  };

  return (
    <ContractorPageSurface
      eyebrow={pageEyebrow}
      title={pageTitle}
      subtitle={pageSubtitle}
      actions={
        <div className="flex flex-wrap gap-2">
          <a
            data-testid="agreement-workspace-nav-back"
            href={backUrl}
            className="rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-white/15"
          >
            {isAdminMode ? 'Back to Admin Agreements' : 'Back to Agreements'}
          </a>
          {!isAdminMode && customerWorkspaceUrl ? (
            <a
              data-testid="agreement-workspace-nav-customer"
              href={customerWorkspaceUrl}
              className="rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-white/15"
            >
              Customer Workspace
            </a>
          ) : null}
          {!isAdminMode ? (
            <a
              data-testid="agreement-workspace-nav-records"
              href={recordsUrl}
              className="rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-white/15"
            >
              Records
            </a>
          ) : null}
          {hasPaymentNavigation ? (
            <a
              data-testid="agreement-workspace-nav-payments"
              href={paymentsUrl}
              className="rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-white/15"
            >
              Payments
            </a>
          ) : null}
        </div>
      }
    >
      <section
        data-testid="agreement-workspace-header"
        className="rounded-[22px] border border-white/10 bg-[#061d42]/95 p-3 shadow-[0_18px_45px_rgba(2,8,23,0.28)] sm:rounded-[28px] sm:p-5"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            {!isAdminMode ? (
              <nav
                data-testid="agreement-workspace-breadcrumb"
                className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-sky-100/60"
                aria-label="Agreement workspace breadcrumb"
              >
                <a href="/app/agreements" className="hover:text-white">
                  Agreements
                </a>
                <span>/</span>
                {customerWorkspaceUrl ? (
                  <a href={customerWorkspaceUrl} className="hover:text-white">
                    {norm.homeownerName}
                  </a>
                ) : (
                  <span>{norm.homeownerName}</span>
                )}
                <span>/</span>
                <span className="text-sky-100">Agreement Workspace</span>
              </nav>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-xl font-bold tracking-tight text-white sm:text-3xl">
                {norm.title}
              </h2>
              <PaymentModeBadge mode={norm.payment_mode} />
              <ProjectModeBadge
                mode={norm.project_mode}
                dataTestId="agreement-detail-project-mode-badge"
              />
            </div>
            <div className="text-sm text-sky-100/75">
              <span className="font-semibold text-white">
                Customer: {norm.homeownerName}
              </span>
              <span className="mx-2 text-sky-100/50">/</span>
              <span>
                Agreement Value:{' '}
                <span className="font-semibold text-white">
                  {formatMoney(norm.totalCost)}
                </span>
              </span>
              {norm.homeownerEmail && norm.homeownerEmail !== '-' ? (
                <span className="ml-2 text-sky-100/65">
                  {norm.homeownerEmail}
                </span>
              ) : null}
            </div>
            {norm.isDirectPay && (
              <div className="max-w-2xl text-xs text-sky-100/65">
                Direct Pay agreements don&apos;t use escrow. Payment collection
                happens through invoice pay links as milestones are invoiced.
              </div>
            )}
            <div
              data-testid="agreement-workspace-next-action"
              className="inline-flex max-w-full flex-wrap items-center gap-2 rounded-2xl border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-sm text-amber-50"
            >
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-100/80">
                Next action
              </span>
              <span className="font-semibold">{nextActionLabel}</span>
            </div>
          </div>

          <div className="grid min-w-0 grid-cols-2 gap-2 sm:min-w-[280px] sm:gap-3">
            <SummaryCard
              label="Agreement Status"
              value={norm.isSigned ? 'Signed' : statusText}
              className="border-white/10 bg-white/10 text-white"
            />
            <SummaryCard
              label="Funding"
              value={fundingStatusLabel}
              className="border-white/10 bg-white/10 text-white"
            />
            <SummaryCard
              label="Progress"
              value={`${milestoneProgressLabel}${milestones.length ? ` (${overallMilestoneProgressPercent}%)` : ''}`}
              className="border-white/10 bg-white/10 text-white"
            />
            <SummaryCard
              label="Version"
              value={
                norm.currentPdfVersion != null
                  ? `v${norm.currentPdfVersion} current`
                  : pdfStatusLabel
              }
              className="border-white/10 bg-white/10 text-white"
            />
            <SummaryCard
              label="Last Activity"
              value={
                <span
                  data-testid="agreement-timeline-state"
                  className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-extrabold ${
                    timelineState === 'active'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                      : 'border-slate-200 bg-slate-100 text-slate-700'
                  }`}
                >
                  {agreementTimelineLabel(norm)}
                </span>
              }
              className="border-white/10 bg-white/10 text-white"
            />
          </div>
        </div>
      </section>

      <nav
        data-testid="agreement-workspace-tabs"
        className="sticky top-0 z-10 -mx-1 overflow-x-auto rounded-2xl border border-white/10 bg-[#061d42]/95 p-2 shadow-[0_12px_30px_rgba(2,8,23,0.18)]"
      >
        <div className="flex min-w-max gap-2 px-1">
          {WORKSPACE_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              data-testid={`agreement-workspace-tab-${tab.id}`}
              onClick={() => setWorkspaceTab(tab.id)}
              className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
                workspaceTab === tab.id
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-white/5 text-sky-100/75 hover:bg-white/10 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      {isContractor && pendingContractorAmendments.length ? (
        <section
          data-testid="contractor-amendment-next-action"
          className="rounded-2xl border border-rose-200 bg-rose-50 p-5 shadow-sm"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-rose-950">
                Amendment response needed
              </h3>
              <p className="mt-1 text-sm text-rose-800">
                A homeowner amendment request is waiting for your response.
                Affected milestone completion and payment requests may be
                blocked until this is handled.
              </p>
            </div>
            <a
              href="#contractor-amendments"
              className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700"
            >
              Review amendment
            </a>
          </div>
        </section>
      ) : null}

      <div
        data-testid="agreement-workspace-panel-overview"
        className={workspaceTab === 'overview' ? 'space-y-4' : 'hidden'}
      >
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
          <div className="space-y-4">
            <section
              data-testid="agreement-overview-command-center"
              className="rounded-2xl border border-white/10 bg-[#061d42]/95 p-5 text-sky-100 shadow-sm"
            >
              <h3 className="mb-4 text-lg font-semibold text-white">
                Agreement Operations Manager
              </h3>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch lg:justify-between">
                <div className="min-w-0 flex-1 rounded-2xl border border-blue-300/25 bg-white/10 p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-100">
                    Next Action
                  </div>
                  <h3
                    data-testid="agreement-operations-next-action"
                    className="mt-2 text-xl font-bold text-white"
                  >
                    {nextAction.label}
                  </h3>
                  <div className="mt-4 text-sm font-semibold text-sky-50">
                    Why this matters
                  </div>
                  <p className="mt-1 text-sm leading-6 text-sky-100/75">
                    {nextAction.reason}
                  </p>
                </div>
                <div className="flex min-w-[220px] flex-col justify-center gap-2">
                  <button
                    type="button"
                    data-testid="agreement-overview-primary-cta"
                    onClick={() => runWorkspaceAction(nextAction)}
                    className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-500"
                  >
                    {nextAction.cta}
                  </button>
                  {nextAction.secondaryCta ? (
                    <button
                    type="button"
                    data-testid="agreement-overview-secondary-cta"
                    onClick={() =>
                      runWorkspaceAction({
                        href: nextAction.hrefSecondary,
                        tab: nextAction.secondaryTab,
                      })
                    }
                      className="inline-flex items-center justify-center rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-white/15"
                    >
                      {nextAction.secondaryCta}
                    </button>
                  ) : null}
                </div>
              </div>

              <div
                data-testid="agreement-operations-manager"
                className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
              >
                <SummaryCard
                  label="Current Stage"
                  value={nextAction.status}
                  className="border-white/10 bg-white/10 text-white"
                />
                <SummaryCard
                  label="Current Milestone"
                  value={currentMilestoneLabel}
                  className="border-white/10 bg-white/10 text-white"
                />
                <SummaryCard
                  label="Funding State"
                  value={fundingStatusLabel}
                  className="border-white/10 bg-white/10 text-white"
                />
                <SummaryCard
                  label="Next Payment"
                  value={nextPaymentStatus}
                  className="border-white/10 bg-white/10 text-white"
                />
              </div>
            </section>

            <section
              data-testid="agreement-project-snapshot"
              className="rounded-2xl border border-white/10 bg-[#061d42]/95 p-5 text-sky-100 shadow-sm"
            >
              <h3 className="text-lg font-semibold text-white">
                Project Snapshot
              </h3>
              <div
                data-testid="agreement-overview-status-summary"
                className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4"
              >
                <SummaryCard
                  label="Agreement"
                  value={`Status: ${norm.isSigned ? 'Signed' : 'Signature needed'}\nVersion: ${norm.currentPdfVersion || '-'}\n${pdfStatusLabel}`}
                  className="border-white/10 bg-white/10 text-white"
                />
                <SummaryCard
                  label="Financial"
                  value={`Funding: ${fundingStatusLabel}\nOpen invoices: ${openInvoiceRows.length || 'None'}\nOutstanding: ${formatMoney(outstandingBalanceTotal)}`}
                  className="border-white/10 bg-white/10 text-white"
                />
                <SummaryCard
                  label="Progress"
                  value={`Milestones: ${milestoneProgressLabel}\nPending amendments: ${pendingContractorAmendments.length || 'None'}`}
                  className="border-white/10 bg-white/10 text-white"
                />
                <SummaryCard
                  label="Customer"
                  value={`${norm.homeownerName}\nProject value: ${formatMoney(norm.totalCost)}\n${paymentModeLabel(norm.payment_mode)}`}
                  className="border-white/10 bg-white/10 text-white"
                />
              </div>
            </section>

            {hasPlanningAssumptions ? (
              <section
                data-testid="agreement-planning-assumptions"
                className="rounded-2xl border border-blue-300/20 bg-[#061d42]/95 p-5 text-sky-100 shadow-sm"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-100">
                      Milestone Planning
                    </div>
                    <h3 className="mt-1 text-lg font-semibold text-white">
                      Saved Planning Assumptions
                    </h3>
                    <p className="mt-1 text-sm text-sky-100/70">
                      Planning only. Employees are not assigned and schedules are not created from this snapshot.
                    </p>
                  </div>
                  <span className="inline-flex w-fit items-center rounded-full border border-blue-200/30 bg-blue-400/15 px-3 py-1 text-xs font-bold text-blue-50">
                    Advisory
                  </span>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <SummaryCard
                    label="Planned Start"
                    value={formatPlanningDate(planningAssumptions.planned_start_date)}
                    className="border-white/10 bg-white/10 text-white"
                  />
                  <SummaryCard
                    label="Planned Finish"
                    value={formatPlanningDate(planningAssumptions.planned_finish_date)}
                    className="border-white/10 bg-white/10 text-white"
                  />
                  <SummaryCard
                    label="Duration"
                    value={`${planningAssumptions.planned_duration_days || 0} working days`}
                    className="border-white/10 bg-white/10 text-white"
                  />
                  <SummaryCard
                    label="Crew Size"
                    value={`${planningAssumptions.planned_crew_size || 0} people`}
                    className="border-white/10 bg-white/10 text-white"
                  />
                  <SummaryCard
                    label="Labor Hours"
                    value={`${planningAssumptions.planned_labor_hours || 0} hours`}
                    className="border-white/10 bg-white/10 text-white"
                  />
                  <SummaryCard
                    label="Confidence"
                    value={`${planningAssumptions.planning_confidence || 0}%`}
                    className="border-white/10 bg-white/10 text-white"
                  />
                  <SummaryCard
                    label="Priority"
                    value={titleCase(planningAssumptions.planning_priority || 'balanced')}
                    className="border-white/10 bg-white/10 text-white"
                  />
                  <SummaryCard
                    label="Weekends"
                    value={planningAssumptions.include_weekends ? 'Included' : 'Excluded'}
                    className="border-white/10 bg-white/10 text-white"
                  />
                </div>

                {planningCapabilityMix.length ? (
                  <div className="mt-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-sky-100/60">
                      Capability Mix
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {planningCapabilityMix.map((item, index) => (
                        <span
                          key={`${item.capability || 'capability'}-${index}`}
                          className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-semibold text-white"
                        >
                          {item.count || 0} {item.capability || 'Capability'}
                          {item.available != null ? ` / ${item.available} available` : ''}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                {planningAssumptions.planning_notes ? (
                  <div className="mt-4 rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-sky-100/80">
                    {planningAssumptions.planning_notes}
                  </div>
                ) : null}
              </section>
            ) : null}

            <section
              data-testid="agreement-overview-milestone-preview"
              className="rounded-2xl border border-white/10 bg-[#061d42]/95 p-5 text-sky-100 shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-lg font-semibold text-white">
                  Milestones
                </h3>
                <button
                  type="button"
                  onClick={() => setWorkspaceTab('milestones')}
                  className="text-sm font-semibold text-blue-200 hover:text-white"
                >
                  View All Milestones
                </button>
              </div>

              {!milestonePreviewRows.length ? (
                <div className="mt-4 rounded-xl border border-dashed border-white/15 bg-white/10 px-4 py-5 text-sm text-sky-100/70">
                  {milestoneDataKnown
                    ? 'No milestones found.'
                    : 'Milestone data has not loaded yet.'}
                </div>
              ) : (
                <>
                  <div className="mt-4 hidden overflow-hidden rounded-xl border border-white/10 md:block">
                    <table className="min-w-full text-sm">
                      <thead className="bg-white/10 text-left text-xs font-semibold uppercase tracking-[0.12em] text-sky-100/65">
                        <tr>
                          <th className="px-3 py-3">#</th>
                          <th className="px-3 py-3">Milestone</th>
                          <th className="px-3 py-3">Status</th>
                          <th className="px-3 py-3">Progress</th>
                          <th className="px-3 py-3">Amount</th>
                          <th className="px-3 py-3">Payment Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/10">
                        {milestonePreviewRows.map((m, index) => {
                          const display = getMilestoneDisplay(
                            milestoneDisplaySource(m)
                          );
                          const progress = display.displayProgressPercent;
                          const label = display.displayStatus;
                          return (
                            <tr key={m.id || `${m.title}-${index}`}>
                              <td className="px-3 py-3 text-sky-100/70">
                                {m.order || index + 1}
                              </td>
                              <td className="px-3 py-3">
                                <div className="font-semibold text-white">
                                  {m.title || 'Untitled milestone'}
                                </div>
                                {m.description ? (
                                  <div className="text-xs text-sky-100/60">
                                    {m.description}
                                  </div>
                                ) : null}
                              </td>
                              <td className="px-3 py-3">
                                <span
                                  data-testid={`milestone-preview-status-${m.id}`}
                                  className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusBadgeTone(label)}`}
                                >
                                  {label}
                                </span>
                              </td>
                              <td className="px-3 py-3">
                                <div className="flex items-center gap-2">
                                  <span
                                    data-testid={`milestone-preview-progress-${m.id}`}
                                    className="w-10 text-xs font-semibold text-sky-100"
                                  >
                                    {progress}%
                                  </span>
                                  <div className="h-2 w-24 rounded-full bg-white/15">
                                    <div
                                      className={`h-2 rounded-full ${
                                        display.isCompleted
                                          ? 'bg-emerald-500'
                                          : 'bg-blue-500'
                                      }`}
                                      style={{ width: `${progress}%` }}
                                    />
                                  </div>
                                </div>
                              </td>
                              <td className="px-3 py-3 font-semibold text-white">
                                {formatMoney(m.amount)}
                              </td>
                              <td
                                data-testid={`milestone-preview-payment-${m.id}`}
                                className="px-3 py-3 text-sky-100/80"
                              >
                                {display.paymentLabel}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-4 space-y-3 md:hidden">
                    {milestonePreviewRows.map((m, index) => {
                      const display = getMilestoneDisplay(
                        milestoneDisplaySource(m)
                      );
                      const progress = display.displayProgressPercent;
                      return (
                        <div
                          key={m.id || `${m.title}-${index}`}
                          className="rounded-xl border border-white/10 bg-white/10 p-4"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-xs font-semibold text-sky-100/60">
                                Milestone {m.order || index + 1}
                              </div>
                              <div className="font-semibold text-white">
                                {m.title || 'Untitled milestone'}
                              </div>
                            </div>
                            <span
                              className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusBadgeTone(display.statusLabel)}`}
                            >
                              {display.displayStatus}
                            </span>
                          </div>
                          <div className="mt-3 text-sm text-sky-100/80">
                            {progress}% / {formatMoney(m.amount)} /{' '}
                            {display.paymentLabel}
                          </div>
                          <div className="mt-2 h-2 rounded-full bg-white/15">
                            <div
                              className={`h-2 rounded-full ${
                                display.isCompleted
                                  ? 'bg-emerald-500'
                                  : 'bg-blue-500'
                              }`}
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </section>
          </div>

          <aside className="space-y-4">
            <section
              data-testid="agreement-overview-timeline"
              className="rounded-2xl border border-white/10 bg-[#061d42]/95 p-5 text-sky-100 shadow-sm"
            >
              <h3 className="text-lg font-semibold text-white">
                Timeline
              </h3>
              <div className="mt-4 space-y-4">
                {timelineItems.map((item) => (
                  <div key={item.id} className="flex gap-3">
                    <span
                      className={`mt-1 h-3 w-3 rounded-full ${
                        item.tone === 'complete'
                          ? 'bg-emerald-500'
                          : item.tone === 'active'
                            ? 'bg-blue-600'
                            : 'bg-slate-300'
                      }`}
                    />
                    <div>
                      <div className="text-sm font-semibold text-white">
                        {item.title}
                      </div>
                      <div className="text-xs text-sky-100/60">
                        {item.detail}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section
              data-testid="agreement-overview-documents-summary"
              className="rounded-2xl border border-white/10 bg-[#061d42]/95 p-5 text-sky-100 shadow-sm"
            >
              <h3 className="text-lg font-semibold text-white">
                Documents & Files
              </h3>
              <div className="mt-4 divide-y divide-white/10">
                {documentFileRows.map((row) => (
                  <div
                    key={row.label}
                    className="flex items-center justify-between gap-3 py-2 text-sm"
                  >
                    <span className="text-sky-100/80">{row.label}</span>
                    <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold text-sky-100">
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setWorkspaceTab('documents')}
                className="mt-4 w-full rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-semibold text-white hover:bg-white/15"
              >
                Open Documents
              </button>
            </section>
          </aside>
        </div>

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
          {['assisted_diy', 'consultation', 'inspection_only'].includes(
            String(norm.project_mode || '')
              .toLowerCase()
              .replaceAll(' ', '_')
          ) ? (
            <div
              className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
              data-testid="agreement-project-mode-safety-notice"
            >
              <div className="font-semibold">Assisted DIY / Collaboration</div>
              <div className="mt-1">
                Some project phases may require licensed professionals depending
                on local law, project scope, or safety requirements. Customer
                participation is limited to non-restricted activities unless
                otherwise agreed and allowed by law. Contractor may refuse
                unsafe or non-compliant homeowner participation.
              </div>
            </div>
          ) : null}
          <div
            className="mt-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-slate-800"
            data-testid="agreement-payment-protection-summary"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
                  Payment Protection
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900">
                  {paymentProtectionLabel(norm.payment_protection?.label)}
                </div>
              </div>
              <span
                className={`rounded-full border px-2.5 py-1 text-[11px] font-extrabold ${paymentProtectionTone(norm.payment_protection?.label)}`}
              >
                {paymentProtectionLabel(norm.payment_protection?.label)}
              </span>
            </div>
            <div className="mt-2 text-sm text-slate-700">
              {norm.payment_protection?.reason ||
                'Escrow milestone payments help protect both homeowners and contractors.'}
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Homeowner participation
              </div>
              <div className="mt-1 text-sm text-slate-700 whitespace-pre-wrap">
                {norm.homeowner_participation_notes || 'Not specified'}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Homeowner responsibilities
              </div>
              <div className="mt-1 text-sm text-slate-700 whitespace-pre-wrap">
                {norm.homeowner_responsibilities || 'Not specified'}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Contractor responsibilities
              </div>
              <div className="mt-1 text-sm text-slate-700 whitespace-pre-wrap">
                {norm.contractor_responsibilities || 'Not specified'}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Excluded work
              </div>
              <div className="mt-1 text-sm text-slate-700 whitespace-pre-wrap">
                {norm.excluded_work || 'Not specified'}
              </div>
            </div>
          </div>
        </section>

        {['assisted_diy', 'consultation', 'inspection_only'].includes(
          String(norm.project_mode || '')
            .toLowerCase()
            .replaceAll(' ', '_')
        ) ? (
          <section
            data-testid="agreement-detail-responsibility-matrix"
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          >
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
                {norm.collaboration_summary || 'Collaborative project'}
              </span>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {[
                [
                  'homeowner_responsibilities',
                  'Homeowner Responsibilities',
                  'amber',
                ],
                [
                  'contractor_responsibilities',
                  'Contractor Responsibilities',
                  'blue',
                ],
                [
                  'shared_responsibilities',
                  'Shared Responsibilities',
                  'violet',
                ],
                ['excluded_work', 'Excluded Work', 'slate'],
              ].map(([key, title, tone]) => {
                const section = norm.responsibility_matrix?.[key] || {};
                const milestones = Array.isArray(section?.milestones)
                  ? section.milestones
                  : [];
                return (
                  <div
                    key={key}
                    data-testid={`agreement-detail-responsibility-${key}`}
                    className="rounded-xl border border-slate-200 bg-slate-50 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="text-sm font-semibold text-slate-900">
                        {title}
                      </div>
                      <span
                        className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                          tone === 'amber'
                            ? 'border-amber-200 bg-amber-50 text-amber-800'
                            : tone === 'blue'
                              ? 'border-blue-200 bg-blue-50 text-blue-700'
                              : tone === 'violet'
                                ? 'border-violet-200 bg-violet-50 text-violet-700'
                                : 'border-slate-200 bg-slate-100 text-slate-700'
                        }`}
                      >
                        {Number(
                          section?.count || milestones.length || 0
                        ).toLocaleString()}{' '}
                        milestone
                        {Number(section?.count || milestones.length || 0) === 1
                          ? ''
                          : 's'}
                      </span>
                    </div>
                    <div className="mt-2 text-sm text-slate-700 whitespace-pre-wrap">
                      {section?.summary || 'Not specified'}
                    </div>
                    {milestones.length ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {milestones.slice(0, 6).map((m) => (
                          <span
                            key={m.id || m.title}
                            className="rounded-full border border-white bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 shadow-sm"
                          >
                            {m.title}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {Array.isArray(norm.homeowner_acknowledgements) &&
            norm.homeowner_acknowledgements.length ? (
              <div
                data-testid="agreement-detail-homeowner-acknowledgements"
                className="mt-4 rounded-xl border border-sky-200 bg-sky-50 p-4"
              >
                <div className="text-sm font-semibold text-slate-900">
                  Homeowner Acknowledgements
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {norm.homeowner_acknowledgements.map((item) => (
                    <div
                      key={item.key || item.label}
                      className="rounded-lg border border-white bg-white p-3 shadow-sm"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-slate-900">
                          {item.label}
                        </div>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                            item.acknowledged
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                              : 'border-slate-200 bg-slate-100 text-slate-700'
                          }`}
                        >
                          {item.acknowledged ? 'Acknowledged' : 'Pending'}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-slate-600 whitespace-pre-wrap">
                        {item.detail || 'No details available.'}
                      </div>
                      {item.acknowledged_at ? (
                        <div className="mt-2 text-xs text-slate-500">
                          Acknowledged at {fmtDateTime(item.acknowledged_at)}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {Array.isArray(norm.inspection_summary?.items) &&
            norm.inspection_summary.items.length ? (
              <div
                data-testid="agreement-detail-inspection-checkpoints"
                className="mt-4 rounded-xl border border-slate-200 bg-white p-4"
              >
                <div className="text-sm font-semibold text-slate-900">
                  Inspection Checkpoints
                </div>
                <div className="mt-1 text-xs text-slate-600">
                  Requested:{' '}
                  {Number(
                    norm.inspection_summary.requested_count || 0
                  ).toLocaleString()}{' '}
                  / Passed:{' '}
                  {Number(
                    norm.inspection_summary.passed_count || 0
                  ).toLocaleString()}{' '}
                  / Revision required:{' '}
                  {Number(
                    norm.inspection_summary.revision_required_count || 0
                  ).toLocaleString()}
                </div>
                <div className="mt-3 space-y-2">
                  {norm.inspection_summary.items.slice(0, 6).map((item) => (
                    <div
                      key={item.id || item.title}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-slate-900">
                          {item.title}
                        </div>
                        <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                          {item.status_label || item.status}
                        </span>
                      </div>
                      {item.notes ? (
                        <div className="mt-1 text-xs text-slate-600 whitespace-pre-wrap">
                          {item.notes}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {norm.rescue_project_summary?.is_rescue_project ||
            norm.rescue_project_summary?.summary ? (
              <div
                data-testid="agreement-detail-rescue-project-summary"
                className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4"
              >
                <div className="text-sm font-semibold text-amber-900">
                  Rescue / Partial Completion Notes
                </div>
                <div className="mt-2 text-sm text-amber-900 whitespace-pre-wrap">
                  {norm.rescue_project_summary?.summary ||
                    'Project already started context applies.'}
                </div>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  {norm.rescue_project_summary?.takeover_notes ? (
                    <div className="rounded-lg border border-white bg-white p-3 text-sm text-slate-700 shadow-sm">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Homeowner provided work
                      </div>
                      <div className="mt-1 whitespace-pre-wrap">
                        {norm.rescue_project_summary.takeover_notes}
                      </div>
                    </div>
                  ) : null}
                  {norm.rescue_project_summary?.contractor_takeover_notes ? (
                    <div className="rounded-lg border border-white bg-white p-3 text-sm text-slate-700 shadow-sm">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Contractor takeover
                      </div>
                      <div className="mt-1 whitespace-pre-wrap">
                        {norm.rescue_project_summary.contractor_takeover_notes}
                      </div>
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
            <div className="font-semibold">
              This agreement is still being drafted.
            </div>
            <div className="mt-1">
              Use the wizard to finish setup before managing contract activity.
            </div>
            <button
              type="button"
              data-testid="agreement-detail-back-to-wizard-button"
              onClick={() =>
                navigate(
                  isAdminMode ? backUrl : `/app/agreements/${id}/wizard?step=1`
                )
              }
              className="mt-3 rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100"
            >
              {isAdminMode ? 'Back to Admin Agreements' : 'Back to Wizard'}
            </button>
          </div>
        ) : null}

        {isAdminMode && activeTab === 'ai' ? (
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
                  Review the source lead and AI hints without leaving the admin
                  agreement context.
                </div>
              </div>
              <span className="rounded-full border border-indigo-200 bg-white px-2.5 py-1 text-[11px] font-extrabold text-indigo-700">
                {adminAiLoading ? 'Loading...' : 'Loaded'}
              </span>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-indigo-200 bg-white p-3">
                <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
                  Suggested title
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900">
                  {adminAiContext?.suggested_title || 'Not available'}
                </div>
              </div>
              <div className="rounded-xl border border-indigo-200 bg-white p-3">
                <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
                  Template
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900">
                  {adminAiContext?.template_name || 'Not available'}
                </div>
              </div>
              <div className="rounded-xl border border-indigo-200 bg-white p-3">
                <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
                  Confidence
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900">
                  {adminAiContext?.confidence || 'Not available'}
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-indigo-200 bg-white p-3 text-sm text-slate-700">
              <div className="font-extrabold text-slate-900">Reason</div>
              <div className="mt-1">
                {adminAiContext?.reason ||
                  'No AI recommendation notes were saved for this agreement.'}
              </div>
            </div>

            {Array.isArray(adminAiContext?.pricing_confidence_levels) &&
            adminAiContext.pricing_confidence_levels.length ? (
              <div className="mt-4 text-sm text-slate-700">
                <span className="font-extrabold text-slate-900">
                  Pricing confidence:
                </span>{' '}
                {adminAiContext.pricing_confidence_levels.join(', ')}
              </div>
            ) : null}

            {Array.isArray(adminAiContext?.pricing_sources) &&
            adminAiContext.pricing_sources.length ? (
              <div className="mt-3">
                <div className="text-sm font-extrabold text-slate-900">
                  Pricing sources
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {adminAiContext.pricing_sources
                    .slice(0, 4)
                    .map((source, index) => (
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
                  Last decision:{' '}
                  <span className="font-semibold text-slate-900">
                    {agreement.last_sms_automation_decision.reason_code}
                  </span>
                </div>
                <div className="text-xs text-slate-500">
                  {agreement.last_sms_automation_decision.message_preview ||
                    'No message preview available.'}
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
                {agreement.recent_sms_automation_decisions
                  .slice(0, 4)
                  .map((item) => (
                    <div
                      key={item.id || `${item.event_type}-${item.created_at}`}
                      className="rounded-lg bg-slate-50 px-3 py-2"
                    >
                      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                        {item.event_type}
                      </div>
                      <div className="mt-1 text-sm text-slate-800">
                        {item.reason_code} / {item.channel_decision}
                        {item.sent
                          ? ' / sent'
                          : item.deferred
                            ? ' / deferred'
                            : ''}
                      </div>
                    </div>
                  ))}
              </div>
            ) : null}
          </details>
        ) : null}
      </div>

      <div
        data-testid="agreement-workspace-panel-signatures"
        className={
          workspaceTab === 'signatures'
            ? 'space-y-4 rounded-2xl border border-white/10 bg-[#061d42]/95 p-4 text-sky-100 shadow-sm'
            : 'hidden'
        }
      >
        <WorkflowHint hint={agreementHint} testId="agreement-detail-hint" />

        <div className="rounded-2xl border border-white/10 bg-white/10 p-4 shadow-sm">
          <div className="mb-3">
            <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-sky-100/60">
              Primary Actions
            </h3>
            <div className="mt-1 text-sm text-sky-100/70">
              Handle signatures, documents, and the next key job action from one
              place.
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
            {!norm.isDirectPay &&
              isContractor &&
              norm.isSigned &&
              !norm.escrowFunded && (
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
              className="rounded-xl border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-semibold text-sky-100 hover:bg-white/15"
            >
              Support
            </button>

            {isContractor && (
              <button
                data-testid="invite-subcontractor-button"
                type="button"
                onClick={() => setInviteFormOpen((open) => !open)}
                className="rounded-xl border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-semibold text-sky-100 hover:bg-white/15"
              >
                {inviteFormOpen ? 'Close Invite Form' : 'Invite Subcontractor'}
              </button>
            )}
          </div>
        </div>
        {pdfPreviewError ? (
          <section
            data-testid="agreement-pdf-preview-fallback"
            className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 shadow-sm"
          >
            <div className="font-semibold">
              PDF preview is unavailable right now.
            </div>
            <div className="mt-1">{pdfPreviewError}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={previewPdf}
                className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100"
              >
                Refresh preview
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!norm.currentPdfUrl) {
                    toast('No current PDF URL available yet.');
                    return;
                  }
                  openInNewTab(norm.currentPdfUrl);
                }}
                className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-950"
              >
                Open raw PDF
              </button>
              <button
                type="button"
                onClick={downloadPDF}
                className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800"
              >
                Download PDF
              </button>
            </div>
          </section>
        ) : null}

        <section
          data-testid="agreement-signatures-pdf-history"
          className="rounded-2xl border border-white/10 bg-white/10 p-5 shadow-sm"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-white">
                PDF History
              </h3>
              <p className="mt-1 text-sm text-sky-100/70">
                Current and historical agreement PDFs are available here with
                signatures.
              </p>
            </div>
            <span className="rounded-full border border-white/10 bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-sky-100">
              {norm.pdfVersions?.length
                ? `${norm.pdfVersions.length} version${norm.pdfVersions.length === 1 ? '' : 's'}`
                : 'No history yet'}
            </span>
          </div>

          <div className="mt-4 rounded-xl border border-white/10 bg-[#041735]/80 p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-sm font-semibold text-white">
                  Current PDF{' '}
                  {norm.currentPdfVersion != null ? (
                    <span className="text-xs text-sky-100/60">
                      (v{norm.currentPdfVersion})
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 text-xs text-sky-100/60">
                  {norm.currentPdfUrl
                    ? 'Latest stored PDF is available.'
                    : 'No current PDF URL available yet.'}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!norm.currentPdfUrl}
                  onClick={() => openInNewTab(norm.currentPdfUrl)}
                >
                  Open
                </button>
                <button
                  type="button"
                  className="rounded-lg bg-blue-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!norm.currentPdfUrl}
                  onClick={async () => {
                    try {
                      await downloadWithCredentials(
                        norm.currentPdfUrl,
                        `agreement_${norm.id}_current.pdf`
                      );
                      toast.success('Downloaded.');
                    } catch (e) {
                      console.error(e);
                      toast.error('Download failed.');
                    }
                  }}
                >
                  Download
                </button>
              </div>
            </div>
          </div>

          {Array.isArray(norm.pdfVersions) && norm.pdfVersions.length ? (
            <div className="mt-3 space-y-2">
              {norm.pdfVersions.map((v) => {
                const verNum = Number(v?.version_number ?? v?.version ?? 0);
                const kind = String(v?.kind || '').toLowerCase();
                const fileUrl = v?.file_url || v?.fileUrl || '';
                return (
                  <div
                    key={v.id ?? `${verNum}-${v.created_at ?? ''}`}
                    className="rounded-xl border border-white/10 bg-[#041735]/80 p-3"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="text-sm font-semibold text-white">
                          v{verNum || '-'}{' '}
                          {kind ? (
                            <span className="ml-2 rounded-full border border-white/10 bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-sky-100">
                              {kind}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 text-xs text-sky-100/60">
                          Created: {fmtDateTime(v?.created_at) || '-'}
                        </div>
                        <div className="mt-1 text-xs text-sky-100/60">
                          {v?.signed_by_contractor
                            ? 'Contractor signed'
                            : 'Contractor not signed'}{' '}
                          /{' '}
                          {v?.signed_by_homeowner
                            ? 'Customer signed'
                            : 'Customer not signed'}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={!fileUrl}
                          onClick={() => openInNewTab(fileUrl)}
                        >
                          Open
                        </button>
                        <button
                          type="button"
                          className="rounded-lg bg-blue-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={!fileUrl}
                          onClick={async () => {
                            try {
                              await downloadWithCredentials(
                                fileUrl,
                                `agreement_${norm.id}_v${verNum || 'x'}_${kind || 'pdf'}.pdf`
                              );
                              toast.success('Downloaded.');
                            } catch (e) {
                              console.error(e);
                              toast.error('Download failed.');
                            }
                          }}
                        >
                          Download
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="mt-3 rounded-xl border border-dashed border-white/15 bg-white/10 px-4 py-3 text-sm text-sky-100/70">
              No historical PDF versions found yet.
            </div>
          )}
        </section>
      </div>

      <div
        data-testid="agreement-workspace-panel-activity"
        className={
          workspaceTab === 'activity'
            ? 'space-y-4 rounded-2xl border border-white/10 bg-[#061d42]/95 p-4 text-sky-100 shadow-sm'
            : 'hidden'
        }
      >
        <section className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-white">
              Team & Assignments
            </h3>
            <div className="mt-1 text-sm text-sky-100/70">
              Manage who owns the agreement and who is helping deliver the work.
            </div>
          </div>

          {/* Agreement assignment selector */}
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
              className="rounded-2xl border border-white/10 bg-white/10 p-6 shadow-sm space-y-4"
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <h3 className="text-lg font-semibold text-white">
                    Subcontractors
                  </h3>
                  <div className="text-xs text-sky-100/60">
                    Invite collaborators for this agreement. Financial controls
                    stay with the contractor owner.
                  </div>
                </div>
              </div>

              {inviteFormOpen && (
                <div className="rounded border border-white/10 bg-[#041735]/80 p-4 grid gap-3 md:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium mb-1 text-sky-100">
                      Email
                    </label>
                    <input
                      data-testid="subcontractor-email-input"
                      type="email"
                      className="w-full rounded border border-white/10 bg-white px-3 py-2 text-sm text-slate-950"
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
                    <label className="block text-sm font-medium mb-1 text-sky-100">
                      Name
                    </label>
                    <input
                      className="w-full rounded border border-white/10 bg-white px-3 py-2 text-sm text-slate-950"
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
                    <label className="block text-sm font-medium mb-1">
                      Message
                    </label>
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
                      {inviteSubmitting ? 'Sending...' : 'Send Invitation'}
                    </button>
                  </div>
                </div>
              )}

              {subcontractorsLoading ? (
                <div className="text-sm text-gray-500">
                  Loading subcontractors...
                </div>
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
                                  {invitation.invite_name ||
                                    invitation.invite_email}
                                </div>
                                <div className="text-xs text-gray-500">
                                  {invitation.invite_email}
                                </div>
                                <div className="mt-1 text-xs text-gray-500">
                                  Invited{' '}
                                  {formatInviteDate(invitation.invited_at)}
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
                                  onClick={() =>
                                    copyInviteLink(invitation.invite_url)
                                  }
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
                                  Accepted{' '}
                                  {formatInviteDate(subcontractor.accepted_at)}
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
      </div>

      <div
        data-testid="agreement-workspace-panel-documents"
        className={
          workspaceTab === 'documents'
            ? 'space-y-4 rounded-2xl border border-white/10 bg-[#061d42]/95 p-4 text-sky-100 shadow-sm'
            : 'hidden'
        }
      >
        <section className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-white">Documents</h3>
            <div className="mt-1 text-sm text-sky-100/70">
              Supporting attachments and warranty records stay here. Agreement
              PDF history is available under Signatures & PDF.
            </div>
          </div>

          <div
            data-testid="agreement-warranties-section"
            className="rounded-2xl border border-white/10 bg-white/10 p-6 shadow-sm space-y-4"
          >
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h3
                  data-testid="agreement-warranties-heading"
                  className="text-lg font-semibold text-white"
                >
                  Warranty Records
                </h3>
                <div className="text-xs text-sky-100/60">
                  Phase 1 records active warranty coverage linked to this
                  agreement. It does not change the signed PDF warranty
                  snapshot.
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
              <div className="rounded border border-white/10 bg-[#041735]/80 p-4 grid gap-3 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium mb-1 text-sky-100">
                    Title
                  </label>
                  <input
                    data-testid="warranty-title-input"
                    className="w-full rounded border border-white/10 bg-white px-3 py-2 text-sm text-slate-950"
                    value={warrantyForm.title}
                    onChange={(e) =>
                      setWarrantyForm((prev) => ({
                        ...prev,
                        title: e.target.value,
                      }))
                    }
                    placeholder="e.g., 12-Month Workmanship Warranty"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium mb-1 text-sky-100">
                    Coverage Details
                  </label>
                  <textarea
                    className="w-full rounded border border-white/10 bg-white px-3 py-2 text-sm text-slate-950"
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
                  <label className="block text-sm font-medium mb-1 text-sky-100">
                    Exclusions
                  </label>
                  <textarea
                    className="w-full rounded border border-white/10 bg-white px-3 py-2 text-sm text-slate-950"
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
                  <label className="block text-sm font-medium mb-1 text-sky-100">
                    Start Date
                  </label>
                  <input
                    className="w-full rounded border border-white/10 bg-white px-3 py-2 text-sm text-slate-950"
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
                  <label className="block text-sm font-medium mb-1 text-sky-100">
                    End Date
                  </label>
                  <input
                    className="w-full rounded border border-white/10 bg-white px-3 py-2 text-sm text-slate-950"
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
                  <label className="block text-sm font-medium mb-1 text-sky-100">
                    Status
                  </label>
                  <select
                    className="w-full rounded border border-white/10 bg-white px-3 py-2 text-sm text-slate-950"
                    value={warrantyForm.status}
                    onChange={(e) =>
                      setWarrantyForm((prev) => ({
                        ...prev,
                        status: e.target.value,
                      }))
                    }
                  >
                    <option value="active">Active</option>
                    <option value="expired">Expired</option>
                    <option value="void">Void</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1 text-sky-100">
                    Applies To
                  </label>
                  <select
                    className="w-full rounded border border-white/10 bg-white px-3 py-2 text-sm text-slate-950"
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
                    className="px-4 py-2 rounded border border-white/15 bg-white/10 text-sky-100 hover:bg-white/15"
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
                    {warrantySaving
                      ? 'Saving...'
                      : editingWarrantyId
                        ? 'Update Warranty'
                        : 'Save Warranty'}
                  </button>
                </div>
              </div>
            )}

            {warrantiesLoading ? (
              <div className="text-sm text-sky-100/70">
                Loading warranty records...
              </div>
            ) : warranties.length === 0 ? (
              <div className="text-sm text-sky-100/70">
                No warranty records added yet.
              </div>
            ) : (
              <div className="space-y-3">
                {warranties.map((warranty) => (
                  <div
                    key={warranty.id}
                    data-testid={`warranty-card-${warranty.id}`}
                    className="rounded border border-white/10 bg-[#041735]/80 p-4"
                  >
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <div className="text-sm font-semibold text-white">
                          {warranty.title}
                        </div>
                        <div className="mt-1 text-xs text-sky-100/60">
                          {warranty.applies_to
                            ? `Applies to: ${String(warranty.applies_to)
                                .replaceAll('_', ' ')
                                .replace(/^\w/, (c) => c.toUpperCase())}`
                            : 'Applies to: -'}
                        </div>
                        <div className="text-xs text-sky-100/60">
                          {warranty.start_date || '-'} to{' '}
                          {warranty.end_date || '-'}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="inline-flex rounded-full border border-white/10 bg-white/10 px-2 py-0.5 text-xs font-semibold text-sky-100">
                          {String(warranty.status || 'active')
                            .replaceAll('_', ' ')
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
                          {warranty.coverage_details || '-'}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-gray-500">
                          Exclusions
                        </div>
                        <div className="text-sm text-gray-700 whitespace-pre-wrap">
                          {warranty.exclusions || '-'}
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
      </div>

      <div
        data-testid="agreement-workspace-panel-amendments"
        className={workspaceTab === 'amendments' ? 'space-y-4' : 'hidden'}
      >
        {isContractor && amendmentRequests.length ? (
          <AmendmentReviewPanel
            amendments={amendmentRequests}
            onRespond={submitAmendmentResponse}
            onMarkViewed={markAmendmentViewed}
            busyId={amendmentResponseBusy}
          />
        ) : (
          <section className="rounded-2xl border border-white/10 bg-[#061d42]/80 p-6 text-sky-100/75 shadow-sm">
            <h3 className="text-lg font-semibold text-white">
              No amendment activity
            </h3>
            <p className="mt-2 text-sm">
              Amendment requests and contractor responses will appear here when
              this agreement changes after signing.
            </p>
          </section>
        )}
      </div>

      <div
        data-testid="agreement-workspace-panel-milestones"
        className={
          workspaceTab === 'milestones'
            ? 'space-y-4 rounded-2xl border border-white/10 bg-[#061d42]/95 p-4 text-sky-100 shadow-sm'
            : 'hidden'
        }
      >
        {/* Milestones */}
        <section className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-white">Milestones</h3>
            <div className="mt-1 text-sm text-sky-100/70">
              Track execution, assignment overrides, review state, and payout
              readiness in one place.
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/10 p-6 shadow-sm space-y-3">
            <div className="flex items-end justify-between gap-3 flex-wrap">
              <div>
                <h3 className="text-lg font-semibold text-white">
                  Milestone Control
                </h3>
                <div
                  data-testid="agreement-milestones-progress"
                  className="mt-1 text-xs font-semibold text-sky-100/60"
                >
                  {milestoneProgressLabel}
                </div>
              </div>
              <div className="text-xs text-sky-100/60">
                Assign individual milestones to override agreement assignment.
              </div>
            </div>

            {resolvedMilestones.loading ? (
              <p className="text-sky-100/70">Loading milestones...</p>
            ) : resolvedMilestones.error ? (
              <p className="text-rose-200">{resolvedMilestones.error}</p>
            ) : !milestones.length ? (
              <p className="text-sky-100/70">
                {milestoneDataKnown
                  ? 'No milestones found.'
                  : 'No milestone data loaded yet.'}
              </p>
            ) : (
              <div className="space-y-3">
                {milestones.map((m) => {
                  const refunded = isRefundedMilestone(m);
                  const amendmentBlocked = isMilestoneAmendmentBlocked(m);
                  const displayMilestone = milestoneDisplaySource(m);
                  const display = getMilestoneDisplay(displayMilestone, {
                    agreementId: id,
                    primaryActionUrl: milestoneCompletionUrlFor(m),
                  });
                  const label = display.statusLabel;
                  const progress = display.progressPercent;
                  const milestoneViewUrl = milestoneViewUrlFor(m);
                  const milestoneCompletionPath = display.primaryActionUrl;
                  const canCompleteInMilestones =
                    display.canComplete && !amendmentBlocked;
                  const canRefundMilestone = display.canRefund;
                  const refundUrl =
                    m?.refund_url ||
                    m?.refundUrl ||
                    `${milestoneCompletionPath}&action=refund`;
                  const lifecycleState = String(
                    m.milestone_lifecycle_state ||
                      m.lifecycle_state ||
                      'planned'
                  )
                    .trim()
                    .toLowerCase();
                  const roleLabel = deriveMilestoneRoleLabel({
                    projectMode: norm.project_mode,
                    milestone: m,
                  });
                  const payoutOrchestration =
                    m.subcontractor_payout_orchestration ||
                    m.subcontractor_milestone_agreement?.payout_orchestration ||
                    {};
                  const payoutState = String(
                    payoutOrchestration.payout_state ||
                      payoutOrchestration.next_status ||
                      m.payout_status ||
                      ''
                  ).toLowerCase();
                  const payoutMode =
                    m.subcontractor_milestone_agreement
                      ?.payment_release_mode_label ||
                    m.subcontractor_milestone_agreement?.payment_release_mode ||
                    '';
                  const payoutAmount =
                    payoutOrchestration.payout_amount ||
                    m.payout_amount ||
                    m.subcontractor_milestone_agreement?.agreed_pay ||
                    m.amount;

                  return (
                    <div
                      key={m.id}
                      data-testid={`milestone-card-${m.id}`}
                      className={`rounded-xl border p-4 ${
                        display.isCompleted
                          ? 'border-emerald-300/40 bg-emerald-500/10'
                          : 'border-white/10 bg-[#041735]/80'
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3 text-sm">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-white">
                              {m.title}
                            </span>
                          </div>
                          <div className="mt-1 text-xs font-semibold text-sky-100/65">
                            {formatMoney(m.amount)}
                          </div>
                        </div>
                        {refunded ? <RefundedBadge /> : null}
                        <span
                          data-testid={`milestone-status-${m.id}`}
                          className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${statusBadgeTone(label)}`}
                        >
                          {label}
                        </span>
                        <span
                          data-testid={`milestone-lifecycle-${m.id}`}
                          className={`hidden items-center rounded-full border px-2 py-0.5 text-[11px] font-extrabold ${milestoneLifecycleTone(
                            lifecycleState
                          )}`}
                          title={`Timeline state: ${milestoneLifecycleLabel(lifecycleState)}`}
                        >
                          {milestoneLifecycleLabel(lifecycleState)}
                        </span>
                        <MilestoneRoleBadge
                          role={m.milestone_role}
                          projectMode={norm.project_mode}
                          milestone={m}
                          className="hidden"
                          dataTestId={`agreement-milestone-role-${m.id}`}
                          title={roleLabel}
                        />
                        <MilestoneSafetyBadges
                          projectMode={norm.project_mode}
                          milestone={m}
                          className="hidden"
                          dataTestId={`agreement-milestone-safety-${m.id}`}
                        />
                        <InspectionStatusBadge
                          status={m.inspection_status}
                          className="hidden"
                          dataTestId={`agreement-milestone-inspection-${m.id}`}
                        />
                        {amendmentBlocked ? (
                          <span
                            data-testid={`milestone-amendment-review-pending-${m.id}`}
                            className="ml-2 inline-flex items-center rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[11px] font-extrabold text-amber-900"
                          >
                            Amendment Review Pending
                          </span>
                        ) : null}
                      </div>

                      {amendmentBlocked ? (
                        <div
                          data-testid={`milestone-amendment-block-message-${m.id}`}
                          className="mt-3 rounded-lg border border-amber-300/40 bg-amber-400/10 p-3 text-sm text-amber-100"
                        >
                          This milestone is affected by a pending de-scope
                          amendment. Completion submission and invoice/payment
                          release are blocked until the amendment is reviewed.
                        </div>
                      ) : null}

                      <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                        <div className="rounded-lg border border-white/10 bg-white/10 px-3 py-2">
                          <div className="text-xs font-semibold uppercase tracking-wide text-sky-100/60">
                            Progress
                          </div>
                          <div
                            data-testid={`milestone-progress-${m.id}`}
                            className="mt-1 font-semibold text-white"
                          >
                            {progress}%
                          </div>
                          <div className="mt-2 h-2 rounded-full bg-white/15">
                            <div
                              data-testid={`milestone-progress-bar-${m.id}`}
                              className={`h-2 rounded-full ${
                                display.isCompleted
                                  ? 'bg-emerald-500'
                                  : 'bg-blue-500'
                              }`}
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-white/10 px-3 py-2">
                          <div className="text-xs font-semibold uppercase tracking-wide text-sky-100/60">
                            Payment
                          </div>
                          <div
                            data-testid={`milestone-payment-status-${m.id}`}
                            className={`mt-1 font-semibold ${
                              display.isPaid
                                ? 'text-emerald-100'
                                : 'text-white'
                            }`}
                          >
                            {display.paymentLabel}
                          </div>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-white/10 px-3 py-2">
                          <div className="text-xs font-semibold uppercase tracking-wide text-sky-100/60">
                            Due
                          </div>
                          <div className="mt-1 font-semibold text-white">
                            {display.dueLabel}
                          </div>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-white/10 px-3 py-2">
                          <div className="text-xs font-semibold uppercase tracking-wide text-sky-100/60">
                            Action State
                          </div>
                          <div className="mt-1 font-semibold text-white">
                            {display.actionStateLabel}
                          </div>
                        </div>
                      </div>

                      <div
                        data-testid={`milestone-actions-${m.id}`}
                        className="mt-3 flex flex-wrap gap-2"
                      >
                        <a
                          href={milestoneViewUrl}
                          className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold text-sky-100 hover:bg-white/15"
                        >
                          View
                        </a>
                        {canCompleteInMilestones ? (
                          <a
                            data-testid={`milestone-complete-action-${m.id}`}
                            href={milestoneCompletionPath}
                            className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                          >
                            {display.primaryActionLabel}
                          </a>
                        ) : null}
                        {canRefundMilestone ? (
                          <a
                            href={refundUrl}
                            className="rounded-lg border border-rose-300/40 bg-rose-400/10 px-3 py-2 text-xs font-semibold text-rose-100 hover:bg-rose-400/15"
                          >
                            Refund
                          </a>
                        ) : null}
                      </div>

                      <details
                        data-testid={`milestone-team-controls-${m.id}`}
                        className="mt-3 rounded-xl border border-white/10 bg-white/10 p-3"
                      >
                        <summary className="cursor-pointer text-sm font-semibold text-white">
                          Advanced assignment controls
                        </summary>

                        <div className="mt-3 text-sm text-sky-100/70">
                          <span className="font-semibold text-white">
                            Assigned Worker:
                          </span>{' '}
                          {m.assigned_worker_display || 'Unassigned'}
                        </div>

                        <div className="mt-2 text-sm text-sky-100/70">
                          <span className="font-semibold text-white">
                            Reviewer:
                          </span>{' '}
                          {m.reviewer_display || 'Contractor Owner'}
                        </div>

                        <div
                          data-testid={`milestone-review-state-${m.id}`}
                          className="mt-2 text-sm text-sky-100/70"
                        >
                          <span className="font-semibold text-white">
                            Review:
                          </span>{' '}
                          {m.subcontractor_review_requested
                            ? 'Requested'
                            : 'Not requested'}
                          {m.subcontractor_review_requested_at ? (
                            <span className="text-gray-500">
                              {' '}
                              (
                              {fmtDateTime(
                                m.subcontractor_review_requested_at
                              )}
                              )
                            </span>
                          ) : null}
                        </div>

                      {m.subcontractor_review_note ? (
                        <div className="mt-1 text-sm text-gray-600 whitespace-pre-wrap">
                          <span className="font-semibold text-gray-900">
                            Review note:
                          </span>{' '}
                          {m.subcontractor_review_note}
                        </div>
                      ) : null}

                      <div
                        data-testid={`milestone-completion-state-${m.id}`}
                        className="mt-2 text-sm text-gray-600"
                      >
                        <span className="font-semibold text-gray-900">
                          Work submission:
                        </span>{' '}
                        {String(
                          m.work_submission_status ||
                            m.subcontractor_completion_status ||
                            'not_submitted'
                        )
                          .replaceAll('_', ' ')
                          .replace(/^\w/, (c) => c.toUpperCase())}
                        {m.work_submitted_at ||
                        m.subcontractor_marked_complete_at ? (
                          <span className="text-gray-500">
                            {' '}
                            (
                            {fmtDateTime(
                              m.work_submitted_at ||
                                m.subcontractor_marked_complete_at
                            )}
                            )
                          </span>
                        ) : null}
                      </div>

                      {m.work_submission_note ||
                      m.subcontractor_completion_note ? (
                        <div className="mt-1 text-sm text-gray-600 whitespace-pre-wrap">
                          <span className="font-semibold text-gray-900">
                            Completion note:
                          </span>{' '}
                          {m.work_submission_note ||
                            m.subcontractor_completion_note}
                        </div>
                      ) : null}

                      {m.work_review_response_note ||
                      m.subcontractor_review_response_note ? (
                        <div className="mt-1 text-sm text-gray-600 whitespace-pre-wrap">
                          <span className="font-semibold text-gray-900">
                            Review response:
                          </span>{' '}
                          {m.work_review_response_note ||
                            m.subcontractor_review_response_note}
                        </div>
                      ) : null}

                      {isContractor &&
                      m.assigned_worker &&
                      m.assigned_worker.kind === 'subcontractor' ? (
                        <div
                          data-testid={`milestone-payout-state-${m.id}`}
                          className="mt-3 rounded-xl border border-slate-200 bg-white p-4 text-sm text-gray-700"
                        >
                          <span className="font-semibold text-gray-900">
                            Payout:
                          </span>{' '}
                          {m.payout_amount ? formatMoney(m.payout_amount) : '-'}{' '}
                          <span className="text-gray-500">
                            ({formatPayoutStatus(m.payout_status)})
                          </span>
                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <div className="rounded-lg bg-slate-50 px-3 py-2">
                              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Amount
                              </div>
                              <div className="font-semibold text-slate-900">
                                {payoutAmount ? formatMoney(payoutAmount) : '-'}
                              </div>
                            </div>
                            <div className="rounded-lg bg-slate-50 px-3 py-2">
                              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Release Mode
                              </div>
                              <div className="font-semibold text-slate-900">
                                {payoutMode || 'Manual Release'}
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
                          {Array.isArray(
                            payoutOrchestration.blocking_reasons_labels
                          ) &&
                          payoutOrchestration.blocking_reasons_labels.length ? (
                            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-slate-700">
                              <div className="font-semibold text-slate-900">
                                Blocking reasons
                              </div>
                              <ul className="mt-1 list-disc pl-5">
                                {payoutOrchestration.blocking_reasons_labels.map(
                                  (reason) => (
                                    <li key={reason}>{reason}</li>
                                  )
                                )}
                              </ul>
                            </div>
                          ) : null}
                          {m.payout_ready_for_payout_at ? (
                            <div
                              data-testid={`milestone-payout-ready-at-${m.id}`}
                              className="mt-1 text-xs text-emerald-700"
                            >
                              Ready for payout:{' '}
                              {fmtDateTime(m.payout_ready_for_payout_at)}
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
                              Execution:{' '}
                              {formatExecutionMode(m.payout_execution_mode)}
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      {isContractor && m.payout_failure_reason ? (
                        <div
                          data-testid={`milestone-payout-failure-${m.id}`}
                          className="mt-1 text-sm text-rose-700 whitespace-pre-wrap"
                        >
                          <span className="font-semibold">Payout failure:</span>{' '}
                          {m.payout_failure_reason}
                        </div>
                      ) : null}

                      {isContractor && (
                        <div className="mt-3">
                          <AssignSubcontractorInline
                            acceptedSubcontractors={acceptedSubcontractors}
                            currentAssignment={m.assigned_subcontractor}
                            currentCompliance={
                              m.subcontractor_assignment_compliance
                            }
                            currentAgreement={
                              m.subcontractor_milestone_agreement
                            }
                            milestoneAmount={m.amount}
                            onAssign={(invitationId, options) =>
                              assignMilestoneSubcontractor(
                                m.id,
                                invitationId,
                                options
                              )
                            }
                            onUnassign={() =>
                              unassignMilestoneSubcontractor(m.id)
                            }
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
                              value={completionResponseNotes[m.id] || ''}
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
                                onClick={() =>
                                  approveSubcontractorCompletion(m.id)
                                }
                                disabled={
                                  completionDecisionBusy[m.id] ||
                                  (m.work_submission_status ||
                                    m.subcontractor_completion_status) !==
                                    'submitted_for_review'
                                }
                                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                              >
                                {completionDecisionBusy[m.id]
                                  ? 'Working...'
                                  : 'Mark Reviewed'}
                              </button>
                              <button
                                type="button"
                                data-testid={`milestone-completion-reject-${m.id}`}
                                onClick={() =>
                                  rejectSubcontractorCompletion(m.id)
                                }
                                disabled={
                                  completionDecisionBusy[m.id] ||
                                  (m.work_submission_status ||
                                    m.subcontractor_completion_status) !==
                                    'submitted_for_review'
                                }
                                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                              >
                                {completionDecisionBusy[m.id]
                                  ? 'Working...'
                                  : 'Send Back for Changes'}
                              </button>
                            </div>
                          </div>
                          {payoutState === 'ready' ||
                          payoutState === 'ready_for_payout' ? (
                            <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                              <div className="text-sm font-semibold text-emerald-900">
                                Subcontractor payout is ready for contractor
                                release.
                              </div>
                              <div className="mt-1 text-sm text-emerald-800">
                                Amount:{' '}
                                {m.payout_amount
                                  ? formatMoney(m.payout_amount)
                                  : '-'}
                              </div>
                              {payoutOrchestration.can_manual_release ? (
                                <button
                                  type="button"
                                  data-testid={`milestone-payout-execute-${m.id}`}
                                  onClick={() =>
                                    requestReleaseSubcontractorPayment(m)
                                  }
                                  disabled={payoutDecisionBusy[m.id]}
                                  className="mt-3 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                                >
                                  {payoutDecisionBusy[m.id]
                                    ? 'Processing...'
                                    : 'Release Subcontractor Payment'}
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                          {payoutState === 'scheduled' ? (
                            <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50 p-4">
                              <div className="text-sm font-semibold text-indigo-900">
                                Subcontractor payout is scheduled.
                              </div>
                              <div className="mt-1 text-sm text-indigo-800">
                                The system will release this payment after
                                customer approval and payout setup checks.
                              </div>
                            </div>
                          ) : null}
                          {payoutState === 'blocked' ? (
                            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
                              <div className="text-sm font-semibold text-amber-900">
                                Subcontractor payout is blocked.
                              </div>
                              <div className="mt-1 text-sm text-amber-800">
                                {payoutOrchestration.safe_summary ||
                                  'Review the blocking reasons shown above.'}
                              </div>
                            </div>
                          ) : null}
                          {m.payout_status === 'failed' ? (
                            <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-4">
                              <div className="text-sm font-semibold text-rose-900">
                                Subcontractor payout failed.
                              </div>
                              <div className="mt-1 text-sm text-rose-800">
                                Amount:{' '}
                                {m.payout_amount
                                  ? formatMoney(m.payout_amount)
                                  : '-'}
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
                                  {payoutDecisionBusy[m.id]
                                    ? 'Working...'
                                    : 'Retry Payout'}
                                </button>
                                <button
                                  type="button"
                                  data-testid={`milestone-payout-reset-${m.id}`}
                                  onClick={() => resetMilestonePayout(m.id)}
                                  disabled={payoutDecisionBusy[m.id]}
                                  className="rounded-lg border border-rose-300 bg-white px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                                >
                                  {payoutDecisionBusy[m.id]
                                    ? 'Working...'
                                    : 'Reset Payout'}
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      )}
                      </details>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>

      <div
        data-testid="agreement-workspace-panel-funding"
        className={
          workspaceTab === 'funding'
            ? 'space-y-4 rounded-2xl border border-white/10 bg-[#061d42]/95 p-4 text-sky-100 shadow-sm'
            : 'hidden'
        }
      >
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div
            data-testid="agreement-funding-status"
            className="rounded-2xl border border-white/10 bg-white/10 p-4 shadow-sm"
          >
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-100/60">
              Funding Status
            </div>
            <div className="mt-2 text-lg font-semibold text-white">
              {fundingStatusLabel}
            </div>
            <div className="mt-1 text-xs text-sky-100/60">
              {norm.isDirectPay
                ? 'Direct Pay uses invoice pay links instead of escrow funding.'
                : norm.isSigned
                  ? 'Funding state is based on the existing escrow/payment fields.'
                  : 'Funding waits until signatures are complete.'}
            </div>
          </div>
          <div
            data-testid="agreement-payment-summary"
            className="rounded-2xl border border-white/10 bg-white/10 p-4 shadow-sm"
          >
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-100/60">
              Payment Summary
            </div>
            <div className="mt-2 text-lg font-semibold text-white">
              {formatMoney(norm.totalCost)}
            </div>
            <div className="mt-1 text-xs text-sky-100/60">
              {paymentModeLabel(norm.payment_mode)} / {paymentStructure || 'standard'}
            </div>
          </div>
          <div
            data-testid="agreement-outstanding-balance"
            className="rounded-2xl border border-white/10 bg-white/10 p-4 shadow-sm"
          >
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-100/60">
              Outstanding Balance
            </div>
            <div className="mt-2 text-lg font-semibold text-white">
              {formatMoney(outstandingBalanceTotal)}
            </div>
            <div className="mt-1 text-xs text-sky-100/60">
              From open invoices and active draw requests currently loaded.
            </div>
          </div>
          <div
            data-testid="agreement-invoice-summary"
            className="rounded-2xl border border-white/10 bg-white/10 p-4 shadow-sm"
          >
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-100/60">
              Invoice Summary
            </div>
            <div className="mt-2 text-lg font-semibold text-white">
              {invoiceSummaryLabel}
            </div>
            <div className="mt-1 text-xs text-sky-100/60">
              Invoice logic is unchanged; this summarizes existing invoice rows.
            </div>
          </div>
        </section>

        {/* Project Totals & Fee Summary (Contractor View) */}
        {!norm.isDirectPay && (
          <section className="rounded-2xl border border-dashed border-white/15 bg-white/10 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-base font-semibold text-white">
                Funding Status Detail
              </h3>
              {fundingPreview && (
                <div className="text-[11px] text-sky-100/60 text-right space-y-0.5">
                  {tierLabel && <div>{tierLabel}</div>}
                  {ratePercent && (
                    <div>Current platform rate: {ratePercent}% + $1</div>
                  )}
                  {fundingPreview.high_risk_applied && (
                    <div className="text-[11px] text-amber-100">
                      High-risk surcharge applied for this project type.
                    </div>
                  )}
                </div>
              )}
            </div>

            {fundingLoading ? (
              <div className="text-xs text-sky-100/65">
                Loading fee &amp; escrow summary...
              </div>
            ) : fundingError ? (
              <div className="text-xs text-rose-200">{fundingError}</div>
            ) : fundingPreview ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <SummaryCard
                    label="Milestone Escrow Total"
                    value={formatMoney(fundingPreview.milestone_escrow_total ?? fundingPreview.project_amount)}
                  />
                  <SummaryCard
                    label="Incidentals Reserve"
                    value={formatMoney(fundingPreview.incidentals_reserve ?? agreement?.incidentals_reserve_amount ?? 0)}
                  />
                  <SummaryCard
                    label="Total Escrow Required"
                    value={formatMoney(fundingPreview.total_required ?? fundingPreview.homeowner_escrow)}
                  />
                  <SummaryCard
                    label="Remaining to Fund"
                    value={formatMoney(fundingPreview.remaining_to_fund)}
                  />
                </div>
                <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
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
                    label="Already Funded"
                    value={formatMoney(fundingPreview.escrow_funded_amount)}
                  />
                </div>
                <p className="mt-2 text-[11px] text-sky-100/60">
                  This summary shows your estimated take-home after the
                  MyHomeBro platform fee. Stripe processing fees (card/ACH) may
                  slightly adjust the final payout. If these numbers don&apos;t
                  look right, update your milestone amounts or total project
                  price before sending for signature.
                </p>
              </>
            ) : (
              <div className="text-xs text-sky-100/65">
                Fee and escrow detail is not available yet.
              </div>
            )}
          </section>
        )}

        {hasSmsDetails ? (
        <section className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">
              Secondary Details
            </h3>
            <div className="mt-1 text-sm text-slate-600">
              Communication diagnostics and lower-priority agreement details
              stay available here without competing with the core job controls
              above.
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
                ? 'Customer SMS updates are enabled for this agreement.'
                : agreement?.sms_opted_out
                  ? 'Customer has opted out of SMS updates for this agreement.'
                  : 'Recent SMS diagnostics are available for this agreement.'}
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
                  Last decision:{' '}
                  <span className="font-semibold text-slate-900">
                    {agreement.last_sms_automation_decision.reason_code}
                  </span>
                </div>
                <div className="text-xs text-slate-500">
                  {agreement.last_sms_automation_decision.message_preview ||
                    'No message preview available.'}
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
                {agreement.recent_sms_automation_decisions
                  .slice(0, 4)
                  .map((item) => (
                    <div
                      key={item.id || `${item.event_type}-${item.created_at}`}
                      className="rounded-lg bg-slate-50 px-3 py-2"
                    >
                      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                        {item.event_type}
                      </div>
                      <div className="mt-1 text-sm text-slate-800">
                        {item.reason_code} / {item.channel_decision}
                        {item.sent
                          ? ' / sent'
                          : item.deferred
                            ? ' / deferred'
                            : ''}
                      </div>
                    </div>
                  ))}
              </div>
            ) : null}
          </details>
        </section>
        ) : null}

        {showDrawRequestsPanel && (
          <>
            <div
              data-testid="agreement-draw-requests"
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold mb-1">Draw Requests</h3>
                  <p className="text-sm text-gray-500">
                    {drawSummaryLabel}. Create and review progress-payment
                    draws after the agreement is signed.
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
                <div className="mt-4 text-sm text-gray-500">
                  Loading draw requests...
                </div>
              ) : drawRows.length === 0 ? (
                <div className="mt-4 rounded-lg border border-dashed border-gray-300 px-4 py-4 text-sm text-gray-500">
                  No draw requests yet.
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  {drawRows.map((draw) => (
                    <div
                      key={draw.id}
                      className="rounded-xl border border-gray-200 p-4"
                    >
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                          <div className="text-sm font-semibold text-gray-900">
                            Draw {draw.draw_number}: {draw.title}
                          </div>
                          <div className="mt-1 text-xs text-gray-500">
                            Status: {drawWorkflowLabel(draw)} / Gross{' '}
                            {formatMoney(draw.gross_amount)} / Retainage{' '}
                            {formatMoney(draw.retainage_amount)} / Net{' '}
                            {formatMoney(draw.net_amount)}
                          </div>
                          {draw.review_email_sent_at ? (
                            <div className="mt-1 text-xs text-emerald-700">
                              Owner review email sent. The public review link is
                              ready to share.
                            </div>
                          ) : null}
                          {draw.homeowner_review_notes ? (
                            <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                              Owner note: {draw.homeowner_review_notes}
                            </div>
                          ) : null}
                          {drawWorkflowStatus(draw) === 'payment_pending' ? (
                            <div
                              className={`mt-2 text-xs ${draw?.is_awaiting_release ? 'text-teal-700' : 'text-indigo-700'}`}
                            >
                              {draw?.is_awaiting_release
                                ? 'Owner approval is complete. Payment is pending while this escrow draw waits for release in MyHomeBro.'
                                : 'Owner approval is complete. Payment is still pending through the draw review page in MyHomeBro.'}
                            </div>
                          ) : null}
                          {drawWorkflowStatus(draw) === 'paid' ? (
                            <div className="mt-2 text-xs text-emerald-700">
                              {draw?.released_at
                                ? `Payment completed${draw.released_at ? ` on ${fmtDateTime(draw.released_at)}` : ''}.`
                                : `Payment recorded${draw.paid_at ? ` on ${fmtDateTime(draw.paid_at)}` : ''}${draw.paid_via ? ` via ${String(draw.paid_via).toUpperCase()}` : ''}.`}
                            </div>
                          ) : null}
                          {drawWorkflowStatus(draw) === 'disputed' ? (
                            <div className="mt-2 text-xs text-rose-700">
                              A payment issue is under review for this draw.
                            </div>
                          ) : null}
                          {draw.notes ? (
                            <div className="mt-2 text-sm text-gray-600 whitespace-pre-wrap">
                              {draw.notes}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {draw.status === 'draft' ||
                          draw.status === 'changes_requested' ? (
                            <button
                              type="button"
                              onClick={() => runDrawAction(draw.id, 'submit')}
                              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                            >
                              Submit
                            </button>
                          ) : null}
                          {draw.status === 'submitted' ? (
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
                          {drawWorkflowStatus(draw) === 'payment_pending' &&
                          !draw?.is_awaiting_release ? (
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
                                onClick={() =>
                                  runDrawAction(draw.id, 'release')
                                }
                                className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
                              >
                                Release Funds
                              </button>
                            </>
                          ) : null}
                        </div>
                      </div>

                      {Array.isArray(draw.line_items) &&
                      draw.line_items.length ? (
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
                                <tr
                                  key={item.id}
                                  className="border-b border-gray-100"
                                >
                                  <td className="py-2 pr-3 text-gray-700">
                                    {item.milestone_title || item.description}
                                  </td>
                                  <td className="py-2 pr-3">
                                    {formatMoney(item.scheduled_value)}
                                  </td>
                                  <td className="py-2 pr-3">
                                    {Number(item.percent_complete || 0).toFixed(
                                      2
                                    )}
                                    %
                                  </td>
                                  <td className="py-2 pr-3">
                                    {formatMoney(item.this_draw_amount)}
                                  </td>
                                  <td className="py-2 pr-3">
                                    {formatMoney(item.remaining_balance)}
                                  </td>
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

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="text-lg font-semibold mb-1">External Payments</h3>
              <p className="text-sm text-gray-500">
                Read-only records for payments received outside the app.
              </p>
              {externalPaymentsLoading ? (
                <div className="mt-4 text-sm text-gray-500">
                  Loading external payments...
                </div>
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
                          <td className="py-3 pr-3 text-gray-700">
                            {row.draw_title || 'Unlinked payment'}
                          </td>
                          <td className="py-3 pr-3 text-gray-700 uppercase">
                            {row.payment_method}
                          </td>
                          <td className="py-3 pr-3 text-gray-700">
                            {row.payment_date || '-'}
                          </td>
                          <td className="py-3 pr-3 font-semibold text-gray-900">
                            {formatMoney(row.net_amount)}
                          </td>
                          <td className="py-3 pr-3 text-gray-700">
                            {row.status}
                          </td>
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
          <div
            data-testid="agreement-invoice-records"
            className="rounded-2xl border border-white/10 bg-white/10 p-6 shadow-sm"
          >
            <h3 className="text-lg font-semibold mb-3 text-white">Invoices</h3>
            {!invoiceRows.length ? (
              <p className="text-sky-100/65">
                {workspaceInvoicesLoaded
                  ? 'No invoices yet.'
                  : 'Loading invoice records...'}
              </p>
            ) : (
              <ul className="space-y-2">
                {invoiceRows.map((inv) => (
                  <li
                    key={inv.id || inv.invoice_id}
                    className="rounded-xl border border-white/10 bg-[#041735]/80 px-4 py-3 text-sm text-sky-100"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span className="font-semibold text-white">
                        #{inv.invoice_number || inv.id || inv.invoice_id}
                      </span>
                      <span>{formatMoney(inv.amount || inv.total_amount)}</span>
                      <span className="rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-xs font-semibold text-sky-100">
                        {inv.display_status || inv.status || 'Tracked'}
                      </span>
                    </div>
                    {inv.milestone_title ? (
                      <div className="mt-1 text-xs text-sky-100/60">
                        {inv.milestone_title}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>

      <div
        data-testid="agreement-workspace-panel-ai"
        className={workspaceTab === 'ai' ? 'space-y-4' : 'hidden'}
      >
        <section className="rounded-2xl border border-white/10 bg-[#061d42]/90 p-6 text-sky-100/75 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-100/55">
            AI Review
          </div>
          <h3 className="mt-2 text-xl font-semibold text-white">
            AI Agreement Review coming soon.
          </h3>
          <p className="mt-2 max-w-2xl text-sm">
            This tab is reserved for advisory review tools. No AI generation or
            agreement changes happen in this phase.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              'Scope completeness',
              'Amendment risk',
              'Funding readiness',
              'Missing exclusions',
              'Warranty language',
            ].map((item) => (
              <div
                key={item}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-sky-50"
              >
                {item}
              </div>
            ))}
          </div>
        </section>
      </div>

      {drawModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-3xl rounded-xl bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-gray-900">
                  Create Draw
                </div>
                <div className="text-sm text-gray-500">
                  Set percent complete for the schedule-of-values items you want
                  to bill in this draw.
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
                onChange={(e) =>
                  setDrawForm((prev) => ({ ...prev, title: e.target.value }))
                }
                className="rounded border px-3 py-2 text-sm"
                placeholder="Draw title"
              />
              <textarea
                rows={3}
                value={drawForm.notes}
                onChange={(e) =>
                  setDrawForm((prev) => ({ ...prev, notes: e.target.value }))
                }
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
                      <td className="px-3 py-2 text-gray-700">
                        {milestone.title}
                      </td>
                      <td className="px-3 py-2 text-gray-700">
                        {formatMoney(milestone.amount)}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          value={drawForm.percents[String(milestone.id)] || '0'}
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
                {drawSaving ? 'Creating...' : 'Create Draw'}
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
                <div className="text-lg font-semibold text-gray-900">
                  Record External Payment
                </div>
                <div className="text-sm text-gray-500">
                  Save payment context without changing payout execution or
                  escrow behavior.
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
                  Expected payment: Gross{' '}
                  {formatMoney(paymentTargetDraw?.gross_amount)} / Retainage{' '}
                  {formatMoney(paymentTargetDraw?.retainage_amount)} / Net{' '}
                  {formatMoney(paymentTargetDraw?.net_amount)}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  Partial external payments are not supported. Recorded amounts
                  must match this approved draw.
                </div>
              </div>
              <input
                type="number"
                step="0.01"
                value={paymentForm.gross_amount}
                onChange={(e) =>
                  setPaymentForm((prev) => ({
                    ...prev,
                    gross_amount: e.target.value,
                  }))
                }
                className="rounded border px-3 py-2 text-sm"
                placeholder="Amount"
              />
              <select
                value={paymentForm.payment_method}
                onChange={(e) =>
                  setPaymentForm((prev) => ({
                    ...prev,
                    payment_method: e.target.value,
                  }))
                }
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
                onChange={(e) =>
                  setPaymentForm((prev) => ({
                    ...prev,
                    net_amount: e.target.value,
                  }))
                }
                className="rounded border px-3 py-2 text-sm"
                placeholder="Net amount"
              />
              <input
                type="date"
                value={paymentForm.payment_date}
                onChange={(e) =>
                  setPaymentForm((prev) => ({
                    ...prev,
                    payment_date: e.target.value,
                  }))
                }
                className="rounded border px-3 py-2 text-sm"
              />
              <input
                type="text"
                value={paymentForm.reference_number}
                onChange={(e) =>
                  setPaymentForm((prev) => ({
                    ...prev,
                    reference_number: e.target.value,
                  }))
                }
                className="rounded border px-3 py-2 text-sm sm:col-span-2"
                placeholder="Reference number"
              />
              <textarea
                rows={3}
                value={paymentForm.notes}
                onChange={(e) =>
                  setPaymentForm((prev) => ({ ...prev, notes: e.target.value }))
                }
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
                {paymentSaving ? 'Saving...' : 'Record Payment'}
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
              Release {formatMoney(payoutReleaseTarget.amount || 0)} to{' '}
              {payoutReleaseTarget.subcontractorName} for{' '}
              {payoutReleaseTarget.milestoneTitle}?
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
                disabled={Boolean(
                  payoutDecisionBusy[payoutReleaseTarget.milestoneId]
                )}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {payoutDecisionBusy[payoutReleaseTarget.milestoneId]
                  ? 'Releasing...'
                  : 'Release Payment'}
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
        defaultEmail={user?.email || ''}
        defaultCategory="agreement_help"
        defaultSubject={`Help with Agreement #${id}`}
        relatedObjectType="agreement"
        relatedObjectId={String(id || '')}
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
        title={`Agreement #${id} - Preview`}
      />
    </ContractorPageSurface>
  );
}

function SummaryCard({ label, value, className = '' }) {
  const dark = className.includes('text-white');
  return (
    <div className={`rounded border bg-gray-50 px-3 py-2 h-full ${className}`}>
      <div className={`text-xs ${dark ? 'text-sky-100/65' : 'text-gray-500'}`}>
        {label}
      </div>
      <div
        className={`text-sm font-medium whitespace-pre-wrap break-words ${dark ? 'text-white' : 'text-gray-900'}`}
      >
        {value}
      </div>
    </div>
  );
}
