// frontend/src/pages/AgreementList.jsx
// v2026-03-03 — ✅ UI wording: Homeowner → Customer
// - Column header renamed
// - Signature badge label renamed
// - Search placeholder wording updated
//
// v2026-03-02 — ✅ Agreement list reflects Direct Pay + Waived signatures
// - Escrow column shows "Direct Pay" when payment_mode === "direct"
// - Signatures column shows "Waived" when require_*_signature === false
// - Keeps existing lifecycle UX: mark complete, archive/unarchive, merge, amend, delete draft
//
// v2026-03-02b — ✅ PDF version column:
// - Shows Agreement.pdf_version
// - Shows "History" badge if pdf_versions_count > 1 (or >0 if your backend counts historical rows)
// - Quick Open/Download for current_pdf_url (credentialed fetch)
//
// v2026-03-02c — ✅ FIX: clicking PDF chip / History does NOT route to Step 4
// - v# opens current PDF in a new tab
// - History opens a dropdown that fetches versions from Agreement detail endpoint
// - Open/Download per historical version
// - Closes on outside click / Esc

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import { normalizeProjectClass } from "../utils/projectClass.js";
import { ProjectModeBadge, normalizeProjectModeFilter, normalizeProjectMode, PROJECT_MODE_OPTIONS } from "../components/projectMode.jsx";
import {
  CheckCircle2,
  XCircle,
  RefreshCw,
  Plus,
  Layers,
  Pencil,
  Trash2,
  Star,
  Eye,
  Archive,
  Check,
  Undo2,
  Landmark,
  Zap,
  MinusCircle,
  FileText,
  Download,
  ExternalLink,
  MoreHorizontal,
} from "lucide-react";
import ContractorPageSurface from "../components/dashboard/ContractorPageSurface.jsx";

const fmtMoney = (n) => {
  if (n === null || n === undefined || n === "") return "—";
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n);
  return num.toLocaleString(undefined, { style: "currency", currency: "USD" });
};

const fmtDate = (s) => {
  if (!s) return "—";
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toISOString().slice(0, 10);
  } catch {
    return "—";
  }
};

const fmtDateTime = (s) => {
  if (!s) return "—";
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return String(s);
    return d.toLocaleString();
  } catch {
    return String(s);
  }
};

const labelFromHomeownerObj = (h) => {
  if (!h || typeof h !== "object") return "";
  const first = h.first_name || h.firstName || "";
  const last = h.last_name || h.lastName || "";
  const fullFromParts = [first, last].filter(Boolean).join(" ").trim();
  return h.full_name || h.name || fullFromParts || h.email || h.username || "";
};

const safeLower = (v) => String(v || "").trim().toLowerCase();

const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const boolish = (v, defaultValue = true) => {
  if (v === true) return true;
  if (v === false) return false;
  if (v === 1 || v === "1" || v === "true" || v === "True" || v === "yes" || v === "on")
    return true;
  if (v === 0 || v === "0" || v === "false" || v === "False" || v === "no" || v === "off")
    return false;
  return defaultValue;
};

const getPaymentMode = (r) => {
  const s = safeLower(r?.payment_mode || r?.paymentMode || "");
  if (s.includes("direct")) return "direct";
  return "escrow";
};

const getPaymentProtectionLevel = (r) => {
  const raw = safeLower(r?.payment_protection?.level || r?.payment_protection?.label || r?.paymentProtection?.level || r?.paymentProtection?.label || "");
  if (raw.includes("required")) return "required";
  if (raw.includes("recommended")) return "recommended";
  if (raw.includes("preferred")) return "preferred";
  return getPaymentMode(r) === "direct" ? "direct" : "preferred";
};

const parseDateAny = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const startOfToday = () => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
};

const endOfToday = () => {
  const date = new Date();
  date.setHours(23, 59, 59, 999);
  return date;
};

const startOfTomorrow = () => {
  const date = startOfToday();
  date.setDate(date.getDate() + 1);
  return date;
};

const endOfTomorrow = () => {
  const date = endOfToday();
  date.setDate(date.getDate() + 1);
  return date;
};

const endOfWeek = () => {
  const date = endOfToday();
  date.setDate(date.getDate() + 6);
  return date;
};

const inRange = (dateObj, from, to) => {
  if (!dateObj) return false;
  const time = dateObj.getTime();
  if (from && time < from.getTime()) return false;
  if (to && time > to.getTime()) return false;
  return true;
};

const agreementDueDate = (row) =>
  parseDateAny(
    row?.earliest_due_date ||
      row?.next_due_date ||
      row?.milestone_due_date ||
      row?.milestoneDueDate ||
      row?.due_date ||
      row?.dueDate ||
      row?.end ||
      row?.end_date ||
      row?.start
  );

const numberish = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const rowIsAwaitingSignature = (row) => {
  const status = safeLower(row?.status);
  const signatureSatisfied =
    typeof row?.signature_is_satisfied !== "undefined" ? !!row.signature_is_satisfied : null;
  const fullySigned = typeof row?.is_fully_signed !== "undefined" ? !!row.is_fully_signed : null;

  if (signatureSatisfied !== null || fullySigned !== null) {
    return !signatureSatisfied && !fullySigned && status !== "signed";
  }

  const requireContractor = boolish(row?.require_contractor_signature, true);
  const requireCustomer = boolish(row?.require_customer_signature, true);
  const contractorSigned =
    !!(
      row?.signed_by_contractor ||
      row?.contractor_signed ||
      row?.contractor_signature_name ||
      row?.signed_at_contractor ||
      row?.contractor_signed_at
    );
  const customerSigned =
    !!(
      row?.signed_by_homeowner ||
      row?.homeowner_signed ||
      row?.homeowner_signature_name ||
      row?.signed_at_homeowner ||
      row?.homeowner_signed_at
    );

  return (!requireContractor || contractorSigned ? 1 : 0) + (!requireCustomer || customerSigned ? 1 : 0) < 2 && status !== "signed";
};

const rowIsAwaitingFunding = (row) => {
  const status = safeLower(row?.status);
  return (
    getPaymentMode(row) !== "direct" &&
    (row?.signature_is_satisfied || row?.is_fully_signed || status === "signed") &&
    !row?.escrow_funded
  );
};

const rowHasPendingApproval = (row) => {
  const status = safeLower(row?.status);
  const candidates = [
    row?.pending_approval_count,
    row?.invoices_pending_approval_count,
    row?.pending_invoices_count,
    row?.awaiting_approval_count,
    row?.milestones_awaiting_review_count,
    row?.pending_review_count,
    row?.submitted_milestones_count,
  ];

  return (
    ["pending_approval", "awaiting_approval", "approval_pending", "pending_review", "in_review", "review", "submitted"].includes(status) ||
    candidates.some((value) => numberish(value) > 0)
  );
};

const rowHasDispute = (row) => {
  const status = safeLower(row?.status);
  const disputeStatus = safeLower(
    row?.dispute_status ||
      row?.dispute_state ||
      row?.latest_dispute_status ||
      row?.open_dispute_status
  );
  const candidates = [
    row?.disputed_invoice_count,
    row?.invoices_disputed_count,
    row?.dispute_count,
    row?.open_disputes,
    row?.disputes_open,
  ];

  return (
    status.includes("dispute") ||
    disputeStatus.includes("dispute") ||
    candidates.some((value) => numberish(value) > 0)
  );
};

const rowIsScheduleClosed = (row) => {
  const status = safeLower(row?.status);

  if (
    [
      "completed",
      "complete",
      "approved",
      "paid",
      "earned",
      "released",
      "cancelled",
      "archived",
    ].includes(status)
  ) {
    return true;
  }

  return (
    boolish(row?.approved, false) ||
    boolish(row?.is_complete, false) ||
    boolish(row?.is_completed, false) ||
    boolish(row?.completed, false) ||
    !!(row?.completed_at || row?.completed_on || row?.completed_date)
  );
};

function statusPillClass(status) {
  const s = safeLower(status);
  if (s === "draft") return "border border-slate-300/30 bg-slate-400/15 text-slate-100";
  if (s === "signed") return "border border-amber-300/50 bg-amber-400/15 text-amber-100";
  if (s === "funded") return "border border-blue-300/50 bg-blue-400/15 text-blue-100";
  if (s === "in_progress") return "border border-sky-300/50 bg-sky-400/15 text-sky-100";
  if (s === "completed") return "border border-emerald-300/50 bg-emerald-400/15 text-emerald-100";
  if (s === "cancelled") return "border border-rose-300/50 bg-rose-400/15 text-rose-100";
  return "border border-slate-300/30 bg-slate-400/15 text-slate-100";
}

function prettyStatus(status) {
  const s = String(status || "").trim();
  if (!s) return "—";
  return s.replaceAll("_", " ");
}

const pick = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== "") ?? "";

function projectClassLabel(value) {
  return normalizeProjectClass(value) === "commercial" ? "Commercial" : "Residential";
}

function normalizeProjectClassFilter(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "commercial" || normalized === "residential" ? normalized : "all";
}

function absUrl(url) {
  if (!url) return "";
  const s = String(url);
  if (s.startsWith("http")) return s;
  return `${window.location.origin}${s.startsWith("/") ? "" : "/"}${s}`;
}

async function downloadWithCredentials(url, filename) {
  if (!url) throw new Error("Missing URL");
  const u = absUrl(url);
  const res = await fetch(u, { credentials: "include" });
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
  window.open(absUrl(url), "_blank", "noopener,noreferrer");
}

function shortSha(s) {
  const v = String(s || "").trim();
  if (!v) return "—";
  return v.length > 10 ? `${v.slice(0, 10)}…` : v;
}

const AGREEMENT_LIST_CACHE_TTL_MS = 15000;
const MILESTONE_STATS_CACHE_TTL_MS = 15000;
const sharedAgreementListLoad = { key: null, promise: null };
const sharedAgreementListCache = new Map();
const sharedMilestoneStatsPromises = new Map();
const sharedMilestoneStatsCache = new Map();

function getFreshCachedAgreementList(key) {
  const hit = sharedAgreementListCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > AGREEMENT_LIST_CACHE_TTL_MS) {
    sharedAgreementListCache.delete(key);
    return null;
  }
  return hit.data;
}

function setCachedAgreementList(key, data) {
  sharedAgreementListCache.set(key, { ts: Date.now(), data });
}

function normalizeAgreementListResponse(data, fallbackPage = 1, fallbackPageSize = 10) {
  const isPaginated = data && !Array.isArray(data) && Array.isArray(data.results);
  const list = isPaginated ? data.results : Array.isArray(data) ? data : [];
  const count = isPaginated ? Number(data.count ?? list.length) : list.length;
  const pageSize = Math.max(1, Number(fallbackPageSize) || list.length || 1);
  const totalPages = Math.max(1, Math.ceil(count / pageSize));
  const page = Math.min(Math.max(1, Number(fallbackPage) || 1), totalPages);

  return {
    list,
    pagination: {
      isPaginated,
      count,
      page,
      pageSize,
      totalPages,
      hasNext: isPaginated ? Boolean(data.next) : page < totalPages,
      hasPrevious: isPaginated ? Boolean(data.previous) : page > 1,
    },
  };
}

function getFreshCachedMilestoneStats(agreementId) {
  const hit = sharedMilestoneStatsCache.get(agreementId);
  if (!hit) return null;
  if (Date.now() - hit.ts > MILESTONE_STATS_CACHE_TTL_MS) {
    sharedMilestoneStatsCache.delete(agreementId);
    return null;
  }
  return hit.data;
}

function setCachedMilestoneStats(agreementId, data) {
  sharedMilestoneStatsCache.set(agreementId, { ts: Date.now(), data });
}

async function fetchAgreementListData({
  showArchived,
  pageNumber = 1,
  pageSize = 10,
  search = "",
  statusFilter = "all",
  projectClassFilter = "all",
  projectModeFilter = "all",
  paymentModeFilter = "all",
  routeFocus = "",
  routeFilter = "",
  routeRange = "",
  statusParam = "",
} = {}) {
  const { data } = await api.get("/projects/agreements/", {
    params: {
      page: pageNumber,
      page_size: pageSize,
      include_archived: showArchived ? 1 : 0,
      search: search || undefined,
      project_class: projectClassFilter && projectClassFilter !== "all" ? projectClassFilter : undefined,
      project_mode: projectModeFilter && projectModeFilter !== "all" ? projectModeFilter : undefined,
      payment_mode: paymentModeFilter && paymentModeFilter !== "all" ? paymentModeFilter : undefined,
      focus: routeFocus || undefined,
      filter: routeFilter || undefined,
      range: routeRange || undefined,
      status: statusFilter && statusFilter !== "all"
        ? statusFilter
        : statusParam && !["awaiting_signature", "funding_needed"].includes(statusParam)
        ? statusParam
        : undefined,
      _ts: Date.now(),
    },
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
  });

  const normalized = normalizeAgreementListResponse(data, pageNumber, pageSize);
  const index = {};
  const mergeIntoIndex = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const h of arr) {
      const id = String(h.id ?? h.pk ?? "");
      if (!id) continue;
      const name = labelFromHomeownerObj(h);
      const email = h.email || h.username || "";
      index[id] = { name: name || email || "", email: email || "", raw: h };
    }
  };

  try {
    const { data: h1 } = await api.get("/projects/homeowners/", { params: { page_size: 1000 } });
    mergeIntoIndex(h1?.results || h1);
  } catch {
    /* ignore */
  }

  return { list: normalized.list, index, pagination: normalized.pagination };
}

function fetchMilestoneStats(agreementId, isMsComplete) {
  const cached = getFreshCachedMilestoneStats(agreementId);
  if (cached) {
    return Promise.resolve(cached);
  }

  if (sharedMilestoneStatsPromises.has(agreementId)) {
    return sharedMilestoneStatsPromises.get(agreementId);
  }

  const promise = api
    .get(`/projects/agreements/${agreementId}/milestones/`, {
      params: { _ts: Date.now() },
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    })
    .then(({ data }) => {
      const list = Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : [];
      const total = list.length;
      const complete = list.filter(isMsComplete).length;
      const percent = total > 0 ? Math.round((complete / total) * 100) : 0;
      const stats = { total, complete, percent };
      setCachedMilestoneStats(agreementId, stats);
      return stats;
    })
    .finally(() => {
      sharedMilestoneStatsPromises.delete(agreementId);
    });

  sharedMilestoneStatsPromises.set(agreementId, promise);
  return promise;
}

export default function AgreementList() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const routeFocus = params.get("focus") || "";
  const routeFilter = params.get("filter") || "";
  const routeRange = params.get("range") || "";
  const statusParam = params.get("status") || "";
  const projectClassFilter = normalizeProjectClassFilter(params.get("project_class"));
  const projectModeFilter = normalizeProjectModeFilter(params.get("project_mode"));
  const paymentModeFilter = safeLower(params.get("payment_mode")) || "all";
  const paymentProtectionFilter = safeLower(params.get("payment_protection")) || "all";
  const activeRouteFilter = useMemo(() => {
    if (routeFocus === "needs_attention") {
      if (routeFilter === "awaiting_signature") {
        return { kind: "needs_attention", value: routeFilter, label: "Awaiting Signature" };
      }
      if (routeFilter === "awaiting_funding") {
        return { kind: "needs_attention", value: routeFilter, label: "Awaiting Funding" };
      }
      if (routeFilter === "pending_approval") {
        return { kind: "needs_attention", value: routeFilter, label: "Pending Approval" };
      }
      if (routeFilter === "disputed") {
        return { kind: "needs_attention", value: routeFilter, label: "Disputed" };
      }
    }

    if (routeFocus === "schedule") {
      if (routeRange === "late") return { kind: "schedule", value: routeRange, label: "Past Due / Late" };
      if (routeRange === "today") return { kind: "schedule", value: routeRange, label: "Due Today" };
      if (routeRange === "tomorrow") return { kind: "schedule", value: routeRange, label: "Due Tomorrow" };
      if (routeRange === "week") return { kind: "schedule", value: routeRange, label: "This Week" };
    }

    if (routeFocus === "draft") {
      return { kind: "active_workflow", value: "draft", label: "Draft Agreements" };
    }

    if (statusParam === "awaiting_signature") {
      return { kind: "legacy_status", value: statusParam, label: "Awaiting Signature" };
    }
    if (statusParam === "funding_needed") {
      return { kind: "legacy_status", value: statusParam, label: "Funding Needed" };
    }

    return null;
  }, [routeFilter, routeFocus, routeRange, statusParam]);

  // ✅ Base route for contractor vs employee console
  const BASE = useMemo(() => {
    const p = location.pathname || "";
    return p.startsWith("/app/employee") ? "/app/employee" : "/app";
  }, [location.pathname]);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const [selected, setSelected] = useState(() => new Set());
  const [primaryId, setPrimaryId] = useState(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [pageSize, setPageSize] = useState(10);
  const [pageNumber, setPageNumber] = useState(1);
  const [pagination, setPagination] = useState({
    isPaginated: false,
    count: 0,
    page: 1,
    pageSize: 10,
    totalPages: 1,
    hasNext: false,
    hasPrevious: false,
  });
  const [loadError, setLoadError] = useState("");

  const [busyDeleteRow, setBusyDeleteRow] = useState(null);
  const [busyAmendRow, setBusyAmendRow] = useState(null);

  const [hmIndex, setHmIndex] = useState({});
  const [msStats, setMsStats] = useState({});

  // ✅ show archived toggle
  const [showArchived, setShowArchived] = useState(false);

  // ✅ action busy flags
  const [busyCompleteRow, setBusyCompleteRow] = useState(null);
  const [busyArchiveRow, setBusyArchiveRow] = useState(null);
  const [actionMenuOpenForId, setActionMenuOpenForId] = useState(null);

  // ✅ PDF History dropdown state + cache
  const [pdfOpenForId, setPdfOpenForId] = useState(null);
  const [pdfLoadingForId, setPdfLoadingForId] = useState(null);
  const [pdfCache, setPdfCache] = useState({});
  const pdfPopoverRef = useRef(null);
  const actionMenuRef = useRef(null);
  const loadSeqRef = useRef(0);
  const msStatsRef = useRef({});
  const pageSizeRef = useRef(pageSize);
  const pageNumberRef = useRef(pageNumber);

  useEffect(() => {
    msStatsRef.current = msStats || {};
  }, [msStats]);

  useEffect(() => {
    pageSizeRef.current = pageSize;
  }, [pageSize]);

  useEffect(() => {
    pageNumberRef.current = pageNumber;
  }, [pageNumber]);

  useEffect(() => {
    const nextTotalPages = Math.max(1, Number(pagination?.totalPages || 1));
    if (pageNumber > nextTotalPages) {
      setPageNumber(nextTotalPages);
    }
  }, [pageNumber, pagination?.totalPages]);

  useEffect(() => {
    if (activeRouteFilter) {
      setStatusFilter("all");
    }
  }, [activeRouteFilter]);

  useEffect(() => {
    setPageNumber(1);
  }, [
    routeFocus,
    routeFilter,
    routeRange,
    statusParam,
    projectClassFilter,
    projectModeFilter,
    paymentModeFilter,
    paymentProtectionFilter,
  ]);

  const updateFilters = useCallback(
    (updates) => {
      const next = new URLSearchParams(location.search);
      Object.entries(updates).forEach(([key, value]) => {
        if (!value || value === "all") next.delete(key);
        else next.set(key, value);
      });
      setPageNumber(1);
      navigate(`${location.pathname}${next.toString() ? `?${next.toString()}` : ""}`, { replace: true });
    },
    [location.pathname, location.search, navigate]
  );

  useEffect(() => {
    const onDown = (e) => {
      const el = pdfPopoverRef.current;
      if (pdfOpenForId && (!el || !el.contains(e.target))) {
        setPdfOpenForId(null);
      }

      const menuEl = actionMenuRef.current;
      if (actionMenuOpenForId && (!menuEl || !menuEl.contains(e.target))) {
        setActionMenuOpenForId(null);
      }
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        setPdfOpenForId(null);
        setActionMenuOpenForId(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [actionMenuOpenForId, pdfOpenForId]);

  const isMsComplete = (m) => {
    const sv = (x) => String(x || "").trim().toLowerCase();
    const yes = (v) => v === true || v === "true" || v === 1 || v === "1";
    const status = sv(m.status);
    return (
      yes(m.completed) ||
      yes(m.is_complete) ||
      yes(m.approved) ||
      status === "complete" ||
      status === "completed" ||
      status === "approved" ||
      status === "done"
    );
  };

  const fetchStatsFor = useCallback(async (subset) => {
    const cachedStats = {};
    const ids = [];

    subset.forEach((r) => {
      const id = r.id;
      if (msStatsRef.current[id]) return;
      const cached = getFreshCachedMilestoneStats(id);
      if (cached) {
        cachedStats[id] = cached;
        return;
      }
      ids.push(id);
    });

    if (Object.keys(cachedStats).length) {
      setMsStats((prev) => ({ ...cachedStats, ...prev }));
    }

    if (ids.length === 0) return;

    const limit = 5;
    let idx = 0;

    const runOne = async () => {
      const i = idx++;
      if (i >= ids.length) return;
      const agreementId = ids[i];
      try {
        const stats = await fetchMilestoneStats(agreementId, isMsComplete);
        setMsStats((prev) => (prev[agreementId] ? prev : { ...prev, [agreementId]: stats }));
      } catch (e) {
        console.warn("Milestone stats fetch failed for agreement", agreementId, e?.response?.status || e);
      } finally {
        await runOne();
      }
    };

    const starters = Math.min(limit, ids.length);
    await Promise.all(Array.from({ length: starters }, runOne));
  }, []);

  const load = useCallback(async (options = {}) => {
    const normalized = typeof options === "string" ? { source: options } : options === true ? { force: true } : options || {};
    const force = !!normalized?.force;
    const source = normalized?.source || "unknown";
    const effectivePage = Number(normalized?.pageNumber || pageNumberRef.current || 1);
    const effectivePageSize = Number(normalized?.pageSize || pageSizeRef.current || pageSize || 10);
    const key = JSON.stringify({
      archived: showArchived ? 1 : 0,
      page: effectivePage,
      page_size: effectivePageSize,
      search: q.trim(),
      status: statusFilter,
      project_class: projectClassFilter,
      project_mode: projectModeFilter,
      payment_mode: paymentModeFilter,
      focus: routeFocus,
      filter: routeFilter,
      range: routeRange,
      status_param: statusParam,
    });
    if (force) {
      sharedAgreementListCache.delete(key);
      sharedMilestoneStatsCache.clear();
      setMsStats({});
    } else {
      const cached = getFreshCachedAgreementList(key);
      if (cached) {
        const seq = ++loadSeqRef.current;
        setLoading(true);
        try {
          if (seq !== loadSeqRef.current) return cached;
          setRows(cached.list);
          setHmIndex(cached.index);
          setPagination(cached.pagination || normalizeAgreementListResponse(cached.list, effectivePage, effectivePageSize).pagination);
          setLoadError("");
          return cached;
        } finally {
          if (seq === loadSeqRef.current) {
            setLoading(false);
          }
        }
      }
    }

    let promise = sharedAgreementListLoad.key === key ? sharedAgreementListLoad.promise : null;
    if (!promise) {
      promise = fetchAgreementListData({
        showArchived,
        pageNumber: effectivePage,
        pageSize: effectivePageSize,
        search: q.trim(),
        statusFilter,
        projectClassFilter,
        projectModeFilter,
        paymentModeFilter,
        routeFocus,
        routeFilter,
        routeRange,
        statusParam,
      })
        .then((data) => {
          setCachedAgreementList(key, data);
          return data;
        })
        .finally(() => {
          if (sharedAgreementListLoad.key === key) {
            sharedAgreementListLoad.key = null;
            sharedAgreementListLoad.promise = null;
          }
        });
      sharedAgreementListLoad.key = key;
      sharedAgreementListLoad.promise = promise;
    }

    const seq = ++loadSeqRef.current;

    setLoading(true);
    try {
      const { list, index, pagination: nextPagination } = await promise;
      if (seq !== loadSeqRef.current) return;
      setRows(list);
      setHmIndex(index);
      setPagination(nextPagination || normalizeAgreementListResponse(list, effectivePage, effectivePageSize).pagination);
      setLoadError("");
    } catch (e) {
      console.error(e);
      setLoadError("Failed to load agreements.");
      toast.error("Failed to load agreements.");
    } finally {
      if (seq === loadSeqRef.current) {
        setLoading(false);
      }
    }
    return promise;
  }, [
    showArchived,
    q,
    statusFilter,
    pageSize,
    projectClassFilter,
    projectModeFilter,
    paymentModeFilter,
    routeFocus,
    routeFilter,
    routeRange,
    statusParam,
    pageNumber,
  ]);

  useEffect(() => {
    load({ source: "mount-effect" });
    const onStorage = (e) => {
      if (e.key === "agreements:refresh" && e.newValue === "1") {
        localStorage.removeItem("agreements:refresh");
        load({ force: true, source: "storage-refresh" });
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [load]);

  useEffect(() => {
    const isBackendPage = Boolean(pagination?.isPaginated);
    const visibleRows = isBackendPage ? rows : rows.slice((pageNumber - 1) * pageSize, pageNumber * pageSize);
    fetchStatsFor(visibleRows);
  }, [rows, pageSize, pageNumber, pagination?.isPaginated, fetchStatsFor]);

  const homeownerDisplay = useCallback(
    (r) => {
      const flat = r.homeowner_name || r.homeowner_email || "";
      if (flat) return flat;

      if (r.homeowner && typeof r.homeowner === "object") {
        const nm = labelFromHomeownerObj(r.homeowner);
        const em = r.homeowner.email || "";
        return nm || em || "—";
      }

      const idCandidate = r.homeowner_id ?? r.homeowner ?? null;
      const hid = idCandidate != null ? String(idCandidate) : "";

      if (hid && hmIndex[hid]) return hmIndex[hid].name || hmIndex[hid].email || "—";
      return "—";
    },
    [hmIndex]
  );

  const filtered = useMemo(() => {
    const search = q.trim().toLowerCase();
    const todayStart = startOfToday();
    const todayEnd = endOfToday();
    const tomorrowStart = startOfTomorrow();
    const tomorrowEnd = endOfTomorrow();
    const weekEnd = endOfWeek();

    return rows
      .filter((r) => {
        if (activeRouteFilter?.kind === "needs_attention") {
          if (activeRouteFilter.value === "awaiting_signature") return rowIsAwaitingSignature(r);
          if (activeRouteFilter.value === "awaiting_funding") return rowIsAwaitingFunding(r);
          if (activeRouteFilter.value === "pending_approval") return rowHasPendingApproval(r);
          if (activeRouteFilter.value === "disputed") return rowHasDispute(r);
        }

        if (activeRouteFilter?.kind === "schedule") {
          const dueDate = agreementDueDate(r);
          if (activeRouteFilter.value === "late") {
            return dueDate ? dueDate.getTime() < todayStart.getTime() && !rowIsScheduleClosed(r) : false;
          }
          if (activeRouteFilter.value === "today") return inRange(dueDate, todayStart, todayEnd);
          if (activeRouteFilter.value === "tomorrow") {
            return inRange(dueDate, tomorrowStart, tomorrowEnd);
          }
          if (activeRouteFilter.value === "week") return inRange(dueDate, todayStart, weekEnd);
        }

        if (activeRouteFilter?.kind === "active_workflow") {
          return safeLower(r.status) === "draft";
        }

        if (projectClassFilter !== "all" && normalizeProjectClass(r.project_class) !== projectClassFilter) {
          return false;
        }

        if (projectModeFilter !== "all" && normalizeProjectMode(r.project_mode) !== projectModeFilter) {
          return false;
        }

        if (paymentModeFilter !== "all" && getPaymentMode(r) !== paymentModeFilter) {
          return false;
        }

        if (paymentProtectionFilter !== "all" && getPaymentProtectionLevel(r) !== paymentProtectionFilter) {
          return false;
        }

        const status = safeLower(r.status);
        if (statusParam === "awaiting_signature") return rowIsAwaitingSignature(r);
        if (statusParam === "funding_needed") return rowIsAwaitingFunding(r);
        return statusFilter === "all" ? true : status === statusFilter;
      })
      .filter((r) => {
        if (!search) return true;
        const homeownerLabel = homeownerDisplay(r);

        const hay = [
          r.id,
          r.status,
          r.project_title,
          r.title,
          r.description,
          r.project_type,
          r.project_subtype,
          r.homeowner_name,
          r.homeowner_email,
          homeownerLabel,
          r?.homeowner?.full_name,
          r?.homeowner?.name,
          r?.homeowner?.email,
          r?.payment_mode,
          r?.project_mode,
          r?.pdf_version,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return hay.includes(search);
      });
  }, [
    activeRouteFilter,
    homeownerDisplay,
    q,
    rows,
    statusFilter,
    statusParam,
    projectClassFilter,
    projectModeFilter,
    paymentModeFilter,
    paymentProtectionFilter,
  ]);

  const serverPaginated = Boolean(pagination?.isPaginated);
  const page = serverPaginated ? filtered : filtered.slice((pageNumber - 1) * pageSize, pageNumber * pageSize);
  const totalCount = serverPaginated ? Number(pagination.count || 0) : filtered.length;
  const totalPages = Math.max(
    1,
    serverPaginated ? Number(pagination.totalPages || 1) : Math.ceil(Math.max(filtered.length, 1) / Math.max(pageSize, 1))
  );
  const pageStart = totalCount === 0 ? 0 : (pageNumber - 1) * pageSize + 1;
  const pageEnd = totalCount === 0 ? 0 : Math.min(pageStart + page.length - 1, totalCount);

  const toggle = (id) =>
    setSelected((old) => {
      const next = new Set(old);
      if (next.has(id)) {
        next.delete(id);
        if (primaryId === id) setPrimaryId(null);
      } else {
        next.add(id);
        if (!primaryId) setPrimaryId(id);
      }
      return next;
    });

  const toggleAll = () =>
    setSelected((old) => {
      const pageIds = page.map((r) => r.id);
      const allOn = pageIds.every((id) => old.has(id));
      const next = new Set(old);
      if (allOn) {
        pageIds.forEach((id) => next.delete(id));
        if (pageIds.includes(primaryId)) setPrimaryId(null);
      } else {
        pageIds.forEach((id) => next.add(id));
        if (!primaryId && pageIds.length > 0) setPrimaryId(pageIds[0]);
      }
      return next;
    });

  const choosePrimary = (id) => {
    if (!selected.has(id)) setSelected((s) => new Set([...s, id]));
    setPrimaryId(id);
  };

  const mergeSelected = async () => {
    const ids = Array.from(selected);
    if (ids.length < 2) return toast.error("Select at least two agreements.");
    const effectivePrimary = primaryId && ids.includes(primaryId) ? primaryId : ids[0];
    const merge_ids = ids.filter((i) => i !== effectivePrimary);

    try {
      await api.post("/projects/agreements/merge/", { primary_id: effectivePrimary, merge_ids });
      toast.success("Agreements merged.");
      setSelected(new Set());
      setPrimaryId(null);
      await load({ force: true, source: "merge-selected-primary" });
      return;
    } catch (e1) {
      const d1 = e1?.response?.data;
      if (d1?.detail) toast.error(String(d1.detail));
      try {
        await api.post("/projects/agreements/merge/", { agreement_ids: ids });
        toast.success("Agreements merged.");
        setSelected(new Set());
        setPrimaryId(null);
        await load({ force: true, source: "merge-selected-fallback" });
        return;
      } catch (e2) {
        const d2 = e2?.response?.data;
        if (d2?.detail) toast.error(String(d2.detail));
        toast.error(String(d2?.detail || d1?.detail || "Merge failed."));
      }
    }
  };

  const confirmBulkDelete = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;

    try {
      setBulkDeleting(true);
      const { data } = await api.post("/projects/agreements/bulk-delete/", { agreement_ids: ids });
      const deletedCount = Number(data?.deleted_count ?? data?.deleted?.length ?? 0);
      const skippedCount = Number(data?.skipped_count ?? data?.skipped?.length ?? 0);

      if (deletedCount > 0 && skippedCount > 0) {
        toast.success(`${deletedCount} deleted, ${skippedCount} skipped`);
      } else if (deletedCount > 0) {
        toast.success(`${deletedCount} agreements deleted`);
      } else if (skippedCount > 0) {
        toast.error(`0 deleted, ${skippedCount} skipped`);
      } else {
        toast.error("No agreements deleted.");
      }

      setBulkDeleteOpen(false);
      setSelected(new Set());
      setPrimaryId(null);
      await load({ force: true, source: "bulk-delete" });
    } catch (e) {
      console.error(e);
      const detail =
        e?.response?.data?.detail ||
        "Bulk delete failed. Signed, funded, invoiced, paid, disputed, or completed agreements are protected.";
      toast.error(String(detail));
    } finally {
      setBulkDeleting(false);
    }
  };

  const goEdit = (id) => navigate(`${BASE}/agreements/${id}/wizard?step=1`);
  const goView = (id) => navigate(`${BASE}/agreements/${id}/workspace`);
  const goDetail = (id) => navigate(`${BASE}/agreements/${id}/workspace`);

  const deleteDraft = async (row) => {
    if (String(row.status).toLowerCase() !== "draft") {
      return toast.error("Only draft agreements can be deleted.");
    }
    if (!confirm(`Delete draft Agreement #${row.id}? This cannot be undone.`)) return;
    try {
      setBusyDeleteRow(row.id);
      await api.delete(`/projects/agreements/${row.id}/`);
      toast.success(`Agreement #${row.id} deleted.`);
      await load({ force: true, source: "delete-draft" });
    } catch (e) {
      console.error(e);
      const detail =
        e?.response?.data?.detail ||
        "Delete failed. This agreement may have children, escrow funds, or paid invoices.";
      toast.error(String(detail));
    } finally {
      setBusyDeleteRow(null);
    }
  };

  // --- Signature requirement + signed detection (waiver-aware) ---
  const reqContractor = (r) => boolish(r?.require_contractor_signature, true);
  const reqCustomer = (r) => boolish(r?.require_customer_signature, true);

  const contractorSigned = (r) =>
    (typeof r.signed_by_contractor !== "undefined" ? r.signed_by_contractor : r.contractor_signed) ||
    !!r.contractor_signature_name ||
    !!r.signed_at_contractor ||
    !!r.contractor_signed_at ||
    false;

  const homeownerSigned = (r) =>
    (typeof r.signed_by_homeowner !== "undefined" ? r.signed_by_homeowner : r.homeowner_signed) ||
    !!r.homeowner_signature_name ||
    !!r.signed_at_homeowner ||
    !!r.homeowner_signed_at ||
    false;

  const isFullySignedAgreement = (r) => {
    if (typeof r.signature_is_satisfied !== "undefined") return !!r.signature_is_satisfied;
    if (typeof r.is_fully_signed !== "undefined") return !!r.is_fully_signed;

    const contrOk = !reqContractor(r) || contractorSigned(r);
    const custOk = !reqCustomer(r) || homeownerSigned(r);
    return contrOk && custOk;
  };

  const SignatureBadge = ({ state, who }) => {
    if (state === "waived") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-slate-300/30 bg-slate-400/15 px-2 py-0.5 text-xs font-semibold text-slate-100">
          <MinusCircle size={14} /> {who}: Waived
        </span>
      );
    }
    if (state === "signed") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/40 bg-emerald-400/15 px-2 py-0.5 text-xs font-semibold text-emerald-100">
          <CheckCircle2 size={14} /> {who}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-rose-300/40 bg-rose-400/15 px-2 py-0.5 text-xs font-semibold text-rose-100">
        <XCircle size={14} /> {who}
      </span>
    );
  };

  const signatureSummary = (r) => {
    const required = [reqContractor(r), reqCustomer(r)].filter(Boolean).length;
    const signed = [
      reqContractor(r) ? contractorSigned(r) : true,
      reqCustomer(r) ? homeownerSigned(r) : true,
    ].filter(Boolean).length;

    if (required === 0) {
      return { label: "Waived", detail: "No signatures required", tone: "text-sky-100/80" };
    }

    const waived = 2 - required;
    const complete = signed >= required;
    return {
      label: complete ? "Fully signed" : `${Math.min(signed, required)} of ${required} signed`,
      detail:
        waived > 0
          ? `${waived} waived`
          : complete
          ? "Ready for funding or active work"
          : "Waiting on signatures",
      tone: complete ? "text-emerald-100" : "text-sky-100",
    };
  };

  const renderProject = (r) => {
    const raw = (r.project_title || r.title || "").trim();
    if (/^agreement\s*#\d+$/i.test(raw)) return "—";
    return raw || "—";
  };
  const renderType = (r) => r.project_type || "—";
  const renderSubtype = (r) => r.project_subtype || "—";

  const renderDateRange = (r) => {
    const start = fmtDate(r.start);
    const end = fmtDate(r.end);
    if ((start === "—" || start === "â€”") && (end === "—" || end === "â€”")) return "Dates not set";
    if (start === "—" || start === "â€”") return `Ends ${end}`;
    if (end === "—" || end === "â€”") return `Starts ${start}`;
    return `${start} - ${end}`;
  };

  const Progress = ({ percent, tone = "bg-blue-600" }) => (
    <div className="w-28">
      <div className="h-4 rounded-full bg-slate-300/90 p-[3px]">
        <div
          className={`h-full rounded-full transition-all ${tone}`}
          style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
        />
      </div>
    </div>
  );

  const createAmendment = async (row) => {
    const id = row.id;
    if (!id) return;

    if (!isFullySignedAgreement(row)) {
      toast.error("Agreement is not fully signed. Cannot create amendment.");
      return;
    }

    try {
      setBusyAmendRow(id);
      const { data } = await api.post(`/projects/agreements/${id}/create_amendment/`);
      toast.success(`Amendment created for Agreement #${id}.`);

      try {
        localStorage.setItem("agreements:refresh", "1");
      } catch {
        /* ignore */
      }

      const targetId = data?.id ?? id;
      navigate(`${BASE}/agreements/${targetId}/wizard?step=4`);
    } catch (e) {
      console.error("Create amendment failed:", e?.response || e);
      const detail =
        e?.response?.data?.detail || e?.response?.statusText || e?.message || "Could not create amendment.";
      toast.error(String(detail));
    } finally {
      setBusyAmendRow(null);
    }
  };

  const markComplete = async (row, stat) => {
    const id = row?.id;
    if (!id) return;

    const percent = Number(stat?.percent || 0);
    if (percent < 100) {
      return toast.error("All milestones must be completed before marking the agreement complete.");
    }

    if (!confirm(`Mark Agreement #${id} as COMPLETED?`)) return;

    try {
      setBusyCompleteRow(id);
      const res = await api.post(`/projects/agreements/${id}/mark_complete/`, {});
      setRows((prev) =>
        prev.map((r) => {
          if (r.id !== id) return r;
          const updated = res?.data?.agreement;
          if (updated && typeof updated === "object") return { ...r, ...updated };
          return { ...r, status: "completed" };
        })
      );

      toast.success(`Agreement #${id} marked completed.`);
      await load({ force: true, source: "mark-complete" });
    } catch (e) {
      console.error("mark_complete failed:", e?.response || e);
      const detail =
        e?.response?.data?.detail ||
        "Could not mark complete. Ensure all milestones are completed and invoices are not pending/disputed.";
      toast.error(String(detail));
    } finally {
      setBusyCompleteRow(null);
    }
  };

  const archiveAgreement = async (row) => {
    const id = row?.id;
    if (!id) return;

    if (!confirm(`Archive Agreement #${id}? It will be hidden unless "Show archived" is enabled.`)) return;

    try {
      setBusyArchiveRow(id);
      await api.post(`/projects/agreements/${id}/archive/`, {});
      toast.success(`Agreement #${id} archived.`);
      await load({ force: true, source: "archive-agreement" });
    } catch (e) {
      console.error("archive failed:", e?.response || e);
      toast.error(String(e?.response?.data?.detail || "Archive failed."));
    } finally {
      setBusyArchiveRow(null);
    }
  };

  const unarchiveAgreement = async (row) => {
    const id = row?.id;
    if (!id) return;

    try {
      setBusyArchiveRow(id);
      await api.post(`/projects/agreements/${id}/unarchive/`, {});
      toast.success(`Agreement #${id} unarchived.`);
      await load({ force: true, source: "unarchive-agreement" });
    } catch (e) {
      console.error("unarchive failed:", e?.response || e);
      toast.error(String(e?.response?.data?.detail || "Unarchive failed."));
    } finally {
      setBusyArchiveRow(null);
    }
  };

  const EscrowBadge = ({ r }) => {
    const mode = getPaymentMode(r);
    if (mode === "direct") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-indigo-300/40 bg-indigo-400/15 px-2.5 py-1 text-xs font-semibold text-indigo-100">
          <Zap size={14} /> Direct Pay
        </span>
      );
    }

    const fundedRaw =
      r.escrow_funded_amount ??
      r.escrow_funded_so_far ??
      r.funded_so_far ??
      r.funded_total ??
      null;

    const totalRaw = r.display_total ?? r.total_cost ?? null;

    const funded = toNum(fundedRaw);
    const total = toNum(totalRaw);

    const fundedFlag = !!r.escrow_funded || safeLower(r.status) === "funded";

    if (funded === null || total === null || total <= 0) {
      if (fundedFlag) {
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/40 bg-emerald-400/15 px-2.5 py-1 text-xs font-semibold text-emerald-100">
            <CheckCircle2 size={14} /> Funded
          </span>
        );
      }
      return <span className="text-xs text-gray-400">—</span>;
    }

    const isFullyFunded = funded >= total && total > 0;
    const isPartial = funded > 0 && funded < total;

    if (isFullyFunded) {
      return (
        <span
          className="inline-flex items-center gap-1 rounded-full border border-emerald-300/40 bg-emerald-400/15 px-2.5 py-1 text-xs font-semibold text-emerald-100"
          title={`${fmtMoney(funded)} / ${fmtMoney(total)}`}
        >
          <CheckCircle2 size={14} /> Funded
        </span>
      );
    }

    if (isPartial) {
      return (
        <span
          className="inline-flex items-center gap-1 rounded-full border border-amber-300/40 bg-amber-400/15 px-2.5 py-1 text-xs font-semibold text-amber-100"
          title={`${fmtMoney(funded)} / ${fmtMoney(total)}`}
        >
          <RefreshCw size={14} /> Partial
        </span>
      );
    }

    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-amber-300/40 bg-amber-400/15 px-2.5 py-1 text-xs font-semibold text-amber-100"
          title={`${fmtMoney(funded)} / ${fmtMoney(total)}`}
      >
        <XCircle size={14} /> Funding needed
      </span>
    );
  };

  // ✅ load PDF history on-demand from detail endpoint
  const ensurePdfDetail = useCallback(
    async (agreementId) => {
      if (!agreementId) return null;
      const cached = pdfCache[agreementId];
      if (cached) return cached;

      setPdfLoadingForId(agreementId);
      try {
        const { data } = await api.get(`/projects/agreements/${agreementId}/`, {
          params: { _ts: Date.now() },
          headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
        });

        const detail = {
          current_pdf_url: pick(data?.current_pdf_url, data?.pdf_url, data?.pdf_file_url, ""),
          pdf_version: data?.pdf_version ?? null,
          pdf_versions: Array.isArray(data?.pdf_versions) ? data.pdf_versions : [],
        };

        detail.pdf_versions.sort((a, b) => {
          const av = Number(a?.version_number ?? 0);
          const bv = Number(b?.version_number ?? 0);
          if (bv !== av) return bv - av;
          const at = new Date(a?.created_at || 0).getTime();
          const bt = new Date(b?.created_at || 0).getTime();
          return bt - at;
        });

        setPdfCache((prev) => ({ ...prev, [agreementId]: detail }));
        return detail;
      } catch (e) {
        console.error("PDF history load failed:", e?.response || e);
        toast.error("Could not load PDF history.");
        return null;
      } finally {
        setPdfLoadingForId(null);
      }
    },
    [pdfCache]
  );

  // ✅ Replace PdfBadge with dropdown version
  const PdfBadge = ({ r }) => {
    const id = r?.id;
    const ver = r?.pdf_version != null ? Number(r.pdf_version) : null;
    const urlFromList = pick(r?.current_pdf_url, r?.pdf_url, r?.pdf_file_url, "");
    const count = r?.pdf_versions_count != null ? Number(r.pdf_versions_count) : null;
    const open = pdfOpenForId === id;

    const hasHistory = count != null ? count > 1 : ver != null ? ver > 1 : false;

    const cached = id ? pdfCache[id] : null;
    const currentUrl = pick(cached?.current_pdf_url, urlFromList, "");
    const versions = Array.isArray(cached?.pdf_versions) ? cached.pdf_versions : [];

    return (
      <div className="relative inline-flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-sky-100 transition hover:border-white/30 hover:bg-white/15 hover:text-white"
          title="Open current PDF"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!currentUrl) return toast("No current PDF URL available.");
            openInNewTab(currentUrl);
          }}
        >
          <FileText size={14} /> {ver != null ? `v${ver}` : "v—"}
        </button>

        <button
          type="button"
          className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold border transition ${
            hasHistory
              ? "border-white/15 bg-white/10 text-sky-100 hover:border-white/30 hover:bg-white/15 hover:text-white"
              : "border-white/10 bg-white/5 text-sky-100/70 hover:border-white/20 hover:bg-white/10"
          }`}
          title="Show PDF history"
          onClick={async (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!id) return;

            if (open) {
              setPdfOpenForId(null);
              return;
            }

            setPdfOpenForId(id);
            if (!pdfCache[id]) await ensurePdfDetail(id);
          }}
        >
          {pdfLoadingForId === id ? "Loading…" : hasHistory ? `History ${count != null ? `(${count})` : ""}` : "History"}
        </button>

        {open && (
          <div
            ref={pdfPopoverRef}
            className="absolute z-50 top-10 left-0 w-[420px] max-w-[80vw] rounded-xl border bg-white shadow-lg overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-2 bg-gray-50 border-b flex items-center justify-between">
              <div className="text-sm font-semibold">PDF History — Agreement #{id}</div>
              <button
                className="text-xs text-blue-700 hover:underline"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setPdfOpenForId(null);
                }}
              >
                Close
              </button>
            </div>

            <div className="p-3 space-y-2">
              {!cached ? (
                <div className="text-sm text-gray-500">Loading…</div>
              ) : versions.length ? (
                <div className="space-y-2">
                  {versions.map((v) => {
                    const vnum = Number(v?.version_number ?? 0);
                    const kind = String(v?.kind || "").toLowerCase();
                    const fileUrl = pick(v?.file_url, v?.fileUrl, "");
                    const sig =
                      `${v?.signed_by_contractor ? "Contractor ✓" : "Contractor ✗"} • ` +
                      `${v?.signed_by_homeowner ? "Customer ✓" : "Customer ✗"}`;

                    return (
                      <div key={v?.id ?? `${vnum}-${v?.created_at ?? ""}`} className="rounded-lg border p-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-[220px]">
                            <div className="text-sm font-semibold">
                              v{vnum || "—"}{" "}
                              {kind ? (
                                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border border-slate-200 bg-slate-50 text-slate-800">
                                  {kind}
                                </span>
                              ) : null}
                            </div>
                            <div className="text-xs text-gray-500">
                              {fmtDateTime(v?.created_at)} • SHA {shortSha(v?.sha256)}
                            </div>
                            <div className="text-xs text-gray-500">{sig}</div>
                          </div>

                          <div className="flex gap-2">
                            <button
                              className="px-2 py-1 rounded-md border hover:bg-gray-50 text-sm"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (!fileUrl) return toast("No file URL for this version.");
                                openInNewTab(fileUrl);
                              }}
                            >
                              Open
                            </button>
                            <button
                              className="px-2 py-1 rounded-md border hover:bg-gray-50 text-sm"
                              onClick={async (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (!fileUrl) return toast("No file URL for this version.");
                                try {
                                  await downloadWithCredentials(
                                    fileUrl,
                                    `agreement_${id}_v${vnum || "x"}_${kind || "pdf"}.pdf`
                                  );
                                  toast.success("Downloaded.");
                                } catch (err) {
                                  console.error(err);
                                  toast.error("Download failed.");
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
                <div className="text-sm text-gray-500">
                  No historical versions found yet. Run <b>Finalize PDF</b> at least once to create versions.
                </div>
              )}

              <div className="pt-2 border-t">
                <div className="text-xs text-gray-500 mb-1">Current PDF</div>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium">{ver != null ? `v${ver}` : "v—"}</div>
                  <div className="flex gap-2">
                    <button
                      className="px-2 py-1 rounded-md border hover:bg-gray-50 text-sm"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!currentUrl) return toast("No current PDF URL available.");
                        openInNewTab(currentUrl);
                      }}
                    >
                      Open
                    </button>
                    <button
                      className="px-2 py-1 rounded-md border hover:bg-gray-50 text-sm"
                      onClick={async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!currentUrl) return toast("No current PDF URL available.");
                        try {
                          await downloadWithCredentials(currentUrl, `agreement_${id}_current.pdf`);
                          toast.success("Downloaded.");
                        } catch (err) {
                          console.error(err);
                          toast.error("Download failed.");
                        }
                      }}
                    >
                      Download
                    </button>
                  </div>
                </div>
              </div>

              <div className="text-[11px] text-gray-500">
                If history is empty: call POST <code>/projects/agreements/{id}/finalize_pdf/</code> to create version rows.
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  // --- existing actions & UI below (unchanged from your file) ---

  const PaginationControls = ({ placement = "bottom" }) => (
    <div
      data-testid={`agreement-pagination-${placement}`}
      className="flex flex-col gap-3 rounded-2xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-card)] px-4 py-3 text-sm text-[var(--mhb-text-secondary)] shadow-[var(--mhb-shadow-card)] md:flex-row md:items-center md:justify-between"
    >
      <div className="font-medium">
        Showing <span className="font-bold text-[var(--mhb-text-primary)]">{pageStart}</span>-
        <span className="font-bold text-[var(--mhb-text-primary)]">{pageEnd}</span> of{" "}
        <span className="font-bold text-[var(--mhb-text-primary)]">{totalCount}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setPageNumber((current) => Math.max(1, current - 1))}
          disabled={pageNumber <= 1 || loading}
          className="rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-interactive-secondary)] px-3 py-2 font-semibold text-[var(--mhb-text-primary)] transition hover:border-[var(--mhb-border-strong)] hover:bg-[var(--mhb-interactive-ghost-hover)] disabled:cursor-not-allowed disabled:opacity-45"
        >
          Previous
        </button>
        <span className="rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3 py-2 text-[var(--mhb-text-secondary)]">
          Page <span className="font-bold text-[var(--mhb-text-primary)]">{pageNumber}</span> of{" "}
          <span className="font-bold text-[var(--mhb-text-primary)]">{totalPages}</span>
        </span>
        <button
          type="button"
          onClick={() => setPageNumber((current) => Math.min(totalPages, current + 1))}
          disabled={pageNumber >= totalPages || loading}
          className="rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-interactive-secondary)] px-3 py-2 font-semibold text-[var(--mhb-text-primary)] transition hover:border-[var(--mhb-border-strong)] hover:bg-[var(--mhb-interactive-ghost-hover)] disabled:cursor-not-allowed disabled:opacity-45"
        >
          Next
        </button>
      </div>
    </div>
  );

  return (
    <ContractorPageSurface
      title="Agreements"
      subtitle="Track drafts, signatures, funding, invoices, and agreement history in one workspace."
      className="mhb-agreements-page max-w-[1680px]"
      variant="operational"
      contentClassName="space-y-4"
    >
      {/* Header */}
      <div
        data-testid="agreement-list-controls"
        className="rounded-[24px] border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-card)] p-4 text-[var(--mhb-text-primary)] shadow-[var(--mhb-shadow-card)] md:p-5"
      >
      <div className="flex flex-wrap items-center gap-2.5">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPageNumber(1);
          }}
          placeholder="Search by project, customer, type, subtype, email, or ID"
          className="min-w-[280px] flex-1 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-control)] px-4 py-2.5 text-sm font-medium text-[var(--mhb-text-primary)] shadow-sm outline-none transition placeholder:text-[var(--mhb-text-muted)] focus:border-[var(--mhb-border-focus)] focus:ring-2 focus:ring-[var(--mhb-border-focus)]/25"
        />

        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPageNumber(1);
          }}
          className="rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-control)] px-3.5 py-2.5 text-sm font-medium text-[var(--mhb-text-primary)] shadow-sm"
        >
          <option value="all">All Status</option>
          <option value="draft">draft</option>
          <option value="signed">signed</option>
          <option value="funded">funded</option>
          <option value="in_progress">in_progress</option>
          <option value="completed">completed</option>
          <option value="cancelled">cancelled</option>
        </select>

        <select
          value={projectClassFilter}
          onChange={(e) => updateFilters({ project_class: e.target.value })}
          className="rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-control)] px-3.5 py-2.5 text-sm font-medium text-[var(--mhb-text-primary)] shadow-sm"
          data-testid="agreement-list-project-class-filter"
        >
          <option value="all">All Projects</option>
          <option value="residential">Residential</option>
          <option value="commercial">Commercial</option>
        </select>

        <select
          value={projectModeFilter}
          onChange={(e) => updateFilters({ project_mode: e.target.value })}
          className="rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-control)] px-3.5 py-2.5 text-sm font-medium text-[var(--mhb-text-primary)] shadow-sm"
          data-testid="agreement-list-project-mode-filter"
        >
          <option value="all">All Modes</option>
          {PROJECT_MODE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <label className="inline-flex items-center gap-2 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-control)] px-3.5 py-2.5 text-sm font-medium text-[var(--mhb-text-primary)] shadow-sm">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => {
              setShowArchived(e.target.checked);
              setPageNumber(1);
              setSelected(new Set());
              setPrimaryId(null);
            }}
          />
          <span className="text-sm">Show archived</span>
        </label>

        <select
          value={pageSize}
          onChange={(e) => {
            setPageSize(Number(e.target.value));
            setPageNumber(1);
          }}
          className="rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-control)] px-3.5 py-2.5 text-sm font-medium text-[var(--mhb-text-primary)] shadow-sm"
          data-testid="agreement-page-size-select"
        >
          {[10, 20, 50, 100].map((n) => (
            <option key={n} value={n}>
              {n} / page
            </option>
          ))}
        </select>

        <button
          onClick={() => load({ force: true, source: "refresh-button" })}
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-interactive-secondary)] text-[var(--mhb-text-secondary)] shadow-sm transition hover:border-[var(--mhb-border-strong)] hover:bg-[var(--mhb-interactive-ghost-hover)]"
          title="Refresh"
        >
          <RefreshCw size={16} />
        </button>

        <div className="flex-1" />

        <button
          className="mhb-agreement-primary-action inline-flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm font-semibold shadow-sm transition"
          title="New Agreement"
          onClick={() => navigate(`${BASE}/agreements/new/wizard?step=1`)}
        >
          <Plus size={16} /> New Agreement
        </button>

        {selected.size > 0 ? (
          <button
            className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold shadow-sm transition ${
              selected.size >= 2
                ? "border border-white/15 bg-white/10 text-white hover:bg-white/15"
                : "cursor-not-allowed border border-white/10 bg-white/5 text-sky-100/45"
            }`}
            disabled={selected.size < 2}
            onClick={mergeSelected}
            title="Merge Selected"
          >
            <Layers size={16} /> Merge Selected
          </button>
        ) : null}

        <button
          type="button"
          data-testid="agreement-bulk-delete-button"
          className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm font-semibold shadow-sm transition ${
            selected.size > 0 && !bulkDeleting
              ? "border-rose-300/40 bg-rose-500/20 text-rose-50 hover:border-rose-200/60 hover:bg-rose-500/30"
              : "cursor-not-allowed border-white/10 bg-white/5 text-sky-100/45"
          }`}
          disabled={selected.size === 0 || bulkDeleting}
          onClick={() => setBulkDeleteOpen(true)}
          title="Delete Selected"
        >
          <Trash2 size={16} /> Delete Selected
        </button>
      </div>
      </div>

      {bulkDeleteOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="agreement-bulk-delete-title"
          data-testid="agreement-bulk-delete-modal"
        >
          <div className="w-full max-w-lg rounded-2xl border border-rose-200/25 bg-[#071b3a] p-6 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-full border border-rose-300/30 bg-rose-500/15 p-2 text-rose-100">
                <Trash2 size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="agreement-bulk-delete-title" className="text-lg font-bold text-white">
                  Delete selected agreements?
                </h2>
                <p className="mt-2 text-sm leading-6 text-sky-100/80">
                  {selected.size} agreement{selected.size === 1 ? "" : "s"} selected.
                </p>
                <p className="mt-2 text-sm leading-6 text-sky-100/80">
                  This will permanently delete eligible draft agreements. Signed, funded, invoiced, paid,
                  disputed, or completed agreements will be skipped.
                </p>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                className="rounded-xl border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-semibold text-sky-50 transition hover:bg-white/15"
                onClick={() => setBulkDeleteOpen(false)}
                disabled={bulkDeleting}
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="agreement-bulk-delete-confirm"
                className="rounded-xl border border-rose-300/40 bg-rose-500/25 px-4 py-2.5 text-sm font-semibold text-rose-50 shadow-sm transition hover:bg-rose-500/35 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={confirmBulkDelete}
                disabled={bulkDeleting || selected.size === 0}
              >
                {bulkDeleting ? "Deleting..." : "Delete Selected"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeRouteFilter ? (
        <div
          data-testid="agreement-list-filter-banner"
          className="rounded-2xl border border-sky-300/30 bg-sky-400/15 px-4 py-3 text-sm font-medium text-sky-50"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>Filtered: {activeRouteFilter.label}</span>
            <button
              type="button"
              onClick={() => {
                setPageNumber(1);
                navigate(`${BASE}/agreements`);
              }}
              className="text-sm font-semibold text-white underline underline-offset-4 hover:no-underline"
            >
              Clear filter
            </button>
          </div>
        </div>
      ) : null}

      <PaginationControls placement="top" />

      {/* Table */}
      <div
        data-testid="agreement-list-table-shell"
        className="min-h-[420px] overflow-x-auto rounded-[24px] border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-card)] text-[var(--mhb-text-primary)] shadow-[var(--mhb-shadow-card)]"
      >
        <table className="w-full min-w-[1360px] table-fixed text-[14px] leading-5">
          <colgroup>
            <col className="w-[44px]" />
            <col className="w-[88px]" />
            <col />
            <col className="w-[118px]" />
            <col className="w-[132px]" />
            <col className="w-[150px]" />
            <col className="w-[128px]" />
            <col className="w-[118px]" />
            <col className="w-[86px]" />
            <col className="w-[188px]" />
          </colgroup>
          <thead className="bg-[var(--mhb-surface-inset)]">
            <tr>
              <th className="px-3 py-3 text-center">
                <input
                  type="checkbox"
                  onChange={toggleAll}
                  checked={page.length > 0 && page.every((r) => selected.has(r.id))}
                />
              </th>
              {["Primary", "Agreement", "Status", "Escrow", "Progress", "Signatures"].map((label) => (
                <th key={label} className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-[0.14em] text-[var(--mhb-text-secondary)]">{label}</th>
              ))}
              {["Total", "Invoices", "Actions"].map((label) => (
                <th key={label} className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-[0.14em] text-[var(--mhb-text-secondary)]">{label}</th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-y divide-[var(--mhb-border-divider)]">
            {loading ? (
              <tr>
                <td className="px-6 py-14 text-center text-sm text-sky-100/75" colSpan={10}>
                  Loading…
                </td>
              </tr>
            ) : loadError ? (
              <tr>
                <td className="px-8 py-16 text-center" colSpan={10}>
                  <div className="mx-auto max-w-md rounded-2xl border border-rose-300/30 bg-rose-500/10 px-6 py-10 text-sm font-medium text-rose-100">
                    {loadError}
                  </div>
                </td>
              </tr>
            ) : page.length === 0 ? (
              <tr>
                <td className="px-8 py-16 text-center" colSpan={10}>
                  <div className="mx-auto max-w-md rounded-2xl border border-dashed border-white/20 bg-white/10 px-6 py-10 text-sm font-medium text-sky-100/75">
                    No agreements found.
                  </div>
                </td>
              </tr>
            ) : (
              page.map((r) => {
                const isChecked = selected.has(r.id);
                const isPrimary = primaryId === r.id;
                const stat = msStats[r.id] || { total: 0, complete: 0, percent: 0 };
                const homeowner = homeownerDisplay(r);
                const fullySigned = isFullySignedAgreement(r);
                const signatures = signatureSummary(r);

                const statusLower = safeLower(r.status);
                const isCompleted = statusLower === "completed";
                const isArchived = !!r.is_archived;
                const isDraft = statusLower === "draft";
                const isDirectPay = getPaymentMode(r) === "direct";
                const needsFundingAttention = !isArchived && !isDirectPay && fullySigned && !r.escrow_funded;
                const canAmend = fullySigned && !isArchived;
                const amountValue = fmtMoney(r.display_total ?? r.total_cost);
                const progressTone =
                  stat.percent >= 100 ? "bg-emerald-600" : needsFundingAttention ? "bg-amber-500" : "bg-blue-600";

                const canMarkComplete =
                  stat.total > 0 &&
                  stat.percent >= 100 &&
                  (statusLower === "funded" || statusLower === "in_progress" || statusLower === "signed") &&
                  !isCompleted;

                const canArchive = !isArchived && (isCompleted || statusLower === "cancelled");
                const canUnarchive = isArchived;
                const nextStepLabel = isArchived
                  ? "Restore if work should stay visible"
                  : needsFundingAttention
                  ? "Signatures are complete. Request funding before work starts."
                  : fullySigned
                  ? canMarkComplete
                    ? "Mark complete and close out"
                    : "Use Amend for signed changes"
                  : statusLower === "draft"
                  ? "Finish editing and send"
                  : statusLower === "signed"
                  ? "Review signature status and keep this moving"
                  : statusLower === "funded"
                  ? "Track milestones and invoicing"
                  : statusLower === "in_progress"
                  ? "Keep milestones moving"
                  : isCompleted
                  ? "Archive when ready"
                  : "Review agreement details";

                const identityMeta = [renderType(r), renderSubtype(r), homeowner, renderDateRange(r)].filter(
                  (value) => value && value !== "—" && value !== "â€”"
                );
                const menuOpen = actionMenuOpenForId === r.id;
                const statusTone = needsFundingAttention
                  ? "border border-amber-200 bg-amber-50 text-amber-800"
                  : statusPillClass(r.status);
                const primaryAction = isDraft
                  ? {
                      key: "finish-send",
                      label: "Continue Draft",
                      icon: Pencil,
                      onClick: () => goEdit(r.id),
                      disabled: false,
                      className: "mhb-agreement-primary-action",
                    }
                  : {
                      key: "workspace",
                      label: "Open Workspace",
                      icon: Layers,
                      onClick: () => goView(r.id),
                      disabled: false,
                      className: `mhb-agreement-primary-action ${needsFundingAttention ? "mhb-agreement-primary-action--warning" : ""}`,
                    };

                return (
                  <tr
                    key={r.id}
                    className={`cursor-pointer transition-colors ${
                      needsFundingAttention ? "bg-amber-400/[0.08] hover:bg-amber-400/[0.14]" : "bg-white/[0.035] hover:bg-white/[0.075]"
                    }`}
                    onClick={() => (isDraft ? goEdit(r.id) : goView(r.id))}
                    title={isDraft ? "Continue draft" : "Open workspace"}
                  >
                    <td className="px-3 py-4 align-top">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          e.stopPropagation();
                          toggle(r.id);
                        }}
                      />
                    </td>

                    <td className="px-3 py-4 align-top">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          choosePrimary(r.id);
                        }}
                        disabled={!isChecked}
                        className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${
                          isChecked
                            ? isPrimary
                              ? "border-yellow-300/60 bg-yellow-400/15 text-yellow-100"
                              : "border-white/15 bg-white/10 text-sky-50 hover:bg-white/15"
                            : "cursor-not-allowed border-white/10 text-sky-100/45"
                        }`}
                        title={isChecked ? (isPrimary ? "Primary" : "Set as Primary") : "Select row first"}
                      >
                        <Star size={14} />
                        <span className="text-xs font-semibold">{isPrimary ? "Primary" : "Set"}</span>
                      </button>
                    </td>

                    <td className="min-w-0 px-3 py-4 align-top" title={renderProject(r)}>
                      <div
                        className={`min-w-0 rounded-2xl border px-4 py-3 shadow-sm ${
                          needsFundingAttention
                            ? "border-amber-300/35 bg-amber-400/[0.09]"
                            : "border-white/10 bg-white/[0.055]"
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="truncate text-[15px] font-semibold text-white">{renderProject(r)}</div>
                            <ProjectModeBadge
                              mode={r.project_mode}
                              dataTestId={`agreement-project-mode-${r.id}`}
                            />
                            <span
                              className="inline-flex items-center rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-sky-50"
                              data-testid={`agreement-project-class-${r.id}`}
                            >
                              {projectClassLabel(r.project_class)}
                            </span>
                            <span className="inline-flex items-center rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-sky-100 ring-1 ring-white/15">
                              #{r.id}
                            </span>
                            {needsFundingAttention ? (
                              <span className="inline-flex items-center rounded-full border border-amber-300/40 bg-amber-400/15 px-2 py-0.5 text-[11px] font-semibold text-amber-100">
                                Funding gap
                              </span>
                            ) : null}
                            {isArchived ? (
                              <span className="inline-flex items-center rounded-full bg-slate-400/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-100">
                                Archived
                              </span>
                            ) : null}
                          </div>

                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-sky-100/75">
                            {identityMeta.map((item) => (
                              <span key={`${r.id}-${item}`} className="truncate">
                                {item}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-100/60">Next</span>
                          <span className={`text-sm ${needsFundingAttention ? "font-medium text-amber-100" : "text-sky-100/80"}`}>
                            {nextStepLabel}
                          </span>
                        </div>

                        <div className="mt-3">
                          <PdfBadge r={r} />
                        </div>
                      </div>
                    </td>

                    <td className="px-3 py-4 align-top">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone}`}
                        title={isArchived ? "Archived" : ""}
                      >
                        {prettyStatus(r.status)}
                        {isArchived ? " (archived)" : ""}
                      </span>
                    </td>

                    <td className="px-3 py-4 align-top">
                      <EscrowBadge r={r} />
                    </td>

                    <td className="px-3 py-4 align-top">
                      <div className="min-w-[150px]">
                        <div className="flex items-center gap-2">
                          <Progress percent={stat.percent} tone={progressTone} />
                          <span className="w-10 text-xs font-medium text-sky-100/75">{stat.percent}%</span>
                        </div>
                        <div className="mt-1 text-xs text-sky-100/60">
                          {stat.total ? `${stat.complete} of ${stat.total} milestones complete` : "No milestones yet"}
                        </div>
                      </div>
                    </td>

                    <td className="px-3 py-4 align-top">
                      <div className="min-w-[110px]">
                        <div className={`text-sm font-semibold ${signatures.tone}`}>{signatures.label}</div>
                        <div className="mt-1 text-xs text-sky-100/60">{signatures.detail}</div>
                      </div>
                    </td>

                    <td className="px-3 py-4 align-top text-right">
                      <div
                        className={`text-base ${Number((r.display_total ?? r.total_cost) || 0) > 0 ? "font-semibold text-white" : "font-medium text-sky-100/60"}`}
                      >
                        {amountValue}
                      </div>
                      <div className={`mt-1 text-xs ${needsFundingAttention ? "font-medium text-amber-100" : "text-sky-100/60"}`}>
                        {needsFundingAttention ? "Protected funding pending" : isDirectPay ? "Direct pay" : "Contract total"}
                      </div>
                    </td>

                    <td className="px-3 py-4 align-top text-right">
                      <div className="text-sm font-medium text-sky-50">{Number(r.invoices_count || 0)}</div>
                      <div className="mt-1 text-[11px] text-sky-100/55">Invoices</div>
                    </td>

                    <td className="relative px-3 py-4 align-top text-right">
                      <div className="flex items-start justify-end gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            primaryAction.onClick();
                          }}
                          disabled={primaryAction.disabled}
                          className={`inline-flex min-w-[118px] items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-semibold shadow-sm transition disabled:cursor-not-allowed ${primaryAction.className}`}
                          title={primaryAction.label}
                        >
                          <primaryAction.icon
                            size={14}
                            className={primaryAction.icon === RefreshCw ? "animate-spin" : undefined}
                          />
                          {primaryAction.label}
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            goEdit(r.id);
                          }}
                          disabled={canAmend}
                          className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border shadow-sm transition ${
                            canAmend
                              ? "cursor-not-allowed border-white/10 bg-white/5 text-sky-100/35"
                              : "border-white/15 bg-white/10 text-sky-50 hover:bg-white/15"
                          }`}
                          title={canAmend ? "Fully signed. Use Amend to modify." : "Edit agreement"}
                        >
                          <Pencil size={14} />
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setActionMenuOpenForId((current) => (current === r.id ? null : r.id));
                          }}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 bg-white/10 text-sky-50 shadow-sm transition hover:bg-white/15"
                          title="More actions"
                        >
                          <MoreHorizontal size={16} />
                        </button>
                      </div>

                      {menuOpen ? (
                        <div
                          ref={actionMenuRef}
                          className="absolute right-3 top-14 z-20 min-w-[180px] rounded-xl border border-white/15 bg-[#071f46] p-1.5 text-left shadow-[0_16px_40px_rgba(2,8,23,0.34)]"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {primaryAction.key !== "workspace" ? (
                            <button
                              type="button"
                              onClick={() => {
                                setActionMenuOpenForId(null);
                                if (isDraft) {
                                  goEdit(r.id);
                                } else {
                                  goView(r.id);
                                }
                              }}
                              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-sky-100 hover:bg-white/10"
                            >
                              <Eye size={14} /> {isDraft ? "Continue draft" : "Open workspace"}
                            </button>
                          ) : null}

                          <button
                            type="button"
                            onClick={() => {
                              setActionMenuOpenForId(null);
                              if (canMarkComplete && primaryAction.key !== "complete") {
                                markComplete(r, stat);
                              }
                            }}
                            disabled={!canMarkComplete || primaryAction.key === "complete" || busyCompleteRow === r.id}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-sky-100 hover:bg-white/10 disabled:cursor-not-allowed disabled:text-sky-100/35 disabled:hover:bg-transparent"
                          >
                            <Check size={14} /> Mark complete
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setActionMenuOpenForId(null);
                              if (canUnarchive && primaryAction.key !== "restore") {
                                unarchiveAgreement(r);
                              } else if (!canUnarchive) {
                                archiveAgreement(r);
                              }
                            }}
                            disabled={(canUnarchive && primaryAction.key === "restore") || (!canUnarchive && !canArchive) || busyArchiveRow === r.id}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-sky-100 hover:bg-white/10 disabled:cursor-not-allowed disabled:text-sky-100/35 disabled:hover:bg-transparent"
                          >
                            {canUnarchive ? <Undo2 size={14} /> : <Archive size={14} />}
                            {canUnarchive ? "Restore agreement" : "Archive agreement"}
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setActionMenuOpenForId(null);
                              if (isDraft) deleteDraft(r);
                            }}
                            disabled={!isDraft || busyDeleteRow === r.id}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-rose-100 hover:bg-rose-400/10 disabled:cursor-not-allowed disabled:text-sky-100/35 disabled:hover:bg-transparent"
                          >
                            <Trash2 size={14} /> Delete draft
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <PaginationControls placement="bottom" />

      <div className="rounded-2xl border border-white/10 bg-[#061d42]/80 px-4 py-3 text-sm text-sky-100/75">
        Showing {pageStart}-{pageEnd} of {totalCount}. Select 2+ rows, choose a <b className="text-white">Primary</b> (star), then click{" "}
        <b className="text-white">Merge Selected</b>. Fully executed agreements can no longer be edited directly; use <b className="text-white">Amend</b> to create a new Amendment and re-sign.
      </div>
    </ContractorPageSurface>
  );
}
