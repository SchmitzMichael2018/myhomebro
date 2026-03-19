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
  Zap,
  MinusCircle,
  FileText,
  Download,
  ExternalLink,
} from "lucide-react";

console.log("AgreementList.jsx v2026-03-03 — Customer wording pass");

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

function statusPillClass(status) {
  const s = safeLower(status);
  if (s === "draft") return "bg-gray-100 text-gray-800";
  if (s === "signed") return "bg-amber-100 text-amber-800";
  if (s === "funded") return "bg-green-100 text-green-800";
  if (s === "in_progress") return "bg-blue-100 text-blue-800";
  if (s === "completed") return "bg-slate-200 text-slate-900";
  if (s === "cancelled") return "bg-red-100 text-red-800";
  return "bg-gray-100 text-gray-800";
}

function prettyStatus(status) {
  const s = String(status || "").trim();
  if (!s) return "—";
  return s.replaceAll("_", " ");
}

const pick = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== "") ?? "";

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

export default function AgreementList() {
  const navigate = useNavigate();
  const location = useLocation();

  // ✅ Base route for contractor vs employee console
  const BASE = useMemo(() => {
    const p = location.pathname || "";
    return p.startsWith("/app/employee") ? "/app/employee" : "/app";
  }, [location.pathname]);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const [selected, setSelected] = useState(() => new Set());
  const [primaryId, setPrimaryId] = useState(null);

  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [pageSize, setPageSize] = useState(10);

  const [busyDeleteRow, setBusyDeleteRow] = useState(null);
  const [busyAmendRow, setBusyAmendRow] = useState(null);

  const [hmIndex, setHmIndex] = useState({});
  const [msStats, setMsStats] = useState({});

  // ✅ show archived toggle
  const [showArchived, setShowArchived] = useState(false);

  // ✅ action busy flags
  const [busyCompleteRow, setBusyCompleteRow] = useState(null);
  const [busyArchiveRow, setBusyArchiveRow] = useState(null);

  // ✅ PDF History dropdown state + cache
  const [pdfOpenForId, setPdfOpenForId] = useState(null);
  const [pdfLoadingForId, setPdfLoadingForId] = useState(null);
  const [pdfCache, setPdfCache] = useState({});
  const pdfPopoverRef = useRef(null);

  useEffect(() => {
    const onDown = (e) => {
      if (!pdfOpenForId) return;
      const el = pdfPopoverRef.current;
      if (el && el.contains(e.target)) return;
      setPdfOpenForId(null);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setPdfOpenForId(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [pdfOpenForId]);

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

  const fetchStatsFor = async (subset) => {
    const ids = subset.map((r) => r.id).filter((id) => !msStats[id]);
    if (ids.length === 0) return;

    const limit = 5;
    let idx = 0;

    const runOne = async () => {
      const i = idx++;
      if (i >= ids.length) return;
      const agreementId = ids[i];
      try {
        const { data } = await api.get(`/projects/agreements/${agreementId}/milestones/`, {
          params: { _ts: Date.now() },
          headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
        });
        const list = Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : [];
        const total = list.length;
        const complete = list.filter(isMsComplete).length;
        const percent = total > 0 ? Math.round((complete / total) * 100) : 0;
        setMsStats((prev) => ({ ...prev, [agreementId]: { total, complete, percent } }));
      } catch (e) {
        console.warn("Milestone stats fetch failed for agreement", agreementId, e?.response?.status || e);
      } finally {
        await runOne();
      }
    };

    const starters = Math.min(limit, ids.length);
    await Promise.all(Array.from({ length: starters }, runOne));
  };

  const load = useCallback(async () => {
    try {
      setLoading(true);

      const { data } = await api.get("/projects/agreements/", {
        params: {
          page_size: 250,
          include_archived: showArchived ? 1 : 0,
          _ts: Date.now(),
        },
        headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
      });

      const list = Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : [];
      setRows(list);

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

      setHmIndex(index);
      fetchStatsFor(list.slice(0, pageSize));
    } catch (e) {
      console.error(e);
      toast.error("Failed to load agreements.");
    } finally {
      setLoading(false);
    }
  }, [fetchStatsFor, pageSize, showArchived]);

  useEffect(() => {
    load();
    const onStorage = (e) => {
      if (e.key === "agreements:refresh" && e.newValue === "1") {
        localStorage.removeItem("agreements:refresh");
        load();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [load]);

  useEffect(() => {
    fetchStatsFor(rows.slice(0, pageSize));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, pageSize]);

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
    return rows
      .filter((r) => (statusFilter === "all" ? true : String(r.status || "").toLowerCase() === statusFilter))
      .filter((r) => {
        if (!search) return true;
        const homeownerLabel = homeownerDisplay(r);

        const hay = [
          r.id,
          r.status,
          r.project_title,
          r.title,
          r.project_type,
          r.project_subtype,
          r.homeowner_name,
          r.homeowner_email,
          homeownerLabel,
          r?.homeowner?.full_name,
          r?.homeowner?.name,
          r?.homeowner?.email,
          r?.payment_mode,
          r?.pdf_version,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return hay.includes(search);
      });
  }, [rows, q, statusFilter, homeownerDisplay]);

  const page = filtered.slice(0, pageSize);

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
      await load();
      return;
    } catch (e1) {
      const d1 = e1?.response?.data;
      if (d1?.detail) toast.error(String(d1.detail));
      try {
        await api.post("/projects/agreements/merge/", { agreement_ids: ids });
        toast.success("Agreements merged.");
        setSelected(new Set());
        setPrimaryId(null);
        await load();
        return;
      } catch (e2) {
        const d2 = e2?.response?.data;
        if (d2?.detail) toast.error(String(d2.detail));
        toast.error(String(d2?.detail || d1?.detail || "Merge failed."));
      }
    }
  };

  const goEdit = (id) => navigate(`${BASE}/agreements/${id}/wizard?step=1`);
  const goView = (id) => navigate(`${BASE}/agreements/${id}/wizard?step=4`);
  const goDetail = (id) => navigate(`${BASE}/agreements/${id}`);

  const deleteDraft = async (row) => {
    if (String(row.status).toLowerCase() !== "draft") {
      return toast.error("Only draft agreements can be deleted.");
    }
    if (!confirm(`Delete draft Agreement #${row.id}? This cannot be undone.`)) return;
    try {
      setBusyDeleteRow(row.id);
      await api.delete(`/projects/agreements/${row.id}/`);
      toast.success(`Agreement #${row.id} deleted.`);
      await load();
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
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">
          <MinusCircle size={14} /> {who}: Waived
        </span>
      );
    }
    if (state === "signed") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800">
          <CheckCircle2 size={14} /> {who}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800">
        <XCircle size={14} /> {who}
      </span>
    );
  };

  const renderProject = (r) => {
    const raw = (r.project_title || r.title || "").trim();
    if (/^agreement\s*#\d+$/i.test(raw)) return "—";
    return raw || "—";
  };
  const renderType = (r) => r.project_type || "—";
  const renderSubtype = (r) => r.project_subtype || "—";

  const Progress = ({ percent }) => (
    <div className="w-24">
      <div className="h-2 bg-gray-200 rounded">
        <div className="h-2 bg-blue-600 rounded" style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
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
      await load();
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
      await load();
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
      await load();
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
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-800">
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
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800">
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
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800"
          title={`${fmtMoney(funded)} / ${fmtMoney(total)}`}
        >
          <CheckCircle2 size={14} /> Funded
        </span>
      );
    }

    if (isPartial) {
      return (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800"
          title={`${fmtMoney(funded)} / ${fmtMoney(total)}`}
        >
          <RefreshCw size={14} /> Partial
        </span>
      );
    }

    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-800"
        title={`${fmtMoney(funded)} / ${fmtMoney(total)}`}
      >
        <XCircle size={14} /> Not Funded
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
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-800 hover:bg-slate-200"
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
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
            hasHistory
              ? "border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100"
              : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
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
          {pdfLoadingForId === id ? "Loading…" : "History"}
        </button>

        <button
          type="button"
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md border hover:bg-gray-50"
          title="Open current PDF"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!currentUrl) return toast("No current PDF URL available.");
            openInNewTab(currentUrl);
          }}
        >
          <ExternalLink size={14} />
        </button>

        <button
          type="button"
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md border hover:bg-gray-50"
          title="Download current PDF"
          onClick={async (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!currentUrl) return toast("No current PDF URL available.");
            try {
              await downloadWithCredentials(currentUrl, `agreement_${id}_v${ver || "x"}.pdf`);
              toast.success("Downloaded.");
            } catch (err) {
              console.error(err);
              toast.error("Download failed.");
            }
          }}
        >
          <Download size={14} />
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

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by project, customer, type, subtype, email, ID…"
          className="border rounded-lg px-3 py-2 w-80"
        />

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border rounded-lg px-3 py-2"
        >
          <option value="all">All Status</option>
          <option value="draft">draft</option>
          <option value="signed">signed</option>
          <option value="funded">funded</option>
          <option value="in_progress">in_progress</option>
          <option value="completed">completed</option>
          <option value="cancelled">cancelled</option>
        </select>

        <label className="inline-flex items-center gap-2 px-3 py-2 border rounded-lg bg-white">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => {
              setShowArchived(e.target.checked);
              setSelected(new Set());
              setPrimaryId(null);
            }}
          />
          <span className="text-sm">Show archived</span>
        </label>

        <select
          value={pageSize}
          onChange={(e) => setPageSize(Number(e.target.value))}
          className="border rounded-lg px-3 py-2"
        >
          {[10, 20, 50, 100, 250].map((n) => (
            <option key={n} value={n}>
              {n} / page
            </option>
          ))}
        </select>

        <button
          onClick={load}
          className="inline-flex items-center gap-2 px-3 py-2 border rounded-lg hover:bg-gray-50"
          title="Refresh"
        >
          <RefreshCw size={16} /> Refresh
        </button>

        <div className="flex-1" />

        <button
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
          title="New Agreement"
          onClick={() => navigate(`${BASE}/agreements/new/wizard?step=1`)}
        >
          <Plus size={16} /> New Agreement
        </button>

        <button
          className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg ${
            selected.size >= 2
              ? "bg-indigo-600 text-white hover:bg-indigo-700"
              : "bg-gray-300 text-gray-600 cursor-not-allowed"
          }`}
          disabled={selected.size < 2}
          onClick={mergeSelected}
          title="Merge Selected"
        >
          <Layers size={16} /> Merge Selected
        </button>
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-white shadow-sm overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-2 border">
                <input
                  type="checkbox"
                  onChange={toggleAll}
                  checked={page.length > 0 && page.every((r) => selected.has(r.id))}
                />
              </th>
              <th className="p-2 text-left border">Primary</th>
              <th className="p-2 text-left border">Agreement ID</th>
              <th className="p-2 text-left border">Status</th>
              <th className="p-2 text-left border">Escrow</th>
              <th className="p-2 text-left border">PDF</th>
              <th className="p-2 text-left border">Project</th>
              <th className="p-2 text-left border">Type</th>
              <th className="p-2 text-left border">Subtype</th>
              <th className="p-2 text-left border">Customer</th>
              <th className="p-2 text-left border">Start</th>
              <th className="p-2 text-left border">End</th>
              <th className="p-2 text-right border">Milestones</th>
              <th className="p-2 text-left border">% Complete</th>
              <th className="p-2 text-left border">Signatures</th>
              <th className="p-2 text-right border">Total</th>
              <th className="p-2 text-right border">Invoices</th>
              <th className="p-2 text-left border">Actions</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td className="p-3 border text-gray-600" colSpan={18}>
                  Loading…
                </td>
              </tr>
            ) : page.length === 0 ? (
              <tr>
                <td className="p-3 border text-gray-500" colSpan={18}>
                  No agreements found.
                </td>
              </tr>
            ) : (
              page.map((r) => {
                const isChecked = selected.has(r.id);
                const isPrimary = primaryId === r.id;
                const stat = msStats[r.id] || { total: 0, complete: 0, percent: 0 };
                const homeowner = homeownerDisplay(r);
                const fullySigned = isFullySignedAgreement(r);

                const statusLower = safeLower(r.status);
                const isCompleted = statusLower === "completed";
                const isArchived = !!r.is_archived;

                const canMarkComplete =
                  stat.total > 0 &&
                  stat.percent >= 100 &&
                  (statusLower === "funded" || statusLower === "in_progress" || statusLower === "signed") &&
                  !isCompleted;

                const canArchive = !isArchived && (isCompleted || statusLower === "cancelled");
                const canUnarchive = isArchived;

                const contrReq = reqContractor(r);
                const custReq = reqCustomer(r);

                const contrState = contrReq ? (contractorSigned(r) ? "signed" : "unsigned") : "waived";
                const custState = custReq ? (homeownerSigned(r) ? "signed" : "unsigned") : "waived";

                return (
                  <tr
                    key={r.id}
                    className="odd:bg-white even:bg-gray-50 hover:bg-blue-50 cursor-pointer"
                    onClick={() => goView(r.id)}
                    title="Click to view agreement"
                  >
                    <td className="p-2 border">
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

                    <td className="p-2 border">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          choosePrimary(r.id);
                        }}
                        disabled={!isChecked}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border ${
                          isChecked
                            ? isPrimary
                              ? "bg-yellow-100 border-yellow-300"
                              : "hover:bg-gray-50"
                            : "text-gray-400 cursor-not-allowed"
                        }`}
                        title={isChecked ? (isPrimary ? "Primary" : "Set as Primary") : "Select row first"}
                      >
                        <Star size={14} />
                        <span className="text-xs font-semibold">{isPrimary ? "Primary" : "Set"}</span>
                      </button>
                    </td>

                    <td className="p-2 border">#{r.id}</td>

                    <td className="p-2 border">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-semibold ${statusPillClass(r.status)}`}
                        title={isArchived ? "Archived" : ""}
                      >
                        {prettyStatus(r.status)}
                        {isArchived ? " (archived)" : ""}
                      </span>
                    </td>

                    <td className="p-2 border">
                      <EscrowBadge r={r} />
                    </td>

                    <td className="p-2 border">
                      <PdfBadge r={r} />
                    </td>

                    <td className="p-2 border max-w-[320px] truncate" title={renderProject(r)}>
                      {renderProject(r)}
                    </td>

                    <td className="p-2 border whitespace-nowrap" title={renderType(r)}>
                      {renderType(r)}
                    </td>

                    <td className="p-2 border whitespace-nowrap" title={renderSubtype(r)}>
                      {renderSubtype(r)}
                    </td>

                    <td className="p-2 border max-w-[320px] truncate" title={homeowner}>
                      {homeowner}
                    </td>

                    <td className="p-2 border">{fmtDate(r.start)}</td>
                    <td className="p-2 border">{fmtDate(r.end)}</td>

                    <td className="p-2 border text-right">
                      {stat.total ? `${stat.complete} / ${stat.total}` : "—"}
                    </td>

                    <td className="p-2 border">
                      <div className="flex items-center gap-2">
                        <Progress percent={stat.percent} />
                        <span className="w-10 text-xs">{stat.percent}%</span>
                      </div>
                    </td>

                    <td className="p-2 border">
                      <div className="flex items-center gap-2">
                        <SignatureBadge state={contrState} who="Contractor" />
                        <SignatureBadge state={custState} who="Customer" />
                      </div>
                    </td>

                    <td className="p-2 border text-right">
                      {fmtMoney(r.display_total ?? r.total_cost)}
                    </td>

                    <td className="p-2 border text-right">{Number(r.invoices_count || 0)}</td>

                    <td className="p-2 border">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            goView(r.id);
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md border hover:bg-gray-50"
                          title="View agreement"
                        >
                          <Eye size={14} /> View
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            goEdit(r.id);
                          }}
                          disabled={fullySigned}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border ${
                            fullySigned ? "border-gray-300 text-gray-400 cursor-not-allowed" : "hover:bg-gray-50"
                          }`}
                          title={fullySigned ? "Fully signed. Use Amend to modify." : "Continue Editing"}
                        >
                          <Pencil size={14} /> Edit
                        </button>

                        {fullySigned && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              createAmendment(r);
                            }}
                            disabled={busyAmendRow === r.id}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-amber-400 text-amber-700 hover:bg-amber-50 disabled:opacity-60"
                            title="Create amendment"
                          >
                            {busyAmendRow === r.id ? (
                              <>
                                <RefreshCw size={14} className="animate-spin" /> Amending…
                              </>
                            ) : (
                              <>
                                <Layers size={14} /> Amend
                              </>
                            )}
                          </button>
                        )}

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            markComplete(r, stat);
                          }}
                          disabled={!canMarkComplete || busyCompleteRow === r.id}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border ${
                            canMarkComplete
                              ? "border-green-300 text-green-800 hover:bg-green-50"
                              : "border-gray-300 text-gray-400 cursor-not-allowed"
                          }`}
                          title={canMarkComplete ? "Mark agreement completed" : "Requires 100% milestones + funded/in_progress/signed"}
                        >
                          {busyCompleteRow === r.id ? (
                            <>
                              <RefreshCw size={14} className="animate-spin" /> Completing…
                            </>
                          ) : (
                            <>
                              <Check size={14} /> Complete
                            </>
                          )}
                        </button>

                        {canUnarchive ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              unarchiveAgreement(r);
                            }}
                            disabled={busyArchiveRow === r.id}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-300 text-slate-800 hover:bg-slate-50 disabled:opacity-60"
                            title="Unarchive agreement"
                          >
                            {busyArchiveRow === r.id ? (
                              <>
                                <RefreshCw size={14} className="animate-spin" /> Restoring…
                              </>
                            ) : (
                              <>
                                <Undo2 size={14} /> Unarchive
                              </>
                            )}
                          </button>
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              archiveAgreement(r);
                            }}
                            disabled={!canArchive || busyArchiveRow === r.id}
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border ${
                              canArchive
                                ? "border-slate-300 text-slate-800 hover:bg-slate-50"
                                : "border-gray-300 text-gray-400 cursor-not-allowed"
                            }`}
                            title={canArchive ? "Archive agreement" : "Archive enabled only for completed/cancelled"}
                          >
                            {busyArchiveRow === r.id ? (
                              <>
                                <RefreshCw size={14} className="animate-spin" /> Archiving…
                              </>
                            ) : (
                              <>
                                <Archive size={14} /> Archive
                              </>
                            )}
                          </button>
                        )}

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteDraft(r);
                          }}
                          disabled={busyDeleteRow === r.id}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-md ${
                            String(r.status).toLowerCase() === "draft"
                              ? "border border-red-300 text-red-700 hover:bg-red-50"
                              : "border border-gray-300 text-gray-400 cursor-not-allowed"
                          }`}
                          title="Delete Draft"
                        >
                          <Trash2 size={14} /> {busyDeleteRow === r.id ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="mhb-helper-text mt-3">
        Showing {Math.min(page.length, filtered.length)} of {filtered.length}. Select 2+ rows, choose a <b>Primary</b> (star), then click{" "}
        <b>Merge Selected</b>. Fully executed agreements can no longer be edited directly; use <b>Amend</b> to create a new Amendment and re-sign.
      </div>
    </div>
  );
}
