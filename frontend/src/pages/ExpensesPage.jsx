// src/pages/ExpensesPage.jsx
import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import toast from "react-hot-toast";
import api from "../api";
import ContractorPageSurface from "../components/dashboard/ContractorPageSurface.jsx";

console.log("ExpensesPage.jsx v2026-02-20e — resend-safe: only sign drafts; resend uses send_to_homeowner");

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
  if (s.includes("sent")) return "bg-amber-100 text-amber-900 border-amber-200";
  if (s.includes("accepted") || s.includes("approved") || s.includes("paid"))
    return "bg-green-100 text-green-900 border-green-200";
  if (s.includes("draft")) return "bg-slate-100 text-slate-900 border-slate-200";
  if (s.includes("reject")) return "bg-red-100 text-red-900 border-red-200";
  return "bg-slate-100 text-slate-900 border-slate-200";
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

  const [form, setForm] = useState({
    agreement: "",
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

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!form.agreement) return toast.error("Please select an agreement.");
    if (!form.description.trim()) return toast.error("Add a short description.");
    if (!form.amount || Number(form.amount) <= 0) return toast.error("Enter a positive amount.");

    await onAdd({
      agreement: form.agreement,
      description: form.description.trim(),
      amount: Number(form.amount),
      incurred_date: form.incurred_date || todayISO(),
      send_to_homeowner: !!form.send_to_homeowner,
      notes_to_homeowner: form.note?.trim() || "",
      files: form.files || [],
    });

    setForm({
      agreement: "",
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
      className="grid grid-cols-1 gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-2 md:grid-cols-12"
    >
      <div className="md:col-span-4">
        <label className="mb-1.5 block text-sm font-medium text-slate-700">Agreement</label>
        <select
          name="agreement"
          value={form.agreement}
          onChange={onChange}
          className="form-input min-h-[46px] w-full rounded-xl border-slate-200"
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
        <label className="mb-1.5 block text-sm font-medium text-slate-700">Description</label>
        <input
          name="description"
          placeholder="Expense title (e.g., Nails, Dumpster fee)"
          value={form.description}
          onChange={onChange}
          className="form-input min-h-[46px] w-full rounded-xl border-slate-200"
          required
        />
      </div>

      <div className="md:col-span-2">
        <label className="mb-1.5 block text-sm font-medium text-slate-700">Amount</label>
        <input
          name="amount"
          type="number"
          step="0.01"
          placeholder="Amount"
          value={form.amount}
          onChange={onChange}
          className="form-input min-h-[46px] w-full rounded-xl border-slate-200"
          required
        />
      </div>

      <div className="md:col-span-3">
        <label className="mb-1.5 block text-sm font-medium text-slate-700">Expense Date</label>
        <input
          name="incurred_date"
          type="date"
          value={form.incurred_date}
          onChange={onChange}
          className="form-input min-h-[46px] w-full rounded-xl border-slate-200"
          required
        />
      </div>

      <div className="md:col-span-8">
        <label className="mb-1.5 block text-sm font-medium text-slate-700">Customer Note</label>
        <input
          name="note"
          placeholder="Details for customer: store/vendor + what was purchased + why (optional)"
          value={form.note}
          onChange={onChange}
          className="form-input min-h-[46px] w-full rounded-xl border-slate-200"
        />
        <div className="mt-2 text-[11px] text-gray-500">
          Example: “Home Depot — roofing nails + sealant. Needed to complete flashing.”
        </div>
      </div>

      <div className="md:col-span-4">
        <label className="mb-1.5 block text-sm font-medium text-slate-700">Receipts / Files</label>
        <input
          type="file"
          multiple
          onChange={onFiles}
          className="form-input min-h-[46px] w-full rounded-xl border-slate-200 bg-white"
          accept="image/*,.pdf"
        />
        {form.files?.length ? (
          <div className="mt-2 text-xs text-gray-600">
            Selected: <span className="font-semibold">{form.files.length}</span>{" "}
            file{form.files.length === 1 ? "" : "s"}
          </div>
        ) : null}
      </div>

      <div className="md:col-span-12 flex flex-col items-start justify-between gap-4 border-t border-slate-200 pt-4 sm:flex-row sm:items-center">
        <label className="inline-flex min-h-[46px] items-center gap-2 rounded-xl bg-slate-50 px-3 text-sm text-gray-700">
          <input
            type="checkbox"
            name="send_to_homeowner"
            checked={!!form.send_to_homeowner}
            onChange={onChange}
          />
          Sign & Send to Customer immediately
        </label>

        <button
          type="submit"
          disabled={submitting}
          className="inline-flex min-h-[46px] w-full items-center justify-center rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:bg-gray-400 sm:w-auto"
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

  const filtered = useMemo(() => {
    const sel = String(agreementFilter || "");
    if (!sel) return expenseRequests;
    return (expenseRequests || []).filter((er) => String(er.agreement || er.agreement_id || "") === sel);
  }, [expenseRequests, agreementFilter]);

  const totalAmount = useMemo(() => {
    return (filtered || []).reduce((s, x) => s + Number(x.amount || 0), 0);
  }, [filtered]);

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
      tier="full"
      eyebrow="Business"
      title="Expenses"
      subtitle="Track customer-facing expense requests, receipts, and resend status from one cleaner workspace."
      actions={
        <div className="text-sm text-gray-700">
          Total:&nbsp;<span className="font-semibold">{toMoney(totalAmount)}</span>
        </div>
      }
    >
      <div className="space-y-6">
      <div>
        <div className="text-sm text-gray-600">
          Unified on Expense Requests with multiple receipts/photos. Resend supported.
        </div>
      </div>

      <div>
        <AddExpenseForm agreements={agreements} onAdd={handleAddExpenseRequest} submitting={submitting} />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-gray-700">
          Showing <span className="font-semibold">{filtered.length}</span> expense{filtered.length === 1 ? "" : "s"}
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Filter:</label>
          <select
            value={agreementFilter}
            onChange={(e) => setAgreementFilter(e.target.value)}
            className="form-input min-h-[42px] rounded-xl border-slate-200 bg-white"
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
            className="min-h-[42px] rounded-xl border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-[1150px] w-full text-sm">
          <thead className="bg-slate-50 text-gray-600">
            <tr>
              <th className="px-3 py-2 text-left">Created</th>
              <th className="px-3 py-2 text-left">Agreement</th>
              <th className="px-3 py-2 text-left">Project</th>
              <th className="px-3 py-2 text-left">Description</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-left">Expense Date</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Receipt</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                  <td colSpan={9} className="px-3 py-12 text-center text-gray-500">
                    <div className="mx-auto max-w-md rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-sm text-slate-500">
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
                  <tr key={er.id || idx} className="hover:bg-gray-50/80">
                    <td className="px-3 py-3 text-gray-700 whitespace-nowrap">{prettyDT(created)}</td>

                    <td className="px-3 py-3">
                      <div className="font-medium text-gray-900">{agreementText}</div>
                      {aId ? <div className="text-xs text-gray-500">Agreement ID: {aId}</div> : null}
                    </td>

                    <td className="px-3 py-3">{projectFromExpenseRequest(er, agreementsMap)}</td>

                    <td className="px-3 py-3">
                      <div className="text-gray-900 font-medium">{er.description || "—"}</div>
                      {er.notes_to_homeowner ? (
                        <div className="text-xs text-gray-500 mt-1 line-clamp-1">{er.notes_to_homeowner}</div>
                      ) : null}
                    </td>

                    <td className="px-3 py-3 text-right font-semibold">{toMoney(er.amount)}</td>

                    <td className="px-3 py-3 whitespace-nowrap">{expenseDate}</td>

                    <td className="px-3 py-3">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full border text-xs font-medium ${statusPillClasses(status)}`}>
                        {statusLabel(status)}
                      </span>
                    </td>

                    <td className="px-3 py-3 whitespace-nowrap">
                      {receiptUrl ? (
                        <a className="text-blue-700 underline font-medium" href={receiptUrl} target="_blank" rel="noreferrer">
                          Open
                        </a>
                      ) : (
                        <span className="text-gray-500">—</span>
                      )}
                    </td>

                    <td className="px-3 py-3">
                      <div className="flex flex-wrap justify-end gap-2">
                        <label className="cursor-pointer rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
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
                           className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
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
                             canSend(status) ? "bg-blue-600 hover:bg-blue-700" : "bg-gray-400 cursor-not-allowed"
                           }`}
                        >
                          {sendButtonLabel(status)}
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDeleteExpenseRequest(er.id)}
                           className="rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
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
              const incurred = activeExpense.incurred_date || "—";

              return (
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold text-gray-900">{activeExpense.description || "—"}</div>
                      <div className="text-sm text-gray-700 mt-1">
                        Amount: <span className="font-semibold">{toMoney(activeExpense.amount)}</span>
                      </div>

                      <div className="text-xs text-gray-600 mt-2 space-y-1">
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
                </div>
              );
            })()}

            {/* Timeline */}
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="text-sm font-semibold text-gray-900 mb-2">Timeline</div>
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
