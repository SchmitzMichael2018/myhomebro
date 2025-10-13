// frontend/src/components/AgreementWizard.jsx
// v2025-10-12-fix-openingPreview — pass openingPreview to Step4Finalize and use it safely

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../api";
import MilestoneEditModal from "../components/MilestoneEditModal";
import { PROJECT_TYPES, SUBTYPES_BY_TYPE } from "./options/projectOptions";

/* ---------- constants & small helpers ---------- */

const TABS = [
  { step: 1, label: "1. Details" },
  { step: 2, label: "2. Milestones" },
  { step: 3, label: "3. Warranty & Attachments" },
  { step: 4, label: "4. Finalize & Review" },
];

function useQuery() {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}

// Normalize to YYYY-MM-DD (accepts ISO strings or timestamps)
function toDateOnly(v) {
  if (!v) return "";
  if (typeof v === "number") {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return "";
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${mm}-${dd}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${yyyy}-${mm}-${dd}`;
}

function daySpan(start, end) {
  const a = start ? new Date(start) : null;
  const b = end ? new Date(end) : null;
  if (!a || !b || Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return "";
  const ms = b.getTime() - a.getTime();
  return ms >= 0 ? Math.floor(ms / 86400000) + 1 : "";
}

/* normalize option inputs: strings OR {value,label} OR {id,name} */
const optValue = (x) =>
  x == null
    ? ""
    : typeof x === "string"
    ? x
    : typeof x === "number"
    ? String(x)
    : x.value != null
    ? String(x.value)
    : x.id != null
    ? String(x.id)
    : String(x);

const optLabel = (x) => {
  if (x == null) return "";
  if (typeof x === "string") return x;
  const first = x.first_name || x.firstName;
  const last = x.last_name || x.lastName;
  if (first || last) return [first, last].filter(Boolean).join(" ").trim();
  return x.full_name ?? x.name ?? x.label ?? x.title ?? x.email ?? String(x);
};

function CalendarBtn({ onClick, title = "Pick a date", disabled }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      aria-label={title}
      title={title}
      disabled={disabled}
      style={{
        position: "absolute",
        right: 8,
        top: "50%",
        transform: "translateY(-50%)",
        zIndex: 2147483647,
        background: "transparent",
        border: 0,
        lineHeight: 0,
        color: "#6B7280",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span role="img" aria-label="calendar">📅</span>
    </button>
  );
}

const DEFAULT_WARRANTY = `Standard workmanship warranty: Contractor warrants all labor performed under this Agreement for one (1) year from substantial completion. Materials are covered by the manufacturer’s warranties. This warranty excludes damage caused by misuse, neglect, alteration, improper maintenance, or acts of God.`;

/* ---------- main ---------- */

export default function AgreementWizard() {
  console.log("%cAgreementWizard v2025-10-12-fix-openingPreview", "color:#fff;background:#0ea5e9;padding:2px 6px;border-radius:4px");

  const navigate = useNavigate();
  const { id } = useParams();
  const q = useQuery();
  const step = Number(q.get("step") || "1");

  const [loading, setLoading] = useState(false);
  const [agreement, setAgreement] = useState(null);
  const [milestones, setMilestones] = useState([]);

  // Step 1
  const [homeowners, setHomeowners] = useState([]);
  const [dLocal, setDLocal] = useState({
    homeowner: "",
    project_title: "",
    project_type: "",
    project_subtype: "",
    description: "",
    start: "",
    end: "",
  });

  // Step 2
  const [mLocal, setMLocal] = useState({ title: "", description: "", amount: "", start: "", end: "" });
  const [editMilestone, setEditMilestone] = useState(null);

  // Step 3
  const [useDefaultWarranty, setUseDefaultWarranty] = useState(true);
  const [customWarranty, setCustomWarranty] = useState("");
  const [warrantySaving, setWarrantySaving] = useState(false);
  const [warrantyError, setWarrantyError] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [attFiles, setAttFiles] = useState([]);
  const [attMeta, setAttMeta] = useState({ title: "", category: "WARRANTY", visible: true });
  const [attachError, setAttachError] = useState("");

  // Step 4
  const [hasPreviewed, setHasPreviewed] = useState(false);
  const [ackReviewed, setAckReviewed] = useState(false);
  const [ackTos, setAckTos] = useState(false);
  const [ackEsign, setAckEsign] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [signing, setSigning] = useState(false);

  // FIX: openingPreview state lives here and is passed to Step4Finalize
  const [openingPreview, setOpeningPreview] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: ag } = await api.get(`/projects/agreements/${id}/`);
      setAgreement(ag);

      const agHomeownerId =
        typeof ag.homeowner === "object" && ag.homeowner
          ? String(ag.homeowner.id ?? "")
          : ag.homeowner != null
          ? String(ag.homeowner)
          : ag.homeowner_id != null
          ? String(ag.homeowner_id)
          : "";

      setDLocal({
        homeowner: agHomeownerId,
        project_title: ag.project_title || ag.title || "",
        project_type: optValue(ag.project_type || ""),
        project_subtype: optValue(ag.project_subtype || ""),
        description: ag.description || "",
        start: toDateOnly(ag.start),
        end: toDateOnly(ag.end),
      });

      // homeowners
      try {
        const { data: h1 } = await api.get(`/projects/homeowners/`, { params: { page_size: 500 } });
        setHomeowners(Array.isArray(h1?.results) ? h1.results : Array.isArray(h1) ? h1 : []);
      } catch {
        try {
          const { data: h2 } = await api.get(`/projects/customers/`, { params: { page_size: 500 } });
          setHomeowners(Array.isArray(h2?.results) ? h2.results : Array.isArray(h2) ? h2 : []);
        } catch {
          setHomeowners([]);
        }
      }

      // milestones
      const { data: msRaw } = await api.get(`/projects/milestones/`, { params: { agreement: id, page_size: 500 } });
      setMilestones(Array.isArray(msRaw?.results) ? msRaw.results : Array.isArray(msRaw) ? msRaw : []);

      // warranty state from server
      const isDefault =
        String(ag.warranty_type || "").toUpperCase() === "DEFAULT" ||
        Boolean(ag.use_default_warranty) ||
        !ag.warranty_text_snapshot ||
        String(ag.warranty_text_snapshot || "").trim() === "" ||
        String(ag.warranty_text_snapshot || "").trim() === DEFAULT_WARRANTY.trim();
      setUseDefaultWarranty(isDefault);
      setCustomWarranty(isDefault ? "" : (ag.warranty_text_snapshot || ""));

      // attachments
      await fetchAttachments();
      setAttachError("");
    } catch (e) {
      console.error(e);
      toast.error("Failed to load agreement.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => {
    const totalAmt = milestones.reduce((s, m) => s + Number(m.amount || 0), 0);
    const starts = milestones.map(m => toDateOnly(m.start_date || m.start || m.scheduled_date)).filter(Boolean);
    const ends   = milestones.map(m => toDateOnly(m.completion_date || m.end_date || m.end || m.due_date)).filter(Boolean);
    const minStart = starts.length ? [...starts].sort()[0] : "";
    const maxEnd   = ends.length ? [...ends].sort().slice(-1)[0] : "";
    const totalDays = (minStart && maxEnd) ? daySpan(minStart, maxEnd) : 0;
    return { totalAmt, minStart, maxEnd, totalDays };
  }, [milestones]);

  const goStep = (n) => navigate(`/agreements/${id}/wizard?step=${n}`);

  /* ---------- Step 1 (Details) ---------- */

  const saveStep1 = async (navigateNext = false) => {
    try {
      const payload = {
        homeowner: dLocal.homeowner || null,
        title: dLocal.project_title,
        project_title: dLocal.project_title,
        project_type: dLocal.project_type || null,
        project_subtype: dLocal.project_subtype || null,
        description: dLocal.description,
        start: dLocal.start || null,
        end: dLocal.end || null,
      };
      await api.patch(`/projects/agreements/${id}/`, payload);
      toast.success("Details saved.");
      if (navigateNext) goStep(2);
      await load();
    } catch (e) {
      const resp = e?.response;
      const body =
        (resp?.data && (typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data))) ||
        resp?.statusText ||
        e?.message ||
        "Save failed";
      toast.error(`Save failed: ${body}`);
    }
  };

  /* ---------- Step 2 (Milestones) ---------- */

  const onLocalChange = (e) => {
    const { name, value } = e.target;
    setMLocal((s) => (name === "start" || name === "end" ? { ...s, [name]: toDateOnly(value) } : { ...s, [name]: value }));
  };

  const addMilestone = async () => {
    const f = mLocal;
    if (!f.title?.trim()) return toast.error("Enter a title.");
    if (!f.start || !f.end) return toast.error("Select start and end dates.");
    try {
      const payload = {
        agreement: Number(id),
        title: f.title.trim(),
        description: f.description || "",
        amount: f.amount ? Number(f.amount) : 0,
        start_date: f.start,
        end_date: f.end,
        completion_date: f.end,
      };
      await api.post(`/projects/milestones/`, payload);
      await load();
      setMLocal({ title: "", description: "", amount: "", start: "", end: "" });
      toast.success("Milestone added.");
    } catch (e) {
      const msg = e?.response?.data?.non_field_errors || e?.response?.data?.detail || "Add failed.";
      toast.error(Array.isArray(msg) ? msg.join(", ") : String(msg));
    }
  };

  const removeMilestone = async (mid) => {
    try {
      await api.delete(`/projects/milestones/${mid}/`);
      await load();
      toast.success("Milestone removed.");
    } catch {
      toast.error("Delete failed.");
    }
  };

  const markComplete = async (mid) => {
    try {
      await api.patch(`/projects/milestones/${mid}/`, { status: "Complete", completed: true });
      await load();
      toast.success("Marked complete.");
    } catch (e) {
      const resp = e?.response;
      const body =
        (resp?.data && (typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data))) ||
        resp?.statusText ||
        e?.message ||
        "Save failed";
      toast.error(`Could not mark complete: ${body}`);
    }
  };

  /* ---------- Step 3 (Warranty & Attachments) ---------- */

  const saveWarranty = async () => {
    setWarrantySaving(true);
    setWarrantyError("");
    const isDefault = !!useDefaultWarranty;
    const text = isDefault ? "" : (customWarranty || "");
    const payload = {
      warranty_type: isDefault ? "DEFAULT" : "CUSTOM",
      warranty_text_snapshot: text,
      use_default_warranty: isDefault,
      custom_warranty_text: text,
    };
    try {
      await api.patch(`/projects/agreements/${id}/`, payload);
      await load();
      toast.success("Warranty saved.");
    } catch (e) {
      const resp = e?.response;
      const body =
        (resp?.data && (typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data))) ||
        resp?.statusText ||
        e?.message ||
        "Save failed";
      setWarrantyError(body);
      toast.error(`Warranty save failed: ${body}`);
    } finally {
      setWarrantySaving(false);
    }
  };

  const fetchAttachments = async () => {
    const { data } = await api.get(`/projects/agreements/${id}/attachments/`);
    setAttachments(Array.isArray(data) ? data : []);
    return Array.isArray(data) ? data : [];
  };

  const patchAttachmentMultipart = async (path, fields) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, typeof v === "boolean" ? String(v) : v);
    return api.patch(path, fd, { headers: { "Content-Type": "multipart/form-data" } });
  };

  const setAttachmentVisibility = async (attId, visible) => {
    const visBodies = [
      { visible }, { is_visible: visible }, { public: visible }, { is_public: visible },
      { visible: visible ? 1 : 0 }, { is_visible: visible ? 1 : 0 },
    ];
    const paths = [
      `/projects/attachments/${attId}/`,
      `/projects/agreements/${id}/attachments/${attId}/`,
    ];
    for (const p of paths) {
      for (const body of visBodies) {
        try { await patchAttachmentMultipart(p, body); return true; } catch { /* keep trying */ }
      }
    }
    return false;
  };

  const uploadAttachments = async () => {
    if (!attFiles.length) return toast.error("Select or drop a file first.");
    setAttachError("");

    const picked = attFiles[0];
    const title = attMeta.title || picked.name;

    const postFD = async (url, fd) => api.post(url, fd, { headers: { "Content-Type": "multipart/form-data" } });

    const attempts = [
      () => { const fd = new FormData(); fd.append("file", picked); fd.append("agreement", String(id)); fd.append("title", title); fd.append("category", attMeta.category || "OTHER"); return [ `/projects/attachments/`, fd ]; },
      () => { const fd = new FormData(); fd.append("file", picked); fd.append("agreement", String(id)); fd.append("title", title); return [ `/projects/attachments/`, fd ]; },
      () => { const fd = new FormData(); fd.append("file", picked); fd.append("agreement", String(id)); return [ `/projects/attachments/`, fd ]; },

      () => { const fd = new FormData(); fd.append("file", picked); fd.append("title", title); fd.append("category", attMeta.category || "OTHER"); return [ `/projects/agreements/${id}/attachments/`, fd ]; },
      () => { const fd = new FormData(); fd.append("file", picked); fd.append("title", title); return [ `/projects/agreements/${id}/attachments/`, fd ]; },
      () => { const fd = new FormData(); fd.append("file", picked); return [ `/projects/agreements/${id}/attachments/`, fd ]; },
    ];

    let createdId = null;
    let lastErr = null;

    for (const build of attempts) {
      const [url, fd] = build();
      try {
        const res = await postFD(url, fd);
        createdId = res?.data?.id ?? null;
        break;
      } catch (e) {
        lastErr = e;
      }
    }

    if (!createdId) {
      const list = await fetchAttachments();
      const found = list.find((a) => (a.title && a.title === title) || (a.filename && a.filename === picked.name));
      if (!found) {
        const resp = lastErr?.response;
        const body =
          (resp?.data && (typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data))) ||
          resp?.statusText ||
          lastErr?.message ||
          "Upload failed";
        setAttachError(body);
        toast.error(`Upload failed: ${body}`);
        return;
      }
      createdId = found.id;
    }

    const ok = await setAttachmentVisibility(createdId, !!attMeta.visible);
    if (!ok) toast.error("Added file, but could not set visibility.");

    await fetchAttachments();
    setAttFiles((prev) => prev.slice(1));
    toast.success("Attachment added.");
  };

  const deleteAttachment = async (attId) => {
    setAttachError("");
    try {
      await api.delete(`/projects/attachments/${attId}/`);
    } catch {
      try { await api.delete(`/projects/agreements/${id}/attachments/${attId}/`); }
      catch (e2) {
        const resp = e2?.response;
        const body =
          (resp?.data && (typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data))) ||
          resp?.statusText ||
          e2?.message ||
          "Delete failed";
        setAttachError(body);
        toast.error(`Delete failed: ${body}`);
        return;
      }
    }
    await fetchAttachments();
    toast.success("Attachment deleted.");
  };

  /* ---------- Step 4 (Preview/Sign) ---------- */

  // Safer Preview: try signed link (no auth header). If that fails, fall back to tokenless contractor/staff path.
  const previewPdf = async () => {
    try {
      setOpeningPreview(true);
      const { data } = await api.post(`/projects/agreements/${id}/preview_link/`);
      const url = data?.url;
      if (url) {
        window.open(url, "_blank", "noopener,noreferrer");
        setHasPreviewed(true);
        try { await api.post(`/projects/agreements/${id}/mark_previewed/`); } catch {}
        return;
      }
      // Fallback
      window.open(`/api/projects/agreements/preview_signed/?agreement_id=${id}`, "_blank", "noopener,noreferrer");
      setHasPreviewed(true);
      try { await api.post(`/projects/agreements/${id}/mark_previewed/`); } catch {}
    } catch (err) {
      console.error(err);
      toast.error("Could not open preview.");
    } finally {
      setOpeningPreview(false);
    }
  };

  const goPublic = () => window.open(`/agreements/public/${id}/`, "_blank");

  const signContractor = async () => {
    if (!(hasPreviewed && ackReviewed && ackTos && ackEsign && typedName.trim().length >= 2)) return;
    setSigning(true);
    try {
      await api.post(`/projects/agreements/${id}/contractor_sign/`, { typed_name: typedName.trim() });
      toast.success("Signed as Contractor.");
      window.location.reload();
    } catch (e) {
      const resp = e?.response;
      const msg =
        (resp?.data && (typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data))) ||
        resp?.statusText ||
        e?.message ||
        "Sign failed";
      toast.error(`Sign failed: ${msg}`);
    } finally {
      setSigning(false);
    }
  };

  const canSign = hasPreviewed && ackReviewed && ackTos && ackEsign && typedName.trim().length >= 2;

  /* ---------- render ---------- */

  return (
    <div className="p-4 md:p-6">
      {/* Tabs */}
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.step}
            onClick={() => goStep(t.step)}
            className={`rounded px-3 py-2 text-sm ${step === t.step ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
          >
            {t.label}
          </button>
        ))}
        <div className="flex-1" />
        <div className="flex gap-2">
          <button
            onClick={previewPdf}
            disabled={openingPreview}
            className={`rounded px-3 py-2 text-sm ${
              openingPreview ? "bg-indigo-100 text-indigo-400 cursor-wait" : "bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
            }`}
            title="Open PDF preview"
          >
            {openingPreview ? "Opening…" : "Preview PDF"}
          </button>
          <button onClick={goPublic} className="rounded bg-gray-100 px-3 py-2 text-sm text-gray-700 hover:bg-gray-200">View Public Link</button>
        </div>
      </div>

      {step === 1 && (
        <Step1Details
          agreement={agreement}
          dLocal={dLocal}
          setDLocal={setDLocal}
          homeowners={homeowners}
          saveStep1={saveStep1}
          goStep={goStep}
          id={id}
        />
      )}

      {step === 2 && (
        <Step2Milestones
          loading={loading}
          mLocal={mLocal}
          onLocalChange={onLocalChange}
          onAdd={addMilestone}
          milestones={milestones}
          onDelete={removeMilestone}
          onEdit={(m) => setEditMilestone(m)}
          onComplete={markComplete}
          agreement={agreement}
          totals={totals}
          onBack={() => goStep(1)}
          onNext={() => goStep(3)}
        />
      )}

      {step === 3 && (
        <Step3WarrantyAttachments
          loading={loading}
          DEFAULT_WARRANTY={DEFAULT_WARRANTY}
          useDefaultWarranty={useDefaultWarranty}
          setUseDefaultWarranty={setUseDefaultWarranty}
          customWarranty={customWarranty}
          setCustomWarranty={setCustomWarranty}
          saveWarranty={saveWarranty}
          warrantySaving={warrantySaving}
          warrantyError={warrantyError}
          attachments={attachments}
          attFiles={attFiles}
          setAttFiles={setAttFiles}
          attMeta={attMeta}
          setAttMeta={setAttMeta}
          onDropFiles={(e) => {
            e.preventDefault();
            const files = Array.from(e.dataTransfer?.files || []);
            if (!files.length) return;
            setAttFiles((prev) => [...prev, ...files]);
          }}
          onPickFiles={(e) => {
            const files = Array.from(e.target.files || []);
            if (!files.length) return;
            setAttFiles((prev) => [...prev, ...files]);
            e.target.value = "";
          }}
          uploadAttachments={uploadAttachments}
          deleteAttachment={deleteAttachment}
          attachError={attachError}
          goBack={() => goStep(2)}
          goNext={() => goStep(4)}
        />
      )}

      {step === 4 && (
        <Step4Finalize
          agreement={agreement}
          id={id}
          previewPdf={previewPdf}
          goPublic={goPublic}
          milestones={milestones}
          totals={totals}
          hasPreviewed={hasPreviewed}
          ackReviewed={ackReviewed} setAckReviewed={setAckReviewed}
          ackTos={ackTos} setAckTos={setAckTos}
          ackEsign={ackEsign} setAckEsign={setAckEsign}
          typedName={typedName} setTypedName={setTypedName}
          canSign={canSign} signing={signing} signContractor={signContractor}
          attachments={attachments}
          defaultWarrantyText={DEFAULT_WARRANTY}
          customWarranty={customWarranty}
          useDefaultWarranty={useDefaultWarranty}
          goBack={() => goStep(3)}
          /* FIX: pass openingPreview down so the child can disable its buttons correctly */
          openingPreview={openingPreview}
        />
      )}

      {/* Edit modal for Step 2 */}
      {editMilestone && (
        <MilestoneEditModal
          open={!!editMilestone}
          milestone={editMilestone}
          onClose={() => setEditMilestone(null)}
          onSaved={() => { setEditMilestone(null); load(); }}
          onMarkComplete={async (mid) => { await markComplete(mid); setEditMilestone(null); }}
        />
      )}
    </div>
  );
}

/* ---------- Step 1 ---------- */

function Step1Details({ agreement, dLocal, setDLocal, homeowners, saveStep1, goStep, id }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="text-sm text-gray-600 mb-4">
        {agreement ? <>Agreement #{agreement.id} — {agreement.project_title || agreement.title || "Project"}</> : <>Agreement #{id}</>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="md:col-span-2">
          <label className="block text-sm font-medium mb-1">Homeowner</label>
          <select
            className="w-full rounded border px-3 py-2 text-sm"
            value={dLocal.homeowner || ""}
            onChange={(e) => setDLocal((s) => ({ ...s, homeowner: e.target.value }))}
          >
            <option value="">— Select Homeowner —</option>
            {homeowners.map((h) => {
              const val = optValue(h);
              const lbl = optLabel(h);
              return <option key={val || lbl} value={val}>{lbl}</option>;
            })}
          </select>
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-medium mb-1">Project Title</label>
          <input
            className="w-full rounded border px-3 py-2 text-sm"
            value={dLocal.project_title}
            onChange={(e) => setDLocal((s) => ({ ...s, project_title: e.target.value }))}
            placeholder="e.g., Kitchen Floor and Wall"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Type</label>
          <select
            className="w-full rounded border px-3 py-2 text-sm"
            value={dLocal.project_type || ""}
            onChange={(e) => setDLocal((s) => ({ ...s, project_type: e.target.value, project_subtype: "" }))}
          >
            <option value="">— Select Type —</option>
            {(Array.isArray(PROJECT_TYPES) ? PROJECT_TYPES : []).map((t) => {
              const val = optValue(t);
              const lbl = optLabel(t);
              return <option key={val || lbl} value={val}>{lbl}</option>;
            })}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Subtype</label>
          <select
            className="w-full rounded border px-3 py-2 text-sm"
            value={dLocal.project_subtype || ""}
            onChange={(e) => setDLocal((s) => ({ ...s, project_subtype: e.target.value }))}
          >
            <option value="">— Select Subtype —</option>
            {((SUBTYPES_BY_TYPE || {})[dLocal.project_type] || []).map((st) => {
              const val = optValue(st);
              const lbl = optLabel(st);
              return <option key={val || lbl} value={val}>{lbl}</option>;
            })}
          </select>
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-medium mb-1">Description</label>
          <textarea
            className="w-full rounded border px-3 py-2 text-sm"
            rows={3}
            value={dLocal.description}
            onChange={(e) => setDLocal((s) => ({ ...s, description: e.target.value }))}
            placeholder="Brief project scope…"
          />
        </div>

        <DateWithButton label="Start" value={dLocal.start} onChange={(v) => setDLocal((s) => ({ ...s, start: toDateOnly(v) }))} />
        <DateWithButton label="End" value={dLocal.end} onChange={(v) => setDLocal((s) => ({ ...s, end: toDateOnly(v) }))} />
      </div>

      <div className="mt-4 flex gap-2">
        <button onClick={() => saveStep1(false)} className="rounded bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700">Save</button>
        <button onClick={() => saveStep1(true)} className="rounded bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700">Save & Next</button>
      </div>
    </div>
  );
}

/* ---------- Step 2 ---------- */

function Step2Milestones({
  loading,
  mLocal, onLocalChange, onAdd,
  milestones, onDelete, onEdit, onComplete, agreement,
  totals, onBack, onNext,
}) {
  const startRef = useRef(null);
  const endRef = useRef(null);
  const openPicker = (ref) => {
    if (!ref?.current) return;
    if (typeof ref.current.showPicker === "function") ref.current.showPicker();
    else ref.current.focus();
  };
  const isDraft = (agreement?.status || "").toLowerCase() === "draft";

  return (
    <div className="rounded-lg border bg-white p-4">
      {!!loading && <div className="text-sm text-gray-500 mb-3">Loading…</div>}
      <div className="text-sm text-gray-600 mb-4">New Milestone</div>

      <div className="grid grid-cols-1 gap-3">
        <input type="text" name="title" value={mLocal.title} onChange={onLocalChange} className="w-full rounded border px-3 py-2 text-sm" placeholder="e.g., Install Floor Tile" />
        <textarea name="description" value={mLocal.description} onChange={onLocalChange} className="w-full rounded border px-3 py-2 text-sm" placeholder="Brief description of the milestone work…" />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <input type="number" step="0.01" name="amount" value={mLocal.amount} onChange={onLocalChange} className="w-full rounded border px-3 py-2 text-sm" placeholder="Amount ($)" />
          <div className="grid grid-cols-2 gap-3">
            <div style={{ position: "relative", overflow: "visible" }}>
              <input ref={startRef} type="date" name="start" value={mLocal.start || ""} onChange={onLocalChange} className="w-full rounded border px-3 py-2 text-sm" style={{ paddingRight: "2.5rem" }} />
              <CalendarBtn title="Open start date" onClick={() => openPicker(startRef)} />
            </div>
            <div style={{ position: "relative", overflow: "visible" }}>
              <input ref={endRef} type="date" name="end" value={mLocal.end || ""} onChange={onLocalChange} className="w-full rounded border px-3 py-2 text-sm" style={{ paddingRight: "2.5rem" }} />
              <CalendarBtn title="Open end date" onClick={() => openPicker(endRef)} />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-[auto_1fr] gap-3 items-center">
          <div className="text-sm text-gray-600">Days (auto)</div>
          <div className="rounded border px-3 py-2 text-sm bg-gray-50">{mLocal.start && mLocal.end ? daySpan(mLocal.start, mLocal.end) : "—"}</div>
        </div>
        <div><button onClick={onAdd} className="rounded bg-green-600 px-3 py-2 text-sm text-white hover:bg-green-700">+ Add Milestone</button></div>
      </div>

      <div className="mt-6 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left">
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Title</th>
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2">Start</th>
              <th className="px-3 py-2">End</th>
              <th className="px-3 py-2">Days</th>
              <th className="px-3 py-2">Amount</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {milestones.map((m, i) => {
              const start = toDateOnly(m.start_date || m.start || m.scheduled_date);
              const end   = toDateOnly(m.completion_date || m.end_date || m.end || m.due_date);
              return (
                <tr key={m.id} className="border-t">
                  <td className="px-3 py-2">{i + 1}</td>
                  <td className="px-3 py-2">{m.title}</td>
                  <td className="px-3 py-2">{m.description}</td>
                  <td className="px-3 py-2">{start || "—"}</td>
                  <td className="px-3 py-2">{end || "—"}</td>
                  <td className="px-3 py-2">{start && end ? daySpan(start, end) : "—"}</td>
                  <td className="px-3 py-2">${Number(m.amount || 0).toFixed(2)}</td>
                  <td className="px-3 py-2 flex flex-wrap gap-2">
                    {(agreement?.status || "").toLowerCase() === "draft" && (
                      <>
                        <button onClick={() => onEdit(m)} className="rounded bg-gray-100 px-2 py-1 text-gray-700 hover:bg-gray-200">Edit</button>
                        <button onClick={() => onComplete(m.id)} className="rounded bg-indigo-50 px-2 py-1 text-indigo-700 hover:bg-indigo-100">Complete</button>
                      </>
                    )}
                    <button onClick={() => onDelete(m.id)} className="rounded bg-red-50 px-2 py-1 text-red-700 hover:bg-red-100">Delete</button>
                  </td>
                </tr>
              );
            })}
            {!milestones.length && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-500">No milestones yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-4">
        <SummaryCard label="Total Amount" value={`$${totals.totalAmt.toFixed(2)}`} />
        <SummaryCard label="Total Days" value={String(totals.totalDays || 0)} />
        <SummaryCard label="Agreement Start" value={totals.minStart || "—"} />
        <SummaryCard label="Agreement End" value={totals.maxEnd || "—"} />
      </div>

      <div className="mt-6 flex gap-2">
        <button onClick={onBack} className="rounded bg-gray-100 px-3 py-2 text-sm text-gray-700 hover:bg-gray-200">Back</button>
        <button onClick={onNext} className="rounded bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700">Save & Next</button>
      </div>
    </div>
  );
}

/* ---------- Step 3 ---------- */

function Step3WarrantyAttachments({
  loading,
  DEFAULT_WARRANTY,
  useDefaultWarranty, setUseDefaultWarranty,
  customWarranty, setCustomWarranty,
  saveWarranty, warrantySaving, warrantyError,
  attachments,
  attFiles, setAttFiles,
  attMeta, setAttMeta,
  onDropFiles, onPickFiles,
  uploadAttachments, deleteAttachment,
  attachError,
  goBack, goNext,
}) {
  return (
    <div className="rounded-lg border bg-white p-4">
      {!!loading && <div className="text-sm text-gray-500 mb-3">Loading…</div>}

      {/* Warranty */}
      <div className="mb-4">
        <div className="text-sm font-medium mb-2">Warranty</div>
        <div className="flex items-center gap-2 mb-2">
          <input id="use_default_warranty" type="checkbox" checked={useDefaultWarranty} onChange={(e) => setUseDefaultWarranty(e.target.checked)} />
          <label htmlFor="use_default_warranty" className="text-sm">Use default 12-month workmanship warranty</label>
        </div>
        <textarea
          className="w-full rounded border px-3 py-2 text-sm"
          rows={5}
          value={useDefaultWarranty ? DEFAULT_WARRANTY : customWarranty}
          onChange={(e) => !useDefaultWarranty && setCustomWarranty(e.target.value)}
          readOnly={useDefaultWarranty}
          placeholder={useDefaultWarranty ? "" : "Example: Standard workmanship warranty... (edit as needed)"}
          style={useDefaultWarranty ? { background: "#F9FAFB", color: "#374151" } : { color: "#111827" }}
        />
        <div className="mt-2 flex items-center gap-3">
          <button onClick={saveWarranty} disabled={warrantySaving} className="rounded bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-60">
            {warrantySaving ? "Saving…" : "Save Warranty"}
          </button>
          {!!warrantyError && (<div className="text-xs text-red-600">Server response: {warrantyError}</div>)}
        </div>
      </div>

      {/* Attachments */}
      <div>
        <div className="text-sm font-medium mb-2">Attachments & Addenda</div>

        <div onDragOver={(e) => e.preventDefault()} onDrop={onDropFiles} style={{ border: "2px dashed #CBD5E1", borderRadius: 8, padding: 16, background: "#F8FAFC" }} className="mb-3">
          <div className="text-sm mb-2">Drag & drop files here, or choose files:</div>
          <input type="file" multiple onChange={onPickFiles} className="text-sm" />
          {!!attFiles.length && (<div className="mt-2 text-xs text-gray-600">Pending: {attFiles.map((f) => f.name).join(", ")}</div>)}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
          <input
            type="text"
            className="w-full rounded border px-3 py-2 text-sm"
            placeholder="Title (e.g., Spec Sheet)"
            value={attMeta.title}
            onChange={(e) => setAttMeta((s) => ({ ...s, title: e.target.value }))}
          />
          <select
            className="w-full rounded border px-3 py-2 text-sm"
            value={attMeta.category}
            onChange={(e) => setAttMeta((s) => ({ ...s, category: e.target.value }))}
          >
            <option value="WARRANTY">WARRANTY</option>
            <option value="ADDENDUM">ADDENDUM</option>
            <option value="EXHIBIT">EXHIBIT</option>
            <option value="OTHER">OTHER</option>
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={attMeta.visible}
              onChange={(e) => setAttMeta((s) => ({ ...s, visible: e.target.checked }))}
            />
            Visible to homeowner
          </label>
        </div>

        <div className="flex gap-2">
          <button onClick={uploadAttachments} className="rounded bg-gray-800 px-3 py-2 text-sm text-white hover:bg-black">+ Add Attachment</button>
          {!!attachError && <div className="text-xs text-red-600 self-center">Server response: {attachError}</div>}
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">Title</th>
                <th className="px-3 py-2">Visible</th>
                <th className="px-3 py-2">File</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {attachments.map((a) => {
                const isVisible = a.visible || a.is_visible || a.public || a.is_public;
                const url = a.file || a.url || a.file_url || a.download_url || a.download || a.absolute_url || null;
                return (
                  <tr key={a.id} className="border-t">
                    <td className="px-3 py-2">{(a.category || "").toUpperCase()}</td>
                    <td className="px-3 py-2">{a.title || a.filename || "—"}</td>
                    <td className="px-3 py-2">{isVisible ? "Yes" : "No"}</td>
                    <td className="px-3 py-2">{url ? (<a className="text-blue-600 hover:underline" href={url} target="_blank" rel="noreferrer">Download</a>) : "—"}</td>
                    <td className="px-3 py-2">
                      <button onClick={() => deleteAttachment(a.id)} className="rounded bg-red-50 px-2 py-1 text-red-700 hover:bg-red-100">Delete</button>
                    </td>
                  </tr>
                );
              })}
              {!attachments.length && (<tr><td colSpan={5} className="px-3 py-6 text-center text-gray-500">No attachments yet.</td></tr>)}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex gap-2">
          <button onClick={goBack} className="rounded bg-gray-100 px-3 py-2 text-sm text-gray-700 hover:bg-gray-200">Back</button>
          <button onClick={goNext} className="rounded bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700">Save & Next</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Step 4 ---------- */

function Step4Finalize({
  agreement, id, previewPdf, goPublic, milestones, totals,
  hasPreviewed,
  ackReviewed, setAckReviewed,
  ackTos, setAckTos,
  ackEsign, setAckEsign,
  typedName, setTypedName,
  canSign, signing, signContractor,
  attachments, defaultWarrantyText, customWarranty, useDefaultWarranty,
  goBack,
  // FIX: receive openingPreview from parent to drive disabled state
  openingPreview = false,
}) {
  const warrantyText = useDefaultWarranty
    ? defaultWarrantyText
    : (customWarranty?.trim() ? customWarranty : defaultWarrantyText);

  return (
    <div className="rounded-lg border bg-white p-4 space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <SummaryCard label="Agreement" value={`#${agreement?.id || id} — ${agreement?.project_title || agreement?.title || "Project"}`} />
        <SummaryCard label="Total Amount" value={`$${Number(totals.totalAmt || 0).toFixed(2)}`} />
        <SummaryCard label="Start → End" value={`${totals.minStart || "—"} → ${totals.maxEnd || "—"}`} />
        <SummaryCard label="Total Days" value={String(totals.totalDays || 0)} />
      </div>

      <section>
        <div className="text-sm font-semibold mb-2">Warranty (Snapshot)</div>
        <div className="border rounded bg-gray-50 p-3 max-h-44 overflow-auto text-sm leading-relaxed whitespace-pre-wrap">
          {warrantyText}
        </div>
      </section>

      <section>
        <div className="text-sm font-semibold mb-2">Milestones</div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Title</th>
                <th className="px-3 py-2">Due</th>
                <th className="px-3 py-2">Amount</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {(milestones || []).map((m, i) => (
                <tr key={m.id || i} className="border-t">
                  <td className="px-3 py-2">{i + 1}</td>
                  <td className="px-3 py-2">{m.title || m.description || "—"}</td>
                  <td className="px-3 py-2">{toDateOnly(m.completion_date || m.end_date || m.end || m.due_date || m.scheduled_date || m.start_date || m.start) || "—"}</td>
                  <td className="px-3 py-2">${Number(m.amount || 0).toFixed(2)}</td>
                  <td className="px-3 py-2">{m.status || (m.completed ? "Completed" : "Pending")}</td>
                </tr>
              ))}
              {!milestones?.length && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-500">No milestones.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="text-sm font-semibold mb-2">Attachments &amp; Addenda (Visible)</div>
        {(attachments || []).filter(a => a.visible || a.is_visible || a.public || a.is_public).length ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Title</th>
                  <th className="px-3 py-2">File</th>
                </tr>
              </thead>
              <tbody>
                {(attachments || [])
                  .filter(a => a.visible || a.is_visible || a.public || a.is_public)
                  .map((a) => {
                    const url = a.file || a.url || a.file_url || a.download_url || a.download || a.absolute_url || null;
                    return (
                      <tr key={a.id} className="border-t">
                        <td className="px-3 py-2">{(a.category || "").toUpperCase()}</td>
                        <td className="px-3 py-2">{a.title || a.filename || "—"}</td>
                        <td className="px-3 py-2">{url ? <a className="text-blue-600 hover:underline" href={url} target="_blank" rel="noreferrer">Download</a> : "—"}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-sm text-gray-500">No visible attachments.</div>
        )}
      </section>

      <section className="space-y-2 text-sm">
        <div className="text-sm font-semibold">Agreement Review</div>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={!!ackReviewed} onChange={(e) => setAckReviewed(e.target.checked)} />
          <span>I have reviewed the entire agreement and all attached exhibits/attachments.</span>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={!!ackTos} onChange={(e) => setAckTos(e.target.checked)} />
          <span>
            I agree to the&nbsp;
            <a className="text-blue-600 hover:underline" href="/static/legal/terms_of_service.txt" target="_blank" rel="noreferrer">Terms of Service</a>
            &nbsp;and&nbsp;
            <a className="text-blue-600 hover:underline" href="/static/legal/privacy_policy.txt" target="_blank" rel="noreferrer">Privacy Policy</a>.
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={!!ackEsign} onChange={(e) => setAckEsign(e.target.checked)} />
          <span>
            I consent to conduct business electronically and use electronic signatures under the U.S. E-SIGN Act.
            I understand my electronic signature is legally binding, and I can request a paper copy.
          </span>
        </label>
        <div className="rounded border bg-yellow-50 text-yellow-800 px-3 py-2">
          <strong>Note:</strong> You must preview the PDF before signing.
        </div>
      </section>

      <section>
        <div className="text-sm font-semibold mb-2">Signatures</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Contractor */}
          <div className="rounded border p-3">
            <div className="text-sm font-medium mb-2">Contractor Signature</div>

            {agreement?.signed_by_contractor ? (
              <div className="text-sm text-green-700">
                ✓ Already signed by contractor {agreement?.contractor_signature_name ? `(${agreement.contractor_signature_name})` : ""}.
              </div>
            ) : (
              <>
                <label className="block text-sm mb-1">Type full legal name</label>
                <input
                  className="w-full rounded border px-3 py-2 text-sm"
                  placeholder="e.g., Jane Q. Contractor"
                  value={typedName}
                  onChange={(e) => setTypedName(e.target.value)}
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={previewPdf}
                    disabled={openingPreview}
                    className={`rounded px-3 py-2 text-sm ${
                      openingPreview ? "bg-indigo-100 text-indigo-400 cursor-wait" : "bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                    }`}
                    title="Open PDF preview in a new tab"
                  >
                    {openingPreview ? "Opening…" : "Preview PDF"}
                  </button>
                  <button
                    type="button"
                    disabled={!canSign || signing}
                    onClick={signContractor}
                    className={`rounded px-3 py-2 text-sm text-white ${canSign ? "bg-indigo-600 hover:bg-indigo-700" : "bg-gray-400 cursor-not-allowed"}`}
                    title={!canSign ? "Preview + all checkboxes + typed name required" : "Sign as Contractor"}
                  >
                    {signing ? "Signing…" : "Sign as Contractor"}
                  </button>
                </div>
                {!hasPreviewed && <div className="mt-2 text-xs text-amber-700">Please preview the PDF before signing.</div>}
              </>
            )}
          </div>

          {/* Homeowner */}
          <div className="rounded border p-3">
            <div className="text-sm font-medium mb-2">Homeowner Signature</div>
            {agreement?.signed_by_homeowner ? (
              <div className="text-sm text-green-700">✓ Already signed by homeowner.</div>
            ) : (
              <>
                <div className="text-sm text-gray-600">The homeowner signs via their public link.</div>
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={goPublic}
                    className="rounded bg-gray-800 px-3 py-2 text-sm text-white hover:bg-black"
                    title="Open the public signing link"
                  >
                    Open Public Signing Link
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Footer actions */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={goBack}
          className="rounded bg-gray-100 px-3 py-2 text-sm text-gray-700 hover:bg-gray-200"
          title="Back to previous step"
        >
          Back
        </button>
        <button
          type="button"
          onClick={previewPdf}
          disabled={openingPreview}
          className={`rounded px-3 py-2 text-sm ${
            openingPreview ? "bg-indigo-100 text-indigo-400 cursor-wait" : "bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
          }`}
          title="Open PDF preview in a new tab"
        >
          {openingPreview ? "Opening…" : "Preview PDF"}
        </button>
        <button
          type="button"
          onClick={goPublic}
          className="rounded bg-gray-800 px-3 py-2 text-sm text-white hover:bg-black"
          title="Open the public signing link"
        >
          View Public Link
        </button>
      </div>
    </div>
  );
}

/* ---------- shared UI ---------- */

function DateWithButton({ label, value, onChange }) {
  const ref = useRef(null);
  const openPicker = () => { if (ref.current?.showPicker) ref.current.showPicker(); else ref.current?.focus(); };
  return (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      <div style={{ position: "relative", overflow: "visible" }}>
        <input
          ref={ref}
          type="date"
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded border px-3 py-2 text-sm"
          style={{ paddingRight: "2.5rem" }}
        />
        <CalendarBtn onClick={openPicker} title={`Open ${label} calendar`} />
      </div>
    </div>
  );
}

function SummaryCard({ label, value }) {
  return (
    <div className="rounded border bg-gray-50 px-3 py-2">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}
