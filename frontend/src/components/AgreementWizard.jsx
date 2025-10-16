// frontend/src/components/AgreementWizard.jsx
// v2025-10-16 step3-delete-quiet+fix + Step 4 consolidated to external component

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../api";
import MilestoneEditModal from "./MilestoneEditModal";
import { PROJECT_TYPES, SUBTYPES_BY_TYPE } from "./options/projectOptions";
import Step4Finalize from "./Step4Finalize"; // <-- use external Step 4

/* ---------------- small helpers ---------------- */
const TABS = [
  { step: 1, label: "1. Details" },
  { step: 2, label: "2. Milestones" },
  { step: 3, label: "3. Warranty & Attachments" },
  { step: 4, label: "4. Finalize & Review" },
];

const pickArray = (raw) =>
  Array.isArray(raw?.results) ? raw.results : Array.isArray(raw) ? raw : [];

function toDateOnly(v) {
  if (!v) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function sortPeople(list) {
  return [...list].sort((a, b) =>
    (a.full_name || a.last_name || a.email || `id:${a.id}`).localeCompare(
      b.full_name || b.last_name || b.email || `id:${b.id}`
    )
  );
}

function normalizeCustomer(rec) {
  if (!rec || typeof rec !== "object") return null;
  const id = rec.id ?? rec.pk;
  if (!id) return null;
  const full_name = String(rec.full_name ?? rec.name ?? "").trim();
  const email = String(rec.email ?? "").trim();
  let first_name = "",
    last_name = "";
  if (full_name.includes(" ")) {
    const parts = full_name.split(/\s+/);
    first_name = parts.slice(0, -1).join(" ");
    last_name = parts.slice(-1)[0];
  } else {
    first_name = full_name;
  }
  return { id, first_name, last_name, full_name, email, _src: "customers" };
}

function normalizeHomeowner(rec) {
  if (!rec || typeof rec !== "object") return null;
  const id = rec.id ?? rec.pk;
  if (!id) return null;
  const first_name = String(rec.first_name ?? rec.firstName ?? "").trim();
  const last_name = String(rec.last_name ?? rec.lastName ?? "").trim();
  const email = String(rec.email ?? "").trim();
  const full_name = String(
    rec.full_name ??
      rec.fullName ??
      rec.name ??
      [first_name, last_name].filter(Boolean).join(" ")
  ).trim();
  return { id, first_name, last_name, full_name, email, _src: "homeowners" };
}

function synthesizeFromMilestones(raw, agreementHomeownerId) {
  const arr = pickArray(raw);
  const map = new Map();
  for (const m of arr) {
    const nm = String(m?.homeowner_name || "").trim();
    const em = String(m?.homeowner_email || "").trim();
    if (!nm && !em) continue;
    const key = em || nm;
    if (!map.has(key)) map.set(key, { full_name: nm, email: em });
  }
  return [...map.entries()].map(([key, v]) => ({
    id: agreementHomeownerId || key,
    first_name: "",
    last_name: "",
    full_name: v.full_name || "",
    email: v.email || "",
    _src: "milestones-fallback",
  }));
}

function buildLabel(p) {
  const l = (p.last_name || "").trim();
  const f = (p.first_name || "").trim();
  const full = (p.full_name || "").trim();
  const email = (p.email || "").trim();
  if (l || f) {
    const lf = [l, f].filter(Boolean).join(", ");
    return email ? `${lf} — ${email}` : lf;
  }
  if (full) return email ? `${full} — ${email}` : full;
  if (email) return email;
  return `ID ${p.id}`;
}

function friendly(d) {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/* ---------------- main ---------------- */
export default function AgreementWizard() {
  const { id: idParam } = useParams();
  const navigate = useNavigate();
  const search = new URLSearchParams(useLocation().search);
  const step = Number(search.get("step") || "1");

  const agreementId =
    idParam && /^\d+$/.test(String(idParam)) ? String(idParam) : null;
  const isEdit = !!agreementId;

  const [loading, setLoading] = useState(false);
  const [agreement, setAgreement] = useState(null);
  const [milestones, setMilestones] = useState([]);
  const [people, setPeople] = useState([]);

  // Step 1 form
  const [dLocal, setDLocal] = useState({
    homeowner: "",
    project_title: "",
    project_type: "",
    project_subtype: "",
    description: "",
    start: "",
    end: "",
  });

  // Step 2 form
  const [mLocal, setMLocal] = useState({
    title: "",
    description: "",
    amount: "",
    start: "",
    end: "",
  });
  const [editMilestone, setEditMilestone] = useState(null);

  // Warranty & signing bits
  const [useDefaultWarranty, setUseDefaultWarranty] = useState(true);
  const [customWarranty, setCustomWarranty] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [hasPreviewed, setHasPreviewed] = useState(false);
  const [ackReviewed, setAckReviewed] = useState(false);
  const [ackTos, setAckTos] = useState(false);
  const [ackEsign, setAckEsign] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [signing, setSigning] = useState(false);

  /* -------- explicit people loader -------- */
  const loadPeopleStrict = useCallback(async () => {
    const cfg = {
      params: { page: 1, page_size: 1000, ordering: "-created_at" },
    };

    try {
      const { data } = await api.get(`/customers/`, cfg);
      const list = pickArray(data).map(normalizeCustomer).filter(Boolean);
      if (list.length) return sortPeople(list);
    } catch {}

    try {
      const { data } = await api.get(`/homeowners/`, cfg);
      const list = pickArray(data).map(normalizeHomeowner).filter(Boolean);
      if (list.length) return sortPeople(list);
    } catch {}

    try {
      const { data } = await api.get(`/projects/customers/`, cfg);
      const list = pickArray(data).map(normalizeCustomer).filter(Boolean);
      if (list.length) return sortPeople(list);
    } catch {}

    try {
      const { data } = await api.get(`/projects/homeowners/`, cfg);
      const list = pickArray(data).map(normalizeHomeowner).filter(Boolean);
      if (list.length) return sortPeople(list);
    } catch {}

    return [];
  }, []);

  /* -------- edit mode -------- */
  const loadEdit = useCallback(async () => {
    setLoading(true);
    try {
      const { data: ag } = await api.get(`/projects/agreements/${agreementId}/`);
      setAgreement(ag);

      const agHomeownerId =
        typeof ag.homeowner === "object" && ag.homeowner
          ? String(ag.homeowner.id ?? "")
          : ag.homeowner != null
          ? String(ag.homeowner)
          : ag.homeowner_id != null
          ? String(ag.homeowner_id)
          : "";

      const seed = [];
      if (agHomeownerId || ag.homeowner_name || ag.homeowner_email) {
        seed.push({
          id: agHomeownerId || (ag.homeowner_email || ag.homeowner_name || "unknown"),
          first_name: "",
          last_name: "",
          full_name: ag.homeowner_name || "",
          email: ag.homeowner_email || "",
          _src: "agreement-snapshot",
        });
      }
      setPeople(seed);

      setDLocal({
        homeowner: String(agHomeownerId || ""),
        project_title: ag.project_title || ag.title || "",
        project_type: (ag.project_type ?? "") || "",
        project_subtype: (ag.project_subtype ?? "") || "",
        description: ag.description || "",
        start: toDateOnly(ag.start),
        end: toDateOnly(ag.end),
      });

      let loaded = await loadPeopleStrict();

      if (!loaded.length) {
        try {
          const { data: msRaw } = await api.get(`/projects/milestones/`, {
            params: { agreement: agreementId, page_size: 500 },
          });
          loaded = synthesizeFromMilestones(msRaw, agHomeownerId);
        } catch {}
      }

      const byKey = new Map();
      for (const p of [...seed, ...loaded]) {
        const key = /^\d+$/.test(String(p.id))
          ? `id:${p.id}`
          : `email:${(p.email || "").toLowerCase()}`;
        if (!byKey.has(key)) byKey.set(key, p);
      }
      setPeople(sortPeople([...byKey.values()]));

      try {
        const { data: ms } = await api.get(`/projects/milestones/`, {
          params: { agreement: agreementId, page_size: 500 },
        });
        setMilestones(pickArray(ms));
      } catch {
        setMilestones([]);
      }

      const isDef =
        String(ag.warranty_type || "").toUpperCase() === "DEFAULT" ||
        Boolean(ag.use_default_warranty) ||
        !ag.warranty_text_snapshot ||
        String(ag.warranty_text_snapshot || "").trim() === "";
      setUseDefaultWarranty(isDef);
      setCustomWarranty(isDef ? "" : ag.warranty_text_snapshot || "");

      try {
        const { data: atts } = await api.get(
          `/projects/agreements/${agreementId}/attachments/`
        );
        setAttachments(Array.isArray(atts) ? atts : pickArray(atts));
      } catch {
        setAttachments([]);
      }
    } catch (e) {
      console.error(e);
      toast.error("Failed to load agreement.");
    } finally {
      setLoading(false);
    }
  }, [agreementId, loadPeopleStrict]);

  /* -------- create mode -------- */
  const loadCreate = useCallback(async () => {
    setLoading(true);
    try {
      setAgreement(null);
      setMilestones([]);
      setAttachments([]);

      const loaded = await loadPeopleStrict();
      setPeople(loaded);
    } catch (e) {
      console.error(e);
      toast.error("Failed to load form.");
    } finally {
      setLoading(false);
    }
  }, [loadPeopleStrict]);

  useEffect(() => {
    if (agreementId) loadEdit();
    else loadCreate();
  }, [agreementId, loadEdit, loadCreate]);

  /* -------- totals -------- */
  const totals = useMemo(() => {
    const starts = milestones
      .map((m) =>
        toDateOnly(m.start_date || m.start || m.scheduled_date)
      )
      .filter(Boolean);
    const ends = milestones
      .map((m) =>
        toDateOnly(m.completion_date || m.end_date || m.end || m.due_date)
      )
      .filter(Boolean);
    const minStart = starts.length
      ? [...starts].sort()[0]
      : toDateOnly(agreement?.start) || "";
    const maxEnd = ends.length
      ? [...ends].sort().slice(-1)[0]
      : toDateOnly(agreement?.end) || "";
    const totalAmt = milestones.reduce(
      (s, m) => s + Number(m.amount || 0),
      0
    );
    const totalDays =
      minStart && maxEnd
        ? Math.max(
            1,
            Math.floor((new Date(maxEnd) - new Date(minStart)) / 86400000) + 1
          )
        : 0;
    return { totalAmt, minStart, maxEnd, totalDays };
  }, [milestones, agreement]);

  const goStep = (n) =>
    navigate(
      agreementId
        ? `/agreements/${agreementId}/wizard?step=${n}`
        : `/agreements/new?step=${n}`
    );

  /* -------- Step 1 save (POST vs PATCH) -------- */
  const saveStep1 = async (next = false) => {
    try {
      const val = String(dLocal.homeowner || "");
      const homeownerField = /^\d+$/.test(val) ? Number(val) : null;

      const payload = {
        homeowner: homeownerField,
        title: dLocal.project_title,
        project_title: dLocal.project_title,
        project_type: dLocal.project_type || null,
        project_subtype: dLocal.project_subtype || null,
        description: dLocal.description,
        start: dLocal.start || null,
        end: dLocal.end || null,
      };

      if (agreementId) {
        await api.patch(`/projects/agreements/${agreementId}/`, payload);
        toast.success("Details saved.");
        if (next) goStep(2);
        else await loadEdit();
      } else {
        const { data: created } = await api.post(
          `/projects/agreements/`,
          payload
        );
        const newId = created?.id ?? created?.pk;
        if (!newId) return toast.error("Could not determine new Agreement ID.");
        toast.success("Agreement created.");
        navigate(`/agreements/${newId}/wizard?step=${next ? 2 : 1}`, {
          replace: true,
        });
      }
    } catch (e) {
      toast.error(
        `Save failed: ${e?.response?.statusText || e?.message || "Unknown error"}`
      );
    }
  };

  /* -------- Step 2 -------- */
  const onLocalChange = (e) => {
    const { name, value } = e.target;
    setMLocal((s) => ({
      ...s,
      [name]: name === "start" || name === "end" ? toDateOnly(value) : value,
    }));
  };

  const addMilestone = async () => {
    if (!agreementId) return toast.error("Create and save Agreement first.");
    const f = mLocal;
    if (!f.title?.trim()) return toast.error("Enter a title.");
    if (!f.start || !f.end) return toast.error("Select start and end dates.");
    try {
      await api.post(`/projects/milestones/`, {
        agreement: Number(agreementId),
        title: f.title.trim(),
        description: f.description || "",
        amount: f.amount ? Number(f.amount) : 0,
        start_date: f.start,
        end_date: f.end,
        completion_date: f.end,
      });
      setMLocal({ title: "", description: "", amount: "", start: "", end: "" });
      await loadEdit();
      toast.success("Milestone added.");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Add failed.");
    }
  };

  const removeMilestone = async (mid) => {
    if (!agreementId) return;
    try {
      await api.delete(`/projects/milestones/${mid}/`);
      await loadEdit();
      toast.success("Milestone removed.");
    } catch {
      toast.error("Delete failed.");
    }
  };

  /* -------- Step 3 (warranty) -------- */
  const saveWarranty = async () => {
    if (!agreementId) return toast.error("Create and save Agreement first.");
    try {
      const text = useDefaultWarranty ? "" : customWarranty || "";
      await api.patch(`/projects/agreements/${agreementId}/`, {
        warranty_type: useDefaultWarranty ? "DEFAULT" : "CUSTOM",
        warranty_text_snapshot: text,
        use_default_warranty: useDefaultWarranty,
        custom_warranty_text: text,
      });
      await loadEdit();
      toast.success("Warranty saved.");
    } catch (e) {
      toast.error(
        e?.response?.statusText || e?.message || "Save failed"
      );
    }
  };

  /* -------- Step 4 (preview/sign) -------- */
  const previewPdf = async () => {
    if (!agreementId) return toast.error("Create and save Agreement first.");
    try {
      const { data } = await api.post(
        `/projects/agreements/${agreementId}/preview_link/`
      );
      const url = data?.url;
      if (!url) return toast.error("Preview link unavailable.");
      window.open(url, "_blank", "noopener");
      setHasPreviewed(true);
      try {
        await api.post(
          `/projects/agreements/${agreementId}/mark_previewed/`
        );
      } catch {}
    } catch {
      toast.error("Could not open preview.");
    }
  };
  const goPublic = () => {
    if (!agreementId) return toast.error("Create and save Agreement first.");
    window.open(`/agreements/public/${agreementId}/`, "_blank");
  };
  const signContractor = async () => {
    if (!agreementId) return toast.error("Create and save Agreement first.");
    if (
      !(
        hasPreviewed &&
        ackReviewed &&
        ackTos &&
        ackEsign &&
        typedName.trim().length >= 2
      )
    )
      return;
    setSigning(true);
    try {
      await api.post(
        `/projects/agreements/${agreementId}/contractor_sign/`,
        { typed_name: typedName.trim() }
      );
      toast.success("Signed as Contractor.");
      window.location.reload();
    } catch (e) {
      toast.error(
        `Sign failed: ${e?.response?.statusText || e?.message || "Save failed"}`
      );
    } finally {
      setSigning(false);
    }
  };
  const canSign =
    !!agreementId &&
    hasPreviewed &&
    ackReviewed &&
    ackTos &&
    ackEsign &&
    typedName.trim().length >= 2;

  /* -------- render -------- */
  return (
    <div className="p-4 md:p-6">
      {/* Tabs */}
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.step}
            onClick={() =>
              navigate(
                agreementId
                  ? `/agreements/${agreementId}/wizard?step=${t.step}`
                  : `/agreements/new?step=${t.step}`
              )
            }
            className={`rounded px-3 py-2 text-sm ${
              step === t.step
                ? "bg-indigo-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {step === 1 && (
        <Step1Details
          isEdit={isEdit}
          agreementId={agreementId}
          dLocal={dLocal}
          setDLocal={setDLocal}
          people={people}
          saveStep1={saveStep1}
        />
      )}

      {step === 2 && (
        <Step2Milestones
          agreement={agreement}
          mLocal={mLocal}
          onLocalChange={onLocalChange}
          onAdd={addMilestone}
          milestones={milestones}
          onDelete={removeMilestone}
          onEdit={(m) => setEditMilestone(m)}
          onBack={() =>
            navigate(
              agreementId
                ? `/agreements/${agreementId}/wizard?step=1`
                : `/agreements/new?step=1`
            )
          }
          onNext={() =>
            navigate(
              agreementId
                ? `/agreements/${agreementId}/wizard?step=3`
                : `/agreements/new?step=3`
            )
          }
        />
      )}

      {step === 3 && (
        <Step3WarrantyAttachments
          agreementId={agreementId}
          DEFAULT_WARRANTY={
            "Standard workmanship warranty: Contractor warrants all labor performed under this Agreement for one (1) year from substantial completion. Materials are covered by the manufacturer’s warranties. This warranty excludes damage caused by misuse, neglect, alteration, improper maintenance, or acts of God."
          }
          useDefaultWarranty={useDefaultWarranty}
          setUseDefaultWarranty={setUseDefaultWarranty}
          customWarranty={customWarranty}
          setCustomWarranty={setCustomWarranty}
          saveWarranty={saveWarranty}
          attachments={attachments}
          refreshAttachments={loadEdit}
          onBack={() =>
            navigate(
              agreementId
                ? `/agreements/${agreementId}/wizard?step=2`
                : `/agreements/new?step=2`
            )
          }
          onNext={() =>
            navigate(
              agreementId
                ? `/agreements/${agreementId}/wizard?step=4`
                : `/agreements/new?step=4`
            )
          }
        />
      )}

      {step === 4 && (
        <Step4Finalize
          agreement={agreement}
          id={agreementId}
          previewPdf={previewPdf}
          goPublic={goPublic}
          milestones={milestones}
          totals={totals}
          hasPreviewed={hasPreviewed}
          ackReviewed={ackReviewed}
          setAckReviewed={setAckReviewed}
          ackTos={ackTos}
          setAckTos={setAckTos}
          ackEsign={ackEsign}
          setAckEsign={setAckEsign}
          typedName={typedName}
          setTypedName={setTypedName}
          canSign={canSign}
          signing={signing}
          signContractor={signContractor}
          attachments={attachments}
          defaultWarrantyText={
            "Standard workmanship warranty: Contractor warrants all labor performed under this Agreement for one (1) year from substantial completion. Materials are covered by the manufacturer’s warranties. This warranty excludes damage caused by misuse, neglect, alteration, improper maintenance, or acts of God."
          }
          customWarranty={customWarranty}
          useDefaultWarranty={useDefaultWarranty}
          goBack={() =>
            navigate(
              agreementId
                ? `/agreements/${agreementId}/wizard?step=3`
                : `/agreements/new?step=3`
            )
          }
        />
      )}

      {editMilestone && (
        <MilestoneEditModal
          open={!!editMilestone}
          milestone={editMilestone}
          onClose={() => setEditMilestone(null)}
          onSaved={() => {
            setEditMilestone(null);
            isEdit ? loadEdit() : loadCreate();
          }}
        />
      )}

      {loading && (
        <div className="mt-4 text-sm text-gray-500">Loading…</div>
      )}
    </div>
  );
}

/* ---------------- Step 1 ---------------- */
function Step1Details({ isEdit, agreementId, dLocal, setDLocal, people, saveStep1 }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="text-sm text-gray-600 mb-4">
        {isEdit ? <>Agreement #{agreementId}</> : <>New Agreement</>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="md:col-span-2">
          <label className="block text-sm font-medium mb-1">Homeowner</label>
          <select
            className="w-full rounded border px-3 py-2 text-sm"
            value={String(dLocal.homeowner || "")}
            onChange={(e) =>
              setDLocal((s) => ({ ...s, homeowner: e.target.value }))
            }
          >
            <option value="">— Select Homeowner —</option>
            {people.length === 0 && (
              <option value="" disabled>
                (loading customers…)
              </option>
            )}
            {(people || []).map((p) => {
              const val = String(p.id);
              const lbl = buildLabel(p);
              return (
                <option key={`${val}-${lbl}`} value={val}>
                  {lbl}
                </option>
              );
            })}
          </select>
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-medium mb-1">Project Title</label>
          <input
            className="w-full rounded border px-3 py-2 text-sm"
            value={dLocal.project_title}
            onChange={(e) =>
              setDLocal((s) => ({ ...s, project_title: e.target.value }))
            }
            placeholder="e.g., Kitchen Floor and Wall"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Type</label>
          <select
            className="w-full rounded border px-3 py-2 text-sm"
            value={dLocal.project_type || ""}
            onChange={(e) =>
              setDLocal((s) => ({
                ...s,
                project_type: e.target.value,
                project_subtype: "",
              }))
            }
          >
            <option value="">— Select Type —</option>
            {(Array.isArray(PROJECT_TYPES) ? PROJECT_TYPES : []).map((t) => {
              const val = t?.value ?? t?.id ?? t,
                lbl = t?.label ?? t?.name ?? t?.title ?? t;
              return (
                <option key={String(val)} value={String(val)}>
                  {String(lbl)}
                </option>
              );
            })}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Subtype</label>
          <select
            className="w-full rounded border px-3 py-2 text-sm"
            value={dLocal.project_subtype || ""}
            onChange={(e) =>
              setDLocal((s) => ({ ...s, project_subtype: e.target.value }))
            }
          >
            <option value="">— Select Subtype —</option>
            {((SUBTYPES_BY_TYPE || {})[dLocal.project_type] || []).map(
              (st) => {
                const val = st?.value ?? st?.id ?? st,
                  lbl = st?.label ?? st?.name ?? st?.title ?? st;
                return (
                  <option key={String(val)} value={String(val)}>
                    {String(lbl)}
                  </option>
                );
              }
            )}
          </select>
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-medium mb-1">Description</label>
          <textarea
            className="w-full rounded border px-3 py-2 text-sm"
            rows={3}
            value={dLocal.description}
            onChange={(e) =>
              setDLocal((s) => ({ ...s, description: e.target.value }))
            }
            placeholder="Brief project scope…"
          />
        </div>

        <DateWithButton
          label="Start"
          value={dLocal.start}
          onChange={(v) =>
            setDLocal((s) => ({ ...s, start: toDateOnly(v) }))
          }
        />
        <DateWithButton
          label="End"
          value={dLocal.end}
          onChange={(v) => setDLocal((s) => ({ ...s, end: toDateOnly(v) }))}
        />
      </div>

      <div className="mt-4 flex gap-2">
        <button
          onClick={() => saveStep1(false)}
          className="rounded bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700"
        >
          Save
        </button>
        <button
          onClick={() => saveStep1(true)}
          className="rounded bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700"
        >
          Save & Next
        </button>
      </div>
    </div>
  );
}

/* ---------------- shared UI ---------------- */
function DateWithButton({ label, value, onChange }) {
  const ref = useRef(null);
  const open = () => {
    if (ref.current?.showPicker) ref.current.showPicker();
    else ref.current?.focus();
  };
  return (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      <div style={{ position: "relative" }}>
        <input
          ref={ref}
          type="date"
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded border px-3 py-2 text-sm"
          style={{ paddingRight: "2.5rem" }}
        />
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={open}
          aria-label={label}
          title={label}
          style={{
            position: "absolute",
            right: 8,
            top: "50%",
            transform: "translateY(-50%)",
            background: "transparent",
            border: 0,
            lineHeight: 0,
            color: "#6B7280",
          }}
        >
          <span role="img" aria-label="calendar">📅</span>
        </button>
      </div>
    </div>
  );
}

/* ---------------- Step 2 ---------------- */
function Step2Milestones({
  agreement,
  mLocal,
  onLocalChange,
  onAdd,
  milestones,
  onDelete,
  onEdit,
  onBack,
  onNext,
}) {
  const total = milestones.reduce((s, m) => s + Number(m.amount || 0), 0);
  const minStart = useMemo(() => {
    const s = milestones
      .map((m) => toDateOnly(m.start_date || m.start))
      .filter(Boolean)
      .sort()[0];
    return s || "";
  }, [milestones]);
  const maxEnd = useMemo(() => {
    const e = milestones
      .map((m) => toDateOnly(m.completion_date || m.end_date || m.end || m.due_date))
      .filter(Boolean)
      .sort()
      .slice(-1)[0];
    return e || "";
  }, [milestones]);

  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold">Milestones</h3>
        <div className="text-sm text-gray-600">
          Schedule:{" "}
          {minStart && maxEnd ? (
            <span className="font-medium">
              {friendly(minStart)} → {friendly(maxEnd)} (est.)
            </span>
          ) : (
            <span className="text-gray-400">add dates to see range</span>
          )}
        </div>
      </div>

      {/* Inline add form */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 mb-2">
        <input
          className="md:col-span-4 rounded border px-3 py-2 text-sm"
          placeholder="Title"
          name="title"
          value={mLocal.title}
          onChange={onLocalChange}
        />
        <input
          type="date"
          className="md:col-span-3 rounded border px-3 py-2 text-sm"
          name="start"
          value={mLocal.start || ""}
          onChange={onLocalChange}
          aria-label="Start date"
        />
        <input
          type="date"
          className="md:col-span-3 rounded border px-3 py-2 text-sm"
          name="end"
          value={mLocal.end || ""}
          onChange={onLocalChange}
          aria-label="End date"
        />
        <input
          type="number"
          min="0"
          step="0.01"
          className="md:col-span-2 rounded border px-3 py-2 text-sm"
          placeholder="Amount"
          name="amount"
          value={mLocal.amount}
          onChange={onLocalChange}
        />
        <div className="md:col-span-12">
          <textarea
            className="w-full rounded border px-3 py-2 text-sm resize-y"
            rows={3}
            placeholder="Description (details, materials, notes)…"
            name="description"
            value={mLocal.description}
            onChange={onLocalChange}
          />
        </div>
      </div>
      <div className="mb-6">
        <button
          onClick={onAdd}
          className="rounded bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700"
        >
          + Add Milestone
        </button>
      </div>

      {/* Summary table */}
      <div className="rounded-2xl border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="[&>*]:px-3 [&>*]:py-2 text-left">
              <th>#</th>
              <th>Title</th>
              <th>Description</th>
              <th>Start</th>
              <th>Due</th>
              <th>Amount</th>
              <th />
            </tr>
          </thead>
        <tbody>
            {milestones.map((m, idx) => (
              <tr key={m.id || `${m.title}-${idx}`} className="border-t align-top">
                <td className="[&>*]:px-3 [&>*]:py-2">{idx + 1}</td>
                <td className="[&>*]:px-3 [&>*]:py-2">{m.title || "—"}</td>
                <td className="[&>*]:px-3 [&>*]:py-2 whitespace-pre-wrap">
                  {m.description || "—"}
                </td>
                <td className="[&>*]:px-3 [&>*]:py-2">
                  {friendly(toDateOnly(m.start_date || m.start))}
                </td>
                <td className="[&>*]:px-3 [&>*]:py-2">
                  {friendly(
                    toDateOnly(
                      m.completion_date || m.end_date || m.end || m.due_date
                    )
                  )}
                </td>
                <td className="[&>*]:px-3 [&>*]:py-2">
                  {Number(m.amount || 0).toLocaleString(undefined, {
                    style: "currency",
                    currency: "USD",
                  })}
                </td>
                <td className="[&>*]:px-3 [&>*]:py-2 text-right">
                  <div className="inline-flex gap-2">
                    <button
                      className="rounded border px-2 py-1"
                      onClick={() => onEdit?.(m)}
                    >
                      Edit
                    </button>
                    <button
                      className="rounded border px-2 py-1"
                      onClick={() => onDelete?.(m.id)}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!milestones.length && (
              <tr>
                <td
                  colSpan={7}
                  className="text-center text-gray-400 py-6"
                >
                  No milestones yet.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="bg-gray-50 font-semibold [&>*]:px-3 [&>*]:py-2">
              <td colSpan={5}>Total</td>
              <td>
                {total.toLocaleString(undefined, {
                  style: "currency",
                  currency: "USD",
                })}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <button onClick={onBack} className="rounded border px-3 py-2 text-sm">
          Back
        </button>
        <button
          onClick={onNext}
          className="rounded bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700"
        >
          Next
        </button>
      </div>
    </div>
  );
}

/* ---------------- Step 3 (attachments — quiet 404 delete) ---------------- */
function Step3WarrantyAttachments({
  agreementId,
  DEFAULT_WARRANTY,
  useDefaultWarranty,
  setUseDefaultWarranty,
  customWarranty,
  setCustomWarranty,
  saveWarranty,
  attachments,
  refreshAttachments,
  onBack,
  onNext,
}) {
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("WARRANTY");
  const [visible, setVisible] = useState(true);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef(null);
  const dropRef = useRef(null);

  useEffect(() => {
    const el = dropRef.current;
    if (!el) return;
    const onDragOver = (e) => { e.preventDefault(); el.classList.add("ring-2","ring-indigo-400"); };
    const onDragLeave = (e) => { e.preventDefault(); el.classList.remove("ring-2","ring-indigo-400"); };
    const onDrop = (e) => {
      e.preventDefault();
      el.classList.remove("ring-2","ring-indigo-400");
      if (e.dataTransfer?.files?.[0]) setFile(e.dataTransfer.files[0]);
    };
    el.addEventListener("dragover", onDragOver);
    el.addEventListener("dragleave", onDragLeave);
    el.addEventListener("drop", onDrop);
    return () => {
      el.removeEventListener("dragover", onDragOver);
      el.removeEventListener("dragleave", onDragLeave);
      el.removeEventListener("drop", onDrop);
    };
  }, []);

  const tryPostAttachment = async (form) => {
    const urls = [
      agreementId ? `/projects/agreements/${agreementId}/attachments/` : null,
      `/projects/attachments/`,
    ].filter(Boolean);

    let lastErr;
    for (const url of urls) {
      try {
        const { data } = await api.post(url, form);
        return data;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  };

  const addAttachment = async () => {
    if (!agreementId) return toast.error("Create and save Agreement first.");
    if (!file) return toast.error("Choose a file to upload.");

    try {
      setUploading(true);
      const form = new FormData();
      const resolvedTitle = title || file.name;

      // FK + names
      form.set("agreement", String(agreementId));
      form.set("title", resolvedTitle);
      form.set("name", resolvedTitle);

      // category
      form.set("category", category);

      // visibility
      form.set("visible_to_homeowner", visible);
      form.set("visible", visible);

      // file aliases
      form.set("file", file, file.name);
      form.set("document", file, file.name);

      await tryPostAttachment(form);

      // reset
      setTitle("");
      setCategory("WARRANTY");
      setVisible(true);
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";

      await refreshAttachments?.();
      toast.success("Attachment uploaded.");
    } catch (e) {
      const msg =
        e?.response?.data?.detail ||
        e?.response?.statusText ||
        e?.message ||
        "Upload failed.";
      toast.error(msg);
    } finally {
      setUploading(false);
    }
  };

  // Delete with validateStatus so a 404 doesn't trigger interceptor noise
  const quietDelete = (url) =>
    api.delete(url, {
      validateStatus: (s) => (s >= 200 && s < 300) || s === 404,
    });

  const deleteAttachment = async (attId) => {
    if (!agreementId || !attId) return;
    const nestedUrl = `/projects/agreements/${agreementId}/attachments/${attId}/`;
    const genericUrl = `/projects/attachments/${attId}/`;
    try {
      const res1 = await quietDelete(nestedUrl);
      if (res1?.status === 200 || res1?.status === 204) {
        await refreshAttachments?.();
        toast.success("Attachment deleted.");
        return;
      }
      const res2 = await quietDelete(genericUrl);
      if (res2?.status === 200 || res2?.status === 204 || res2?.status === 404) {
        await refreshAttachments?.();
        toast.success("Attachment deleted.");
      } else {
        toast.error("Delete failed.");
      }
    } catch (e) {
      const msg =
        e?.response?.data?.detail ||
        e?.response?.statusText ||
        e?.message ||
        "Delete failed.";
      toast.error(msg);
    }
  };

  return (
    <div className="rounded-lg border bg-white p-4 space-y-6">
      {/* Warranty */}
      <div>
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={useDefaultWarranty}
            onChange={(e) => setUseDefaultWarranty(e.target.checked)}
          />
          <span className="text-sm">Use default 12-month workmanship warranty</span>
        </label>

        {useDefaultWarranty ? (
          <div className="mt-3 rounded border p-3 bg-gray-50 text-sm whitespace-pre-wrap">
            {DEFAULT_WARRANTY}
          </div>
        ) : (
          <div className="mt-3">
            <label className="block text-sm font-medium mb-1">Custom Warranty</label>
            <textarea
              className="w-full rounded border px-3 py-2 text-sm min-h-[120px]"
              placeholder="Enter your custom warranty text…"
              value={customWarranty}
              onChange={(e) => setCustomWarranty(e.target.value)}
            />
          </div>
        )}

        <div className="mt-3">
          <button
            onClick={saveWarranty}
            className="rounded bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700"
          >
            Save Warranty
          </button>
        </div>
      </div>

      {/* Attachments */}
      <div className="rounded-2xl border">
        <div className="p-4 border-b">
          <h3 className="text-base font-semibold">Attachments &amp; Addenda</h3>
        </div>

        <div className="p-4 space-y-3">
          {/* Drop zone */}
          <div
            ref={dropRef}
            className="border-2 border-dashed rounded-md p-4 text-sm text-gray-600 flex flex-col gap-2 items-start"
          >
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                id="wizard-step3-file"
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="hidden"
              />
              <label
                htmlFor="wizard-step3-file"
                className="inline-flex items-center px-3 py-1.5 rounded-md border bg-white hover:bg-gray-50 cursor-pointer"
              >
                Choose Files
              </label>
              <span className="text-gray-500">{file ? file.name : "No file chosen"}</span>
            </div>
            <p className="text-xs text-gray-500">Drag &amp; drop files here, or click.</p>
          </div>

          {/* Meta */}
          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-6">
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full border rounded-md p-2 text-sm"
                placeholder="Title (e.g., Spec Sheet)"
              />
            </div>
            <div className="col-span-3">
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full border rounded-md p-2 text-sm"
              >
                <option value="WARRANTY">WARRANTY</option>
                <option value="SPEC">SPEC / SCOPE</option>
                <option value="PERMIT">PERMIT / LICENSE</option>
                <option value="PHOTO">PHOTO / IMAGE</option>
                <option value="OTHER">OTHER</option>
              </select>
            </div>
            <div className="col-span-3 flex items-center gap-4">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={visible}
                  onChange={(e) => setVisible(e.target.checked)}
                />
                <span className="text-sm">Visible to homeowner</span>
              </label>
            </div>
          </div>

          <div>
            <button
              type="button"
              onClick={addAttachment}
              disabled={uploading}
              className="px-3 py-2 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {uploading ? "Uploading..." : "Add Attachment"}
            </button>
          </div>

          {/* List */}
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2 pr-3 font-semibold text-gray-700">Category</th>
                  <th className="py-2 pr-3 font-semibold text-gray-700">Title</th>
                  <th className="py-2 pr-3 font-semibold text-gray-700">Visible</th>
                  <th className="py-2 pr-3 font-semibold text-gray-700">File</th>
                  <th className="py-2 pr-3 font-semibold text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody>
                {attachments?.length ? (
                  attachments.map((a) => {
                    const v = (a.visible_to_homeowner ?? a.visible) ? true : false;
                    const name = a.file_name || a.filename || a.name || a.title || "File";
                    const url = a.file_url || a.url || a.download_url || a.file || null;
                    return (
                      <tr key={a.id || name} className="border-b last:border-b-0">
                        <td className="py-2 pr-3">{a.category || "-"}</td>
                        <td className="py-2 pr-3">{a.title || name}</td>
                        <td className="py-2 pr-3">{v ? "Yes" : "No"}</td>
                        <td className="py-2 pr-3">
                          {url ? (
                            <a href={url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
                              {name}
                            </a>
                          ) : (
                            name
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          <div className="flex gap-2">
                            {url && (
                              <a
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                className="px-2 py-1 rounded border text-xs hover:bg-gray-50"
                              >
                                Download
                              </a>
                            )}
                            {a?.id && (
                              <button
                                type="button"
                                onClick={() => deleteAttachment(a.id)}
                                className="px-2 py-1 rounded border text-xs text-red-600 hover:bg-red-50"
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-gray-500">
                      No attachments uploaded.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer nav */}
        <div className="px-4 py-3 border-t flex items-center justify-between">
          <button onClick={onBack} className="rounded border px-3 py-2 text-sm">
            Back
          </button>
          <button
            onClick={onNext}
            className="rounded bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700"
          >
            Save & Next
          </button>
        </div>
      </div>
    </div>
  );
}
