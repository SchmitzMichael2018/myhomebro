// src/components/AgreementWizard.jsx
// v2025-10-06 — Step 2 milestone list restored (editable table), authenticated PDF preview (Blob),
// header public link/copy, fluid desktop layout, Step4Review wiring.

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../api";
import { PROJECT_TYPES, SUBTYPES_BY_TYPE } from "./options/projectOptions";
import AttachmentSection from "./AttachmentSection";
import Step4Review from "./Step4Review";

/* ---------- Tabs ---------- */
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

/* ---------- Helpers ---------- */
function normalizeOptions(input) {
  if (!input) return [];
  return input.map((item) => {
    if (item && typeof item === "object") {
      const value = String(item.value ?? item.id ?? item.label ?? "");
      const label =
        String(
          item.label ??
            item.name ??
            item.full_name ??
            item.title ??
            item.email ??
            item.value ??
            ""
        ) || "";
      return { value, label };
    }
    const str = String(item ?? "");
    return { value: str, label: str };
  });
}

function toDateOnly(v) {
  if (!v) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${yyyy}-${mm}-${dd}`;
}

function pickApiDate(obj, preferredKeys, fallbackNeedleList) {
  for (const k of preferredKeys) if (obj?.[k]) return obj[k];
  const needles = fallbackNeedleList || ["end", "finish"];
  const looksDate = (val) =>
    typeof val === "string" && (/\d{4}-\d{2}-\d{2}/.test(val) || /\d{4}-\d{2}-\d{2}T/.test(val));
  for (const key of Object.keys(obj || {})) {
    const lower = key.toLowerCase();
    if (needles.some((n) => lower.includes(n)) && looksDate(obj[key])) return obj[key];
  }
  return "";
}

function daysInclusive(start, end) {
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 0;
  const ms = e.setHours(0, 0, 0, 0) - s.setHours(0, 0, 0, 0);
  return ms < 0 ? 0 : Math.floor(ms / 86400000) + 1;
}

function money(n) {
  const v = Number(n || 0);
  return v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

/* ---------- API routes ---------- */
const routes = {
  agreement: (id) => `/projects/agreements/${id}/`,
  milestonesList: (agreementId) => `/projects/agreements/${agreementId}/milestones/`,
  milestoneDetail: (milestoneId) => `/projects/milestones/${milestoneId}/`,
  homeowners: () => `/projects/homeowners/`,
  previewPdf: (id) => `/projects/agreements/${id}/preview_pdf/`,
};

/* ========================================================= */

export default function AgreementWizard() {
  const { id } = useParams();
  const query = useQuery();
  const navigate = useNavigate();

  const initialStep = Number(query.get("step") || 1);
  const [step, setStep] = useState([1, 2, 3, 4].includes(initialStep) ? initialStep : 1);

  /* ----- Agreement shell ----- */
  const [agreement, setAgreement] = useState(null);
  const [loadingAgreement, setLoadingAgreement] = useState(true);

  /* ----- Global preview/public link state ----- */
  const [previewing, setPreviewing] = useState(false);
  const [copying, setCopying] = useState(false);

  /* ----- Step 1 fields ----- */
  const [projectType, setProjectType] = useState("");
  const [projectSubtype, setProjectSubtype] = useState("");
  const [projectTitle, setProjectTitle] = useState("");
  const [description, setDescription] = useState("");
  const [homeownerId, setHomeownerId] = useState("");

  const [homeowners, setHomeowners] = useState([]);
  const [loadingHomeowners, setLoadingHomeowners] = useState(false);

  /* ----- Step 3 warranty fields ----- */
  const [useDefaultWarranty, setUseDefaultWarranty] = useState(true);
  const [customWarrantyText, setCustomWarrantyText] = useState("");
  const [defaultWarrantyText, setDefaultWarrantyText] = useState(
    "Standard workmanship warranty: Contractor warrants all labor performed under this Agreement for one (1) year from substantial completion. Materials are covered by the manufacturer’s warranties. This warranty excludes damage caused by misuse, neglect, alteration, improper maintenance, or acts of God."
  );

  // Focus management for custom textarea
  const warrantyRef = useRef(null);
  const [warrantyTyping, setWarrantyTyping] = useState(false);

  const ids = {
    projectTitle: "projectTitleInput",
    projectType: "projectTypeSelect",
    projectSubtype: "projectSubtypeSelect",
    homeowner: "homeownerSelect",
    description: "projectDescription",
  };

  const typeOptions = useMemo(() => normalizeOptions(PROJECT_TYPES || []), []);
  const subtypeOptions = useMemo(
    () => normalizeOptions((SUBTYPES_BY_TYPE?.[projectType]) || []),
    [projectType]
  );

  /* ----- Step 2 milestones ----- */
  const [listLoading, setListLoading] = useState(true);
  const [milestones, setMilestones] = useState([]);
  const [deletions, setDeletions] = useState(new Set());
  const [newMs, setNewMs] = useState({ title: "", description: "", start: "", end: "", amount: "" });
  const [rowEdits, setRowEdits] = useState({});

  const totals = useMemo(() => {
    const active = milestones.filter((m) => !deletions.has(m.id));
    const totalAmount = active.reduce((sum, m) => sum + Number(m.amount || 0), 0);
    const totalDays = active.reduce((sum, m) => sum + daysInclusive(m.start, m.end), 0);
    const starts = active.map((m) => m.start).filter(Boolean).sort();
    const ends = active.map((m) => m.end).filter(Boolean).sort();
    const agreementStart = starts.length ? starts[0] : "";
    const agreementEnd = ends.length ? ends[ends.length - 1] : "";
    return { totalAmount, totalDays, agreementStart, agreementEnd };
  }, [milestones, deletions]);

  /* ---------- Loaders ---------- */
  const loadAgreement = useCallback(async () => {
    try {
      setLoadingAgreement(true);
      const { data } = await api.get(routes.agreement(id));
      setAgreement(data || {});
      setProjectTitle(data?.project_title || data?.title || "");
      setProjectType(data?.project_type || "");
      setProjectSubtype(data?.project_subtype || "");
      setHomeownerId(String(data?.homeowner || data?.homeowner_id || ""));
      setDescription(data?.description || data?.job_description || "");

      // Warranty snapshot from server, if present
      if (typeof data?.warranty_type === "string") {
        const wt = String(data.warranty_type).trim().toLowerCase();
        setUseDefaultWarranty(wt !== "custom");
      }
      if (data?.warranty_text_snapshot) {
        const snap = String(data.warranty_text_snapshot || "");
        if (snap) {
          setDefaultWarrantyText(snap);
          if (String(data?.warranty_type || "").toLowerCase() === "custom") {
            setCustomWarrantyText(snap);
          }
        }
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to load agreement.");
    } finally {
      setLoadingAgreement(false);
    }
  }, [id]);

  const loadHomeowners = useCallback(async () => {
    try {
      setLoadingHomeowners(true);
      const { data } = await api.get(routes.homeowners());
      const rows = Array.isArray(data) ? data : (Array.isArray(data?.results) ? data.results : []);
      const opts = (rows || [])
        .map((r) => {
          const idVal = r.id ?? r.pk ?? r.customer_id ?? r.user_id;
          const nm =
            r.name ??
            r.full_name ??
            ((r.first_name && r.last_name) ? `${r.first_name} ${r.last_name}` : null);
          const em = r.email ?? r.primary_email ?? null;
          const label = nm ? (em ? `${nm} (${em})` : nm) : (em ? em : `Customer #${idVal}`);
          return idVal ? { value: String(idVal), label } : null;
        })
        .filter(Boolean);
      setHomeowners(opts);
    } catch (err) {
      console.error(err);
      toast.error("Could not load homeowners.");
    } finally {
      setLoadingHomeowners(false);
    }
  }, []);

  const loadMilestones = useCallback(async () => {
    try {
      setListLoading(true);
      const { data } = await api.get(routes.milestonesList(id));
      const rows = Array.isArray(data) ? data : [];
      const mapped = rows.map((m) => {
        const startRaw = pickApiDate(
          m,
          ["start", "start_date", "planned_start", "scheduled_start", "begin", "begin_date"],
          ["start", "begin"]
        );
        const endRaw = pickApiDate(
          m,
          [
            "end",
            "end_date",
            "planned_end",
            "scheduled_end",
            "finish",
            "finish_date",
            "end_on",
            "date_end",
            "completion_date",
          ],
          ["end", "finish"]
        );
        return { ...m, start: toDateOnly(startRaw), end: toDateOnly(endRaw) };
      });
      setMilestones(mapped);
      setDeletions(new Set());
      setRowEdits({});
    } catch (err) {
      console.error(err);
      toast.error("Failed to load milestones.");
    } finally {
      setListLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadAgreement();
    loadHomeowners();
    loadMilestones();
  }, [loadAgreement, loadHomeowners, loadMilestones]);

  /* ---------- Nav ---------- */
  const goStep = (n) => {
    setStep(n);
    const sp = new URLSearchParams(Array.from(query.entries()));
    sp.set("step", String(n));
    navigate({ search: `?${sp.toString()}` }, { replace: true });
  };

  /* ---------- Saves ---------- */
  const saveStep1 = async () => {
    try {
      const payload = {
        title: projectTitle || "",
        project_type: projectType || "",
        project_subtype: projectSubtype || "",
        homeowner: homeownerId ? Number(homeownerId) : null,
        description: description || "",
      };
      await api.patch(routes.agreement(id), payload);
      toast.success("Details saved.");
    } catch (err) {
      console.error(err);
      toast.error("Failed to save details.");
      throw err;
    }
  };

  const saveWarranty = async () => {
    const isDefault = !!useDefaultWarranty;
    const trimmedCustom = (customWarrantyText || "").trim();
    let snapshot = isDefault ? (defaultWarrantyText || "").trim() : trimmedCustom;

    if (!snapshot) {
      if (isDefault) {
        snapshot =
          "Standard workmanship warranty: Contractor warrants all labor performed under this Agreement for one (1) year from substantial completion. Materials are covered by the manufacturer’s warranties. This warranty excludes damage caused by misuse, neglect, alteration, improper maintenance, or acts of God.";
      } else {
        toast.error("Please enter your custom warranty text before saving.");
        return;
      }
    }

    const primaryPayload = {
      warranty_type: isDefault ? "default" : "custom",
      warranty_text_snapshot: snapshot,
    };
    const aliasPayload = {
      use_default_warranty: isDefault,
      custom_warranty_text: isDefault ? "" : snapshot,
    };

    const fmtErr = (err) => {
      const d = err?.response?.data;
      if (typeof d === "string") return d;
      if (d?.detail) return d.detail;
      if (d && typeof d === "object") {
        return Object.entries(d)
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
          .join(" | ");
      }
      return err?.message || "Unknown error";
    };

    try {
      await api.patch(routes.agreement(id), primaryPayload);
      toast.success("Warranty saved.");
    } catch (e1) {
      try {
        await api.patch(routes.agreement(id), aliasPayload);
        toast.success("Warranty saved.");
      } catch (e2) {
        toast.error(fmtErr(e2) || fmtErr(e1) || "Failed to save warranty.");
        console.error("Warranty save error (primary, alias):", e1, e2);
      }
    }
  };

  /* ---------- Milestones logic ---------- */
  const resetNewMs = () =>
    setNewMs({ title: "", description: "", start: "", end: "", amount: "" });

  const canAddNew = useMemo(() => {
    const d = daysInclusive(newMs.start, newMs.end);
    return (
      newMs.title.trim() &&
      newMs.amount !== "" &&
      Number(newMs.amount) >= 0 &&
      newMs.start &&
      newMs.end &&
      d > 0
    );
  }, [newMs]);

  const onAddMilestone = () => {
    if (!canAddNew) {
      toast.error("Fill Title, Start, End, and Amount (valid dates) before adding.");
      return;
    }
    const tempId = -1 * Date.now();
    const ms = {
      id: tempId,
      title: newMs.title.trim(),
      description: newMs.description?.trim() || "",
      start: toDateOnly(newMs.start),
      end: toDateOnly(newMs.end),
      amount: Number(newMs.amount),
      _isTemp: true,
    };
    setMilestones((prev) => [...prev, ms]);
    resetNewMs();
    toast.success("Milestone added to list.");
  };

  const startEditRow = (m) =>
    setRowEdits((prev) => ({ ...prev, [m.id]: { ...m, editing: true } }));

  const cancelEditRow = (id_) =>
    setRowEdits((prev) => {
      const n = { ...prev };
      delete n[id_];
      return n;
    });

  const commitEditRow = (id_) => {
    const e = rowEdits[id_];
    if (!e || !e.title?.trim() || !e.start || !e.end || Number.isNaN(Number(e.amount))) {
      toast.error("Missing/invalid fields.");
      return;
    }
    if (daysInclusive(e.start, e.end) <= 0) {
      toast.error("End date must be on/after Start date.");
      return;
    }
    setMilestones((prev) =>
      prev.map((m) => (m.id === id_ ? { ...m, ...e, editing: undefined } : m))
    );
    cancelEditRow(id_);
    toast.success("Row updated.");
  };

  const markDelete = (id_) => {
    const row = milestones.find((m) => m.id === id_);
    if (row && row._isTemp) {
      setMilestones((prev) => prev.filter((m) => m.id !== id_));
      return;
    }
    setDeletions((prev) => new Set([...Array.from(prev), id_]));
  };

  const unmarkDelete = (id_) =>
    setDeletions((prev) => {
      const n = new Set(prev);
      n.delete(id_);
      return n;
    });

  const persistMilestones = async () => {
    // deletes
    for (const id_ of deletions) {
      try {
        await api.delete(routes.milestoneDetail(id_));
      } catch (e) {
        console.error(e);
        toast.error(`Failed deleting milestone #${id_}`);
      }
    }
    // edits
    const editedIds = Object.keys(rowEdits).map((k) => Number(k));
    for (const id_ of editedIds) {
      const e = rowEdits[id_];
      if (!e) continue;
      try {
        const s = toDateOnly(e.start);
        const ed = toDateOnly(e.end);
        await api.patch(routes.milestoneDetail(id_), {
          title: e.title?.trim(),
          description: e.description || "",
          amount: Number(e.amount),
          start: s,
          start_date: s,
          planned_start: s,
          scheduled_start: s,
          end: ed,
          end_date: ed,
          planned_end: ed,
          scheduled_end: ed,
          finish_date: ed,
          completion_date: ed,
        });
      } catch (err) {
        console.error(err);
        toast.error(`Failed updating milestone #${id_}`);
      }
    }
    // creates
    const news = milestones.filter((m) => m._isTemp);
    for (const n of news) {
      try {
        const s = n.start;
        const ed = n.end;
        await api.post(routes.milestonesList(id), {
          title: n.title,
          description: n.description || "",
          amount: Number(n.amount),
          start: s,
          start_date: s,
          planned_start: s,
          scheduled_start: s,
          end: ed,
          end_date: ed,
          planned_end: ed,
          scheduled_end: ed,
          finish_date: ed,
          completion_date: ed,
        });
      } catch (err) {
        console.error(err);
        toast.error(`Failed creating milestone "${n.title}"`);
      }
    }
    await loadMilestones();
    toast.success("Milestones saved.");
  };

  /* ---------- Header Actions ---------- */

  // Authenticated preview: fetch Blob with Authorization and open in a new tab
  const handleHeaderPreview = async () => {
    try {
      setPreviewing(true);
      const res = await api.get(routes.previewPdf(id), {
        params: { stream: 1 },
        responseType: "blob",
      });
      const blob = new Blob([res.data], { type: "application/pdf" });
      const url = window.URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      console.error(err);
      toast.error("Could not generate preview. Please try again.");
    } finally {
      setPreviewing(false);
    }
  };

  const handleViewPublic = () => {
    const url = `${window.location.origin}/agreements/${id}`;
    window.open(url, "_blank", "noopener");
  };

  const handleCopyPublic = async () => {
    const url = `${window.location.origin}/agreements/${id}`;
    try {
      setCopying(true);
      await navigator.clipboard.writeText(url);
      toast.success("Public link copied to clipboard");
    } catch {
      toast.error("Unable to copy. You can copy from the new tab.");
    } finally {
      setCopying(false);
    }
  };

  /* ---------- UI ---------- */
  const TabButtons = () => (
    <div className="flex flex-wrap gap-2 mb-4" onSubmit={(e) => e.preventDefault()}>
      {TABS.map((t) => (
        <button
          key={t.step}
          type="button"
          onClick={() => goStep(t.step)}
          className={`px-3 py-2 rounded border text-sm ${step === t.step ? "bg-blue-600 text-white" : "bg-white"}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  const Step1 = () => (
    <div className="space-y-4" onSubmit={(e) => e.preventDefault()}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
        <div>
          <label htmlFor={ids.projectTitle} className="block text-sm font-medium mb-1">
            Project Title
          </label>
          <input
            id={ids.projectTitle}
            className="w-full border rounded px-3 py-2"
            value={projectTitle}
            onChange={(e) => setProjectTitle(e.target.value)}
            placeholder="e.g., Kitchen Floor and Wall"
          />
        </div>

        <div>
          <label htmlFor={ids.projectType} className="block text-sm font-medium mb-1">
            Project Type
          </label>
          <select
            id={ids.projectType}
            className="w-full border rounded px-3 py-2"
            value={projectType}
            onChange={(e) => {
              setProjectType(e.target.value);
              setProjectSubtype("");
            }}
          >
            <option value="">Select a type</option>
            {typeOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor={ids.projectSubtype} className="block text-sm font-medium mb-1">
            Project Subtype
          </label>
          <select
            id={ids.projectSubtype}
            className="w-full border rounded px-3 py-2"
            value={projectSubtype}
            onChange={(e) => setProjectSubtype(e.target.value)}
            disabled={!projectType}
          >
            <option value="">Select a subtype</option>
            {(SUBTYPES_BY_TYPE?.[projectType] || []).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor={ids.homeowner} className="block text-sm font-medium mb-1">
            Homeowner
          </label>
          <select
            id={ids.homeowner}
            className="w-full border rounded px-3 py-2"
            value={homeownerId}
            onChange={(e) => setHomeownerId(e.target.value)}
          >
            <option value="">{loadingHomeowners ? "Loading…" : "Select a homeowner"}</option>
            {homeowners.map((h) => (
              <option key={h.value} value={h.value}>
                {h.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor={ids.description} className="block text-sm font-medium mb-1">
          Project Description
        </label>
        <textarea
          id={ids.description}
          className="w-full border rounded px-3 py-2"
          rows={4}
          placeholder="Describe the scope of work, important notes, materials, etc."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="flex gap-2">
        <button type="button" className="px-4 py-2 rounded border" onClick={() => navigate(-1)}>
          Back
        </button>
        <button
          type="button"
          className="px-4 py-2 rounded bg-blue-600 text-white"
          onClick={async () => {
            await saveStep1();
            goStep(2);
          }}
        >
          Save & Next
        </button>
      </div>
    </div>
  );

  const Step2 = () => {
    const dNew = daysInclusive(newMs.start, newMs.end);
    return (
      <div className="space-y-6" onSubmit={(e) => e.preventDefault()}>
        {/* New Milestone form */}
        <div className="border rounded p-4 bg-white shadow-sm w-full">
          <h3 className="font-semibold mb-3">New Milestone</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
            <div>
              <label className="block text-sm font-medium mb-1">Title</label>
              <input
                className="w-full border rounded px-3 py-2"
                value={newMs.title}
                onChange={(e) => setNewMs((s) => ({ ...s, title: e.target.value }))}
                placeholder="e.g., Install Floor Tile"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Amount ($)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                className="w-full border rounded px-3 py-2"
                value={newMs.amount}
                onChange={(e) => setNewMs((s) => ({ ...s, amount: e.target.value }))}
                placeholder="0.00"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-1">Milestone Description</label>
              <textarea
                className="w-full border rounded px-3 py-2"
                rows={2}
                value={newMs.description}
                onChange={(e) => setNewMs((s) => ({ ...s, description: e.target.value }))}
                placeholder="Brief description of the milestone work…"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Start</label>
              <input
                type="date"
                className="w-full border rounded px-3 py-2"
                value={newMs.start}
                onChange={(e) => setNewMs((s) => ({ ...s, start: toDateOnly(e.target.value) }))}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">End</label>
              <input
                type="date"
                className="w-full border rounded px-3 py-2"
                value={newMs.end}
                onChange={(e) => setNewMs((s) => ({ ...s, end: toDateOnly(e.target.value) }))}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Days (auto)</label>
              <input
                className="w-full border rounded px-3 py-2 bg-gray-50"
                readOnly
                value={dNew || ""}
                placeholder="—"
                aria-label="Auto-calculated days"
              />
            </div>

            <div className="flex items-end">
              <button
                type="button"
                className={`px-4 py-2 rounded ${
                  canAddNew ? "bg-emerald-600 text-white" : "bg-gray-300 text-gray-700 cursor-not-allowed"
                }`}
                onClick={onAddMilestone}
                disabled={!canAddNew}
              >
                + Add Milestone
              </button>
            </div>
          </div>
        </div>

        {/* ---- Milestone list (restored) ---- */}
        <div className="border rounded bg-white shadow-sm overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-3 py-2">#</th>
                <th className="text-left px-3 py-2">Title</th>
                <th className="text-left px-3 py-2">Description</th>
                <th className="text-left px-3 py-2">Start</th>
                <th className="text-left px-3 py-2">End</th>
                <th className="text-left px-3 py-2">Days</th>
                <th className="text-right px-3 py-2">Amount</th>
                <th className="text-left px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {listLoading ? (
                <tr>
                  <td className="px-3 py-3" colSpan={8}>
                    Loading…
                  </td>
                </tr>
              ) : milestones.length === 0 ? (
                <tr>
                  <td className="px-3 py-3" colSpan={8}>
                    No milestones yet. Add one above.
                  </td>
                </tr>
              ) : (
                milestones.map((m, idx) => {
                  const isDeleted = deletions.has(m.id);
                  const d = daysInclusive(m.start, m.end);
                  const edit = rowEdits[m.id];

                  return (
                    <tr key={m.id} className={isDeleted ? "opacity-50" : ""}>
                      <td className="px-3 py-2 align-top">{idx + 1}</td>

                      <td className="px-3 py-2 align-top">
                        {edit?.editing ? (
                          <input
                            className="w-full border rounded px-2 py-1"
                            value={edit.title}
                            onChange={(e) =>
                              setRowEdits((prev) => ({ ...prev, [m.id]: { ...prev[m.id], title: e.target.value } }))
                            }
                          />
                        ) : (
                          <span className="font-medium">{m.title}</span>
                        )}
                      </td>

                      <td className="px-3 py-2 align-top">
                        {edit?.editing ? (
                          <textarea
                            className="w-full border rounded px-2 py-1"
                            rows={2}
                            value={edit.description || ""}
                            onChange={(e) =>
                              setRowEdits((prev) => ({
                                ...prev,
                                [m.id]: { ...prev[m.id], description: e.target.value },
                              }))
                            }
                          />
                        ) : (
                          <span className="text-gray-700">{m.description}</span>
                        )}
                      </td>

                      <td className="px-3 py-2 align-top">
                        {edit?.editing ? (
                          <input
                            type="date"
                            className="w-full border rounded px-2 py-1"
                            value={edit.start}
                            onChange={(e) =>
                              setRowEdits((prev) => ({
                                ...prev,
                                [m.id]: { ...prev[m.id], start: toDateOnly(e.target.value) },
                              }))
                            }
                          />
                        ) : (
                          <span>{m.start}</span>
                        )}
                      </td>

                      <td className="px-3 py-2 align-top">
                        {edit?.editing ? (
                          <input
                            type="date"
                            className="w-full border rounded px-2 py-1"
                            value={edit.end}
                            onChange={(e) =>
                              setRowEdits((prev) => ({
                                ...prev,
                                [m.id]: { ...prev[m.id], end: toDateOnly(e.target.value) },
                              }))
                            }
                          />
                        ) : (
                          <span>{m.end}</span>
                        )}
                      </td>

                      <td className="px-3 py-2 align-top">
                        <span>{d}</span>
                      </td>

                      <td className="px-3 py-2 align-top text-right">
                        {edit?.editing ? (
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="w-28 border rounded px-2 py-1 text-right"
                            value={edit.amount}
                            onChange={(e) =>
                              setRowEdits((prev) => ({
                                ...prev,
                                [m.id]: { ...prev[m.id], amount: e.target.value },
                              }))
                            }
                          />
                        ) : (
                          <span>{money(m.amount)}</span>
                        )}
                      </td>

                      <td className="px-3 py-2 align-top">
                        {!isDeleted ? (
                          edit?.editing ? (
                            <div className="flex gap-2">
                              <button
                                type="button"
                                className="px-2 py-1 rounded bg-emerald-600 text-white"
                                onClick={() => commitEditRow(m.id)}
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                className="px-2 py-1 rounded border"
                                onClick={() => cancelEditRow(m.id)}
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="flex gap-2">
                              <button
                                type="button"
                                className="px-2 py-1 rounded border"
                                onClick={() => startEditRow(m)}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="px-2 py-1 rounded bg-rose-600 text-white"
                                onClick={() => markDelete(m.id)}
                              >
                                Delete
                              </button>
                            </div>
                          )
                        ) : (
                          <button
                            type="button"
                            className="px-2 py-1 rounded border"
                            onClick={() => unmarkDelete(m.id)}
                          >
                            Undo Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="border rounded p-4 bg-white shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-gray-500">Total Amount</div>
              <div className="font-semibold">{money(totals.totalAmount)}</div>
            </div>
            <div>
              <div className="text-gray-500">Total Days</div>
              <div className="font-semibold">{totals.totalDays}</div>
            </div>
            <div>
              <div className="text-gray-500">Agreement Start</div>
              <div className="font-semibold">{totals.agreementStart || "—"}</div>
            </div>
            <div>
              <div className="text-gray-500">Agreement End</div>
              <div className="font-semibold">{totals.agreementEnd || "—"}</div>
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <button type="button" className="px-4 py-2 rounded border" onClick={() => goStep(1)}>
            Back
          </button>
          <button
            type="button"
            className="px-4 py-2 rounded border"
            onClick={async () => {
              await persistMilestones();
            }}
          >
            Save
          </button>
          <button
            type="button"
            className="px-4 py-2 rounded bg-blue-600 text-white"
            onClick={async () => {
              await persistMilestones();
              goStep(3);
            }}
          >
            Save & Next
          </button>
        </div>
      </div>
    );
  };

  const Step3 = () => (
    <div className="space-y-6" onSubmit={(e) => e.preventDefault()}>
      <div className="border rounded p-4 bg-white shadow-sm">
        <h3 className="font-semibold mb-3">Warranty</h3>

        <label className="inline-flex items-center gap-2 mb-3">
          <input
            type="checkbox"
            checked={useDefaultWarranty}
            onChange={(e) => setUseDefaultWarranty(e.target.checked)}
          />
          <span>Use default warranty text</span>
        </label>

        <div>
          <label className="block text-sm font-medium mb-1">
            {useDefaultWarranty ? "Default Warranty (read-only)" : "Custom Warranty Text"}
          </label>
          <textarea
            ref={warrantyRef}
            className={`w-full border rounded px-3 py-2 ${useDefaultWarranty ? "bg-gray-100 text-gray-700" : ""}`}
            rows={6}
            disabled={useDefaultWarranty}
            value={useDefaultWarranty ? defaultWarrantyText : customWarrantyText}
            onChange={(e) => {
              if (!useDefaultWarranty) setCustomWarrantyText(e.target.value);
            }}
            onFocus={() => setWarrantyTyping(true)}
            onBlur={() => setWarrantyTyping(false)}
            onKeyDownCapture={(e) => e.stopPropagation()}
            onKeyUpCapture={(e) => e.stopPropagation()}
            onInput={(e) => e.stopPropagation()}
          />
        </div>

        <div className="mt-3">
          <button type="button" className="px-4 py-2 rounded bg-blue-600 text-white" onClick={saveWarranty}>
            Save Warranty
          </button>
        </div>
      </div>

      <div className="border rounded p-4 bg-white shadow-sm">
        <h3 className="font-semibold mb-3">Attachments</h3>
        <AttachmentSection agreementId={id} />
      </div>

      <div className="flex gap-2">
        <button type="button" className="px-4 py-2 rounded border" onClick={() => goStep(2)}>
          Back
        </button>
        <button type="button" className="px-4 py-2 rounded bg-blue-600 text-white" onClick={() => goStep(4)}>
          Save & Next
        </button>
      </div>
    </div>
  );

  const Step4 = () => (
    <Step4Review
      agreementId={id}
      onBack={() => goStep(3)}
      onFinished={() => {
        toast.success("Agreement sent to homeowner for signature.");
      }}
    />
  );

  return (
    <div
      id="agreement-wizard-root"
      data-wizard-root="true"
      className="wizard-fluid p-4"
      style={{ maxWidth: "none", width: "100%", margin: 0 }}
      onSubmit={(e) => e.preventDefault()}
    >
      {/* Header with global Preview + Public Link */}
      <div className="mb-4 flex items-center justify-between gap-3 flex-wrap w-full">
        <div className="text-sm text-gray-700">
          {loadingAgreement ? (
            <div className="text-sm text-gray-500">Loading agreement…</div>
          ) : (
            <>
              <div className="font-semibold">
                Agreement #{agreement?.id}
                {agreement?.project_title ? ` – ${agreement.project_title}` : ""}
              </div>
              <div className="text-gray-500">
                Homeowner: {agreement?.homeowner_name || "—"} · Status: {agreement?.status || "—"}
              </div>
            </>
          )}
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            className="px-3 py-2 rounded border text-sm"
            onClick={handleHeaderPreview}
            disabled={previewing || loadingAgreement}
            title="Open an authenticated PDF preview"
          >
            {previewing ? "Generating…" : "Preview PDF"}
          </button>

          <button
            type="button"
            className="px-3 py-2 rounded border text-sm"
            onClick={handleViewPublic}
            title="Open the read-only, public Agreement page"
          >
            View Public Link
          </button>

          <button
            type="button"
            className="px-3 py-2 rounded border text-sm"
            onClick={handleCopyPublic}
            disabled={copying}
            title="Copy the public link to your clipboard"
          >
            {copying ? "Copying…" : "Copy Link"}
          </button>
        </div>
      </div>

      <TabButtons />

      <div className="space-y-6 w-full">
        {step === 1 && <Step1 />}
        {step === 2 && <Step2 />}
        {step === 3 && <Step3 />}
        {step === 4 && <Step4 />}
      </div>
    </div>
  );
}
