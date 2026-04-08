// frontend/src/components/Step4Finalize.jsx
// v2026-03-15-step4-dedupe-clarifications-cleanup
// Changes:
// - Dedupe clarification rows by canonical concept
// - Hide internal/system-only clarification keys
// - Collapse legacy Step 2 alias keys (materials, permits, measurements, allowances)
// - Improve clarification label/value formatting
// - Prevent duplicate/repeat clarification cards in Step 4 summary

import React, { useEffect, useMemo, useRef, useState } from "react";
import api from "../api";
import toast from "react-hot-toast";
import Modal from "react-modal";
import SignatureModal from "./SignatureModal";
import SendFundingLinkButton from "./SendFundingLinkButton";
import ClarificationsModal from "./ClarificationsModal";

Modal.setAppElement("#root");

/* ---------- helpers ---------- */

function formatPhone(phoneStr) {
  if (!phoneStr) return "—";
  const cleaned = ("" + phoneStr).replace(/\D/g, "");
  const match = cleaned.match(/^(\d{3})(\d{3})(\d{4})$/);
  if (match) return `(${match[1]}) ${match[2]}-${match[3]}`;
  return phoneStr;
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

function buildCityStateZip(city, state, postal) {
  const cityClean = (city || "").trim();
  const stateClean = (state || "").trim();
  const postalClean = (postal || "").trim();
  const cs = [cityClean, stateClean].filter(Boolean).join(", ");
  const tail = [cs, postalClean].filter(Boolean).join(" ");
  return tail.trim();
}

function getHomeownerAddressFromAgreement(agreement, homeownerObj) {
  if (!agreement) return "—";
  const a = agreement;

  const snapSingle =
    (typeof a.homeowner_address_snapshot === "string" && a.homeowner_address_snapshot.trim()) ||
    (typeof a.homeowner_address_text === "string" && a.homeowner_address_text.trim());

  if (snapSingle) return snapSingle;

  const ho =
    homeownerObj || (typeof a.homeowner === "object" ? a.homeowner : null) || null;

  if (ho && typeof ho === "object") {
    const hoLine1 =
      (ho.address_line1 || ho.address1 || ho.street_address || ho.address || "").trim();
    const hoLine2 =
      (ho.address_line2 || ho.address2 || ho.unit || ho.apt || ho.suite || "").trim();
    const hoCity = (ho.city || "").trim();
    const hoState = (ho.state || ho.region || ho.state_code || "").trim();
    const hoPostal = (ho.zip_code || ho.zip || ho.postal_code || ho.postcode || "").trim();

    const hoLines = [];
    if (hoLine1) hoLines.push(hoLine1);
    if (hoLine2) hoLines.push(hoLine2);
    const hoLastLine = buildCityStateZip(hoCity, hoState, hoPostal);
    if (hoLastLine) hoLines.push(hoLastLine);
    if (hoLines.length) return hoLines.join("\n");
  }

  if (a.homeowner_address && String(a.homeowner_address).trim()) {
    return String(a.homeowner_address).trim();
  }

  return "—";
}

function getProjectAddressFromAgreement(agreement) {
  if (!agreement) return "—";
  const a = agreement;

  const line1 = (a.project_address_line1 || a.address_line1 || "").trim();
  const line2 = (a.project_address_line2 || a.address_line2 || "").trim();
  const city = (a.project_address_city || a.address_city || "").trim();
  const state = (a.project_address_state || a.address_state || "").trim();
  const postal = (a.project_postal_code || a.address_postal_code || "").trim();

  if (!line1 && !line2 && !city && !state && !postal) return "—";

  const parts = [];
  if (line1) parts.push(line1);
  if (line2) parts.push(line2);
  const lastLine = buildCityStateZip(city, state, postal);
  if (lastLine) parts.push(lastLine);

  return parts.join("\n").trim();
}

const norm = (s) => (s || "").toString().toLowerCase();

function formatDisputeSummary(agreement, displayMilestones) {
  const a = agreement || {};
  const arr = Array.isArray(displayMilestones) ? displayMilestones : [];

  const disputeId =
    a.dispute_id ||
    a.latest_dispute_id ||
    a.open_dispute_id ||
    a.dispute?.id ||
    a.latest_dispute?.id ||
    null;

  const rawStatus =
    a.dispute_status ||
    a.dispute_state ||
    a.latest_dispute_status ||
    a.open_dispute_status ||
    a.dispute?.status ||
    a.dispute?.state ||
    a.latest_dispute?.status ||
    a.latest_dispute?.state ||
    "";

  const rawDisplay =
    a.dispute_status_display ||
    a.dispute_display_status ||
    a.dispute?.status_display ||
    a.dispute?.display_status ||
    a.latest_dispute?.status_display ||
    a.latest_dispute?.display_status ||
    "";

  const hasFlag =
    a.has_open_dispute === true ||
    a.has_dispute === true ||
    a.open_disputes_count > 0 ||
    a.disputes_open_count > 0 ||
    false;

  const milestoneSignals = arr.some((m) => {
    const s = norm(m.status || m.status_display);
    return s.includes("dispute") || s.includes("under_review");
  });

  const derivedOpen =
    hasFlag ||
    norm(rawStatus).includes("open") ||
    norm(rawStatus).includes("review") ||
    norm(rawStatus).includes("pending") ||
    milestoneSignals;

  const derivedClosed =
    norm(rawStatus).includes("resolved") ||
    norm(rawStatus).includes("closed") ||
    norm(rawStatus).includes("dismissed") ||
    norm(rawStatus).includes("completed");

  if (!disputeId && !rawStatus && !rawDisplay && !hasFlag && !milestoneSignals) {
    return "None";
  }

  const pieces = [];
  if (disputeId) pieces.push(`Dispute #${disputeId}`);
  const statusText = (rawDisplay || rawStatus || "").toString().trim();
  if (statusText) pieces.push(statusText);
  else pieces.push(derivedOpen ? "Open" : derivedClosed ? "Closed" : "Unknown");

  return pieces.join(" — ");
}

function parseMoneyNumber(v) {
  if (v === null || v === undefined) return NaN;
  if (typeof v === "number") return v;
  const s = String(v).trim().replace(/,/g, "");
  if (!s) return NaN;
  const n = Number(s);
  if (!Number.isFinite(n)) return NaN;
  return n;
}

function firstInvalidMilestoneAmount(arr) {
  const list = Array.isArray(arr) ? arr : [];
  for (let i = 0; i < list.length; i++) {
    const m = list[i] || {};
    const amt = parseMoneyNumber(m.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return { idx: i, milestone: m, amount: amt };
    }
  }
  return null;
}

function normalizeRequireBool(v, defaultValue = true) {
  if (v === true) return true;
  if (v === false) return false;
  if (v === 1) return true;
  if (v === 0) return false;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "yes" || s === "1") return true;
    if (s === "false" || s === "no" || s === "0") return false;
  }
  return defaultValue;
}

function normalizePaymentMode(v) {
  const raw = v == null ? "" : String(v);
  const s = raw.trim().toLowerCase();
  if (!s) return "";
  if (s.includes("direct")) return "direct";
  if (s.includes("escrow")) return "escrow";
  return "";
}

function formatMoney(v) {
  return `$${Number(v || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function roundCurrency(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function sumMilestones(milestones) {
  const arr = Array.isArray(milestones) ? milestones : [];
  return arr.reduce((sum, m) => sum + Number(m?.amount || 0), 0);
}

function isSubcontractorAssignedMilestone(milestone) {
  const workerKind = String(milestone?.assigned_worker?.kind || "").trim().toLowerCase();
  if (workerKind === "subcontractor") return true;
  if (milestone?.assigned_subcontractor) return true;
  if (milestone?.assigned_subcontractor_invitation) return true;
  return false;
}

function getMilestoneSubcontractorPayoutAmount(milestone) {
  if (!isSubcontractorAssignedMilestone(milestone)) return 0;

  const cents = parseMoneyNumber(milestone?.subcontractor_payout_amount_cents);
  if (Number.isFinite(cents) && cents > 0) {
    return roundCurrency(cents / 100);
  }

  const dollarCandidates = [
    milestone?.payout_amount,
    milestone?.subcontractor_payout_amount,
    milestone?.subcontractor_payout_amount_dollars,
  ];

  for (const candidate of dollarCandidates) {
    const dollars = parseMoneyNumber(candidate);
    if (Number.isFinite(dollars) && dollars > 0) {
      return roundCurrency(dollars);
    }
  }

  return 0;
}

function formatMilestoneDate(m) {
  const raw = m?.due_date || m?.dueDate || m?.target_date || m?.date || m?.scheduled_for;
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
}

function formatMilestoneStartDate(m) {
  const raw = m?.start_date || m?.startDate || m?.start || m?.scheduled_start;
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
}

function safeMilestoneStr(v) {
  return (v == null ? "" : String(v)).trim();
}

function hasValue(v) {
  return v !== null && v !== undefined && v !== "";
}

function advisoryMoneyLine(label, low, high) {
  if (!hasValue(low) || !hasValue(high)) return "";
  const lo = Number(low);
  const hi = Number(high);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo <= 0 || hi <= 0) return "";
  return `${label}: ${formatMoney(lo)} – ${formatMoney(hi)}`;
}

function milestoneAdvisoryPricingMeta(m) {
  const mode = safeMilestoneStr(m?.pricing_mode).toLowerCase();
  const laborLine = advisoryMoneyLine("Labor", m?.labor_estimate_low, m?.labor_estimate_high);
  const materialRangeLine = advisoryMoneyLine("Materials", m?.materials_estimate_low, m?.materials_estimate_high);
  const materialsLine =
    mode === "labor_only"
      ? "Materials: customer supplied"
      : materialRangeLine || (mode === "hybrid" ? "Materials: shared responsibility" : "");
  const materialsHint = safeMilestoneStr(m?.materials_hint);

  return {
    mode,
    laborLine,
    materialsLine,
    materialsHint: materialsHint ? `Materials context: ${materialsHint}` : "",
    hasAny: !!laborLine || !!materialsLine || !!materialsHint,
  };
}

function normalizeMaterialsResponsibilityValue(v) {
  const raw = safeMilestoneStr(v);
  const lowered = raw.toLowerCase();
  if (!lowered) return "";
  if (lowered.includes("split") || lowered.includes("shared") || lowered.includes("hybrid") || lowered.includes("depend")) {
    return "Split";
  }
  if (
    lowered.includes("homeowner") ||
    lowered.includes("customer") ||
    lowered.includes("owner") ||
    lowered.includes("client")
  ) {
    return "Homeowner";
  }
  if (lowered.includes("contractor")) {
    return "Contractor";
  }
  return raw;
}

function toCompactLine(value, maxLen = 140) {
  const text = safeMilestoneStr(value).replace(/\s+/g, " ");
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1).trim()}…`;
}

function extractQuantitySignals(answers = {}) {
  const entries = [
    ["roof_area", "Roof area"],
    ["square_footage", "Square footage"],
    ["sqft", "Square footage"],
    ["linear_feet", "Linear feet"],
    ["lf", "Linear feet"],
    ["room_count", "Rooms"],
    ["rooms", "Rooms"],
    ["fixture_count", "Fixtures"],
    ["fixtures", "Fixtures"],
    ["gate_count", "Gates"],
  ];

  const signals = [];
  for (const [key, label] of entries) {
    const value = safeMilestoneStr(answers?.[key]);
    if (!value) continue;
    signals.push({ label, value });
    if (signals.length >= 2) return signals;
  }

  const measurementNotes =
    safeMilestoneStr(answers?.measurement_notes) ||
    safeMilestoneStr(answers?.measurements_notes);
  if (measurementNotes) {
    signals.push({ label: "Measurements", value: toCompactLine(measurementNotes, 60) });
  }

  return signals.slice(0, 2);
}

function mergeAgreement(prev, next, fallbackId) {
  const p = prev && typeof prev === "object" ? prev : {};
  const n = next && typeof next === "object" ? next : {};
  const id = n.id ?? n.agreement_id ?? n.pk ?? p.id ?? p.agreement_id ?? p.pk ?? fallbackId ?? null;

  const merged = { ...p, ...n };
  if (id) merged.id = id;
  if (merged.agreement_id == null && id) merged.agreement_id = id;

  if (!Object.prototype.hasOwnProperty.call(n, "payment_mode") && Object.prototype.hasOwnProperty.call(p, "payment_mode")) {
    merged.payment_mode = p.payment_mode;
  }
  if (!Object.prototype.hasOwnProperty.call(n, "paymentMode") && Object.prototype.hasOwnProperty.call(p, "paymentMode")) {
    merged.paymentMode = p.paymentMode;
  }

  const keepKeys = [
    "require_contractor_signature",
    "require_customer_signature",
    "contractor_signed",
    "contractor_signed_at",
    "homeowner_signed",
    "homeowner_signed_at",
    "signed_by_contractor",
    "signed_by_homeowner",
    "homeowner_signature_name",
    "contractor_signature_name",
    "signed_at_contractor",
    "signed_at_homeowner",
    "homeowner_signed_ip",
    "contractor_signed_ip",
  ];
  for (const k of keepKeys) {
    if (!Object.prototype.hasOwnProperty.call(n, k) && Object.prototype.hasOwnProperty.call(p, k)) {
      merged[k] = p[k];
    }
  }

  return merged;
}

function safeArray(v) {
  return Array.isArray(v) ? v : [];
}

function safeObject(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

function isAnsweredClarificationValue(value) {
  if (value === false) return true;
  if (value === 0) return true;
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function prettifyClarificationValue(value) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  if (value == null) return "—";

  if (Array.isArray(value)) {
    if (!value.length) return "—";
    return value
      .map((item) => {
        if (item == null) return "";
        if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
          return String(item);
        }
        if (typeof item === "object") {
          return (
            item.label ||
            item.name ||
            item.value ||
            item.title ||
            JSON.stringify(item)
          );
        }
        return String(item);
      })
      .filter(Boolean)
      .join(", ");
  }

  if (typeof value === "object") {
    if ("label" in value && value.label) return String(value.label);
    if ("name" in value && value.name) return String(value.name);
    if ("value" in value && value.value != null) return String(value.value);
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  const s = String(value).trim();
  return s || "—";
}

function prettifyLabelFromKey(key) {
  const raw = String(key || "").trim();
  if (!raw) return "Clarification";

  const friendlyOverrides = {
    who_purchases_materials: "Who will purchase materials?",
    materials_purchasing: "Who will purchase materials?",
    materials_responsibility: "Who will purchase materials?",
    measurements_needed: "Are measurements needed?",
    measurement_notes: "Measurement notes",
    measurements_notes: "Measurement notes",
    permit_acquisition: "Who is responsible for permits?",
    permits_inspections: "Permits / inspections",
    permits: "Permits / inspections",
    permit_notes: "Permit notes",
    allowances_selections: "Allowances / selections",
    allowance_notes: "Allowances / selections",
    unforeseen_conditions_change_orders: "Unforeseen conditions / change orders",
    material_delivery_coordination: "Material delivery coordination",
    waste_debris_removal: "Waste / debris removal",
    clarifications_reviewed_step2: "Clarifications reviewed",
    clarifications_reviewed: "Clarifications reviewed",
  };

  if (friendlyOverrides[raw]) return friendlyOverrides[raw];

  return raw
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function normalizeQuestionOptions(options) {
  const arr = safeArray(options);
  return arr
    .map((opt) => {
      if (opt == null) return "";
      if (typeof opt === "string" || typeof opt === "number" || typeof opt === "boolean") {
        return String(opt);
      }
      if (typeof opt === "object") {
        return String(opt.label || opt.name || opt.value || opt.title || "").trim();
      }
      return "";
    })
    .filter(Boolean);
}

function normalizeClarificationKey(rawKey) {
  const key = String(rawKey || "").trim().toLowerCase();
  if (!key) return "";

  const aliasMap = {
    who_purchases_materials: "materials_responsibility",
    materials_purchasing: "materials_responsibility",
    materials_responsibility: "materials_responsibility",

    measurements_needed: "measurements_needed",
    measurement_notes: "measurement_notes",
    measurements_notes: "measurement_notes",

    permit_acquisition: "permit_acquisition",
    permits_inspections: "permit_acquisition",
    permits: "permit_acquisition",
    permit_notes: "permit_acquisition",

    allowances_selections: "allowances_selections",
    allowance_notes: "allowances_selections",

    clarifications_reviewed_step2: "__internal__clarifications_reviewed",
    clarifications_reviewed: "__internal__clarifications_reviewed",
  };

  return aliasMap[key] || key;
}

function isInternalClarificationKey(rawKey) {
  const canonical = normalizeClarificationKey(rawKey);
  if (!canonical) return true;
  if (canonical.startsWith("__internal__")) return true;

  const hiddenKeys = new Set([
    "clarifications_reviewed_step2",
    "clarifications_reviewed",
  ]);

  return hiddenKeys.has(String(rawKey || "").trim().toLowerCase());
}

function normalizeClarificationQuestions(aiScope) {
  const questions = safeArray(aiScope?.questions);
  const byKey = new Map();

  questions.forEach((q, idx) => {
    const rawKey = String(q?.key || "").trim();
    if (!rawKey) return;

    if (isInternalClarificationKey(rawKey)) return;

    const canonicalKey = normalizeClarificationKey(rawKey);
    if (!canonicalKey) return;

    const normalized = {
      key: canonicalKey,
      rawKey,
      label: String(q?.label || prettifyLabelFromKey(canonicalKey) || `Question ${idx + 1}`).trim(),
      help: String(q?.help || "").trim(),
      type: String(q?.type || "text").trim(),
      required: !!q?.required,
      options: normalizeQuestionOptions(q?.options),
    };

    const prev = byKey.get(canonicalKey);
    if (!prev) {
      byKey.set(canonicalKey, normalized);
      return;
    }

    const nextScore =
      (normalized.required ? 5 : 0) +
      (normalized.help ? 2 : 0) +
      (normalized.options.length ? 2 : 0) +
      (normalized.label ? 1 : 0);

    const prevScore =
      (prev.required ? 5 : 0) +
      (prev.help ? 2 : 0) +
      (prev.options.length ? 2 : 0) +
      (prev.label ? 1 : 0);

    if (nextScore > prevScore) {
      byKey.set(canonicalKey, normalized);
    }
  });

  return Array.from(byKey.values());
}

function normalizeClarificationRows(aiScope) {
  const answers = safeObject(aiScope?.answers);
  const questions = normalizeClarificationQuestions(aiScope);

  const questionMap = new Map();
  questions.forEach((q) => questionMap.set(q.key, q));

  const groupedAnswers = new Map();

  Object.entries(answers).forEach(([rawKey, value]) => {
    if (isInternalClarificationKey(rawKey)) return;

    const canonicalKey = normalizeClarificationKey(rawKey);
    if (!canonicalKey) return;

    const prev = groupedAnswers.get(canonicalKey);

    const nextAnswered = isAnsweredClarificationValue(value);
    const prevAnswered = prev ? isAnsweredClarificationValue(prev.value) : false;

    if (!prev) {
      groupedAnswers.set(canonicalKey, { rawKey, value });
      return;
    }

    if (!prevAnswered && nextAnswered) {
      groupedAnswers.set(canonicalKey, { rawKey, value });
      return;
    }

    if (!prevAnswered && !nextAnswered) {
      groupedAnswers.set(canonicalKey, { rawKey, value });
    }
  });

  const keys = new Set([
    ...questions.map((q) => q.key),
    ...Array.from(groupedAnswers.keys()),
  ]);

  return Array.from(keys).map((key) => {
    const q = questionMap.get(key);
    const answerEntry = groupedAnswers.get(key);
    const value = answerEntry?.value;

    return {
      key,
      rawKey: answerEntry?.rawKey || q?.rawKey || key,
      label: q?.label || prettifyLabelFromKey(key),
      help: q?.help || "",
      type: q?.type || "text",
      required: !!q?.required,
      options: q?.options || [],
      value,
      answered: isAnsweredClarificationValue(value),
      displayValue: prettifyClarificationValue(value),
    };
  });
}

/* ---------------- component ---------------- */

export default function Step4Finalize({
  agreement: agreementProp,
  dLocal,
  id,
  previewPdf,
  goPublic,
  milestones,
  totals,
  hasPreviewed,
  ackReviewed,
  setAckReviewed,
  ackTos,
  setAckTos,
  ackEsign,
  setAckEsign,
  typedName,
  setTypedName,
  canSign,
  signing,
  signContractor,
  submitSign,
  attachments,
  defaultWarrantyText,
  customWarranty,
  useDefaultWarranty,
  goBack,
  isEdit,
  unsignContractor,
  onAgreementUpdated,
  refreshAgreement: refreshAgreementProp,
  onPreviewViewed = () => {},
  postSendGuidance = "",
}) {
  const [agreement, setAgreement] = useState(agreementProp || null);
  const [showAllClarifications, setShowAllClarifications] = useState(false);

  useEffect(() => {
    setAgreement((prev) => mergeAgreement(prev, agreementProp || null, id));
  }, [agreementProp, id]);

  const agreementId = useMemo(() => {
    const a = agreement || {};
    return a.id || a.agreement_id || a.pk || id || null;
  }, [agreement, id]);

  const syncUp = (nextAgreement) => {
    if (typeof onAgreementUpdated === "function" && nextAgreement && typeof nextAgreement === "object") {
      onAgreementUpdated(nextAgreement);
    }
  };

  const setAgreementAndSync = (updater) => {
    setAgreement((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      const merged = mergeAgreement(prev, next, agreementId);
      syncUp(merged);
      return merged;
    });
  };

  const patchingRef = useRef(false);
  const patchAgreement = async (fields) => {
    if (!agreementId) return { ok: false, data: null };
    if (!fields || Object.keys(fields).length === 0) return { ok: false, data: null };
    if (patchingRef.current) return { ok: false, data: null };
    patchingRef.current = true;
    try {
      const { data } = await api.patch(`/projects/agreements/${agreementId}/`, fields);
      if (data) setAgreementAndSync((prev) => mergeAgreement(prev, data, agreementId));
      return { ok: true, data: data || null };
    } catch (err) {
      const msg =
        err?.response?.data?.detail ||
        err?.response?.data?.error ||
        "Unable to save changes.";
      toast.error(msg);
      return { ok: false, data: null };
    } finally {
      patchingRef.current = false;
    }
  };

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewErr, setPreviewErr] = useState("");
  const [pdfBlobUrl, setPdfBlobUrl] = useState("");
  const [pdfFilename, setPdfFilename] = useState("");
  const [localHasPreviewed, setLocalHasPreviewed] = useState(!!hasPreviewed);

  useEffect(() => {
    setLocalHasPreviewed(!!hasPreviewed);
  }, [hasPreviewed]);

  useEffect(() => {
    const maybe =
      agreement?.has_previewed ??
      agreement?.previewed ??
      agreement?.pdf_previewed ??
      agreement?.contractor_previewed ??
      null;
    if (maybe === true) setLocalHasPreviewed(true);
  }, [
    agreementId,
    agreement?.has_previewed,
    agreement?.previewed,
    agreement?.pdf_previewed,
    agreement?.contractor_previewed,
  ]);

  const cleanupBlob = () => {
    try {
      if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
    } catch {}
  };

  useEffect(() => () => cleanupBlob(), []); // eslint-disable-line

  const closePreview = () => {
    setPreviewOpen(false);
    setPreviewErr("");
    setPreviewLoading(false);
    cleanupBlob();
    setPdfBlobUrl("");
  };

  const downloadPreview = () => {
    if (!pdfBlobUrl) return;
    const a = document.createElement("a");
    a.href = pdfBlobUrl;
    a.download = pdfFilename || "agreement.pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const [homeownerObj, setHomeownerObj] = useState(null);
  const [sendingLink, setSendingLink] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [resendingFinal, setResendingFinal] = useState(false);
  const [resendFinalError, setResendFinalError] = useState(null);
  const [showSignatureModal, setShowSignatureModal] = useState(false);
  const [showClarificationsModal, setShowClarificationsModal] = useState(false);
  const [fundingPreview, setFundingPreview] = useState(null);
  const [fundingLoading, setFundingLoading] = useState(false);
  const [fundingError, setFundingError] = useState("");
  const [unsigning, setUnsigning] = useState(false);
  const [paymentModeSaving, setPaymentModeSaving] = useState(false);

  const paymentMode = useMemo(() => {
    const rawAgreementMode = agreement?.payment_mode || agreement?.paymentMode || "";
    const fromAgreement = normalizePaymentMode(rawAgreementMode);
    if (fromAgreement) return fromAgreement;

    const fromLocal = normalizePaymentMode(dLocal?.payment_mode);
    if (fromLocal) return fromLocal;

    return "escrow";
  }, [agreement?.payment_mode, agreement?.paymentMode, dLocal?.payment_mode]);

  const isDirectPay = paymentMode === "direct";
  const paymentStructure = String(
    agreement?.payment_structure || dLocal?.payment_structure || "simple"
  )
    .trim()
    .toLowerCase();
  const isProgressPayments = paymentStructure === "progress";
  const retainagePercent = Number(
    agreement?.retainage_percent ?? dLocal?.retainage_percent ?? 0
  );

  useEffect(() => {
    const fetchHomeowner = async () => {
      if (!agreement) return;
      const candidate = agreement.homeowner;

      if (agreement.homeowner_snapshot && typeof agreement.homeowner_snapshot === "object") {
        setHomeownerObj(agreement.homeowner_snapshot);
        return;
      }

      if (!candidate) return;
      const idVal = typeof candidate === "number" ? candidate : parseInt(candidate, 10);
      if (!idVal || Number.isNaN(idVal)) return;

      try {
        const { data } = await api.get(`/projects/homeowners/${idVal}/`);
        setHomeownerObj(data);
      } catch {
        // ignore
      }
    };
    fetchHomeowner();
  }, [agreement]);

  const amendmentNumber =
    agreement?.amendment_number != null
      ? Number(agreement.amendment_number)
      : agreement?.amendment != null
      ? Number(agreement.amendment)
      : 0;

  const displayMilestones = milestones || agreement?.milestones || [];
  const milestoneTotal = useMemo(() => sumMilestones(displayMilestones), [displayMilestones]);

  const totalAmount = Number(totals?.totalAmt ?? totals?.total ?? totals?.amount ?? NaN);
  const projectAmount =
    Number.isFinite(totalAmount) && totalAmount > 0 ? totalAmount : Number(milestoneTotal || 0);

  const invalidAmountInfo = useMemo(() => firstInvalidMilestoneAmount(displayMilestones), [displayMilestones]);
  const hasInvalidMilestoneAmounts = !!invalidAmountInfo;

  const firstInvalidTitle = useMemo(() => {
    if (!invalidAmountInfo) return "";
    const m = invalidAmountInfo.milestone || {};
    return (m.title || `Milestone #${(invalidAmountInfo.idx ?? 0) + 1}`).toString();
  }, [invalidAmountInfo]);

  const aiScope = useMemo(() => safeObject(agreement?.ai_scope), [agreement?.ai_scope]);
  const projectContextSummary = useMemo(() => {
    const answers = safeObject(aiScope?.answers);
    const projectType =
      safeMilestoneStr(agreement?.project_type) ||
      safeMilestoneStr(agreement?.project?.project_type) ||
      safeMilestoneStr(agreement?.selected_template?.project_type);
    const projectSubtype =
      safeMilestoneStr(agreement?.project_subtype) ||
      safeMilestoneStr(agreement?.project?.project_subtype) ||
      safeMilestoneStr(agreement?.selected_template?.project_subtype);
    const templateName =
      safeMilestoneStr(agreement?.selected_template?.name) ||
      safeMilestoneStr(agreement?.selected_template_name_snapshot);
    const materialsResponsibility = normalizeMaterialsResponsibilityValue(
      answers?.materials_responsibility ||
      answers?.materials_purchasing ||
      answers?.who_purchases_materials
    );
    const quantitySignals = extractQuantitySignals(answers);
    const scopeSummary = toCompactLine(
      agreement?.description ||
      aiScope?.scope_text ||
      agreement?.project?.description ||
      ""
    );

    return {
      projectType,
      projectSubtype,
      templateName,
      materialsResponsibility:
        materialsResponsibility === "Contractor"
          ? "Contractor supplied"
          : materialsResponsibility === "Homeowner"
          ? "Customer supplied"
          : materialsResponsibility === "Split"
          ? "Shared responsibility"
          : "",
      quantitySignals,
      scopeSummary,
      hasAny:
        !!projectType ||
        !!projectSubtype ||
        !!templateName ||
        !!materialsResponsibility ||
        quantitySignals.length > 0 ||
        !!scopeSummary,
    };
  }, [agreement, aiScope]);
  const clarificationRows = useMemo(() => normalizeClarificationRows(aiScope), [aiScope]);
  const answeredClarificationRows = useMemo(
    () => clarificationRows.filter((row) => row.answered),
    [clarificationRows]
  );
  const visibleClarificationRows = useMemo(
    () => (showAllClarifications ? clarificationRows : answeredClarificationRows),
    [showAllClarifications, clarificationRows, answeredClarificationRows]
  );
  const recommendedClarificationCount = useMemo(
    () => clarificationRows.filter((row) => row.required).length,
    [clarificationRows]
  );
  const unansweredClarificationCount = useMemo(
    () => clarificationRows.filter((row) => !row.answered).length,
    [clarificationRows]
  );

  const handleGateToast = (actionLabel = "continue") => {
    if (!hasInvalidMilestoneAmounts) return false;
    const base = `Cannot ${actionLabel}. All milestones must have an amount greater than $0.`;
    const extra = firstInvalidTitle ? ` First missing price: "${firstInvalidTitle}".` : "";
    toast.error(`${base}${extra}`);
    return true;
  };

  const refreshAgreement = async () => {
    if (typeof refreshAgreementProp === "function") {
      await refreshAgreementProp();
      return;
    }
    if (!agreementId) return;
    try {
      const { data } = await api.get(`/projects/agreements/${agreementId}/`, {
        params: { _ts: Date.now() },
        headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
      });
      if (data) setAgreementAndSync((prev) => mergeAgreement(prev, data, agreementId));
    } catch {
      // ignore
    }
  };

  const openPreviewModal = async () => {
    if (!agreementId) {
      toast.error("Missing agreement ID.");
      return;
    }
    if (handleGateToast("preview")) return;

    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewErr("");

    cleanupBlob();
    setPdfBlobUrl("");

    const base = `/projects/agreements/${agreementId}`;
    const candidates = [
      `${base}/preview_link/`,
      `${base}/preview_link`,
      `${base}/preview_pdf/`,
      `${base}/preview_pdf`,
    ];

    try {
      let streamUrl = null;

      for (const url of candidates) {
        try {
          const { data } = await api.get(url, {
            timeout: 30000,
            params: { _ts: Date.now() },
            headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
          });
          const outUrl = data?.url || data?.preview_url || data?.link;
          if (outUrl) {
            streamUrl = outUrl;
            break;
          }
        } catch (err) {
          if (err?.response?.status === 404) continue;
          throw err;
        }
      }

      if (!streamUrl) throw new Error("Preview endpoint not found on server.");

      const res = await api.get(streamUrl, {
        responseType: "blob",
        timeout: 120000,
        params: { _ts: Date.now() },
        headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
      });

      const blob = new Blob([res.data], { type: "application/pdf" });
      const blobUrl = URL.createObjectURL(blob);

      const titleHint =
        amendmentNumber > 0
          ? `agreement-${agreementId}-amendment-${amendmentNumber}.pdf`
          : `agreement-${agreementId}.pdf`;

      setPdfFilename(titleHint);
      setPdfBlobUrl(blobUrl);
      setPreviewLoading(false);

      try {
        await api.post(`/projects/agreements/${agreementId}/mark_previewed/`);
      } catch {
        try {
          await api.post(`/projects/agreements/${agreementId}/mark_previewed`);
        } catch {}
      }
      setLocalHasPreviewed(true);
      onPreviewViewed();
    } catch (err) {
      const statusCode = err?.response?.status;
      const detail = err?.response?.data?.detail || err?.response?.data?.error;
      const msg =
        statusCode === 401
          ? "You are not authenticated. Please log in again."
          : detail || err?.message || "Preview failed. Check backend logs.";
      setPreviewErr(msg);
      setPreviewLoading(false);
    }
  };

  useEffect(() => {
    const fetchFundingPreview = async () => {
      if (!agreementId) {
        setFundingPreview(null);
        return;
      }

      if (isDirectPay) {
        setFundingPreview(null);
        setFundingError("");
        setFundingLoading(false);
        return;
      }

      setFundingLoading(true);
      setFundingError("");
      try {
        const { data } = await api.get(`/projects/agreements/${agreementId}/funding_preview/`, {
          params: { _ts: Date.now() },
          headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
        });
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
  }, [agreementId, amendmentNumber, projectAmount, isDirectPay]);

  const homeownerAddressDisplay = getHomeownerAddressFromAgreement(agreement, homeownerObj);
  const projectAddressDisplay = getProjectAddressFromAgreement(agreement);

  const homeownerName =
    agreement?.homeowner_name ||
    homeownerObj?.full_name ||
    agreement?.homeowner?.full_name ||
    "—";

  const companyName = (homeownerObj?.company_name || agreement?.homeowner?.company_name || "")
    .toString()
    .trim();
  const customerNameDisplay = companyName ? `${companyName} (${homeownerName})` : homeownerName;

  const homeownerEmail = agreement?.homeowner_email || homeownerObj?.email || agreement?.homeowner?.email || "—";
  const homeownerPhone =
    homeownerObj?.phone_number ||
    agreement?.homeowner?.phone_number ||
    agreement?.homeowner?.phone ||
    "—";

  const status = agreement?.status || "draft";

  const signedByContractor =
    !!agreement?.signed_by_contractor ||
    !!agreement?.contractor_signed ||
    !!agreement?.contractor_signature_name ||
    !!agreement?.signed_at_contractor ||
    !!agreement?.contractor_signed_at;

  const signedByHomeowner =
    !!agreement?.signed_by_homeowner ||
    !!agreement?.homeowner_signed ||
    !!agreement?.homeowner_signature_name ||
    !!agreement?.signed_at_homeowner ||
    !!agreement?.homeowner_signed_at;

  const contractorSignedAt =
    agreement?.contractor_signed_at || agreement?.signed_at_contractor || agreement?.contractor_signed_timestamp || "";

  const homeownerSignedAt =
    agreement?.homeowner_signed_at || agreement?.signed_at_homeowner || agreement?.homeowner_signed_timestamp || "";

  const contractorSignedIp =
    agreement?.contractor_signed_ip || agreement?.contractor_ip || "";

  const homeownerSignedIp =
    agreement?.homeowner_signed_ip || agreement?.homeowner_ip || "";

  const escrowFunded =
    !isDirectPay &&
    (fundingPreview?.escrow_funded != null ? !!fundingPreview.escrow_funded : !!agreement?.escrow_funded);

  const initialReqContr = useMemo(() => {
    return normalizeRequireBool(
      agreement?.require_contractor_signature ??
        agreement?.requireContractorSignature ??
        agreement?.signature_require_contractor ??
        agreement?.signature_requirements?.contractor,
      true
    );
  }, [agreement]);

  const initialReqCust = useMemo(() => {
    return normalizeRequireBool(
      agreement?.require_customer_signature ??
        agreement?.requireCustomerSignature ??
        agreement?.signature_require_customer ??
        agreement?.signature_requirements?.customer,
      true
    );
  }, [agreement]);

  const [reqContr, setReqContr] = useState(initialReqContr);
  const [reqCust, setReqCust] = useState(initialReqCust);

  const reqDirtyRef = useRef(false);
  useEffect(() => {
    reqDirtyRef.current = false;
    setReqContr(initialReqContr);
    setReqCust(initialReqCust);
  }, [initialReqContr, initialReqCust]);

  const contractorSignatureSatisfied = !reqContr || signedByContractor;
  const customerSignatureSatisfied = !reqCust || signedByHomeowner;
  const isFullySigned = contractorSignatureSatisfied && customerSignatureSatisfied;

  const requirementsLocked = signedByHomeowner || escrowFunded;

  const canUnsignContractor = signedByContractor && !signedByHomeowner;

  const pdfVersion = agreement?.pdf_version != null ? Number(agreement.pdf_version) : null;
  const previewButtonLabel = localHasPreviewed ? "View Agreement PDF" : "Preview PDF (Required)";

  const escrowRate = fundingPreview?.rate != null ? Number(fundingPreview.rate) : 0.05;
  const escrowFlat = fundingPreview?.flat_fee != null ? Number(fundingPreview.flat_fee) : 1;

  const escrowPlatformFee =
    fundingPreview?.platform_fee != null
      ? Number(fundingPreview.platform_fee)
      : Math.max(0, Math.round((projectAmount * escrowRate + escrowFlat) * 100) / 100);

  const homeownerEscrow =
    fundingPreview?.homeowner_escrow != null ? Number(fundingPreview.homeowner_escrow) : projectAmount;

  const fundedSoFar = Number(
    fundingPreview?.escrow_funded_amount ??
      fundingPreview?.escrow_funded_so_far ??
      agreement?.escrow_funded_amount ??
      0
  );
  const remainingToFund = Math.max(0, Math.round((homeownerEscrow - fundedSoFar) * 100) / 100);

  const DIRECT_RATE = 0.02;
  const DIRECT_FLAT = 1;
  const ESTIMATED_STRIPE_RATE = 0.029;
  const ESTIMATED_STRIPE_FLAT = 0.3;

  const directPlatformFee = Math.max(0, Math.round((projectAmount * DIRECT_RATE + DIRECT_FLAT) * 100) / 100);
  const estimatedStripeProcessingFee = Math.max(
    0,
    roundCurrency(projectAmount * ESTIMATED_STRIPE_RATE + ESTIMATED_STRIPE_FLAT)
  );
  const subcontractorPayoutTotal = useMemo(
    () =>
      roundCurrency(
        safeArray(displayMilestones).reduce(
          (sum, milestone) => sum + getMilestoneSubcontractorPayoutAmount(milestone),
          0
        )
      ),
    [displayMilestones]
  );
  const showSubcontractorPayoutRow = subcontractorPayoutTotal > 0;
  const platformFee = isDirectPay ? directPlatformFee : escrowPlatformFee;
  const estimatedContractorNet = Math.max(
    0,
    roundCurrency(projectAmount - platformFee - estimatedStripeProcessingFee - subcontractorPayoutTotal)
  );
  const summaryBreakdownRows = [
    {
      key: "project-total",
      label: "Total Project Amount",
      value: formatMoney(projectAmount),
      tone: "default",
    },
    {
      key: "platform-fee",
      label: "Platform Fee",
      value: `-${formatMoney(platformFee)}`,
      tone: "deduction",
    },
    {
      key: "stripe-fee",
      label: "Estimated Stripe Processing Fee",
      value: `-${formatMoney(estimatedStripeProcessingFee)}`,
      tone: "deduction",
      help: "Estimated based on standard card-processing assumptions and shown for planning only.",
    },
    ...(showSubcontractorPayoutRow
      ? [
          {
            key: "subcontractor-payouts",
            label: "Subcontractor Payouts",
            value: `-${formatMoney(subcontractorPayoutTotal)}`,
            tone: "deduction",
          },
        ]
      : []),
  ];
  const readinessItems = [
    {
      key: "project",
      ok: Boolean(safeMilestoneStr(agreement?.project_title || agreement?.title) && safeMilestoneStr(customerNameDisplay)),
      goodLabel: `${safeMilestoneStr(agreement?.project_title || agreement?.title) || "Project"} ready for ${customerNameDisplay || "customer review"}`,
      warnLabel: "Add a project title and customer before sending",
    },
    {
      key: "milestones",
      ok: displayMilestones.length > 0 && projectAmount > 0,
      goodLabel: `${displayMilestones.length} milestone${displayMilestones.length === 1 ? "" : "s"} configured · ${formatMoney(projectAmount)} total`,
      warnLabel: "Milestones and pricing still need review",
    },
    {
      key: "payment",
      ok: Boolean(paymentMode),
      goodLabel: `${isProgressPayments ? "Progress payments" : isDirectPay ? "Direct pay" : "Escrow"} selected`,
      warnLabel: "Choose the payment workflow before sending",
    },
    {
      key: "preview",
      ok: Boolean(localHasPreviewed),
      goodLabel: "Agreement PDF reviewed",
      warnLabel: "Preview the agreement PDF before sending",
    },
  ];
  const readinessWarningCount = readinessItems.filter((item) => !item.ok).length;

  const handlePaymentModeSelect = async (nextMode) => {
    const normalized = normalizePaymentMode(nextMode) || "escrow";
    if (!agreementId || normalized === paymentMode || paymentModeSaving) return;

    setPaymentModeSaving(true);
    try {
      const { ok } = await patchAgreement({ payment_mode: normalized });
      if (ok) {
        toast.success(
          normalized === "direct"
            ? "Payment mode updated to Direct Pay."
            : "Payment mode updated to Escrow."
        );
        await refreshAgreement?.();
      }
    } finally {
      setPaymentModeSaving(false);
    }
  };

  const handleToggleRequirement = async (key, value) => {
    if (!agreementId) return;
    if (requirementsLocked) {
      toast.error("Signature requirements are locked after the customer signs (or escrow is funded).");
      return;
    }

    reqDirtyRef.current = true;

    if (key === "require_contractor_signature") setReqContr(!!value);
    if (key === "require_customer_signature") setReqCust(!!value);

    const { ok, data } = await patchAgreement({ [key]: !!value });

    if (ok) {
      if (data) syncUp(mergeAgreement(agreement, data, agreementId));
      await refreshAgreement();
      toast.success("Signature requirements updated.");
    } else {
      reqDirtyRef.current = false;
      setReqContr(initialReqContr);
      setReqCust(initialReqCust);
    }
  };

  const handleOpenContractorModal = () => {
    if (handleGateToast("sign")) return;

    if (!reqContr) {
      toast.success("Contractor signature is waived for this agreement.");
      return;
    }
    if (!localHasPreviewed) {
      toast.error("You must preview the PDF before signing.");
      return;
    }

    if (!typedName.trim()) {
      toast.error("Please type your full legal name.");
      return;
    }

    setShowSignatureModal(true);
  };

  const handleContractorSigned = async (updatedAgreement) => {
    setShowSignatureModal(false);

    if (updatedAgreement && typeof updatedAgreement === "object") {
      setAgreementAndSync((prev) => mergeAgreement(prev, updatedAgreement, agreementId));
    }

    await refreshAgreement();
    toast.success("Signature captured.");
  };

  const handleUnsignContractor = async () => {
    if (!agreementId) return;
    if (!canUnsignContractor) {
      toast.error("You can only unsign if the customer has not signed yet.");
      return;
    }

    setUnsigning(true);
    try {
      if (typeof unsignContractor === "function") {
        await unsignContractor();
      } else {
        const base = `/projects/agreements/${agreementId}/contractor_unsign`;
        const candidates = [`${base}/`, `${base}`];
        let ok = false;
        for (const url of candidates) {
          try {
            await api.post(url);
            ok = true;
            break;
          } catch (err) {
            if (err?.response?.status === 404) continue;
            throw err;
          }
        }
        if (!ok) throw new Error("Unsign endpoint not found on server.");
      }

      toast.success("Contractor signature removed.");
      await refreshAgreement();
    } catch (err) {
      const msg = err?.response?.data?.detail || err?.message || "Unable to unsign contractor.";
      toast.error(msg);
    } finally {
      setUnsigning(false);
    }
  };

  const handleSendHomeownerLink = async () => {
    if (!agreementId) return;
    if (handleGateToast("send the customer signing link")) return;

    setSendingLink(true);
    setSendError(null);
    try {
      await api.post(`/projects/agreements/${agreementId}/send_signature_request/`);
      toast.success("Customer signing link sent.");
      await refreshAgreement();
    } catch (err) {
      const msg = err?.response?.data?.detail || "Unable to send customer signing link.";
      setSendError(msg);
      toast.error(msg);
    } finally {
      setSendingLink(false);
    }
  };

  const handleResendFinalLink = async () => {
    if (!agreementId) return;
    setResendingFinal(true);
    setResendFinalError(null);

    const base = `/projects/agreements/${agreementId}/send_final_agreement_link`;
    const candidates = [`${base}/`, `${base}`];

    try {
      for (const url of candidates) {
        try {
          const { data } = await api.post(url);
          toast.success("Final agreement link sent to customer.");
          if (data?.view_url) {
            try {
              await navigator.clipboard.writeText(data.view_url);
              toast.success("Link copied to clipboard.");
            } catch {}
          }
          setResendingFinal(false);
          return;
        } catch (err) {
          if (err?.response?.status === 404) continue;
          throw err;
        }
      }
      const msg = "Endpoint not found (404). Backend route may not be deployed.";
      setResendFinalError(msg);
      toast.error(msg);
    } catch (err) {
      const msg = err?.response?.data?.detail || err?.message || "Unable to send final agreement link.";
      setResendFinalError(msg);
      toast.error(msg);
    } finally {
      setResendingFinal(false);
    }
  };

  const openPreview = openPreviewModal;

  return (
    <div className="mt-4 space-y-6">
      <Modal
        isOpen={previewOpen}
        onRequestClose={closePreview}
        contentLabel="Agreement PDF Preview"
        overlayClassName="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
        className="bg-white rounded-xl shadow-xl w-full max-w-6xl h-[88vh] outline-none flex flex-col"
      >
        <div className="flex items-center justify-between gap-3 p-3 border-b border-slate-200">
          <div className="text-sm font-semibold text-slate-900">
            Agreement PDF Preview
            {pdfFilename ? (
              <span className="ml-2 text-xs font-normal text-slate-500">{pdfFilename}</span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={downloadPreview}
              disabled={!pdfBlobUrl}
              className="px-3 py-1.5 rounded-md bg-slate-900 text-white text-sm hover:bg-slate-800 disabled:opacity-60"
            >
              Download PDF
            </button>
            <button
              type="button"
              onClick={closePreview}
              className="px-3 py-1.5 rounded-md border border-slate-300 text-sm hover:bg-slate-50"
            >
              Close
            </button>
          </div>
        </div>

        <div className="flex-1 bg-slate-100">
          {previewLoading ? (
            <div className="h-full w-full flex items-center justify-center text-sm text-slate-700">
              Generating preview…
            </div>
          ) : previewErr ? (
            <div className="h-full w-full flex items-center justify-center p-6">
              <div className="max-w-xl w-full bg-white border border-rose-200 rounded-lg p-4">
                <div className="text-sm font-semibold text-rose-700">Preview failed</div>
                <div className="text-sm text-slate-700 mt-2">{previewErr}</div>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={openPreview}
                    className="px-3 py-2 rounded-md bg-indigo-600 text-white text-sm hover:bg-indigo-700"
                  >
                    Retry
                  </button>
                  <button
                    type="button"
                    onClick={closePreview}
                    className="px-3 py-2 rounded-md border border-slate-300 text-sm hover:bg-slate-50"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          ) : pdfBlobUrl ? (
            <iframe title="Agreement PDF" src={pdfBlobUrl} className="w-full h-full" />
          ) : (
            <div className="h-full w-full flex items-center justify-center text-sm text-slate-600">
              No preview loaded.
            </div>
          )}
        </div>
      </Modal>

      {hasInvalidMilestoneAmounts ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="font-semibold">Pricing required</div>
          <div className="mt-1 text-[12px] text-amber-800">
            All milestones must be priced (amount greater than $0) before you can preview,
            sign, send links, or fund escrow.
            {firstInvalidTitle ? <> First missing price: &quot;{firstInvalidTitle}&quot;.</> : null}
          </div>
        </div>
      ) : null}

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Final Review</h3>
            <p className="mt-1 text-sm text-slate-600">
              Confirm the agreement summary, milestone totals, and signature requirements before sending or funding.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={openPreviewModal}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
              disabled={hasInvalidMilestoneAmounts}
            >
              {previewButtonLabel}
            </button>

            <button
              type="button"
              onClick={() => setShowClarificationsModal(true)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Review Scope Clarifications
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <SummaryCard label="Project Title" value={agreement?.project_title || agreement?.title || "Untitled Project"} />
          <SummaryCard label="Agreement ID" value={agreementId ? `#${agreementId}` : "New"} />
          <SummaryCard label="Project Type" value={agreement?.project_type || agreement?.project?.project_type || "—"} />
          <SummaryCard label="Status" value={status} />
        </div>

        <div className="mt-3 grid grid-cols-1 md:grid-cols-5 gap-4">
          <SummaryCard label="Agreement Version" value={amendmentNumber > 0 ? `Amendment ${amendmentNumber}` : "Original Agreement"} />
          <SummaryCard label="PDF Version" value={pdfVersion != null ? `v${pdfVersion}` : "—"} />
          <SummaryCard label="Payment Mode" value={isDirectPay ? "Direct Pay" : "Escrow (Protected)"} />
          <SummaryCard
            label="Payment Structure"
            value={isProgressPayments ? "Progress Payments" : "Simple Payments"}
          />
          <SummaryCard
            label={isProgressPayments ? "Retainage %" : "Escrow Funded?"}
            value={isProgressPayments ? `${retainagePercent.toFixed(2)}%` : isDirectPay ? "N/A" : escrowFunded ? "Yes" : "No"}
          />
          <SummaryCard label="Fully Signed?" value={isFullySigned ? "Yes" : "No"} />
        </div>

        <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-4">
          <SummaryCard label="Customer Name" value={customerNameDisplay} />
          <SummaryCard label="Customer Email" value={homeownerEmail} />
          <SummaryCard label="Customer Phone" value={formatPhone(homeownerPhone)} />
          <SummaryCard label="Dispute Status" value={formatDisputeSummary(agreement, displayMilestones)} />
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-900">Payment Mode</div>
              <div className="mt-1 text-sm text-slate-600">
                Confirm whether this agreement should use protected escrow or direct invoice payments now that pricing and milestones are set.
              </div>
            </div>
            <span className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
              Final review
            </span>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <button
              type="button"
              onClick={() => handlePaymentModeSelect("escrow")}
              disabled={paymentModeSaving}
              className={`rounded-xl border px-4 py-3 text-left transition ${
                !isDirectPay
                  ? "border-indigo-300 bg-indigo-50"
                  : "border-slate-200 bg-white hover:bg-slate-50"
              } disabled:opacity-60`}
            >
              <div className="font-semibold text-slate-900">Escrow (Protected)</div>
              <div className="mt-1 text-sm text-slate-600">
                Funds are held until milestones are approved, with dispute protection built in.
              </div>
            </button>

            <button
              type="button"
              onClick={() => handlePaymentModeSelect("direct")}
              disabled={paymentModeSaving}
              className={`rounded-xl border px-4 py-3 text-left transition ${
                isDirectPay
                  ? "border-indigo-300 bg-indigo-50"
                  : "border-slate-200 bg-white hover:bg-slate-50"
              } disabled:opacity-60`}
            >
              <div className="font-semibold text-slate-900">Direct Pay</div>
              <div className="mt-1 text-sm text-slate-600">
                Customers pay invoices directly through Stripe payment links as the job progresses.
              </div>
            </button>
          </div>
        </div>

      </div>

      <section
        className={`rounded-2xl border px-5 py-5 shadow-sm ${
          readinessWarningCount === 0
            ? "border-emerald-200 bg-emerald-50/70"
            : "border-amber-200 bg-amber-50/60"
        }`}
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">
              {readinessWarningCount === 0 ? "Ready to send" : "Ready for review"}
            </h3>
            <p className="mt-1 text-sm text-slate-700">
              {readinessWarningCount === 0
                ? "Everything important is in place for a confident final review."
                : "A few final checks will help this agreement go out cleanly."}
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide ${
              readinessWarningCount === 0
                ? "border border-emerald-200 bg-white text-emerald-700"
                : "border border-amber-200 bg-white text-amber-800"
            }`}
          >
            {readinessWarningCount === 0
              ? "Send-ready"
              : `${readinessWarningCount} final check${readinessWarningCount === 1 ? "" : "s"}`}
          </span>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {readinessItems.map((item) => (
            <div
              key={item.key}
              className={`rounded-xl border px-4 py-3 text-sm ${
                item.ok
                  ? "border-emerald-200 bg-white text-emerald-900"
                  : "border-amber-200 bg-white text-amber-900"
              }`}
            >
              <div className="font-medium">{item.ok ? "✓" : "⚠"} {item.ok ? item.goodLabel : item.warnLabel}</div>
            </div>
          ))}
        </div>

        {postSendGuidance ? (
          <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
            <div className="font-semibold">What happens next</div>
            <div className="mt-1 text-sm text-sky-800">{postSendGuidance}</div>
          </div>
        ) : null}
      </section>

      {projectContextSummary.hasAny ? (
        <details className="rounded-2xl border border-slate-200 bg-white shadow-sm" open={false}>
          <summary className="cursor-pointer list-none px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-gray-900">Project Context</h3>
                <div className="mt-1 text-sm text-slate-600">
                  Reference details used to shape pricing, milestones, and template guidance.
                </div>
              </div>
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Expand
              </span>
            </div>
          </summary>
          <div className="border-t border-slate-200 px-5 py-4">
          <div className="flex flex-wrap gap-2 text-xs">
            {projectContextSummary.projectType ? (
              <span className="rounded-full bg-slate-100 px-2 py-1 font-medium text-slate-700">
                Type: {projectContextSummary.projectType}
              </span>
            ) : null}
            {projectContextSummary.projectSubtype ? (
              <span className="rounded-full bg-slate-100 px-2 py-1 font-medium text-slate-700">
                Subtype: {projectContextSummary.projectSubtype}
              </span>
            ) : null}
            {projectContextSummary.templateName ? (
              <span className="rounded-full bg-indigo-50 px-2 py-1 font-medium text-indigo-700">
                Template: {projectContextSummary.templateName}
              </span>
            ) : null}
            {projectContextSummary.materialsResponsibility ? (
              <span className="rounded-full bg-slate-100 px-2 py-1 font-medium text-slate-700">
                Materials: {projectContextSummary.materialsResponsibility}
              </span>
            ) : null}
            {projectContextSummary.quantitySignals.map((signal) => (
              <span
                key={`${signal.label}:${signal.value}`}
                className="rounded-full bg-slate-100 px-2 py-1 font-medium text-slate-700"
              >
                {signal.label}: {signal.value}
              </span>
            ))}
          </div>
          {projectContextSummary.scopeSummary ? (
            <div className="mt-2 text-xs text-slate-600">
              Scope: {projectContextSummary.scopeSummary}
            </div>
          ) : null}
          </div>
        </details>
      ) : null}

      <details className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <summary className="cursor-pointer list-none px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-gray-900">Addresses</h3>
              <div className="mt-1 text-sm text-slate-600">
                Customer and project addresses used on the agreement and PDF.
              </div>
            </div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Expand
            </span>
          </div>
        </summary>
        <div className="grid grid-cols-1 gap-4 border-t border-slate-200 px-5 py-4 md:grid-cols-2">
          <div>
            <h4 className="mb-1 text-sm font-semibold text-gray-800">Customer Address</h4>
            <div className="whitespace-pre-wrap text-sm text-gray-800">{homeownerAddressDisplay}</div>
          </div>
          <div>
            <h4 className="mb-1 text-sm font-semibold text-gray-800">Project Address</h4>
            <div className="whitespace-pre-wrap text-sm text-gray-800">{projectAddressDisplay}</div>
          </div>
        </div>
      </details>

      <details className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <summary className="cursor-pointer list-none px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-gray-900">Scope Clarifications</h3>
              <div className="mt-1 text-sm text-slate-600">
                Review the saved answers from Step 2 before you finalize the agreement.
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-700">
                {clarificationRows.length} total
              </span>
              {recommendedClarificationCount > 0 ? (
                <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-800">
                  {recommendedClarificationCount} recommended
                </span>
              ) : null}
              {unansweredClarificationCount > 0 ? (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-800">
                  {unansweredClarificationCount} unanswered
                </span>
              ) : null}
            </div>
          </div>
        </summary>

        <div className="border-t border-slate-200 px-5 py-4">
        {clarificationRows.length ? (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={showAllClarifications}
                  onChange={(e) => setShowAllClarifications(e.target.checked)}
                />
                Show unanswered clarifications
              </label>

              <button
                type="button"
                onClick={() => setShowClarificationsModal(true)}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Edit Clarifications
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              {visibleClarificationRows.length ? (
                visibleClarificationRows.map((row) => (
                  <div key={row.key} className="rounded border border-slate-200 bg-slate-50 p-3">
                    <div className="flex flex-wrap items-start gap-2">
                      <div className="text-sm font-semibold text-slate-900">{row.label}</div>

                      {row.required ? (
                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-800 border border-blue-200">
                          Recommended
                        </span>
                      ) : (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                          Optional
                        </span>
                      )}

                      {!row.answered ? (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800 border border-amber-200">
                          Unanswered
                        </span>
                      ) : null}
                    </div>

                    {row.help ? (
                      <div className="mt-1 text-[11px] text-slate-500">{row.help}</div>
                    ) : null}

                    <div className="mt-2 rounded border bg-white px-3 py-2 text-sm text-slate-800 whitespace-pre-wrap break-words">
                      {row.displayValue}
                    </div>

                    {Array.isArray(row.options) && row.options.length ? (
                      <div className="mt-2 text-[11px] text-slate-500">
                        Options: {row.options.join(", ")}
                      </div>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="md:col-span-2 rounded border border-dashed border-slate-300 bg-white px-4 py-4 text-sm text-slate-500">
                  No answered clarifications yet. Turn on “Show unanswered clarifications” or click “Edit Clarifications.”
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="mt-3 rounded border border-dashed border-slate-300 bg-white px-4 py-4 text-sm text-slate-500">
            No scope clarifications have been saved yet.
          </div>
        )}
        </div>
      </details>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-gray-900">Milestone Summary</h3>
          <div className="text-sm text-slate-600">
            Total: <span className="font-semibold text-slate-900">{formatMoney(projectAmount)}</span>
          </div>
        </div>

        {Array.isArray(displayMilestones) && displayMilestones.length > 0 ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm border border-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left p-2 border-b border-slate-200 w-[64px]">#</th>
                  <th className="text-left p-2 border-b border-slate-200">Milestone</th>
                  <th className="text-left p-2 border-b border-slate-200 w-[140px]">Start Date</th>
                  <th className="text-left p-2 border-b border-slate-200 w-[140px]">Due Date</th>
                  <th className="text-right p-2 border-b border-slate-200 w-[140px]">Milestone Amount</th>
                </tr>
              </thead>
              <tbody>
                {displayMilestones.map((m, idx) => (
                  <tr key={m?.id || `m-${idx}`} className="hover:bg-slate-50">
                    <td className="p-2 border-b border-slate-200">{idx + 1}</td>
                    <td className="p-2 border-b border-slate-200">
                      <div className="font-medium text-slate-900">{m?.title || `Milestone ${idx + 1}`}</div>
                      {m?.description ? (
                        <div className="text-xs text-slate-500 mt-0.5 whitespace-pre-wrap">{m.description}</div>
                      ) : null}
                      {(() => {
                        const advisory = milestoneAdvisoryPricingMeta(m);
                        if (!advisory.hasAny) return null;
                        return (
                          <div className="mt-2 space-y-1 text-[11px] text-slate-600">
                            <div className="font-semibold uppercase tracking-wide text-[10px] text-slate-500">
                              Estimate guidance
                            </div>
                            {advisory.laborLine ? <div>{advisory.laborLine}</div> : null}
                            {advisory.materialsLine ? <div>{advisory.materialsLine}</div> : null}
                            {advisory.materialsHint ? <div>{advisory.materialsHint}</div> : null}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="p-2 border-b border-slate-200">{formatMilestoneStartDate(m)}</td>
                    <td className="p-2 border-b border-slate-200">{formatMilestoneDate(m)}</td>
                    <td className="p-2 border-b border-slate-200 text-right tabular-nums">
                      <div className="font-semibold text-slate-900">{formatMoney(m?.amount || 0)}</div>
                      <div className="text-[11px] text-slate-500">Milestone amount</div>
                    </td>
                  </tr>
                ))}

                <tr className="bg-slate-50 font-semibold">
                  <td className="p-2 border-t border-slate-200" colSpan={4}>
                    Totals
                  </td>
                  <td className="p-2 border-t border-slate-200 text-right tabular-nums">
                    {formatMoney(projectAmount)}
                  </td>
                </tr>
              </tbody>
            </table>

            <div className="mt-2 text-[11px] text-slate-500">
              Estimated schedule; dates may change. Materials listed are estimated project context and may change.
            </div>
          </div>
        ) : (
          <div className="mt-3 text-sm text-slate-500">No milestones defined.</div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Totals &amp; Fees</h3>

        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.9fr)] gap-4 text-sm">
          <div
            className="rounded-xl border border-slate-200 bg-white p-4"
            data-testid="step4-financial-summary"
          >
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                Estimated Contractor Earnings
              </div>
              <div
                className="mt-1 text-3xl font-bold tracking-tight text-emerald-900 tabular-nums"
                data-testid="financial-summary-net"
              >
                {formatMoney(estimatedContractorNet)}
              </div>
              <div className="mt-1 text-xs text-emerald-800">
                Project total minus platform fees, estimated Stripe processing, and any subcontractor payouts.
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {summaryBreakdownRows.map((row) => (
                <div
                  key={row.key}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                  data-testid={`financial-row-${row.key}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-slate-900">{row.label}</div>
                      {row.help ? <div className="mt-0.5 text-[11px] text-slate-500">{row.help}</div> : null}
                    </div>
                    <div
                      className={`font-semibold tabular-nums ${
                        row.tone === "deduction" ? "text-slate-700" : "text-slate-900"
                      }`}
                    >
                      {row.value}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded border bg-slate-50 p-3 text-[12px] text-slate-700">
            <div className="font-semibold mb-1">
              {isProgressPayments ? "Progress Payments" : isDirectPay ? "Direct Pay" : "Escrow (Protected)"}
            </div>
            {isProgressPayments ? (
              <>
                <div>Payments will be handled via draw requests after signing.</div>
                <div className="mt-3 rounded border border-slate-200 bg-white px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">
                    Progress-payment context
                  </div>
                  <div className="mt-1 text-sm font-semibold text-slate-900 tabular-nums">
                    Retainage set to {retainagePercent.toFixed(2)}% until draws are approved and paid.
                  </div>
                </div>
              </>
            ) : isDirectPay ? (
              <>
                <div>Customer pays invoices via Stripe links. No escrow deposit is required.</div>
                <div className="mt-3 rounded border border-slate-200 bg-white px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">
                    Payment context
                  </div>
                  <div className="mt-1 text-sm font-semibold text-slate-900 tabular-nums">
                    Customer pays as invoices are sent and approved.
                  </div>
                </div>
              </>
            ) : (
              <>
                <div>Funds are held until milestones are approved. Disputes can freeze funds until resolved.</div>
                <div
                  className="mt-3 rounded border border-indigo-200 bg-indigo-50 px-3 py-2"
                  data-testid="financial-row-escrow-deposit"
                >
                  <div className="text-[11px] uppercase tracking-wide text-indigo-700">
                    Total Escrow Deposit
                  </div>
                  <div className="mt-1 text-lg font-semibold text-indigo-900 tabular-nums">
                    {formatMoney(homeownerEscrow)}
                  </div>
                  {fundingError ? <div className="mt-1 text-[11px] text-amber-700">{fundingError}</div> : null}
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          {isProgressPayments ? "Signatures & Progress Payments" : isDirectPay ? "Signatures & Payment" : "Signatures & Escrow"}
        </h3>

        <div className="mb-4 rounded border bg-slate-50 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">Signature Requirements</div>
              <div className="text-[11px] text-slate-600 mt-0.5">
                Use waivers for warranty work, subcontracted jobs (big box stores), or situations where signatures are not obtainable.
              </div>
            </div>
            {requirementsLocked ? <div className="text-[11px] font-semibold text-amber-700">Locked</div> : null}
          </div>

          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            <label className={`flex items-center gap-2 ${requirementsLocked ? "opacity-60" : ""}`}>
              <input
                type="checkbox"
                checked={!!reqContr}
                disabled={requirementsLocked}
                onChange={(e) => handleToggleRequirement("require_contractor_signature", e.target.checked)}
              />
              <span>Require Contractor Signature</span>
            </label>

            <label className={`flex items-center gap-2 ${requirementsLocked ? "opacity-60" : ""}`}>
              <input
                type="checkbox"
                checked={!!reqCust}
                disabled={requirementsLocked}
                onChange={(e) => handleToggleRequirement("require_customer_signature", e.target.checked)}
              />
              <span>Require Customer Signature</span>
            </label>
          </div>

          <div className="mt-2 text-[11px] text-slate-600">
            If unchecked, that party is treated as <b>Waived</b> in execution logic and PDF signatures.
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-800">Contractor Signature</div>
              {signedByContractor ? (
                <span className="text-xs font-semibold text-emerald-700">Signed ✅</span>
              ) : reqContr ? (
                <span className="text-xs font-semibold text-slate-500">Not signed</span>
              ) : (
                <span className="text-xs font-semibold text-slate-500">Waived</span>
              )}
            </div>

            {signedByContractor ? (
              <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                <div className="font-semibold">{agreement?.contractor_signature_name || typedName || "Contractor"}</div>
                <div className="mt-1">{contractorSignedAt ? <>Signed: {String(contractorSignedAt)}</> : "Signed: —"}</div>
                <div className="mt-1">{contractorSignedIp ? <>IP: {contractorSignedIp}</> : null}</div>

                {canUnsignContractor ? (
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={handleUnsignContractor}
                      disabled={unsigning}
                      className="rounded border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                      title="Allowed only if the customer has not signed yet."
                    >
                      {unsigning ? "Removing…" : "Unsign Contractor"}
                    </button>
                    <div className="mt-1 text-[11px] text-emerald-900/80">
                      Unsign is allowed only while the customer has not signed yet.
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 text-[11px] text-emerald-900/80">
                    Unsign is disabled once the customer has signed.
                  </div>
                )}
              </div>
            ) : reqContr ? (
              <>
                <div className="space-y-2 mt-2">
                  <label className="block text-xs font-semibold text-gray-700">Type Your Full Legal Name</label>
                  <input
                    type="text"
                    className="w-full rounded border px-3 py-2 text-sm"
                    value={typedName}
                    onChange={(e) => setTypedName(e.target.value)}
                    placeholder="e.g. Jane Contractor"
                  />
                  <div className="text-[11px] text-gray-500">
                    Legal acknowledgements (reviewed, Terms, Privacy, e-sign consent) are confirmed in the signing modal.
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleOpenContractorModal}
                  disabled={signing || hasInvalidMilestoneAmounts}
                  className="mt-3 rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
                >
                  {signing ? "Signing…" : "Sign & Continue"}
                </button>
              </>
            ) : (
              <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                <div className="font-semibold">Waived</div>
                <div className="mt-1">Contractor signature is not required for this agreement.</div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-800">Customer Signature</div>
              {signedByHomeowner ? (
                <span className="text-xs font-semibold text-emerald-700">Signed ✅</span>
              ) : reqCust ? (
                <span className="text-xs font-semibold text-slate-500">Not signed</span>
              ) : (
                <span className="text-xs font-semibold text-slate-500">Waived</span>
              )}
            </div>

            {signedByHomeowner ? (
              <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                <div className="font-semibold">{agreement?.homeowner_signature_name || homeownerName || "Customer"}</div>
                <div className="mt-1">{homeownerSignedAt ? <>Signed: {String(homeownerSignedAt)}</> : "Signed: —"}</div>
                <div className="mt-1">{homeownerSignedIp ? <>IP: {homeownerSignedIp}</> : null}</div>
              </div>
            ) : reqCust ? (
              <>
                <button
                  type="button"
                  onClick={handleSendHomeownerLink}
                  disabled={sendingLink || hasInvalidMilestoneAmounts}
                  className="mt-2 rounded bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {sendingLink ? "Sending link…" : "Send to Customer"}
                </button>
                {sendError ? <div className="mt-1 text-[11px] text-red-600">{sendError}</div> : null}
              </>
            ) : (
              <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                <div className="font-semibold">Waived</div>
                <div className="mt-1">Customer signature is not required for this agreement.</div>
              </div>
            )}

            {isProgressPayments ? (
              <div className="mt-4 rounded border border-indigo-200 bg-indigo-50 px-3 py-3 text-[11px] text-indigo-900">
                Payments will be handled via draw requests after signing. External payment records can be added from
                the agreement detail page when funds are received outside the app.
              </div>
            ) : !isDirectPay ? (
              <div className="mt-4 border-t pt-2">
                <div className="text-xs text-gray-700 mb-1">Escrow Funding</div>

                {hasInvalidMilestoneAmounts ? (
                  <div className="text-[11px] text-amber-700">
                    Escrow funding is disabled until all milestone amounts are greater than $0.
                  </div>
                ) : isFullySigned ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <SummaryCard label="Escrow Total Required" value={formatMoney(homeownerEscrow)} />
                      <SummaryCard label="Escrow Funded So Far" value={formatMoney(fundedSoFar)} />
                      <SummaryCard label="Remaining to Fund" value={formatMoney(remainingToFund)} />
                    </div>

                    {remainingToFund > 0 ? (
                      <SendFundingLinkButton
                        agreementId={agreementId}
                        isFullySigned={isFullySigned}
                        amount={remainingToFund}
                        disabled={!isFullySigned}
                        variant="success"
                        label={`Send Escrow Funding Link (${formatMoney(remainingToFund)})`}
                      />
                    ) : (
                      <div className="text-[11px] text-green-700">
                        Escrow appears fully funded. No additional deposit is required.
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-[11px] text-gray-500">
                    Escrow funding becomes available once required signatures are satisfied.
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-4 text-[11px] text-gray-600">
                Direct Pay: invoices are paid via Stripe links. No escrow deposit required.
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="flex flex-wrap gap-3 justify-between pt-4 border-t border-gray-200">
        <button
          type="button"
          onClick={goBack}
          className="rounded bg-white border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Back
        </button>

        <div className="flex gap-3">
          {isFullySigned ? (
            <button
              type="button"
              onClick={handleResendFinalLink}
              disabled={resendingFinal}
              className="rounded bg-white border border-emerald-300 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
            >
              {resendingFinal ? "Sending…" : "Resend Final Agreement Link"}
            </button>
          ) : null}
        </div>
      </div>

      {resendFinalError ? <div className="text-[12px] text-red-600">{resendFinalError}</div> : null}

      {agreement && reqContr ? (
        <SignatureModal
          isOpen={showSignatureModal}
          onClose={() => setShowSignatureModal(false)}
          agreement={agreement}
          signingRole="contractor"
          defaultName={typedName}
          compact={true}
          onSigned={(data) => handleContractorSigned(data)}
        />
      ) : null}

      <ClarificationsModal
        open={showClarificationsModal}
        agreementId={agreementId}
        initialAgreement={agreement}
        excludeKeys={[]}
        onClose={() => setShowClarificationsModal(false)}
        onSaved={async (updated) => {
          if (updated) {
            setAgreementAndSync((prev) => mergeAgreement(prev, updated, agreementId));
          }
          toast.success("Clarifications saved.");
          await refreshAgreement();
          setShowClarificationsModal(false);
        }}
      />
    </div>
  );
}
