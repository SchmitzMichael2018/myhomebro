// frontend/src/components/AgreementWizard.jsx
// v2025-11-11h — Fix: Create Project at /projects/projects/ before Agreement (project FK required)
// - Step 1 has NO dates; address toggle kept.
// - De-dupe homeowners; Quick Add Homeowner.
// - Error panel.
// - Smart create flow:
//     1) Try Agreement create directly (in case project is optional on some envs)
//     2) If server says project required (400 mentioning "project"), POST Project to
//        /projects/projects/ (fallback /projects/) then re-POST Agreement with project FK.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../api";
import MilestoneEditModal from "./MilestoneEditModal";
import { PROJECT_TYPES, SUBTYPES_BY_TYPE } from "./options/projectOptions";
import Step4Finalize from "./Step4Finalize";

/* ───────── helpers ───────── */
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

/** Merge duplicates by email (case-insensitive). Prefer:
 *  - source "homeowners" over "customers"
 *  - then longer full_name
 *  - then higher id
 */
function dedupePeople(rawList) {
  const byKey = new Map();
  for (const p of rawList) {
    if (!p) continue;
    const key =
      (p.email && `email:${String(p.email).toLowerCase()}`) ||
      (p.id != null && `id:${String(p.id)}`) ||
      null;
    if (!key) continue;

    if (!byKey.has(key)) {
      byKey.set(key, p);
    } else {
      const cur = byKey.get(key);
      const score = (x) => [
        x?._src === "homeowners" ? 1 : 0,
        (x?.full_name || "").length,
        Number.isFinite(Number(x?.id)) ? Number(x.id) : 0,
      ];
      const [a1, a2, a3] = score(cur);
      const [b1, b2, b3] = score(p);
      if (b1 > a1 || (b1 === a1 && (b2 > a2 || (b2 === a2 && b3 > a3)))) {
        byKey.set(key, p);
      }
    }
  }
  return sortPeople([...byKey.values()]);
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

function PrettyJson({ data }) {
  if (!data) return null;
  let text = "";
  try {
    text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  } catch {
    text = String(data);
  }
  return (
    <pre className="whitespace-pre-wrap break-words text-xs bg-red-50 border border-red-200 rounded p-2 text-red-800">
      {text}
    </pre>
  );
}

/* ───────── main ───────── */
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
  const [peopleLoadedOnce, setPeopleLoadedOnce] = useState(false);

  // Step 1 state (no dates)
  const [dLocal, setDLocal] = useState({
    homeowner: "",
    project_title: "",
    project_type: "",
    project_subtype: "",
    description: "",
    addressSame: true,
    address_line1: "",
    address_line2: "",
    address_city: "",
    address_state: "",
    address_postal_code: "",
  });

  // Step 1: server 400 debug panel
  const [last400, setLast400] = useState(null);

  // Quick Add Homeowner
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [qaName, setQaName] = useState("");
  const [qaEmail, setQaEmail] = useState("");
  const [qaBusy, setQaBusy] = useState(false);

  // Step 2
  const [mLocal, setMLocal] = useState({
    title: "",
    description: "",
    amount: "",
    start: "",
    end: "",
  });
  const [editMilestone, setEditMilestone] = useState(null);

  // Step 3/4
  const [useDefaultWarranty, setUseDefaultWarranty] = useState(true);
  const [customWarranty, setCustomWarranty] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [hasPreviewed, setHasPreviewed] = useState(false);
  const [ackReviewed, setAckReviewed] = useState(false);
  const [ackTos, setAckTos] = useState(false);
  const [ackEsign, setAckEsign] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [signing, setSigning] = useState(false);

  /* ── people loader ── */
  const loadPeople = useCallback(async () => {
    const cfg = { params: { page: 1, page_size: 1000, ordering: "-created_at" } };
    const pile = [];
    try {
      const { data } = await api.get(`/customers/`, cfg);
      pile.push(...pickArray(data).map(normalizeCustomer).filter(Boolean));
    } catch {}
    try {
      const { data } = await api.get(`/homeowners/`, cfg);
      pile.push(...pickArray(data).map(normalizeHomeowner).filter(Boolean));
    } catch {}
    try {
      const { data } = await api.get(`/projects/homeowners/`, cfg);
      pile.push(...pickArray(data).map(normalizeHomeowner).filter(Boolean));
      pile.push(...pickArray(data).map(normalizeCustomer).filter(Boolean));
    } catch {}
    return dedupePeople(pile);
  }, []);

  /* ── edit loader ── */
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

      const loaded = await loadPeople();
      setPeopleLoadedOnce(true);
      setPeople(dedupePeople([...seed, ...loaded]));

      // address normalization
      const addressSame =
        (ag.project_address_same_as_homeowner ??
          ag.project_is_homeowner_address ??
          ag.is_homeowner_address ??
          true) ? true : false;

      const address_line1 =
        ag.project_address_line1 ??
        ag.project_line1 ??
        ag.address_line1 ??
        ag.project_address?.line1 ??
        "";
      const address_line2 =
        ag.project_address_line2 ??
        ag.project_line2 ??
        ag.address_line2 ??
        ag.project_address?.line2 ??
        "";
      const address_city =
        ag.project_city ??
        ag.project_address_city ??
        ag.city ??
        ag.project_address?.city ??
        "";
      const address_state =
        ag.project_state ??
        ag.project_address_state ??
        ag.state ??
        ag.project_address?.state ??
        "";
      const address_postal_code =
        ag.project_postal_code ??
        ag.project_zip ??
        ag.postal_code ??
        ag.zip ??
        ag.project_address?.postal_code ??
        "";

      setDLocal({
        homeowner: String(agHomeownerId || ""),
        project_title: ag.project_title || ag.title || "",
        project_type: (ag.project_type ?? "") || "",
        project_subtype: (ag.project_subtype ?? "") || "",
        description: ag.description || "",
        addressSame,
        address_line1: address_line1 || "",
        address_line2: address_line2 || "",
        address_city: address_city || "",
        address_state: address_state || "",
        address_postal_code: address_postal_code || "",
      });

      // milestones
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
  }, [agreementId, loadPeople]);

  /* ── create loader ── */
  const loadCreate = useCallback(async () => {
    setLoading(true);
    try {
      setAgreement(null);
      setMilestones([]);
      setAttachments([]);

      const loaded = await loadPeople();
      setPeopleLoadedOnce(true);
      setPeople(dedupePeople(loaded));
    } catch (e) {
      console.error(e);
      toast.error("Failed to load form.");
    } finally {
      setLoading(false);
    }
  }, [loadPeople]);

  useEffect(() => {
    if (agreementId) loadEdit();
    else loadCreate();
  }, [agreementId, loadEdit, loadCreate]);

  /* ── totals (derived) ── */
  const totals = useMemo(() => {
    const starts = milestones
      .map((m) => toDateOnly(m.start_date || m.start || m.scheduled_date))
      .filter(Boolean);
    const ends = milestones
      .map((m) =>
        toDateOnly(m.completion_date || m.end_date || m.end || m.due_date)
      )
      .filter(Boolean);
    const minStart = starts.length ? [...starts].sort()[0] : "";
    const maxEnd = ends.length ? [...ends].sort().slice(-1)[0] : "";
    const totalAmt = milestones.reduce((s, m) => s + Number(m.amount || 0), 0);
    const totalDays =
      minStart && maxEnd
        ? Math.max(
            1,
            Math.floor((new Date(maxEnd) - new Date(minStart)) / 86400000) + 1
          )
        : 0;
    return { totalAmt, minStart, maxEnd, totalDays };
  }, [milestones]);

  const goStep = (n) =>
    navigate(
      agreementId
        ? `/agreements/${agreementId}/wizard?step=${n}`
        : `/agreements/new?step=${n}`
    );

  /* ── Smart create/patch helpers ── */

  // Build payload variants to try for Agreement CREATE
  function buildAgreementCreateVariants(base, addr, projectId = null) {
    const titles = [
      { title: base.project_title, project_title: base.project_title },
      { title: base.project_title },
      { project_title: base.project_title },
    ];
    const homeowners = [];
    if (base.homeowner != null) {
      homeowners.push({ homeowner: base.homeowner });
      homeowners.push({ homeowner_id: base.homeowner });
      homeowners.push({ customer: base.homeowner });
      homeowners.push({ customer_id: base.homeowner });
      homeowners.push({ client: base.homeowner });
      homeowners.push({ client_id: base.homeowner });
    } else {
      homeowners.push({});
    }

    const projectBits = projectId
      ? [{ project: projectId }, { project_id: projectId }]
      : [{}];

    const shared = (t, h, p) => ({
      ...t,
      ...h,
      ...p,
      description: base.description,
      project_type: base.project_type ?? null,
      project_subtype: base.project_subtype ?? null,
    });

    const withAddr = addr.same
      ? []
      : [
          {
            project_address_same_as_homeowner: false,
            project_address_line1: addr.line1 || "",
            project_address_line2: addr.line2 || "",
            project_address_city: addr.city || "",
            project_address_state: addr.state || "",
            project_postal_code: addr.postal || "",
          },
          {
            project_is_homeowner_address: false,
            address_line1: addr.line1 || "",
            address_line2: addr.line2 || "",
            city: addr.city || "",
            state: addr.state || "",
            postal_code: addr.postal || "",
          },
        ];

    const variants = [];
    for (const t of titles) {
      for (const h of homeowners) {
        for (const p of projectBits) {
          variants.push(shared(t, h, p));
          for (const ab of withAddr) variants.push({ ...shared(t, h, p), ...ab });
        }
      }
    }
    return variants;
  }

  async function tryVariants(url, variants, method = "post") {
    let lastErr = null;
    for (const body of variants) {
      try {
        setLast400(null);
        const res = await api[method](url, body);
        return res;
      } catch (e) {
        const status = e?.response?.status;
        const data = e?.response?.data;
        console.warn(
          `[${method.toUpperCase()} ${url}] variant failed`,
          { body, status, data }
        );
        if (status === 400) setLast400(data || { detail: "400 Bad Request" });
        lastErr = e;
        if (status && status !== 400) break; // non-400: stop trying
      }
    }
    throw lastErr;
  }

  // Create a Project — try the DRF-typical mount first (/projects/projects/), then fallback (/projects/)
  async function createProject(base, addr) {
    const titles = [
      { title: base.project_title },
      { name: base.project_title },
      { project_title: base.project_title },
    ];
    const homeowners =
      base.homeowner != null
        ? [
            { homeowner: base.homeowner },
            { homeowner_id: base.homeowner },
            { customer: base.homeowner },
          ]
        : [{}];

    const withAddr = addr.same
      ? [{}]
      : [
          {
            address_line1: addr.line1 || "",
            address_line2: addr.line2 || "",
            city: addr.city || "",
            state: addr.state || "",
            postal_code: addr.postal || "",
          },
          {
            project_address_line1: addr.line1 || "",
            project_address_line2: addr.line2 || "",
            project_address_city: addr.city || "",
            project_address_state: addr.state || "",
            project_postal_code: addr.postal || "",
          },
        ];

    const variants = [];
    for (const t of titles) {
      for (const h of homeowners) {
        for (const a of withAddr) {
          variants.push({
            ...t,
            ...h,
            ...a,
            description: base.description,
            project_type: base.project_type ?? null,
            project_subtype: base.project_subtype ?? null,
          });
        }
      }
    }

    const endpoints = [`/projects/projects/`, `/projects/`];
    let lastErr = null;

    for (const ep of endpoints) {
      for (const body of variants) {
        try {
          const res = await api.post(ep, body, {
            validateStatus: (s) => s >= 200 && s < 300,
          });
          return res?.data;
        } catch (e) {
          lastErr = e;
          const s = e?.response?.status;
          // If endpoint is 405 (Method Not Allowed), try next endpoint immediately
          if (s === 405) break;
        }
      }
    }
    throw lastErr;
  }

  const saveStep1 = async (next = false) => {
    try {
      // Front-end validation
      const title = String(dLocal.project_title || "").trim();
      if (!title) {
        toast.error("Project Title is required.");
        setLast400({ project_title: ["This field is required."] });
        return;
      }
      const homeownerVal = String(dLocal.homeowner || "");
      const homeownerField = /^\d+$/.test(homeownerVal)
        ? Number(homeownerVal)
        : null;
      if (homeownerField == null) {
        toast.error("Please select a homeowner.");
        setLast400({ homeowner: ["This field is required."] });
        return;
      }

      const base = {
        homeowner: homeownerField,
        project_title: title,
        project_type: dLocal.project_type || null,
        project_subtype: dLocal.project_subtype || null,
        description: dLocal.description,
      };

      const addr = {
        same: !!dLocal.addressSame,
        line1: dLocal.address_line1,
        line2: dLocal.address_line2,
        city: dLocal.address_city,
        state: dLocal.address_state,
        postal: dLocal.address_postal_code,
      };

      if (agreementId) {
        // PATCH
        const primary = {
          title: base.project_title,
          project_title: base.project_title,
          homeowner: homeownerField,
          description: base.description,
          project_type: base.project_type,
          project_subtype: base.project_subtype,
          ...(addr.same
            ? { project_address_same_as_homeowner: true }
            : {
                project_address_same_as_homeowner: false,
                project_address_line1: addr.line1 || "",
                project_address_line2: addr.line2 || "",
                project_address_city: addr.city || "",
                project_address_state: addr.state || "",
                project_postal_code: addr.postal || "",
              }),
        };
        try {
          setLast400(null);
          await api.patch(`/projects/agreements/${agreementId}/`, primary);
        } catch (e1) {
          setLast400(e1?.response?.data || { detail: "400 Bad Request" });
          const minimal = {
            title: base.project_title,
            project_title: base.project_title,
            description: base.description,
            homeowner_id: homeownerField,
          };
          await api.patch(`/projects/agreements/${agreementId}/`, minimal);
        }
        toast.success("Details saved.");
        if (next) goStep(2);
        else await loadEdit();
      } else {
        // CREATE: first try Agreement POST directly (maybe project optional)
        const firstVariants = buildAgreementCreateVariants(base, addr, null);
        try {
          const { data: created } = await tryVariants(
            `/projects/agreements/`,
            firstVariants,
            "post"
          );
          const newId = created?.id ?? created?.pk;
          if (!newId) return toast.error("Could not determine new Agreement ID.");
          toast.success("Agreement created.");
          navigate(
            `/agreements/${newId}/wizard?step=${next ? 2 : 1}`,
            { replace: true }
          );
          return;
        } catch (e0) {
          const data = e0?.response?.data;
          setLast400(data || { detail: "Save failed." });
          const needProject =
            data &&
            typeof data === "object" &&
            (("project" in data && Array.isArray(data.project)) ||
              JSON.stringify(data).toLowerCase().includes('"project"') ||
              JSON.stringify(data).toLowerCase().includes("project is required"));

          if (!needProject) throw e0;

          // Create Project now (use /projects/projects/ then fallback /projects/)
          let projectRecord = null;
          try {
            projectRecord = await createProject(base, addr);
          } catch (eProj) {
            const msg = eProj?.response?.data
              ? JSON.stringify(eProj.response.data)
              : eProj?.message || "Project creation failed.";
            setLast400({ project_create: msg });
            toast.error(`Project create failed: ${msg}`);
            throw e0; // preserve original agreement error context
          }

          const projectId = projectRecord?.id ?? projectRecord?.pk;
          if (!projectId) {
            setLast400({ project_create: "No project id returned." });
            toast.error("Project create returned no ID.");
            throw e0;
          }

          // Retry Agreement with `project`
          const retryVariants = buildAgreementCreateVariants(base, addr, projectId);
          const { data: created2 } = await tryVariants(
            `/projects/agreements/`,
            retryVariants,
            "post"
          );
          const newId2 = created2?.id ?? created2?.pk;
          if (!newId2)
            return toast.error("Could not determine new Agreement ID.");
          toast.success("Agreement created.");
          navigate(
            `/agreements/${newId2}/wizard?step=${next ? 2 : 1}`,
            { replace: true }
          );
        }
      }
    } catch (e) {
      console.error(e);
      const data = e?.response?.data;
      setLast400(data || { detail: e?.message || "Save failed" });
      const msg =
        (data && typeof data === "object" ? JSON.stringify(data) : null) ||
        e?.response?.statusText ||
        e?.message ||
        "Save failed";
      toast.error(`Save failed: ${msg}`);
    }
  };

  /* ── Step 2 ── */
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
    if (!f.start || !f.end)
      return toast.error("Select start and end dates.");
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
      setMLocal({
        title: "",
        description: "",
        amount: "",
        start: "",
        end: "",
      });
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

  /* ── Step 3 ── */
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

  /* ── Step 4 ── */
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
        {
          typed_name: typedName.trim(),
        }
      );
      toast.success("Signed as Contractor.");
      window.location.reload();
    } catch (e) {
      toast.error(
        `Sign failed: ${
          e?.response?.statusText || e?.message || "Save failed"
        }`
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

  /* ── render ── */
  return (
    <div className="p-4 md:p-6">
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
          peopleLoadedOnce={peopleLoadedOnce}
          reloadPeople={async () => {
            const loaded = await loadPeople();
            setPeopleLoadedOnce(true);
            setPeople(dedupePeople(loaded));
          }}
          showQuickAdd={showQuickAdd}
          setShowQuickAdd={setShowQuickAdd}
          qaName={qaName}
          setQaName={setQaName}
          qaEmail={qaEmail}
          setQaEmail={setQaEmail}
          qaBusy={qaBusy}
          setQaBusy={setQaBusy}
          onQuickAdd={async () => {
            const name = qaName.trim();
            const email = qaEmail.trim();
            if (!name) return toast.error("Enter the homeowner's name.");
            if (!email || !/^\S+@\S+\.\S+$/.test(email))
              return toast.error("Enter a valid email.");
            setQaBusy(true);
            try {
              const [first_name, ...rest] = name.split(/\s+/);
              const last_name = rest.join(" ");
              const body = {
                first_name,
                last_name,
                full_name: name,
                name,
                email,
              };
              let created = null;
              try {
                const { data } = await api.post(`/customers/`, body);
                created = data;
              } catch {
                const { data } = await api.post(`/homeowners/`, body);
                created = data;
              }
              const newId = created?.id ?? created?.pk;
              if (!newId)
                throw new Error("Could not determine new homeowner ID.");
              const loaded = await loadPeople();
              setPeopleLoadedOnce(true);
              setPeople(dedupePeople(loaded));
              setDLocal((s) => ({ ...s, homeowner: String(newId) }));
              setShowQuickAdd(false);
              setQaName("");
              setQaEmail("");
              toast.success("Homeowner added.");
            } catch (e) {
              toast.error(
                e?.response?.data?.detail ||
                  e?.response?.statusText ||
                  e?.message ||
                  "Could not add homeowner."
              );
            } finally {
              setQaBusy(false);
            }
          }}
          saveStep1={saveStep1}
          last400={last400}
        />
      )}

      {step === 2 && (
        <Step2Milestones
          agreement={agreement}
          mLocal={mLocal}
          onLocalChange={(e) => {
            const { name, value } = e.target;
            setMLocal((s) => ({
              ...s,
              [name]:
                name === "start" || name === "end"
                  ? toDateOnly(value)
                  : value,
            }));
          }}
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
          refreshAttachments={agreementId ? loadEdit : undefined}
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

/* ───────── Step 1 ───────── */
function Step1Details({
  isEdit,
  agreementId,
  dLocal,
  setDLocal,
  people,
  peopleLoadedOnce,
  reloadPeople,
  showQuickAdd,
  setShowQuickAdd,
  qaName,
  setQaName,
  qaEmail,
  setQaEmail,
  qaBusy,
  setQaBusy,
  onQuickAdd,
  saveStep1,
  last400,
}) {
  const empty = (people?.length || 0) === 0;

  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="text-sm text-gray-600 mb-2">
        {isEdit ? <>Agreement #{agreementId}</> : <>New Agreement</>}
      </div>

      {/* Error panel */}
      {last400 && (
        <div className="mb-3">
          <div className="text-sm font-semibold text-red-700">
            Server response (400)
          </div>
          <PrettyJson data={last400} />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="md:col-span-2">
          <label className="block text-sm font-medium mb-1">
            Homeowner
          </label>
          <select
            className="w-full rounded border px-3 py-2 text-sm"
            value={String(dLocal.homeowner || "")}
            onFocus={() => {
              if (!peopleLoadedOnce) reloadPeople?.();
            }}
            onChange={(e) =>
              setDLocal((s) => ({ ...s, homeowner: e.target.value }))
            }
          >
            <option value="">
              {empty ? "— No homeowners yet —" : "— Select Homeowner —"}
            </option>
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
          {empty && (
            <div className="mt-2 text-xs text-gray-600">
              No homeowners found.{" "}
              <button
                type="button"
                onClick={() => setShowQuickAdd((v) => !v)}
                className="text-indigo-600 underline"
              >
                Quick add one
              </button>
              .
            </div>
          )}
        </div>

        {showQuickAdd && (
          <div className="md:col-span-2 rounded-md border p-3 bg-indigo-50">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-2">
                <label className="block text-xs font-medium mb-1">
                  Full Name
                </label>
                <input
                  className="w-full rounded border px-3 py-2 text-sm"
                  value={qaName}
                  onChange={(e) => setQaName(e.target.value)}
                  placeholder="e.g., Jane Smith"
                />
              </div>
              <div className="md:col-span-1">
                <label className="block text-xs font-medium mb-1">
                  Email
                </label>
                <input
                  className="w-full rounded border px-3 py-2 text-sm"
                  value={qaEmail}
                  onChange={(e) => setQaEmail(e.target.value)}
                  placeholder="jane@example.com"
                />
              </div>
            </div>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={onQuickAdd}
                disabled={qaBusy}
                className="rounded bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                {qaBusy ? "Adding…" : "Add Homeowner"}
              </button>
              <button
                type="button"
                onClick={() => setShowQuickAdd(false)}
                className="rounded border px-3 py-2 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="md:col-span-2">
          <label className="block text-sm font-medium mb-1">
            Project Title
          </label>
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
              const val = t?.value ?? t?.id ?? t;
              const lbl = t?.label ?? t?.name ?? t?.title ?? t;
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
                const val = st?.value ?? st?.id ?? st;
                const lbl = st?.label ?? st?.name ?? st?.title ?? st;
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
          <label className="block text-sm font-medium mb-1">
            Description
          </label>
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

        {/* Address toggle */}
        <div className="md:col-span-2">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!dLocal.addressSame}
              onChange={(e) =>
                setDLocal((s) => ({
                  ...s,
                  addressSame: !!e.target.checked,
                }))
              }
            />
            <span className="text-sm">Project is homeowner address</span>
          </label>
          <p className="text-xs text-gray-500 mt-1">
            Uncheck to enter an alternate project address.
          </p>
        </div>

        {/* Conditional address fields */}
        {!dLocal.addressSame && (
          <>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-1">
                Address Line 1
              </label>
              <input
                className="w-full rounded border px-3 py-2 text-sm"
                value={dLocal.address_line1}
                onChange={(e) =>
                  setDLocal((s) => ({
                    ...s,
                    address_line1: e.target.value,
                  }))
                }
                placeholder="Street address"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-1">
                Address Line 2 (optional)
              </label>
              <input
                className="w-full rounded border px-3 py-2 text-sm"
                value={dLocal.address_line2}
                onChange={(e) =>
                  setDLocal((s) => ({
                    ...s,
                    address_line2: e.target.value,
                  }))
                }
                placeholder="Apt, suite, etc."
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                City
              </label>
              <input
                className="w-full rounded border px-3 py-2 text-sm"
                value={dLocal.address_city}
                onChange={(e) =>
                  setDLocal((s) => ({
                    ...s,
                    address_city: e.target.value,
                  }))
                }
                placeholder="City"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                State
              </label>
              <input
                className="w-full rounded border px-3 py-2 text-sm"
                value={dLocal.address_state}
                onChange={(e) =>
                  setDLocal((s) => ({
                    ...s,
                    address_state: e.target.value,
                  }))
                }
                placeholder="State"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Postal Code
              </label>
              <input
                className="w-full rounded border px-3 py-2 text-sm"
                value={dLocal.address_postal_code}
                onChange={(e) =>
                  setDLocal((s) => ({
                    ...s,
                    address_postal_code: e.target.value,
                  }))
                }
                placeholder="ZIP / Postal code"
              />
            </div>
          </>
        )}
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
          Save &amp; Next
        </button>
      </div>
    </div>
  );
}

/* ───────── Step 2 ───────── */
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
      .map((m) =>
        toDateOnly(m.completion_date || m.end_date || m.end || m.due_date)
      )
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
                      m.completion_date ||
                        m.end_date ||
                        m.end ||
                        m.due_date
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

/* ───────── Step 3: Warranty & Attachments ───────── */
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
    const onDragOver = (e) => {
      e.preventDefault();
      el.classList.add("ring-2", "ring-indigo-400");
    };
    const onDragLeave = (e) => {
      e.preventDefault();
      el.classList.remove("ring-2", "ring-indigo-400");
    };
    const onDrop = (e) => {
      e.preventDefault();
      el.classList.remove("ring-2", "ring-indigo-400");
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
      agreementId
        ? `/projects/agreements/${agreementId}/attachments/`
        : null,
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

      form.set("agreement", String(agreementId));
      form.set("title", resolvedTitle);
      form.set("name", resolvedTitle);
      form.set("category", category);
      form.set("visible_to_homeowner", visible);
      form.set("visible", visible);
      form.set("file", file, file.name);
      form.set("document", file, file.name);

      await tryPostAttachment(form);

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
      if (
        res2?.status === 200 ||
        res2?.status === 204 ||
        res2?.status === 404
      ) {
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
          <span className="text-sm">
            Use default 12-month workmanship warranty
          </span>
        </label>

        {useDefaultWarranty ? (
          <div className="mt-3 rounded border p-3 bg-gray-50 text-sm whitespace-pre-wrap">
            {DEFAULT_WARRANTY}
          </div>
        ) : (
          <div className="mt-3">
            <label className="block text-sm font-medium mb-1">
              Custom Warranty
            </label>
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
          <h3 className="text-base font-semibold">
            Attachments &amp; Addenda
          </h3>
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
            </div>
            <label
              htmlFor="wizard-step3-file"
              className="inline-flex items-center px-3 py-1.5 rounded-md border bg-white hover:bg-gray-50 cursor-pointer"
            >
              Choose Files
            </label>
            <span className="text-gray-500">
              {file ? file.name : "No file chosen"}
            </span>
            <p className="text-xs text-gray-500">
              Drag &amp; drop files here, or click.
            </p>
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
                  <th className="py-2 pr-3 font-semibold text-gray-700">
                    Category
                  </th>
                  <th className="py-2 pr-3 font-semibold text-gray-700">
                    Title
                  </th>
                  <th className="py-2 pr-3 font-semibold text-gray-700">
                    Visible
                  </th>
                  <th className="py-2 pr-3 font-semibold text-gray-700">
                    File
                  </th>
                  <th className="py-2 pr-3 font-semibold text-gray-700">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {attachments?.length ? (
                  attachments.map((a) => {
                    const v =
                      (a.visible_to_homeowner ?? a.visible) ? true : false;
                    const name =
                      a.file_name ||
                      a.filename ||
                      a.name ||
                      a.title ||
                      "File";
                    const url =
                      a.file_url ||
                      a.url ||
                      a.download_url ||
                      a.file ||
                      null;
                    return (
                      <tr
                        key={a.id || name}
                        className="border-b last:border-b-0"
                      >
                        <td className="py-2 pr-3">
                          {a.category || "-"}
                        </td>
                        <td className="py-2 pr-3">
                          {a.title || name}
                        </td>
                        <td className="py-2 pr-3">
                          {v ? "Yes" : "No"}
                        </td>
                        <td className="py-2 pr-3">
                          {url ? (
                            <a
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-indigo-600 hover:underline"
                            >
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
                    <td
                      colSpan={5}
                      className="py-6 text-center text-gray-500"
                    >
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
            Save &amp; Next
          </button>
        </div>
      </div>
    </div>
  );
}
