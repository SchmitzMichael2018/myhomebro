// src/pages/ExpensesPage.jsx
import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import toast from "react-hot-toast";
import api from "../api";
import ContractorPageSurface from "../components/dashboard/ContractorPageSurface.jsx";

// ---------- helpers ----------
const todayISO = () => new Date().toISOString().slice(0, 10);

const toMoney = (n) =>
  Number(n || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });

function agreementLabel(a) {
  const title = a.project_title || a.title || a.project?.title || "Untitled";
  const homeowner =
    a.homeowner_name ||
    a.project?.homeowner?.full_name ||
    a.project?.homeowner?.name ||
    "";
  return `#${a.id} — ${title}${homeowner ? ` (${homeowner})` : ""}`;
}

function agreementTitleOnly(a) {
  const title = a.project_title || a.title || a.project?.title || "Untitled";
  return `#${a.id} — ${title}`;
}

function projectFromExpenseRequest(er, agreementsMap) {
  const agr = agreementsMap.get(String(er.agreement || er.agreement_id || ""));
  return (
    er.project_title ||
    er.project?.title ||
    agr?.project_title ||
    agr?.title ||
    agr?.project?.title ||
    "N/A"
  );
}

function prettyDT(v) {
  if (!v) return "—";
  try {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toLocaleString();
  } catch {
    return String(v);
  }
}

function statusLabel(s) {
  const v = String(s || "").trim();
  if (!v) return "—";
  return v.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());
}

function statusPillClasses(status) {
  const s = String(status || "").toLowerCase();
  if (s.includes("sent")) return "border-amber-300/35 bg-amber-400/15 text-amber-100";
  if (s.includes("accepted") || s.includes("approved") || s.includes("paid"))
    return "border-emerald-300/35 bg-emerald-400/15 text-emerald-100";
  if (s.includes("draft")) return "border-slate-300/25 bg-slate-400/15 text-sky-100";
  if (s.includes("reject")) return "border-rose-300/35 bg-rose-400/15 text-rose-100";
  return "border-slate-300/25 bg-slate-400/15 text-sky-100";
}

function isImageUrl(url) {
  const u = String(url || "").toLowerCase();
  return (
    u.endsWith(".png") ||
    u.endsWith(".jpg") ||
    u.endsWith(".jpeg") ||
    u.endsWith(".gif") ||
    u.endsWith(".webp")
  );
}

function safeStr(v) {
  if (v === null || v === undefined) return "";
  return String(v);
}

function normalizeStatus(s) {
  return String(s || "").trim().toLowerCase();
}

function sendButtonLabel(status) {
  const s = normalizeStatus(status);
  if (s === "draft") return "Sign & Send";
  if (s === "contractor_signed") return "Send";
  if (s === "sent_to_homeowner") return "Resend";
  return "Send";
}

function canSend(status) {
  const s = normalizeStatus(status);
  return ["draft", "contractor_signed", "sent_to_homeowner"].includes(s);
}

function getAgreementId(er) {
  return String(er?.agreement || er?.agreement_id || "");
}

function isEscrowAgreement(agreement) {
  const values = [
    agreement?.payment_model,
    agreement?.payment_type,
    agreement?.payment_method,
    agreement?.funding_type,
    agreement?.escrow_status,
    agreement?.project?.payment_model,
    agreement?.project?.payment_type,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return values.includes("escrow");
}

function isEscrowExpense(er, agreement) {
  const funding = String(er?.funding_source || "").toLowerCase();
  if (funding) return funding === "incidentals_reserve";
  const kind = String(er?.request_kind || "").toLowerCase();
  return kind.includes("escrow") && isEscrowAgreement(agreement);
}

function fundingSourceLabel(er, agreement) {
  return isEscrowExpense(er, agreement) ? "Incidentals Reserve" : "Reimbursement";
}

function categoryLabel(v) {
  const raw = String(v || "other").replaceAll("_", " ");
  return raw.replace(/\b\w/g, (c) => c.toUpperCase());
}

function expenseMerchant(er) {
  return (
    er?.merchant ||
    er?.vendor ||
    er?.supplier ||
    er?.store_name ||
    er?.description ||
    "Unspecified merchant"
  );
}

function submittedByLabel(er) {
  return (
    er?.submitted_by_name ||
    er?.created_by_name ||
    er?.contractor_name ||
    er?.submitted_by?.full_name ||
    er?.created_by?.full_name ||
    "Contractor"
  );
}

function hasReceipt(er) {
  return Boolean(er?.receipt_url || er?.receipt || (Array.isArray(er?.attachments) && er.attachments.length));
}

function statusBucket(status) {
  const s = normalizeStatus(status);
  if (["homeowner_accepted", "approved", "paid", "released", "pending_release"].includes(s)) return "approved";
  if (["homeowner_rejected", "denied", "cancelled"].includes(s)) return "rejected";
  if (["draft", "submitted", "contractor_signed", "sent_to_homeowner", "held"].includes(s)) return "pending";
  return s || "unknown";
}

function getReserveValue(agreement, names) {
  const summary = agreement?.incidentals_reserve_summary || agreement?.project?.incidentals_reserve_summary;
  if (summary) {
    const lookup = {
      incidentals_reserve_original: summary.original,
      incidentals_reserve_amount: summary.original,
      incidentals_reserve_pending: summary.pending,
      incidentals_reserve_used: summary.spent,
      incidentals_reserve_remaining: summary.remaining,
    };
    for (const name of names) {
      const value = lookup[name];
      if (value !== undefined && value !== null && value !== "" && !Number.isNaN(Number(value))) {
        return Number(value);
      }
    }
  }
  for (const name of names) {
    const value = agreement?.[name] ?? agreement?.project?.[name];
    if (value !== undefined && value !== null && value !== "" && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function getAuditEvents(er) {
  const events = [
    ["Created", er?.created_at],
    ["Submitted", er?.submitted_at],
    ["Contractor signed", er?.contractor_signed_at],
    ["Customer acted", er?.homeowner_acted_at],
    ["Approved", er?.approved_at],
    ["Denied", er?.denied_at],
    ["Paid", er?.paid_at],
    ["Released", er?.released_at],
    ["Updated", er?.updated_at],
  ].filter(([, at]) => Boolean(at));
  return events;
}

async function tryGet(urls, config) {
  let lastErr = null;
  for (const u of urls) {
    try {
      const res = await api.get(u, config);
      return { ok: true, url: u, data: res.data };
    } catch (e) {
      lastErr = e;
    }
  }
  return { ok: false, err: lastErr };
}

async function tryPost(urls, payload, config) {
  let lastErr = null;
  for (const u of urls) {
    try {
      const res = await api.post(u, payload, config);
      return { ok: true, url: u, data: res.data };
    } catch (e) {
      lastErr = e;
    }
  }
  return { ok: false, err: lastErr };
}

async function tryPatch(urls, payload, config) {
  let lastErr = null;
  for (const u of urls) {
    try {
      const res = await api.patch(u, payload, config);
      return { ok: true, url: u, data: res.data };
    } catch (e) {
      lastErr = e;
    }
  }
  return { ok: false, err: lastErr };
}

async function tryDelete(urls) {
  let lastErr = null;
  for (const u of urls) {
    try {
      const res = await api.delete(u);
      return { ok: true, url: u, data: res.data };
    } catch (e) {
      lastErr = e;
    }
  }
  return { ok: false, err: lastErr };
}

// ---------- RESIZABLE modal ----------
function SimpleModal({
  open,
  title,
  onClose,
  children,
  maxWidthClass = "max-w-3xl",
  isFullscreen = false,
  onToggleFullscreen = null,
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        role="button"
        tabIndex={-1}
      />

      <div
        className={[
          "relative bg-white rounded-2xl shadow-xl border border-gray-200",
          isFullscreen ? "w-[96vw] h-[92vh]" : `w-[92vw] ${maxWidthClass}`,
        ].join(" ")}
        style={
          isFullscreen
            ? { overflow: "hidden" }
            : {
                resize: "both",
                overflow: "auto",
                minWidth: 520,
                minHeight: 420,
                maxWidth: "96vw",
                maxHeight: "92vh",
              }
        }
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 sticky top-0 bg-white z-10">
          <div className="font-semibold text-gray-900">{title}</div>

          <div className="flex items-center gap-2">
            {onToggleFullscreen ? (
              <button
                className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-700"
                onClick={onToggleFullscreen}
                type="button"
              >
                {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
              </button>
            ) : null}

            <button
              className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-700"
              onClick={onClose}
              type="button"
            >
              Close
            </button>
          </div>
        </div>

        <div
          className="p-4"
          style={isFullscreen ? { overflow: "auto", maxHeight: "calc(92vh - 58px)" } : undefined}
        >
          {children}
        </div>

        {!isFullscreen ? (
          <div className="px-4 pb-3 text-[11px] text-gray-400">
            Tip: drag the bottom-right corner to resize.
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------- add expense form ----------
const AddExpenseForm = ({ agreements, onAdd, submitting }) => {
  const fileRef = useRef(null);
  const inputClass =
    "min-h-[46px] w-full rounded-xl border border-white/15 bg-slate-950/55 px-3 py-2 text-sm font-semibold text-sky-50 outline-none placeholder:text-sky-100/45 focus:border-sky-300/60 focus:bg-slate-950/75";
  const labelClass = "mb-1.5 block text-sm font-semibold text-sky-100/85";

  const [form, setForm] = useState({
    agreement: "",
    category: "other",
    funding_source: "",
    description: "",
    amount: "",
    incurred_date: todayISO(),
    send_to_homeowner: true,
    note: "",
    files: [],
  });

  const onChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((f) => ({ ...f, [name]: type === "checkbox" ? checked : value }));
  };

  const onFiles = (e) => {
    const picked = Array.from(e.target.files || []);
    setForm((f) => ({ ...f, files: picked }));
  };

  const selectedAgreement = agreements.find((a) => String(a.id) === String(form.agreement));
  const selectedIsEscrow = isEscrowAgreement(selectedAgreement);
  const selectedReserveRemaining = getReserveValue(selectedAgreement, ["incidentals_reserve_remaining", "incidentals_reserve_amount"]) || 0;
  const incidentalsAvailable = selectedIsEscrow && selectedReserveRemaining > 0;
  const selectedFundingSource = form.funding_source || (incidentalsAvailable ? "incidentals_reserve" : "reimbursement");

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!form.agreement) return toast.error("Please select an agreement.");
    if (!form.description.trim()) return toast.error("Add a short description.");
    if (!form.amount || Number(form.amount) <= 0) return toast.error("Enter a positive amount.");

    await onAdd({
      agreement: form.agreement,
      category: form.category || "other",
      funding_source: selectedFundingSource,
      request_kind: selectedFundingSource === "incidentals_reserve" ? "escrow_reimbursement" : "direct_expense",
      description: form.description.trim(),
      amount: Number(form.amount),
      incurred_date: form.incurred_date || todayISO(),
      send_to_homeowner: !!form.send_to_homeowner,
      notes_to_homeowner: form.note?.trim() || "",
      files: form.files || [],
    });

    setForm({
      agreement: "",
      category: "other",
      funding_source: "",
      description: "",
      amount: "",
      incurred_date: todayISO(),
      send_to_homeowner: true,
      note: "",
      files: [],
    });

    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <form
      onSubmit={onSubmit}
      className="grid grid-cols-1 gap-4 rounded-2xl border border-white/12 bg-slate-950/45 p-5 shadow-sm sm:grid-cols-2 md:grid-cols-12"
    >
      <div className="md:col-span-4">
        <label className={labelClass}>Agreement</label>
        <select
          name="agreement"
          value={form.agreement}
          onChange={onChange}
          className={inputClass}
          required
        >
          <option value="">— Select Agreement —</option>
          {agreements.map((a) => (
            <option key={a.id} value={a.id}>
              {agreementLabel(a)}
            </option>
          ))}
        </select>
      </div>

      <div className="md:col-span-3">
        <label className={labelClass}>Merchant / Title</label>
        <input
          name="description"
          placeholder="Expense title (e.g., Nails, Dumpster fee)"
          value={form.description}
          onChange={onChange}
          className={inputClass}
          required
        />
      </div>

      <div className="md:col-span-2">
        <label className={labelClass}>Category</label>
        <select
          name="category"
          value={form.category}
          onChange={onChange}
          className={inputClass}
        >
          <option value="materials">Materials</option>
          <option value="permit">Permit</option>
          <option value="rental">Rental</option>
          <option value="delivery">Delivery</option>
          <option value="other">Other</option>
        </select>
      </div>

      <div className="md:col-span-2">
        <label className={labelClass}>Funding Source</label>
        <select
          name="funding_source"
          value={selectedFundingSource}
          onChange={onChange}
          className={inputClass}
        >
          <option value="incidentals_reserve" disabled={!incidentalsAvailable}>
            Incidentals Reserve
          </option>
          <option value="reimbursement">Reimbursement</option>
        </select>
        {!incidentalsAvailable ? (
          <div className="mt-2 text-[11px] text-sky-100/60">
            Incidentals Reserve is available only for escrow agreements with remaining reserve.
          </div>
        ) : null}
      </div>

      <div className="md:col-span-2">
        <label className={labelClass}>Amount</label>
        <input
          name="amount"
          type="number"
          step="0.01"
          placeholder="Amount"
          value={form.amount}
          onChange={onChange}
          className={inputClass}
          required
        />
      </div>

      <div className="md:col-span-1">
        <label className={labelClass}>Expense Date</label>
        <input
          name="incurred_date"
          type="date"
          value={form.incurred_date}
          onChange={onChange}
          className={inputClass}
          required
        />
      </div>

      <div className="md:col-span-8">
        <label className={labelClass}>Customer Note</label>
        <input
          name="note"
          placeholder="Details for customer: store/vendor + what was purchased + why (optional)"
          value={form.note}
          onChange={onChange}
          className={inputClass}
        />
        <div className="mt-2 text-[11px] text-sky-100/60">
          Example: “Home Depot — roofing nails + sealant. Needed to complete flashing.”
        </div>
      </div>

      <div className="md:col-span-4">
        <label className={labelClass}>Receipts / Files</label>
        <input
          type="file"
          multiple
          onChange={onFiles}
          className={inputClass}
          accept="image/*,.pdf"
        />
        {form.files?.length ? (
          <div className="mt-2 text-xs text-sky-100/70">
            Selected: <span className="font-semibold">{form.files.length}</span>{" "}
            file{form.files.length === 1 ? "" : "s"}
          </div>
        ) : null}
      </div>

      <div className="md:col-span-12 flex flex-col items-start justify-between gap-4 border-t border-white/10 pt-4 sm:flex-row sm:items-center">
        <div className="space-y-2">
          <div className="inline-flex min-h-[34px] items-center rounded-full border border-white/10 bg-slate-900/55 px-3 text-xs font-bold uppercase tracking-wide text-sky-100/75">
            Funding source: {selectedFundingSource === "incidentals_reserve" ? "Incidentals Reserve" : "Reimbursement"}
          </div>
          <label className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-white/10 bg-slate-900/55 px-3 text-sm font-semibold text-sky-100/80">
            <input
              type="checkbox"
              name="send_to_homeowner"
              checked={!!form.send_to_homeowner}
              onChange={onChange}
            />
            Sign & Send to Customer immediately
          </label>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="inline-flex min-h-[46px] w-full items-center justify-center rounded-xl border border-white/70 bg-white px-5 py-3 text-sm font-bold text-slate-950 shadow-sm transition hover:bg-sky-50 disabled:cursor-not-allowed disabled:border-white/20 disabled:bg-slate-700 disabled:text-sky-100/45 sm:w-auto"
        >
          {submitting ? "Adding…" : "+ Add Expense"}
        </button>
      </div>
    </form>
  );
};

// ---------- page ----------
export default function ExpensesPage() {
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [agreements, setAgreements] = useState([]);
  const [expenseRequests, setExpenseRequests] = useState([]);

  const [agreementFilter, setAgreementFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [fundingFilter, setFundingFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [merchantFilter, setMerchantFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [searchFilter, setSearchFilter] = useState("");

  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [activeExpense, setActiveExpense] = useState(null);
  const [attachmentsList, setAttachmentsList] = useState([]);

  const [emailMsg, setEmailMsg] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);

  const [internalNoteText, setInternalNoteText] = useState("");
  const [internalNotes, setInternalNotes] = useState([]);

  const [modalFullscreen, setModalFullscreen] = useState(false);

  const agreementsMap = useMemo(() => {
    const m = new Map();
    agreements.forEach((a) => m.set(String(a.id), a));
    return m;
  }, [agreements]);

  const fetchAgreements = useCallback(async () => {
    const res = await api.get("/projects/agreements/", { params: { page_size: 200 } });
    const arr = Array.isArray(res.data) ? res.data : res.data?.results || [];
    setAgreements(arr);
  }, []);

  const fetchExpenseRequests = useCallback(async () => {
    const res = await tryGet(["/projects/expense-requests/"], null);
    if (!res.ok) throw res.err;
    const arr = Array.isArray(res.data) ? res.data : res.data?.results || [];
    setExpenseRequests(arr);
    setEnabled(true);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([fetchAgreements(), fetchExpenseRequests()]);
    } catch (e) {
      console.error(e);
      toast.error("Failed to load expenses.");
      setEnabled(false);
    } finally {
      setLoading(false);
    }
  }, [fetchAgreements, fetchExpenseRequests]);

  useEffect(() => {
    load();
  }, [load]);

  const fetchAttachments = useCallback(async (er) => {
    const id = er?.id;
    if (!id) return [];
    const res = await tryGet([`/projects/expense-requests/${id}/attachments/`], null);

    if (res.ok) return Array.isArray(res.data) ? res.data : res.data?.results || res.data?.attachments || [];

    const url = er?.receipt_url || null;
    if (url) return [{ id: `receipt-${id}`, original_name: "Receipt", url }];
    return [];
  }, []);

  const uploadAttachments = useCallback(async (id, files) => {
    if (!id || !files?.length) return { ok: true };

    const fd = new FormData();
    for (const f of files) fd.append("files", f);
    for (const f of files) fd.append("file", f);

    return await tryPost([`/projects/expense-requests/${id}/attachments/`], fd, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  }, []);

  const deleteAttachment = useCallback(async (id, attId) => {
    if (!id || !attId) return { ok: false };
    return await tryDelete([`/projects/expense-requests/${id}/attachments/${attId}/`]);
  }, []);

  const contractorSign = useCallback(async (id) => {
    const res = await tryPost([`/projects/expense-requests/${id}/contractor_sign/`], {});
    if (!res.ok) throw res.err;
    return res.data;
  }, []);

  const sendToHomeowner = useCallback(async (id) => {
    const res = await tryPost([`/projects/expense-requests/${id}/send_to_homeowner/`], {});
    if (!res.ok) throw res.err;
    return res.data;
  }, []);

  const homeownerAccept = useCallback(async (id) => {
    const res = await tryPost([`/projects/expense-requests/${id}/homeowner_accept/`], {});
    if (!res.ok) throw res.err;
    return res.data;
  }, []);

  const homeownerReject = useCallback(async (id) => {
    const res = await tryPost([`/projects/expense-requests/${id}/homeowner_reject/`], {});
    if (!res.ok) throw res.err;
    return res.data;
  }, []);

  const markPaid = useCallback(async (id) => {
    const res = await tryPost([`/projects/expense-requests/${id}/mark_paid/`], {});
    if (!res.ok) throw res.err;
    return res.data;
  }, []);

  const openModal = useCallback(
    async (er) => {
      setActiveExpense(er);
      setAttachmentsList([]);
      setAttachmentsOpen(true);
      setAttachmentsLoading(true);
      setModalFullscreen(false);

      setEmailMsg(er?.notes_to_homeowner || "");

      const key = `mhb_expense_request_notes_${er?.id || "unknown"}`;
      try {
        const raw = localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : [];
        setInternalNotes(Array.isArray(parsed) ? parsed : []);
      } catch {
        setInternalNotes([]);
      }

      try {
        const arr = await fetchAttachments(er);
        setAttachmentsList(arr);
      } catch (e) {
        console.error(e);
        toast.error("Could not load attachments.");
      } finally {
        setAttachmentsLoading(false);
      }
    },
    [fetchAttachments]
  );

  const closeModal = () => {
    setAttachmentsOpen(false);
    setActiveExpense(null);
    setAttachmentsList([]);
    setAttachmentsLoading(false);
    setEmailMsg("");
    setEmailBusy(false);
    setInternalNoteText("");
    setInternalNotes([]);
    setModalFullscreen(false);
  };

  const persistInternalNotes = useCallback((id, notes) => {
    try {
      localStorage.setItem(`mhb_expense_request_notes_${id}`, JSON.stringify(notes));
    } catch {}
  }, []);

  const addInternalNote = () => {
    if (!activeExpense?.id) return;
    const text = internalNoteText.trim();
    if (!text) return;
    const newNote = { id: `${Date.now()}`, text, at: new Date().toISOString() };
    const next = [newNote, ...(internalNotes || [])];
    setInternalNotes(next);
    persistInternalNotes(activeExpense.id, next);
    setInternalNoteText("");
  };

  const deleteInternalNote = (noteId) => {
    if (!activeExpense?.id) return;
    const next = (internalNotes || []).filter((n) => n.id !== noteId);
    setInternalNotes(next);
    persistInternalNotes(activeExpense.id, next);
  };

  const handleDeleteExpenseRequest = async (id) => {
    if (!window.confirm("Delete this expense request?")) return;
    try {
      const res = await tryDelete([`/projects/expense-requests/${id}/`]);
      if (!res.ok) throw res.err;
      toast.success("Expense deleted.");
      await fetchExpenseRequests();
      if (activeExpense?.id === id) closeModal();
    } catch (e) {
      console.error(e);
      toast.error("Failed to delete.");
    }
  };

  const handleUpload = async (er, event) => {
    const picked = Array.from(event.target.files || []);
    if (!picked.length) return;

    try {
      const res = await uploadAttachments(er.id, picked);
      if (!res.ok) throw res.err;
      toast.success("Attachment(s) uploaded.");

      await fetchExpenseRequests();

      if (attachmentsOpen && activeExpense?.id === er.id) {
        setAttachmentsLoading(true);
        const arr = await fetchAttachments(er);
        setAttachmentsList(arr);
        setAttachmentsLoading(false);
      }
    } catch (e) {
      console.error(e);
      toast.error("Upload failed.");
    } finally {
      event.target.value = "";
    }
  };

  const handleDeleteAttachment = async (attId) => {
    if (!activeExpense?.id) return;
    if (!window.confirm("Delete this attachment?")) return;

    try {
      const res = await deleteAttachment(activeExpense.id, attId);
      if (!res.ok) throw res.err;
      toast.success("Attachment deleted.");

      setAttachmentsLoading(true);
      const arr = await fetchAttachments(activeExpense);
      setAttachmentsList(arr);
      setAttachmentsLoading(false);

      await fetchExpenseRequests();
    } catch (e) {
      console.error(e);
      toast.error("Could not delete attachment.");
    }
  };

  // ✅ resend-safe: only sign when status is draft
  const handleSendOrResend = async (er) => {
    if (!er?.id) return;

    const s = normalizeStatus(er.status);

    try {
      setEmailBusy(true);

      await tryPatch([`/projects/expense-requests/${er.id}/`], {
        notes_to_homeowner: emailMsg || er.notes_to_homeowner || "",
      });

      if (s === "draft") {
        await contractorSign(er.id);
      }

      // For contractor_signed OR sent_to_homeowner, just call send_to_homeowner.
      const sent = await sendToHomeowner(er.id);

      const newStatus = normalizeStatus(sent?.status);
      toast.success(newStatus === "sent_to_homeowner" && s === "sent_to_homeowner" ? "Resent to customer." : "Sent to customer.");

      await fetchExpenseRequests();
      const updated = (await api.get(`/projects/expense-requests/${er.id}/`)).data;
      setActiveExpense(updated);
    } catch (e) {
      console.error(e);
      toast.error(e?.response?.data?.detail || "Send/Resend failed.");
    } finally {
      setEmailBusy(false);
    }
  };

  const handleApprove = async () => {
    if (!activeExpense?.id) return;
    try {
      setEmailBusy(true);
      await homeownerAccept(activeExpense.id);
      toast.success("Marked accepted.");
      await fetchExpenseRequests();
      const updated = (await api.get(`/projects/expense-requests/${activeExpense.id}/`)).data;
      setActiveExpense(updated);
    } catch (e) {
      console.error(e);
      toast.error("Approve failed.");
    } finally {
      setEmailBusy(false);
    }
  };

  const handleReject = async () => {
    if (!activeExpense?.id) return;
    try {
      setEmailBusy(true);
      await homeownerReject(activeExpense.id);
      toast.success("Marked rejected.");
      await fetchExpenseRequests();
      const updated = (await api.get(`/projects/expense-requests/${activeExpense.id}/`)).data;
      setActiveExpense(updated);
    } catch (e) {
      console.error(e);
      toast.error("Reject failed.");
    } finally {
      setEmailBusy(false);
    }
  };

  const handleMarkPaid = async () => {
    if (!activeExpense?.id) return;
    try {
      setEmailBusy(true);
      await markPaid(activeExpense.id);
      toast.success("Marked paid.");
      await fetchExpenseRequests();
      const updated = (await api.get(`/projects/expense-requests/${activeExpense.id}/`)).data;
      setActiveExpense(updated);
    } catch (e) {
      console.error(e);
      toast.error("Mark paid failed.");
    } finally {
      setEmailBusy(false);
    }
  };

  const handleAddExpenseRequest = async (form) => {
    setSubmitting(true);
    try {
      const createRes = await tryPost(
        ["/projects/expense-requests/"],
        {
          agreement: Number(form.agreement),
          description: form.description,
          amount: form.amount,
          incurred_date: form.incurred_date,
          request_kind: form.request_kind || "direct_expense",
          funding_source: form.funding_source || "reimbursement",
          category: form.category || "other",
          notes_to_homeowner: form.notes_to_homeowner || "",
        }
      );
      if (!createRes.ok) throw createRes.err;

      const created = createRes.data;

      if (form.files?.length) {
        const up = await uploadAttachments(created.id, form.files);
        if (!up.ok) toast.error("Created, but attachments upload failed.");
      }

      if (form.send_to_homeowner) {
        await tryPatch([`/projects/expense-requests/${created.id}/`], {
          notes_to_homeowner: form.notes_to_homeowner || "",
        });

        // Only sign if draft (it is draft right after create)
        await contractorSign(created.id);
        await sendToHomeowner(created.id);
        toast.success("Expense created & sent.");
      } else {
        toast.success("Expense created.");
      }

      await fetchExpenseRequests();
    } catch (e) {
      console.error(e);
      toast.error(e?.response?.data?.detail || "Failed to create expense.");
    } finally {
      setSubmitting(false);
    }
  };

  const enrichedExpenses = useMemo(() => {
    return (expenseRequests || []).map((er) => {
      const aId = getAgreementId(er);
      const agreement = agreementsMap.get(aId);
      const fundingSource = fundingSourceLabel(er, agreement);
      return {
        ...er,
        _agreement: agreement,
        _agreementId: aId,
        _projectTitle: projectFromExpenseRequest(er, agreementsMap),
        _merchant: expenseMerchant(er),
        _categoryLabel: categoryLabel(er.category),
        _fundingSource: fundingSource,
        _fundingKey: fundingSource === "Incidentals Reserve" ? "incidentals" : "reimbursement",
        _statusBucket: statusBucket(er.status),
        _submittedBy: submittedByLabel(er),
        _hasReceipt: hasReceipt(er),
      };
    });
  }, [expenseRequests, agreementsMap]);

  const filtered = useMemo(() => {
    const sel = String(agreementFilter || "");
    const statusSel = String(statusFilter || "");
    const fundingSel = String(fundingFilter || "");
    const categorySel = String(categoryFilter || "");
    const merchantSel = merchantFilter.trim().toLowerCase();
    const searchSel = searchFilter.trim().toLowerCase();

    return enrichedExpenses.filter((er) => {
      if (sel && er._agreementId !== sel) return false;
      if (statusSel && er._statusBucket !== statusSel) return false;
      if (fundingSel && er._fundingKey !== fundingSel) return false;
      if (categorySel && String(er.category || "other") !== categorySel) return false;
      if (dateFilter && String(er.incurred_date || "").slice(0, 10) !== dateFilter) return false;
      if (merchantSel && !er._merchant.toLowerCase().includes(merchantSel)) return false;
      if (searchSel) {
        const haystack = [
          er._merchant,
          er.description,
          er.notes_to_homeowner,
          er._projectTitle,
          er._fundingSource,
          er._categoryLabel,
          er.status_label,
          er.status,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(searchSel)) return false;
      }
      return true;
    });
  }, [
    agreementFilter,
    categoryFilter,
    dateFilter,
    enrichedExpenses,
    fundingFilter,
    merchantFilter,
    searchFilter,
    statusFilter,
  ]);

  const totalAmount = useMemo(() => {
    return (filtered || []).reduce((s, x) => s + Number(x.amount || 0), 0);
  }, [filtered]);

  const dashboard = useMemo(() => {
    const all = enrichedExpenses;
    const pending = all.filter((x) => x._statusBucket === "pending");
    const approved = all.filter((x) => x._statusBucket === "approved");
    const rejected = all.filter((x) => x._statusBucket === "rejected");
    const incidentals = all.filter((x) => x._fundingKey === "incidentals");
    const escrowAgreements = agreements.filter((a) => isEscrowAgreement(a));
    const configuredReserve = escrowAgreements.reduce((sum, a) => {
      const value = getReserveValue(a, [
        "incidentals_reserve_original",
        "incidentals_reserve_amount",
        "incidentals_reserve",
        "incidentals_budget",
        "escrow_incidentals_reserve",
      ]);
      return sum + Number(value || 0);
    }, 0);
    const reservePending = escrowAgreements.reduce((sum, a) => {
      const value = getReserveValue(a, ["incidentals_reserve_pending"]);
      return sum + Number(value || 0);
    }, 0);
    const reserveSpent = escrowAgreements.reduce((sum, a) => {
      const value = getReserveValue(a, ["incidentals_reserve_used"]);
      return sum + Number(value || 0);
    }, 0);
    const fallbackPending = incidentals
      .filter((x) => x._statusBucket === "pending")
      .reduce((sum, x) => sum + Number(x.amount || 0), 0);
    const fallbackSpent = incidentals
      .filter((x) => x._statusBucket === "approved")
      .reduce((sum, x) => sum + Number(x.amount || 0), 0);
    const incidentalsPending = reservePending || fallbackPending;
    const incidentalsSpent = reserveSpent || fallbackSpent;
    return {
      totalSpent: all.reduce((sum, x) => sum + Number(x.amount || 0), 0),
      pendingReimbursements: pending.filter((x) => x._fundingKey === "reimbursement").length,
      approvedExpenses: approved.length,
      rejectedExpenses: rejected.length,
      incidentalsPending,
      incidentalsSpent,
      originalReserve: configuredReserve || null,
      remainingReserve: configuredReserve ? Math.max(configuredReserve - incidentalsSpent, 0) : null,
      hasEscrowProjects: escrowAgreements.length > 0 || incidentals.length > 0,
    };
  }, [agreements, enrichedExpenses]);

  const clearFilters = () => {
    setAgreementFilter("");
    setStatusFilter("");
    setFundingFilter("");
    setCategoryFilter("");
    setMerchantFilter("");
    setDateFilter("");
    setSearchFilter("");
  };

  if (!enabled) {
    return (
      <div className="p-6">
        <div className="rounded-xl bg-yellow-50 border border-yellow-200 text-yellow-900 p-4">
          <div className="font-semibold">Expense Requests unavailable</div>
          <p className="text-sm mt-1">
            Endpoint <code>/api/projects/expense-requests/</code> was not found. Confirm it is registered in{" "}
            <code>projects/urls.py</code>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ContractorPageSurface
      eyebrow="Business"
      title="Expenses"
      subtitle="Review project expense activity across reimbursements and escrow incidentals without changing payment behavior."
      variant="operational"
      actions={
        <div className="rounded-full border border-white/12 bg-white/10 px-3 py-1.5 text-sm font-semibold text-sky-100/80">
          Filtered:&nbsp;<span className="font-semibold">{toMoney(totalAmount)}</span>
        </div>
      }
    >
      <div className="space-y-6">
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6" data-testid="expenses-summary">
        {[
          ["Pending Reimbursements", dashboard.pendingReimbursements],
          ["Approved Expenses", dashboard.approvedExpenses],
          ["Rejected Expenses", dashboard.rejectedExpenses],
          ["Total Spent", toMoney(dashboard.totalSpent)],
          ["Pending Incidentals", toMoney(dashboard.incidentalsPending)],
          ["Original Reserve", dashboard.originalReserve !== null ? toMoney(dashboard.originalReserve) : "Not configured"],
          ["Remaining Reserve", dashboard.remainingReserve !== null ? toMoney(dashboard.remainingReserve) : "Not configured"],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-white/10 bg-white/10 p-4 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wide text-sky-100/60">{label}</div>
            <div className="mt-2 text-2xl font-bold text-white">{value}</div>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-white/10 bg-slate-950/45 p-5 shadow-sm" data-testid="incidentals-reserve-panel">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-lg font-bold text-white">Incidentals Reserve</div>
            <p className="mt-1 max-w-3xl text-sm text-sky-100/70">
              Escrow incidentals are tracked as a separate project budget bucket. Unused reserve refunding is future behavior and is not applied here.
            </p>
          </div>
          <div className="grid min-w-[320px] grid-cols-4 gap-2 text-center">
            <div className="rounded-xl bg-white/10 p-3">
              <div className="text-[11px] font-bold uppercase text-sky-100/55">Original</div>
              <div className="text-sm font-bold text-white">{dashboard.originalReserve !== null ? toMoney(dashboard.originalReserve) : "--"}</div>
            </div>
            <div className="rounded-xl bg-white/10 p-3">
              <div className="text-[11px] font-bold uppercase text-sky-100/55">Pending</div>
              <div className="text-sm font-bold text-white">{toMoney(dashboard.incidentalsPending)}</div>
            </div>
            <div className="rounded-xl bg-white/10 p-3">
              <div className="text-[11px] font-bold uppercase text-sky-100/55">Spent</div>
              <div className="text-sm font-bold text-white">{toMoney(dashboard.incidentalsSpent)}</div>
            </div>
            <div className="rounded-xl bg-white/10 p-3">
              <div className="text-[11px] font-bold uppercase text-sky-100/55">Remaining</div>
              <div className="text-sm font-bold text-white">{dashboard.remainingReserve !== null ? toMoney(dashboard.remainingReserve) : "--"}</div>
            </div>
          </div>
        </div>
        {dashboard.hasEscrowProjects && dashboard.originalReserve === null ? (
          <div className="mt-4 rounded-xl border border-amber-300/25 bg-amber-400/10 px-4 py-3 text-sm font-semibold text-amber-100">
            No Incidentals Reserve has been configured.
          </div>
        ) : null}
        {!dashboard.hasEscrowProjects ? (
          <div className="mt-4 rounded-xl border border-sky-300/20 bg-sky-400/10 px-4 py-3 text-sm text-sky-100/75">
            Direct-pay projects continue to use the existing reimbursement request workflow.
          </div>
        ) : null}
      </section>
      <div>
        <div className="text-sm text-sky-100/70">
          Create direct-pay reimbursement requests or escrow incidentals using the existing expense request workflow.
        </div>
      </div>

      <div>
        <AddExpenseForm agreements={agreements} onAdd={handleAddExpenseRequest} submitting={submitting} />
      </div>

      <div className="rounded-2xl border border-white/12 bg-slate-950/45 p-4 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-sky-100/75">
          Showing <span className="font-semibold text-white">{filtered.length}</span> expense{filtered.length === 1 ? "" : "s"}
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm font-semibold text-sky-100/75">Filter:</label>
          <select
            value={agreementFilter}
            onChange={(e) => setAgreementFilter(e.target.value)}
            className="min-h-[42px] rounded-xl border border-white/15 bg-slate-950/55 px-3 py-2 text-sm font-semibold text-sky-50 outline-none focus:border-sky-300/60"
          >
            <option value="">All agreements</option>
            {agreements.map((a) => (
              <option key={a.id} value={String(a.id)}>
                {agreementTitleOnly(a)}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={fetchExpenseRequests}
            className="min-h-[42px] rounded-xl border border-white/16 bg-slate-900/70 px-3.5 py-2 text-sm font-semibold text-sky-100 transition hover:border-sky-300/35 hover:bg-sky-500/15"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-7" data-testid="expenses-filters">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="min-h-[42px] rounded-xl border border-white/15 bg-slate-950/55 px-3 py-2 text-sm font-semibold text-sky-50 outline-none focus:border-sky-300/60">
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <select value={fundingFilter} onChange={(e) => setFundingFilter(e.target.value)} className="min-h-[42px] rounded-xl border border-white/15 bg-slate-950/55 px-3 py-2 text-sm font-semibold text-sky-50 outline-none focus:border-sky-300/60">
          <option value="">All funding</option>
          <option value="incidentals">Incidentals Reserve</option>
          <option value="reimbursement">Reimbursement</option>
        </select>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="min-h-[42px] rounded-xl border border-white/15 bg-slate-950/55 px-3 py-2 text-sm font-semibold text-sky-50 outline-none focus:border-sky-300/60">
          <option value="">All categories</option>
          <option value="materials">Materials</option>
          <option value="permit">Permit</option>
          <option value="rental">Rental</option>
          <option value="delivery">Delivery</option>
          <option value="other">Other</option>
        </select>
        <input value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} type="date" className="min-h-[42px] rounded-xl border border-white/15 bg-slate-950/55 px-3 py-2 text-sm font-semibold text-sky-50 outline-none focus:border-sky-300/60" />
        <input value={merchantFilter} onChange={(e) => setMerchantFilter(e.target.value)} placeholder="Merchant" className="min-h-[42px] rounded-xl border border-white/15 bg-slate-950/55 px-3 py-2 text-sm font-semibold text-sky-50 outline-none placeholder:text-sky-100/45 focus:border-sky-300/60" />
        <input value={searchFilter} onChange={(e) => setSearchFilter(e.target.value)} placeholder="Search notes, project, receipt" className="min-h-[42px] rounded-xl border border-white/15 bg-slate-950/55 px-3 py-2 text-sm font-semibold text-sky-50 outline-none placeholder:text-sky-100/45 focus:border-sky-300/60 xl:col-span-2" />
        <button type="button" onClick={clearFilters} className="min-h-[42px] rounded-xl border border-white/16 bg-slate-900/70 px-3.5 py-2 text-sm font-semibold text-sky-100 transition hover:border-sky-300/35 hover:bg-sky-500/15">
          Clear filters
        </button>
      </div>

      <div className="mb-3 text-xs font-semibold text-sky-100/60">
        Active filters: {[agreementFilter && "Project", statusFilter && "Status", fundingFilter && "Funding", categoryFilter && "Category", dateFilter && "Date", merchantFilter && "Merchant", searchFilter && "Search"].filter(Boolean).join(", ") || "None"}
      </div>

      <div className="space-y-3" data-testid="expenses-ledger">
        {loading ? (
          <div className="rounded-2xl border border-white/10 bg-slate-950/35 px-6 py-10 text-center text-sky-100/65">
            Loading expenses...
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/14 bg-slate-950/35 px-6 py-10 text-center text-sm text-sky-100/70">
            {enrichedExpenses.length
              ? "No expenses match the current filters."
              : "No expenses recorded yet. Direct-pay projects can request reimbursement, and escrow projects can charge approved incidentals against the reserve."}
          </div>
        ) : (
          filtered.map((er, idx) => {
            const status = er.status || "--";
            const receiptUrl = er.receipt_url || er.attachments?.[0]?.url || null;
            return (
              <div key={er.id || idx} className="grid gap-4 rounded-2xl border border-white/10 bg-white/8 p-4 text-sky-100/78 lg:grid-cols-[1.5fr_0.85fr_0.75fr_0.85fr_0.9fr_1fr_auto] lg:items-center">
                <div>
                  <button type="button" onClick={() => openModal(er)} className="text-left">
                    <div className="text-base font-bold text-white">{er._merchant}</div>
                    <div className="mt-1 text-xs text-sky-100/55">{er._projectTitle}</div>
                  </button>
                </div>
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wide text-sky-100/50">Category</div>
                  <div className="mt-1 font-semibold text-sky-50">{er._categoryLabel}</div>
                </div>
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wide text-sky-100/50">Amount</div>
                  <div className="mt-1 font-bold text-white">{toMoney(er.amount)}</div>
                </div>
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wide text-sky-100/50">Status</div>
                  <span className={`mt-1 inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${statusPillClasses(status)}`}>
                    {statusLabel(status)}
                  </span>
                </div>
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wide text-sky-100/50">Receipt</div>
                  {receiptUrl ? (
                    <a className="mt-1 inline-flex font-semibold text-sky-200 underline decoration-sky-300/50 underline-offset-2" href={receiptUrl} target="_blank" rel="noreferrer">
                      Open
                    </a>
                  ) : er._hasReceipt ? (
                    <div className="mt-1 font-semibold text-sky-100/70">Attached</div>
                  ) : (
                    <div className="mt-1 text-sky-100/45">Missing</div>
                  )}
                </div>
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wide text-sky-100/50">Submitted / Funding</div>
                  <div className="mt-1 font-semibold text-sky-50">{er._submittedBy}</div>
                  <div className="mt-1 text-xs text-sky-100/60">{er.incurred_date || "--"}</div>
                  <span className="mt-2 inline-flex rounded-full border border-white/12 bg-white/10 px-2.5 py-1 text-xs font-bold text-sky-100">
                    {er._fundingSource}
                  </span>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <label className="cursor-pointer rounded-lg border border-white/16 bg-slate-900/70 px-3 py-2 text-sm font-semibold text-sky-100 hover:border-sky-300/35 hover:bg-sky-500/15">
                    Upload
                    <input type="file" multiple className="hidden" accept="image/*,.pdf" onChange={(evt) => handleUpload(er, evt)} />
                  </label>
                  <button type="button" onClick={() => openModal(er)} className="rounded-lg border border-white/16 bg-slate-900/70 px-3 py-2 text-sm font-semibold text-sky-100 hover:border-sky-300/35 hover:bg-sky-500/15">
                    View
                  </button>
                  <button
                    type="button"
                    disabled={!canSend(status)}
                    onClick={() => {
                      openModal(er);
                      setTimeout(() => handleSendOrResend(er), 0);
                    }}
                    className={`rounded-lg px-3 py-2 text-sm font-semibold text-white ${canSend(status) ? "border border-sky-300/40 bg-sky-500/80 hover:bg-sky-400/80" : "cursor-not-allowed border border-white/10 bg-slate-700 text-sky-100/45"}`}
                  >
                    {sendButtonLabel(status)}
                  </button>
                  <button type="button" onClick={() => handleDeleteExpenseRequest(er.id)} className="rounded-lg border border-rose-300/35 bg-rose-500/10 px-3 py-2 text-sm font-semibold text-rose-100 hover:bg-rose-500/18">
                    Delete
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="hidden overflow-x-auto rounded-xl border border-white/10 bg-slate-950/35">
        <table className="min-w-[1150px] w-full text-sm">
          <thead className="bg-white/8 text-sky-100/75">
            <tr>
              <th className="px-3 py-2 text-left">Merchant</th>
              <th className="px-3 py-2 text-left">Category</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Receipt</th>
              <th className="px-3 py-2 text-left">Submitted By</th>
              <th className="px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-left">Funding Source</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-white/10">
            {loading ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-sky-100/65">
                  Loading…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                  <td colSpan={9} className="px-3 py-12 text-center text-sky-100/70">
                    <div className="mx-auto max-w-md rounded-2xl border border-dashed border-white/14 bg-slate-950/35 px-6 py-8 text-sm text-sky-100/70">
                      No expenses recorded.
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((er, idx) => {
                const aId = String(er.agreement || er.agreement_id || "");
                const a = agreementsMap.get(aId);

                const created = er.created_at || null;
                const expenseDate = er.incurred_date || "—";
                const status = er.status || "—";
                const agreementText = a ? agreementLabel(a) : aId ? `#${aId}` : "—";
                const receiptUrl = er.receipt_url || null;

                return (
                  <tr key={er.id || idx} className="text-sky-100/78 transition hover:bg-sky-500/10">
                    <td className="px-3 py-3 whitespace-nowrap text-sky-100/70">{prettyDT(created)}</td>

                    <td className="px-3 py-3">
                      <div className="font-semibold text-white">{agreementText}</div>
                      {aId ? <div className="text-xs text-sky-100/55">Agreement ID: {aId}</div> : null}
                    </td>

                    <td className="px-3 py-3">{projectFromExpenseRequest(er, agreementsMap)}</td>

                    <td className="px-3 py-3">
                      <div className="font-semibold text-white">{er.description || "—"}</div>
                      {er.notes_to_homeowner ? (
                        <div className="text-xs text-sky-100/55 mt-1 line-clamp-1">{er.notes_to_homeowner}</div>
                      ) : null}
                    </td>

                    <td className="px-3 py-3 text-right font-bold text-white">{toMoney(er.amount)}</td>

                    <td className="px-3 py-3 whitespace-nowrap">{expenseDate}</td>

                    <td className="px-3 py-3">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full border text-xs font-medium ${statusPillClasses(status)}`}>
                        {statusLabel(status)}
                      </span>
                    </td>

                    <td className="px-3 py-3 whitespace-nowrap">
                      {receiptUrl ? (
                        <a className="font-semibold text-sky-200 underline decoration-sky-300/50 underline-offset-2" href={receiptUrl} target="_blank" rel="noreferrer">
                          Open
                        </a>
                      ) : (
                        <span className="text-sky-100/45">—</span>
                      )}
                    </td>

                    <td className="px-3 py-3">
                      <div className="flex flex-wrap justify-end gap-2">
                        <label className="cursor-pointer rounded-lg border border-white/16 bg-slate-900/70 px-3 py-2 text-sm font-semibold text-sky-100 hover:border-sky-300/35 hover:bg-sky-500/15">
                          Upload
                          <input
                            type="file"
                            multiple
                            className="hidden"
                            accept="image/*,.pdf"
                            onChange={(evt) => handleUpload(er, evt)}
                          />
                        </label>

                        <button
                          type="button"
                          onClick={() => openModal(er)}
                           className="rounded-lg border border-white/16 bg-slate-900/70 px-3 py-2 text-sm font-semibold text-sky-100 hover:border-sky-300/35 hover:bg-sky-500/15"
                        >
                          View
                        </button>

                        <button
                          type="button"
                          disabled={!canSend(status)}
                          onClick={() => {
                            openModal(er);
                            setTimeout(() => handleSendOrResend(er), 0);
                          }}
                           className={`rounded-lg px-3 py-2 text-sm font-semibold text-white ${
                             canSend(status) ? "border border-sky-300/40 bg-sky-500/80 hover:bg-sky-400/80" : "cursor-not-allowed border border-white/10 bg-slate-700 text-sky-100/45"
                           }`}
                        >
                          {sendButtonLabel(status)}
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDeleteExpenseRequest(er.id)}
                           className="rounded-lg border border-rose-300/35 bg-rose-500/10 px-3 py-2 text-sm font-semibold text-rose-100 hover:bg-rose-500/18"
                        >
                          Delete
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
      </div>

      <SimpleModal
        open={attachmentsOpen}
        title={activeExpense ? `Expense Details — #${activeExpense.id}` : "Expense Details"}
        onClose={closeModal}
        maxWidthClass="max-w-3xl"
        isFullscreen={modalFullscreen}
        onToggleFullscreen={() => setModalFullscreen((v) => !v)}
      >
        {!activeExpense ? (
          <div className="text-sm text-gray-600">No expense selected.</div>
        ) : (
          <div className="space-y-5">
            {/* Summary */}
            {(() => {
              const aId = String(activeExpense.agreement || activeExpense.agreement_id || "");
              const a = agreementsMap.get(aId);
              const agreementText = a ? agreementLabel(a) : aId ? `Agreement #${aId}` : "—";
              const projectTitle = projectFromExpenseRequest(activeExpense, agreementsMap);
              const status = activeExpense.status || "—";
              const createdAt = activeExpense.created_at || null;
              const fundingSource = fundingSourceLabel(activeExpense, a);
              const merchant = expenseMerchant(activeExpense);
              const incurred = activeExpense.incurred_date || "—";

              return (
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold text-gray-900">{merchant}</div>
                      <div className="text-sm text-gray-700 mt-1">
                        Amount: <span className="font-semibold">{toMoney(activeExpense.amount)}</span>
                      </div>

                      <div className="text-xs text-gray-600 mt-2 space-y-1">
                        <div>
                          <span className="text-gray-500">Category:</span>{" "}
                          <span className="font-semibold">{categoryLabel(activeExpense.category)}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Funding Source:</span>{" "}
                          <span className="font-semibold">{fundingSource}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Agreement:</span>{" "}
                          <span className="font-semibold">{agreementText}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Project:</span>{" "}
                          <span className="font-semibold">{projectTitle}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Incurred Date:</span>{" "}
                          <span className="font-semibold">{incurred}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Created:</span>{" "}
                          <span className="font-semibold">{prettyDT(createdAt)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-start gap-2">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full border text-xs font-medium ${statusPillClasses(status)}`}>
                        {statusLabel(status)}
                      </span>
                    </div>
                  </div>

                  {activeExpense.notes_to_homeowner ? (
                    <div className="mt-3 rounded-lg bg-white border border-gray-200 p-3">
                      <div className="text-xs font-semibold text-gray-700 mb-1">Customer Details</div>
                      <div className="text-sm text-gray-800 whitespace-pre-wrap">{activeExpense.notes_to_homeowner}</div>
                    </div>
                  ) : null}
                  {activeExpense.reserve_impact ? (
                    <div className="mt-3 grid gap-2 rounded-lg bg-white border border-gray-200 p-3 text-sm sm:grid-cols-3">
                      <div>
                        <div className="text-xs font-semibold text-gray-500">Pending Impact</div>
                        <div className="font-semibold text-gray-900">{toMoney(activeExpense.reserve_impact.pending_delta)}</div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-gray-500">Spent Impact</div>
                        <div className="font-semibold text-gray-900">{toMoney(activeExpense.reserve_impact.spent_delta)}</div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-gray-500">Remaining After Approval</div>
                        <div className="font-semibold text-gray-900">{toMoney(activeExpense.reserve_impact.remaining_after_approval)}</div>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })()}

            {/* Audit history */}
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="text-sm font-semibold text-gray-900 mb-2">Audit History</div>
              <div className="text-sm text-gray-700 space-y-1">
                <div>• Created: {prettyDT(activeExpense.created_at)}</div>
                {activeExpense.contractor_signed_at ? (
                  <div>• Contractor signed: {prettyDT(activeExpense.contractor_signed_at)}</div>
                ) : null}
                {activeExpense.homeowner_acted_at ? (
                  <div>• Customer acted: {prettyDT(activeExpense.homeowner_acted_at)}</div>
                ) : null}
                {activeExpense.paid_at ? <div>• Paid: {prettyDT(activeExpense.paid_at)}</div> : null}
              </div>
            </div>

            {/* Actions */}
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="text-sm font-semibold text-gray-900 mb-2">Actions</div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={emailBusy || !canSend(activeExpense.status)}
                  onClick={() => handleSendOrResend(activeExpense)}
                  className={`px-4 py-2 rounded-lg text-white font-semibold ${
                    canSend(activeExpense.status) ? (emailBusy ? "bg-gray-500" : "bg-blue-600 hover:bg-blue-700") : "bg-gray-400 cursor-not-allowed"
                  }`}
                >
                  {emailBusy ? "Working…" : sendButtonLabel(activeExpense.status)}
                </button>

                <button
                  type="button"
                  disabled={emailBusy}
                  onClick={handleApprove}
                  className="px-4 py-2 rounded-lg border border-green-300 bg-white hover:bg-green-50 text-green-800 font-semibold"
                >
                  Mark Accepted
                </button>

                <button
                  type="button"
                  disabled={emailBusy}
                  onClick={handleReject}
                  className="px-4 py-2 rounded-lg border border-red-300 bg-white hover:bg-red-50 text-red-800 font-semibold"
                >
                  Mark Rejected
                </button>

                <button
                  type="button"
                  disabled={emailBusy}
                  onClick={handleMarkPaid}
                  className="px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 font-semibold"
                >
                  Mark Paid
                </button>
              </div>

              <div className="mt-3">
                <div className="text-xs text-gray-600 mb-2">
                  Notes to Customer (store/vendor/details). Saved to <code>notes_to_homeowner</code>.
                </div>
                <textarea
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[90px]"
                  value={emailMsg}
                  onChange={(e) => setEmailMsg(e.target.value)}
                />
              </div>
            </div>

            {/* Internal notes */}
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="text-sm font-semibold text-gray-900 mb-2">Internal Notes (Contractor Only)</div>
              <div className="flex gap-2">
                <input
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  value={internalNoteText}
                  onChange={(e) => setInternalNoteText(e.target.value)}
                  placeholder="Add an internal note…"
                />
                <button
                  type="button"
                  onClick={addInternalNote}
                  className="px-4 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800 text-sm font-semibold"
                >
                  Add
                </button>
              </div>

              <div className="mt-3 space-y-2">
                {internalNotes.length === 0 ? (
                  <div className="text-sm text-gray-500">No internal notes yet.</div>
                ) : (
                  internalNotes.map((n) => (
                    <div key={n.id} className="flex items-start justify-between gap-3 border border-gray-200 rounded-lg p-3">
                      <div className="min-w-0">
                        <div className="text-sm text-gray-800 whitespace-pre-wrap">{n.text}</div>
                        <div className="text-[11px] text-gray-500 mt-1">{prettyDT(n.at)}</div>
                      </div>
                      <button
                        type="button"
                        className="text-xs text-red-700 hover:underline whitespace-nowrap"
                        onClick={() => deleteInternalNote(n.id)}
                      >
                        Delete
                      </button>
                    </div>
                  ))
                )}
              </div>

              <div className="text-[11px] text-gray-500 mt-2">Saved locally on this device/browser.</div>
            </div>

            {/* Attachments */}
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="text-sm font-semibold text-gray-900">Receipts / Photos</div>

                <label className="px-3 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 cursor-pointer">
                  Upload
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    accept="image/*,.pdf"
                    onChange={(evt) => handleUpload(activeExpense, evt)}
                  />
                </label>
              </div>

              {attachmentsLoading ? (
                <div className="text-sm text-gray-600">Loading…</div>
              ) : attachmentsList.length ? (
                <div className="space-y-2">
                  {attachmentsList.map((a, i) => {
                    const name = a.original_name || a.filename || a.name || `Attachment ${i + 1}`;
                    const url = a.url || a.file_url || a.download_url || a.file || null;
                    const attId = a.id;

                    return (
                      <div key={attId || `${name}-${i}`} className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 p-3 bg-white">
                        <div className="flex items-center gap-3 min-w-0">
                          {url && isImageUrl(url) ? (
                            <img src={url} alt={name} className="w-14 h-14 rounded-lg object-cover border border-gray-200" />
                          ) : (
                            <div className="w-14 h-14 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center text-xs text-gray-600">
                              FILE
                            </div>
                          )}

                          <div className="min-w-0">
                            <div className="text-sm font-medium text-gray-900 truncate">{name}</div>
                            {url ? <div className="text-[11px] text-gray-500 truncate">{safeStr(url)}</div> : <div className="text-[11px] text-gray-500">No URL</div>}
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {url ? (
                            <a href={url} target="_blank" rel="noreferrer" className="px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-sm whitespace-nowrap">
                              Open
                            </a>
                          ) : null}

                          {attId && String(attId).match(/^\d+$/) ? (
                            <button type="button" onClick={() => handleDeleteAttachment(attId)} className="px-3 py-2 rounded-lg border border-red-300 bg-white hover:bg-red-50 text-red-700 text-sm whitespace-nowrap">
                              Delete
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-sm text-gray-600">No receipts/photos uploaded yet.</div>
              )}
            </div>
          </div>
        )}
      </SimpleModal>
      </div>
    </ContractorPageSurface>
  );
}
