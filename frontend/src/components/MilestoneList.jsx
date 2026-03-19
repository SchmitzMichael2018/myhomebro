// src/components/MilestoneList.jsx
// v2026-03-03 — FIX: Tab filtering now filters milestone rows inside expanded agreements
// - Previously: Paid/Late/etc only filtered which AGREEMENTS showed, but expanded rows still showed ALL milestones
// - Now: When filtering (tab !== "all" OR search active), expanded agreement shows ONLY matching milestones
// - Also: Clicking tabs updates ?filter=... in the URL for correct deep-links / refresh behavior

import React, { useCallback, useEffect, useMemo, useState } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { useLocation, useNavigate } from "react-router-dom";

import MilestoneEditModal from "./MilestoneEditModal";
import MilestoneDetailModal from "./MilestoneDetailModal";
import RefundEscrowModal from "./RefundEscrowModal";

/* ---------------- Utilities ---------------- */
const pick = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== "") ?? "";

const money = (n) => {
  if (n === null || n === undefined || n === "") return "—";
  const v = Number(n);
  return Number.isFinite(v)
    ? `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : String(n);
};

const toDateOnly = (v) => {
  if (!v) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

const startOfToday = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

function useQuery() {
  const { search } = useLocation();
  return new URLSearchParams(search);
}

const getAgreementId = (m) => {
  const raw = m?.agreement_id ?? m?.agreement ?? m?.agreement_number ?? m?.agreement?.id ?? null;
  if (raw === null || raw === undefined || raw === "") return null;
  return String(raw);
};

const getAgreementStatus = (a) =>
  (pick(a?.status, a?.agreement_status, a?.signature_status, a?.state) || "").toLowerCase();

const isAgreementDraft = (a) => getAgreementStatus(a) === "draft";

/**
 * IMPORTANT:
 * "Signed" != "Fully Signed" in your workflow.
 * This function tries several common shapes. If your API has a canonical field, add it here.
 */
const isAgreementFullySigned = (a) => {
  if (!a) return false;

  // Explicit booleans (preferred)
  if (a.is_fully_signed === true) return true;
  if (a.fully_signed === true) return true;
  if (a.both_signed === true) return true;

  // Signature components (common)
  const contractorSigned = a.contractor_signed === true || !!a.contractor_signed_at;
  const customerSigned = a.customer_signed === true || !!a.customer_signed_at;
  if (contractorSigned && customerSigned) return true;

  // Fallback to status only if you don't have signature flags
  // (keep conservative: treat "funded" as fully signed, but NOT "signed" by itself)
  const st = getAgreementStatus(a);
  if (["funded", "in_progress", "active", "executed"].includes(st)) return true;

  return false;
};

/**
 * "Signed-ish" can stay for other UI bits, but completion uses FULLY SIGNED.
 */
const isAgreementSigned = (a) =>
  ["signed", "executed", "active", "approved", "funded", "in_progress"].includes(getAgreementStatus(a));

const getPaymentMode = (a) => String(pick(a?.payment_mode, a?.paymentMode, a?.mode) || "escrow").toLowerCase();

const isDirectPay = (a) => getPaymentMode(a) === "direct";

const isEscrowFunded = (a) => {
  const flag = !!pick(a?.escrow_funded, a?.escrowFunded, a?.escrowFundedBool, a?.is_escrow_funded);
  if (flag) return true;
  const st = getAgreementStatus(a);
  return st === "funded";
};

const getAgreementNumber = (m, a, agId) =>
  pick(m?.agreement_number, m?.agreement_no, a?.id, a?.agreement_id, agId, m?.agreement_id, m?.agreement);

const getProjectTitle = (m, a) => pick(m?.project_title, m?.projectTitle, a?.project_title, a?.projectTitle, a?.title);
const getHomeownerName = (m, a) => pick(m?.homeowner_name, m?.homeownerName, a?.homeowner_name, a?.homeownerName);

const getDueDateRaw = (m) =>
  pick(m?.due_date, m?.scheduled_for, m?.date_due, m?.date, m?.end_date, m?.completion_date, m?.endDate);

const computeIsLate = (m) => {
  if (m.completed === true) return false;
  const due = toDateOnly(getDueDateRaw(m));
  if (!due) return false;
  return due < startOfToday();
};

const isRefundedMilestone = (m) => {
  const s = String(pick(m?.descope_status, m?.descopeStatus) || "").toLowerCase();
  return s === "refunded";
};

const isReworkMilestone = (m) => {
  const t = String(pick(m?.title, m?.name) || "").toLowerCase();
  if (!t) return false;
  if (m?.rework_origin_milestone_id) return true;
  return t.startsWith("rework — dispute #") || (t.includes("rework") && t.includes("dispute #"));
};

const hasInvoiceLink = (m) => !!pick(m?.invoice, m?.invoice_id, m?.invoiceId);

const getInvoiceIdFromMilestone = (m) => {
  const inv = m?.invoice;
  if (inv && typeof inv === "object") return inv.id ?? inv.invoice_id ?? inv.pk ?? null;
  return pick(m?.invoice_id, m?.invoiceId, m?.invoice, null);
};

const isPaidFromInvoice = (m, invoicesMap) => {
  const invObj = m?.invoice && typeof m.invoice === "object" ? m.invoice : null;
  const invoiceId = getInvoiceIdFromMilestone(m);
  const inv = invObj || (invoiceId ? invoicesMap[String(invoiceId)] : null);
  if (!inv) return false;

  const statusRaw = String(pick(inv.status, inv.invoice_status, inv.state) || "").toLowerCase();
  const escrowReleased = inv.escrow_released === true || !!inv.escrow_released_at;
  const statusPaid = statusRaw === "paid";

  return escrowReleased || statusPaid;
};

const deriveMilestonePhaseLabel = (m, invoicesMap) => {
  if (isPaidFromInvoice(m, invoicesMap)) return "Paid";

  const completed = m.completed === true;
  const invoiced = m.is_invoiced === true || !!getInvoiceIdFromMilestone(m);

  if (!completed) return "Incomplete";
  if (completed && !invoiced) return "Completed (Not Invoiced)";
  return "Invoiced";
};

function getRefundBlockReason(m) {
  if (!m?._escrowFunded) return "Escrow is not funded for this agreement.";
  if (isRefundedMilestone(m)) return "This milestone was already refunded.";
  if (m.completed === true) return "Milestone is completed (work started).";
  if (m.is_invoiced === true) return "Milestone is invoiced (work done).";
  if (hasInvoiceLink(m)) return "Milestone has an invoice link.";
  return "";
}

function canOpenRefundModalFromRow(m) {
  return getRefundBlockReason(m) === "";
}

const getAgreementTotal = (a, allMilestonesForAgreement = []) => {
  const direct =
    pick(a?.total_cost, a?.total_amount, a?.total, a?.agreement_total, a?.amount_total, a?.total_price) ?? null;

  const cents = pick(a?.total_cost_cents, a?.total_amount_cents, a?.total_cents, a?.amount_cents) ?? null;

  if (cents !== null && cents !== undefined && cents !== "" && Number.isFinite(Number(cents))) {
    return money(Number(cents) / 100);
  }

  if (direct !== null && direct !== undefined && direct !== "" && Number.isFinite(Number(direct))) {
    return money(Number(direct));
  }

  const sum = allMilestonesForAgreement.reduce((acc, m) => acc + Number(m?.amount || 0), 0);
  return money(sum);
};

/* ---------------- API base ---------------- */
const API = {
  listMilestones: "/projects/milestones/",
  listAgreements: "/projects/agreements/",
  listInvoices: "/projects/invoices/",
  deleteMilestone: (id) => `/projects/milestones/${id}/`,
  milestoneFiles: "/projects/milestone-files/",
  createInvoice: (id) => `/projects/milestones/${id}/create-invoice/`,
  completeToReview: (id) => `/projects/milestones/${id}/complete-to-review/`,
};

export default function MilestoneList() {
  const navigate = useNavigate();

  const query = useQuery();
  const urlFilter = String(query.get("filter") || "").toLowerCase();
  const focusIdRaw = query.get("focus");
  const focusId = focusIdRaw ? String(focusIdRaw) : null;

  const [rows, setRows] = useState([]);
  const [agreementsMap, setAgreementsMap] = useState({});
  const [invoicesMap, setInvoicesMap] = useState({});
  const [loading, setLoading] = useState(true);

  const [tab, setTab] = useState("all");
  const [q, setQ] = useState("");

  const [openAgreements, setOpenAgreements] = useState(() => new Set());
  const [busy, setBusy] = useState(new Set());

  const [editOpen, setEditOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailItem, setDetailItem] = useState(null);

  const [refundOpen, setRefundOpen] = useState(false);
  const [refundAgreementId, setRefundAgreementId] = useState(null);
  const [refundAgreementLabel, setRefundAgreementLabel] = useState("");
  const [refundPreselected, setRefundPreselected] = useState([]);

  const allowedFilters = useMemo(
    () => new Set(["all", "late", "incomplete", "complete_not_invoiced", "invoiced", "paid", "rework"]),
    []
  );

  // Deep-link filters (URL -> tab)
  useEffect(() => {
    if (!urlFilter) return;
    if (allowedFilters.has(urlFilter)) setTab(urlFilter);
  }, [urlFilter, allowedFilters]);

  // Keep URL in sync (tab -> URL)
  const syncUrlFilter = useCallback(
    (nextTab) => {
      const t = String(nextTab || "").toLowerCase();
      const params = new URLSearchParams(window.location.search);

      if (!t || t === "all") params.delete("filter");
      else params.set("filter", t);

      // Preserve focus param (and any other params), just update filter
      const next = `${window.location.pathname}?${params.toString()}`;
      window.history.replaceState({}, "", next);
    },
    []
  );

  // When tab changes, update URL (but only for known tabs)
  useEffect(() => {
    if (!allowedFilters.has(tab)) return;
    syncUrlFilter(tab);
  }, [tab, allowedFilters, syncUrlFilter]);

  const markBusy = (id, on = true) =>
    setBusy((prev) => {
      const n = new Set(prev);
      on ? n.add(id) : n.delete(id);
      return n;
    });

  const updateLocal = (id, patch) => setRows((list) => list.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  /* ---------------- Load ---------------- */
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [mRes, aRes, iRes] = await Promise.all([
        api.get(API.listMilestones, { params: { page_size: 500, _ts: Date.now() } }),
        api.get(API.listAgreements, { params: { page_size: 500, _ts: Date.now() } }),
        api.get(API.listInvoices, { params: { page_size: 500, _ts: Date.now() } }),
      ]);

      const mList = Array.isArray(mRes.data?.results) ? mRes.data.results : Array.isArray(mRes.data) ? mRes.data : [];
      const aList = Array.isArray(aRes.data?.results) ? aRes.data.results : Array.isArray(aRes.data) ? aRes.data : [];
      const iList = Array.isArray(iRes.data?.results) ? iRes.data.results : Array.isArray(iRes.data) ? iRes.data : [];

      const amap = {};
      for (const a of aList) {
        const id = a?.id ?? a?.agreement_id ?? null;
        if (id !== null && id !== undefined && id !== "") amap[String(id)] = a;
      }

      const imap = {};
      for (const inv of iList) {
        const id = inv?.id ?? inv?.invoice_id ?? inv?.pk ?? null;
        if (id !== null && id !== undefined && id !== "") imap[String(id)] = inv;
      }

      setRows(mList);
      setAgreementsMap(amap);
      setInvoicesMap(imap);
    } catch (e) {
      console.error(e);
      toast.error("Failed to load milestones.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  /* ---------------- Enrich ---------------- */
  const enriched = useMemo(() => {
    return rows.map((m) => {
      const agId = getAgreementId(m);
      const ag = agId ? agreementsMap[agId] || {} : {};
      const late = computeIsLate(m);
      const phaseLabel = deriveMilestonePhaseLabel(m, invoicesMap);

      const paymentMode = getPaymentMode(ag);
      const requiresEscrow = paymentMode !== "direct";
      const escrowFunded = requiresEscrow ? isEscrowFunded(ag) : true;

      return {
        ...m,
        _ag: ag,
        _agId: agId,
        _paymentMode: paymentMode,
        _requiresEscrow: requiresEscrow,
        _escrowFunded: escrowFunded,
        _agStatus: getAgreementStatus(ag),
        _agreementNumber: getAgreementNumber(m, ag, agId),
        _projectTitle: getProjectTitle(m, ag),
        _homeownerName: getHomeownerName(m, ag),
        _dueRaw: getDueDateRaw(m),
        _late: late,
        _phaseLabel: phaseLabel,
        _refunded: isRefundedMilestone(m),
        _fullySigned: isAgreementFullySigned(ag),
        _signedLike: isAgreementSigned(ag),
      };
    });
  }, [rows, agreementsMap, invoicesMap]);

  /* ---------------- Filter milestones (produces MATCHES) ---------------- */
  const matchingMilestones = useMemo(() => {
    let r = enriched;

    switch (tab) {
      case "rework":
        r = r.filter((m) => isReworkMilestone(m));
        break;

      default:
        r = r.filter((m) => !isReworkMilestone(m));

        if (tab === "late") r = r.filter((m) => m._late && m._phaseLabel !== "Paid");
        else if (tab === "incomplete") r = r.filter((m) => m._phaseLabel === "Incomplete");
        else if (tab === "complete_not_invoiced") r = r.filter((m) => m._phaseLabel === "Completed (Not Invoiced)");
        else if (tab === "invoiced") r = r.filter((m) => m._phaseLabel === "Invoiced");
        else if (tab === "paid") r = r.filter((m) => m._phaseLabel === "Paid");
        break;
    }

    const s = q.trim().toLowerCase();
    if (s) {
      r = r.filter((m) =>
        [m.title, m._projectTitle, m._homeownerName, String(m._agreementNumber)]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(s)
      );
    }

    return r;
  }, [enriched, tab, q]);

  /* ---------------- All milestones by agreement ---------------- */
  const allMilestonesByAgreement = useMemo(() => {
    const map = new Map();
    for (const m of enriched) {
      const agId = m._agId || "unknown";
      if (!map.has(agId)) map.set(agId, []);
      map.get(agId).push(m);
    }
    for (const [agId, list] of map.entries()) {
      list.sort((a, b) => {
        const da = toDateOnly(a._dueRaw)?.getTime() ?? 9e15;
        const db = toDateOnly(b._dueRaw)?.getTime() ?? 9e15;
        if (da !== db) return da - db;
        return String(a.title || "").localeCompare(String(b.title || ""));
      });
      map.set(agId, list);
    }
    return map;
  }, [enriched]);

  /* ---------------- Matching set per agreement ---------------- */
  const matchSetByAgreement = useMemo(() => {
    const map = new Map();
    for (const m of matchingMilestones) {
      const agId = m._agId || "unknown";
      if (!map.has(agId)) map.set(agId, new Set());
      map.get(agId).add(String(m.id));
    }
    return map;
  }, [matchingMilestones]);

  /* ---------------- Agreement list ---------------- */
  const agreementGroups = useMemo(() => {
    const hasFiltering = tab !== "all" || q.trim().length > 0;
    const agIds = hasFiltering ? Array.from(matchSetByAgreement.keys()) : Array.from(allMilestonesByAgreement.keys());

    const out = agIds.map((agId) => {
      const listAll = allMilestonesByAgreement.get(agId) || [];
      const any = listAll[0] || {};
      const ag = agreementsMap[String(agId)] || any._ag || {};

      const agreementNumber = getAgreementNumber(any, ag, agId);
      const projectTitle = getProjectTitle(any, ag) || "—";
      const homeownerName = getHomeownerName(any, ag) || "—";
      const matchCount = (matchSetByAgreement.get(agId) || new Set()).size;

      return {
        agId: String(agId),
        ag,
        agreementNumber,
        projectTitle,
        homeownerName,
        matchCount,
        allMilestones: listAll,
      };
    });

    out.sort((a, b) => {
      const an = Number(String(a.agId).replace(/[^\d]/g, "")) || 0;
      const bn = Number(String(b.agId).replace(/[^\d]/g, "")) || 0;
      return bn - an;
    });

    return out;
  }, [tab, q, matchSetByAgreement, allMilestonesByAgreement, agreementsMap]);

  /* ---------------- Auto-expand behavior ---------------- */
  useEffect(() => {
    if (!focusId) return;
    if (loading) return;

    const m = enriched.find((x) => String(x.id) === String(focusId));
    if (!m?._agId) return;

    setOpenAgreements((prev) => {
      const next = new Set(prev);
      next.add(String(m._agId));
      return next;
    });
  }, [focusId, loading, enriched]);

  useEffect(() => {
    const isFiltering = tab !== "all" || q.trim().length > 0;
    if (!isFiltering) return;

    setOpenAgreements(() => {
      const next = new Set();
      for (const g of agreementGroups) next.add(String(g.agId));
      return next;
    });
  }, [tab, q, agreementGroups]);

  useEffect(() => {
    if (!focusId) return;
    if (loading) return;

    const t = setTimeout(() => {
      const el = document.getElementById(`mhb-milestone-row-${focusId}`);
      if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);

    return () => clearTimeout(t);
  }, [focusId, loading, openAgreements]);

  /* ---------------- Rules ---------------- */
  const canEditDelete = (m) => isAgreementDraft(m._ag);

  const getCompleteBlockReason = (m) => {
    if (!m?._agId) return "Missing agreement id.";
    if (m._fullySigned !== true) return "Agreement must be fully signed first.";
    if (m._requiresEscrow && m._escrowFunded !== true) return "Escrow must be funded before completing milestones.";
    if (m.completed === true) return "Already completed.";
    if (m.is_invoiced === true || hasInvoiceLink(m)) return "Already invoiced.";
    return "";
  };

  const canComplete = (m) => getCompleteBlockReason(m) === "";

  const isCompletedNotInvoiced = (m) => m.completed === true && !(m.is_invoiced === true || hasInvoiceLink(m));

  const getInvoiceBlockReason = (m) => {
    if (!m?._agId) return "Missing agreement id.";
    if (m._requiresEscrow && m._escrowFunded !== true) return "Escrow must be funded before invoicing milestones.";
    if (!(m.completed === true)) return "Milestone must be completed before invoicing.";
    if (m.is_invoiced === true || hasInvoiceLink(m)) return "Already invoiced.";
    return "";
  };

  const ensureEscrowOrRoute = (m, reason) => {
    toast(reason);
    if (!m?._agId) return;
    if (m._requiresEscrow && m._escrowFunded !== true) {
      navigate(`/app/agreements/${m._agId}/wizard?step=4`);
    }
  };

  /* ---------------- Actions ---------------- */
  const openEdit = (m) => {
    if (!canEditDelete(m)) {
      toast("Editing is only available while the agreement is in Draft.");
      return;
    }
    setEditItem(m);
    setEditOpen(true);
  };

  const removeItem = async (m) => {
    if (!canEditDelete(m)) {
      toast("Delete is only available while the agreement is in Draft.");
      return;
    }
    if (!window.confirm(`Delete milestone "${m.title}" (Agreement #${m._agreementNumber || "?"})?`)) return;

    markBusy(m.id, true);
    const snapshot = rows;
    setRows((list) => list.filter((x) => x.id !== m.id));

    try {
      await api.delete(API.deleteMilestone(m.id));
      toast.success("Milestone deleted.");
    } catch (err) {
      console.error(err);
      setRows(snapshot);
      toast.error("Failed to delete milestone.");
    } finally {
      markBusy(m.id, false);
    }
  };

  const uploadEvidenceFiles = async (milestoneId, files) => {
    if (!files?.length) return;
    for (const f of files) {
      const fd = new FormData();
      fd.append("milestone", milestoneId);
      fd.append("file", f, f.name);
      await api.post(API.milestoneFiles, fd, { headers: { "Content-Type": "multipart/form-data" } });
    }
  };

  const submitComplete = async ({ id, notes, files }) => {
    if (!id) return;

    const m = enriched.find((x) => String(x.id) === String(id));
    if (m) {
      const reason = getCompleteBlockReason(m);
      if (reason) {
        ensureEscrowOrRoute(m, reason);
        return;
      }
    }

    markBusy(id, true);
    try {
      await uploadEvidenceFiles(id, files || []);
      await api.post(API.completeToReview(id), { completion_notes: notes || "" });
      toast.success("Milestone submitted for review.");
      setDetailOpen(false);
      setDetailItem(null);
      await reload();
    } catch (err) {
      console.error(err);

      const code = err?.response?.data?.code;
      const msg = err?.response?.data?.detail || "Could not submit milestone for review.";
      toast.error(msg);

      // If backend enforces escrow/signature, route to correct place
      if (code === "escrow_required" || String(msg).toLowerCase().includes("escrow")) {
        const m2 = enriched.find((x) => String(x.id) === String(id));
        if (m2?._agId) navigate(`/app/agreements/${m2._agId}/wizard?step=4`);
      }

      await reload();
    } finally {
      markBusy(id, false);
    }
  };

  const createInvoiceAndGo = async (m) => {
    const milestoneId = m?.id;
    if (!milestoneId) return;

    const reason = getInvoiceBlockReason(m);
    if (reason) {
      ensureEscrowOrRoute(m, reason);
      return;
    }

    markBusy(milestoneId, true);
    try {
      const { data } = await api.post(API.createInvoice(milestoneId));
      const invoiceId = data?.id || data?.invoice_id || data?.pk || getInvoiceIdFromMilestone(m) || null;

      toast.success("Invoice created.");
      await reload();

      if (invoiceId) navigate(`/app/invoices/${invoiceId}`);
      else {
        toast.error("Invoice created but no invoice id returned.");
        navigate(`/app/invoices`);
      }
    } catch (e) {
      console.error(e);
      const code = e?.response?.data?.code;
      const msg = e?.response?.data?.detail || "Unable to create invoice for this milestone.";
      toast.error(msg);

      if (code === "escrow_required" || String(msg).toLowerCase().includes("escrow")) {
        if (m?._agId) navigate(`/app/agreements/${m._agId}/wizard?step=4`);
      }
    } finally {
      markBusy(milestoneId, false);
    }
  };

  const openRefundForMilestone = (m) => {
    const block = getRefundBlockReason(m);
    if (block) {
      toast(block);
      return;
    }
    const agId = m._agId;
    if (!agId) {
      toast.error("Missing agreement id for this milestone.");
      return;
    }
    setRefundAgreementId(agId);
    setRefundAgreementLabel(m._projectTitle || `Agreement #${agId}`);
    setRefundPreselected([m.id]);
    setRefundOpen(true);
  };

  const toggleAgreement = (agId) => {
    setOpenAgreements((prev) => {
      const next = new Set(prev);
      const k = String(agId);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const filterTabs = [
    { key: "all", label: "All" },
    { key: "late", label: "Late" },
    { key: "incomplete", label: "Incomplete" },
    { key: "complete_not_invoiced", label: "Completed (Not Invoiced)" },
    { key: "invoiced", label: "Invoiced" },
    { key: "paid", label: "Paid" },
    { key: "rework", label: "Rework Work Orders" },
  ];

  // Common header cell classes (clean column separation)
  const thBase =
    "px-4 py-3 text-xs font-extrabold uppercase tracking-wide text-slate-700 border-r border-slate-200 last:border-r-0";
  const tdBase = "px-4 py-3 border-r border-slate-100 last:border-r-0";

  // 🔑 Determines whether we should show ONLY matching rows inside expanded agreements
  const isFiltering = tab !== "all" || q.trim().length > 0;

  return (
    <div className="p-4 md:p-6">
      {/* Header: filters + search */}
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div className="flex flex-wrap gap-2">
          {filterTabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`px-3 py-1 rounded text-sm border ${
                tab === t.key
                  ? "bg-white/80 text-gray-900 border-white/60 shadow"
                  : "bg-white/10 text-white/90 border-white/20 hover:bg-white/20"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search title, project, customer."
            className="px-3 py-2 rounded border border-white/30 bg-white/90 text-gray-900 w-72 max-w-full"
          />
          <button
            type="button"
            onClick={() => reload()}
            className="px-3 py-2 rounded bg-white/80 text-gray-900 border border-white/60"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Agreement-first table */}
      <div className="rounded-xl overflow-hidden shadow border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-[860px] w-full text-sm">
            <thead className="bg-slate-100">
              <tr className="border-b border-slate-200">
                <th className={`${thBase} text-left w-[140px]`}>Agreement #</th>
                <th className={`${thBase} text-left`}>Project</th>
                <th className={`${thBase} text-left w-[200px]`}>Customer</th>
                <th className={`${thBase} text-right w-[160px]`}>Agreement Total</th>
                <th className={`${thBase} text-center w-[180px]`}>Matches</th>
                <th className={`${thBase} text-center w-[90px]`}>Open</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-600" colSpan={6}>
                    Loading milestones…
                  </td>
                </tr>
              ) : agreementGroups.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-600" colSpan={6}>
                    No milestones found.
                  </td>
                </tr>
              ) : (
                agreementGroups.map((g) => {
                  const agId = String(g.agId);
                  const isOpen = openAgreements.has(agId);
                  const totalLabel = getAgreementTotal(g.ag, g.allMilestones);

                  const agreementNum = g.agreementNumber ? `#${g.agreementNumber}` : `#${agId}`;
                  const matchCount = Number(g.matchCount || 0);

                  // ✅ NEW: compute which milestones should be shown when expanded
                  const matchSet = matchSetByAgreement.get(agId) || new Set();
                  const milestonesToShow = isFiltering ? g.allMilestones.filter((m) => matchSet.has(String(m.id))) : g.allMilestones;

                  return (
                    <React.Fragment key={`ag-${agId}`}>
                      <tr
                        className="odd:bg-white even:bg-slate-50 hover:bg-slate-100 cursor-pointer border-b border-slate-100"
                        onClick={() => toggleAgreement(agId)}
                        title="Click to expand / collapse milestones for this agreement"
                      >
                        <td className={`${tdBase} font-extrabold text-slate-900 whitespace-nowrap`}>{agreementNum}</td>

                        <td className={tdBase}>
                          <div className="font-semibold text-slate-900">{g.projectTitle || "—"}</div>
                        </td>

                        <td className={tdBase}>{g.homeownerName || "—"}</td>

                        <td className={`${tdBase} text-right font-extrabold text-slate-900`}>{totalLabel}</td>

                        <td className={`${tdBase} text-center`}>
                          <span
                            className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-extrabold ${
                              matchCount > 0
                                ? "bg-amber-100 text-amber-900 border border-amber-200"
                                : "bg-slate-100 text-slate-700 border border-slate-200"
                            }`}
                          >
                            {matchCount}
                          </span>
                        </td>

                        <td className={`${tdBase} text-center`}>
                          <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-200 bg-white text-slate-700 font-extrabold shadow-sm">
                            {isOpen ? "▾" : "▸"}
                          </span>
                        </td>
                      </tr>

                      {isOpen ? (
                        <tr className="bg-slate-50/60">
                          <td colSpan={6} className="px-4 py-4">
                            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                              <div className="overflow-x-auto">
                                <table className="min-w-[900px] w-full text-sm">
                                  <thead className="bg-slate-100">
                                    <tr className="border-b border-slate-200">
                                      <th className={`${thBase} text-left`}>Milestone Title</th>
                                      <th className={`${thBase} text-left w-[140px]`}>Due</th>
                                      <th className={`${thBase} text-left w-[160px]`}>Status</th>
                                      <th className={`${thBase} text-right w-[140px]`}>Amount</th>
                                      <th className={`${thBase} text-left w-[420px]`}>Actions</th>
                                    </tr>
                                  </thead>

                                  <tbody>
                                    {milestonesToShow.length === 0 ? (
                                      <tr>
                                        <td className="px-4 py-6 text-center text-slate-600" colSpan={5}>
                                          No matching milestones for this agreement.
                                        </td>
                                      </tr>
                                    ) : (
                                      milestonesToShow.map((m) => {
                                        const allowED = canEditDelete(m);
                                        const allowComplete = canComplete(m);
                                        const isRowBusy = busy.has(m.id);

                                        const completeReason = getCompleteBlockReason(m);
                                        const invoiceReason = getInvoiceBlockReason(m);

                                        const statusPill = m._phaseLabel === "Paid" ? "Paid" : m._late ? "Late" : m._phaseLabel;

                                        const canRefund = canOpenRefundModalFromRow(m);
                                        const refundReason = getRefundBlockReason(m);

                                        return (
                                          <tr
                                            id={`mhb-milestone-row-${m.id}`}
                                            key={`m-${m.id}`}
                                            className={[
                                              "border-b border-slate-100 last:border-b-0",
                                              "hover:bg-slate-100",
                                              "odd:bg-white even:bg-slate-50",
                                              isRowBusy ? "opacity-70" : "",
                                              focusId && String(m.id) === String(focusId) ? "ring-2 ring-amber-300" : "",
                                            ].join(" ")}
                                            title="Click to view milestone details"
                                            onClick={() => {
                                              setDetailItem(m);
                                              setDetailOpen(true);
                                            }}
                                          >
                                            <td className={tdBase}>
                                              <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-semibold text-slate-900">{m.title}</span>

                                                {m.rework_origin_milestone_id ? (
                                                  <div className="text-xs text-slate-600">
                                                    Original milestone:{" "}
                                                    <button
                                                      type="button"
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        navigate(`/app/milestones?focus=${m.rework_origin_milestone_id}`);
                                                      }}
                                                      className="font-extrabold text-blue-700 hover:underline"
                                                      title="View the original disputed milestone"
                                                    >
                                                      #{m.rework_origin_milestone_id} — View
                                                    </button>
                                                  </div>
                                                ) : null}

                                                {m._late && statusPill !== "Paid" && (
                                                  <span className="px-2 py-0.5 rounded text-xs bg-red-100 text-red-700 border border-red-200">
                                                    late
                                                  </span>
                                                )}
                                                {m._refunded && (
                                                  <span className="px-2 py-0.5 rounded text-xs bg-emerald-100 text-emerald-700 border border-emerald-200">
                                                    ✅ refunded
                                                  </span>
                                                )}
                                              </div>

                                              {/* Small agreement gates hint */}
                                              <div className="mt-1 text-[11px] text-slate-500">
                                                {m._paymentMode === "direct" ? "Direct Pay" : "Escrow"} •{" "}
                                                {m._fullySigned ? "Fully signed" : "Not fully signed"}{" "}
                                                {m._requiresEscrow ? `• ${m._escrowFunded ? "Escrow funded" : "Escrow NOT funded"}` : ""}
                                              </div>
                                            </td>

                                            <td className={tdBase}>{m._dueRaw || "—"}</td>

                                            <td className={tdBase}>
                                              <span
                                                className={`px-2 py-0.5 rounded text-xs border ${
                                                  statusPill === "Paid"
                                                    ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                                                    : statusPill === "Late"
                                                    ? "bg-red-100 text-red-700 border-red-200"
                                                    : statusPill === "Completed (Not Invoiced)"
                                                    ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                                                    : statusPill === "Invoiced"
                                                    ? "bg-blue-100 text-blue-700 border-blue-200"
                                                    : "bg-gray-100 text-gray-700 border-gray-200"
                                                }`}
                                              >
                                                {statusPill}
                                              </span>
                                            </td>

                                            <td className={`${tdBase} text-right font-extrabold text-slate-900`}>{money(m.amount)}</td>

                                            <td className={tdBase}>
                                              <div className="flex gap-2 flex-wrap">
                                                <button
                                                  type="button"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    setDetailItem(m);
                                                    setDetailOpen(true);
                                                  }}
                                                  className="px-3 py-2 text-xs rounded-md border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 font-semibold"
                                                >
                                                  View
                                                </button>

                                                <button
                                                  type="button"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (canRefund) openRefundForMilestone(m);
                                                  }}
                                                  disabled={!canRefund}
                                                  className={`px-3 py-2 text-xs rounded-md border font-semibold ${
                                                    canRefund
                                                      ? "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                                                      : "border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed"
                                                  }`}
                                                  title={canRefund ? "Refund via agreement refund tool (preselected milestone)." : refundReason}
                                                >
                                                  Refund
                                                </button>

                                                {allowComplete ? (
                                                  <button
                                                    type="button"
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      // open detail; submit happens inside modal, but gating is enforced in submitComplete too
                                                      setDetailItem(m);
                                                      setDetailOpen(true);
                                                    }}
                                                    className="px-3 py-2 text-xs rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-semibold"
                                                    title="Complete → Review"
                                                  >
                                                    ✓ Complete
                                                  </button>
                                                ) : isCompletedNotInvoiced(m) ? (
                                                  <>
                                                    <button
                                                      type="button"
                                                      disabled
                                                      className="px-3 py-2 text-xs rounded-md border border-gray-200 bg-gray-100 text-gray-500 font-semibold cursor-default"
                                                      title="Already completed"
                                                    >
                                                      ✓ Completed
                                                    </button>

                                                    <button
                                                      type="button"
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        const reason = getInvoiceBlockReason(m);
                                                        if (reason) {
                                                          ensureEscrowOrRoute(m, reason);
                                                          return;
                                                        }
                                                        createInvoiceAndGo(m);
                                                      }}
                                                      className="px-3 py-2 text-xs rounded-md border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-semibold"
                                                      title={invoiceReason || "Create invoice for this completed milestone"}
                                                    >
                                                      Invoice
                                                    </button>
                                                  </>
                                                ) : (
                                                  <button
                                                    type="button"
                                                    disabled
                                                    className="px-3 py-2 text-xs rounded-md border border-gray-200 bg-gray-100 text-gray-400 font-semibold cursor-not-allowed"
                                                    title={completeReason || "Not eligible to complete"}
                                                  >
                                                    ✓ Complete
                                                  </button>
                                                )}

                                                {allowED ? (
                                                  <button
                                                    type="button"
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      openEdit(m);
                                                    }}
                                                    className="px-3 py-2 text-xs rounded-md border border-gray-200 bg-white text-gray-800 hover:bg-gray-50 font-semibold"
                                                  >
                                                    Edit
                                                  </button>
                                                ) : (
                                                  <span className="text-xs text-gray-400 self-center">Edit (locked)</span>
                                                )}

                                                {allowED ? (
                                                  <button
                                                    type="button"
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      removeItem(m);
                                                    }}
                                                    className="px-3 py-2 text-xs rounded-md border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 font-semibold"
                                                  >
                                                    Delete
                                                  </button>
                                                ) : (
                                                  <span className="text-xs text-gray-400 self-center">Delete (locked)</span>
                                                )}
                                              </div>
                                            </td>
                                          </tr>
                                        );
                                      })
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modals */}
      {editOpen && editItem && (
        <MilestoneEditModal
          open={editOpen}
          onClose={() => {
            setEditOpen(false);
            setEditItem(null);
          }}
          milestone={editItem}
          onSaved={async (updated) => {
            if (updated?.id) updateLocal(updated.id, updated);
            await reload();
            setEditOpen(false);
            setEditItem(null);
            toast.success("Milestone updated.");
          }}
          onMarkComplete={async () => {
            toast("Open the milestone to submit completion for review.");
          }}
        />
      )}

      {detailOpen && detailItem && (
        <MilestoneDetailModal
          open={detailOpen}
          milestone={detailItem}
          agreement={detailItem._ag}
          // Optional: modal can show gate reasons if you wire it
          completionGate={{
            canComplete: (() => {
              // safe compute from latest enriched object if possible
              const live = enriched.find((x) => String(x.id) === String(detailItem.id));
              return live ? canComplete(live) : canComplete(detailItem);
            })(),
            reason: (() => {
              const live = enriched.find((x) => String(x.id) === String(detailItem.id));
              return live ? getCompleteBlockReason(live) : getCompleteBlockReason(detailItem);
            })(),
            routeToEscrow: () => {
              if (detailItem?._agId) navigate(`/app/agreements/${detailItem._agId}/wizard?step=4`);
            },
          }}
          onClose={() => {
            setDetailOpen(false);
            setDetailItem(null);
          }}
          onSaved={reload}
          onCompleted={reload}
          onSubmit={({ id, notes, files }) => submitComplete({ id, notes, files })}
        />
      )}

      <RefundEscrowModal
        open={refundOpen}
        onClose={() => setRefundOpen(false)}
        agreementId={refundAgreementId}
        agreementLabel={refundAgreementLabel}
        preselectedMilestoneIds={refundPreselected}
        onRefunded={() => reload()}
      />
    </div>
  );
}