// frontend/src/components/AgreementWizard.jsx
// v2025-11-25 — split into separate Step components (Option A)
// - Project Address is MANDATORY (Step 1).
// - Step 2 inline form is add-only; Edit opens MilestoneEditModal.
// - Step 2 delete uses /projects/milestones/:id/ flat endpoint.
// - Step 4: Preview PDF calls /preview_link/ + /mark_previewed/ and updates hasPreviewed.
// - Step 4: canSign uses hasPreviewed + checkboxes + typed name and is passed into Step4Finalize.
// - Step 4 header now shows: "Agreement #ID — Amendment N" when amendment_number > 0.
// v2025-12-05 — timezone-safe dates + inline overlap handling + removed /projects/customers/ 404.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../api";
import MilestoneEditModal from "./MilestoneEditModal";
import { PROJECT_TYPES, SUBTYPES_BY_TYPE } from "./options/projectOptions";
import Step4Finalize from "./Step4Finalize";

// Split step components
import Step1Details from "./Step1Details";
import Step2Milestones from "./Step2Milestones";
import Step3WarrantyAttachments from "./Step3WarrantyAttachments";
import PdfPreviewModal from "./PdfPreviewModal";

/* ───────── helpers ───────── */
const TABS = [
  { step: 1, label: "1. Details" },
  { step: 2, label: "2. Milestones" },
  { step: 3, label: "3. Warranty & Attachments" },
  { step: 4, label: "4. Finalize & Review" },
];

const pickArray = (raw) =>
  Array.isArray(raw?.results) ? raw.results : Array.isArray(raw) ? raw : [];

// Normalize various input forms (Date/string) → "YYYY-MM-DD" or ""
function toDateOnly(v) {
  if (!v) return "";
  const s = String(v).trim();

  // Already plain date (good)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return s;
  }

  // ISO datetime like "2025-12-04T00:00:00Z" or "2025-12-04T00:00:00-06:00"
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    return s.slice(0, 10); // just YYYY-MM-DD, no timezone math
  }

  // Fallback: try Date parsing for weird formats
  const d = new Date(s);
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

/* ───────── main ───────── */
export default function AgreementWizard() {
  const { id: idParam } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const search = new URLSearchParams(location.search);
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
    // Project address (mandatory)
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

  // PDF preview state for Step 4
  const [pdfUrl, setPdfUrl] = useState(null);
  const [pdfOpen, setPdfOpen] = useState(false);

  /* ── people loader ── */
  const loadPeople = useCallback(async () => {
    const cfg = { params: { page: 1, page_size: 1000, ordering: "-created_at" } };
    const pile = [];
    try {
      const { data } = await api.get(`/homeowners/`, cfg);
      pile.push(...pickArray(data).map(normalizeHomeowner).filter(Boolean));
    } catch {}
    try {
      const { data } = await api.get(`/projects/homeowners/`, cfg);
      pile.push(...pickArray(data).map(normalizeHomeowner).filter(Boolean));
    } catch {}
    return dedupePeople(pile);
  }, []);

  /* ── edit loader ── */
  const loadEdit = useCallback(async () => {
    setLoading(true);
    try {
      const { data: ag } = await api.get(`/projects/agreements/${agreementId}/`);
      setAgreement(ag);

      // Initialize hasPreviewed from backend flags, so reopening an agreement
      // that was already previewed/signed doesn't re-block signing.
      setHasPreviewed(!!ag.reviewed || !!ag.reviewed_at);

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

      // Hydrate address fields directly from Agreement.project_address_*
      const address_line1 =
        ag.project_address_line1 ??
        ag.project_line1 ??
        ag.address_line1 ??
        "";
      const address_line2 =
        ag.project_address_line2 ??
        ag.project_line2 ??
        ag.address_line2 ??
        "";
      const address_city =
        ag.project_address_city ??
        ag.project_city ??
        ag.city ??
        "";
      const address_state =
        ag.project_address_state ??
        ag.project_state ??
        ag.state ??
        "";
      const address_postal_code =
        ag.project_postal_code ??
        ag.project_zip ??
        ag.postal_code ??
        "";

      setDLocal({
        homeowner: String(agHomeownerId || ""),
        project_title: ag.project_title || ag.title || "",
        project_type: (ag.project_type ?? "") || "",
        project_subtype: (ag.project_subtype ?? "") || "",
        description: ag.description || "",
        address_line1,
        address_line2,
        address_city,
        address_state,
        address_postal_code,
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
      setHasPreviewed(false);

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

  // Step 4 view-model — prefer dLocal, fallback to Agreement.
  const dStep4 = useMemo(() => {
    if (!agreement) return dLocal;
    const ag = agreement;

    const address_line1 =
      dLocal.address_line1 ||
      ag.project_address_line1 ||
      ag.project_line1 ||
      ag.address_line1 ||
      "";
    const address_line2 =
      dLocal.address_line2 ||
      ag.project_address_line2 ||
      ag.project_line2 ||
      ag.address_line2 ||
      "";
    const address_city =
      dLocal.address_city ||
      ag.project_address_city ||
      ag.project_city ||
      ag.city ||
      "";
    const address_state =
      dLocal.address_state ||
      ag.project_address_state ||
      ag.project_state ||
      ag.state ||
      "";
    const address_postal_code =
      dLocal.address_postal_code ||
      ag.project_postal_code ||
      ag.project_zip ||
      ag.postal_code ||
      "";

    return {
      ...dLocal,
      address_line1,
      address_line2,
      address_city,
      address_state,
      address_postal_code,
    };
  }, [agreement, dLocal]);

  // Detect whether we are inside the /app namespace (authenticated shell)
  const APP_PREFIX = location?.pathname?.startsWith("/app") ? "/app" : "";

  // Navigation Helper
  const goStep = (n) =>
    navigate(
      agreementId
        ? `${APP_PREFIX}/agreements/${agreementId}/wizard?step=${n}`
        : `${APP_PREFIX}/agreements/new?step=${n}`
    );

  // --- MEMOIZED OPTIONS ---
  const homeownerOptions = useMemo(
    () =>
      people.map((p) => ({
        value: String(p.id),
        label: buildLabel(p),
      })),
    [people]
  );

  const projectTypeOptions = useMemo(
    () =>
      (Array.isArray(PROJECT_TYPES) ? PROJECT_TYPES : []).map((t) => {
        const val = typeof t === "string" ? t : t?.value || "";
        const lbl =
          typeof t === "string"
            ? t.charAt(0).toUpperCase() + t.slice(1)
            : t?.label || val;
        return { value: val, label: lbl };
      }),
    []
  );

  const projectSubtypeOptions = useMemo(() => {
    const key = dLocal.project_type || "";
    const list = SUBTYPES_BY_TYPE[key] || [];
    return list.map((t) => {
      const val = typeof t === "string" ? t : t?.value || "";
      const lbl =
        typeof t === "string"
          ? t.charAt(0).toUpperCase() + t.slice(1)
          : t?.label || val;
      return { value: val, label: lbl };
    });
  }, [dLocal.project_type]);

  /* ── Smart create/patch helpers ── */

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

    const withAddr = [
      {
        project_address_line1: addr.line1 || "",
        project_address_line2: addr.line2 || "",
        project_address_city: addr.city || "",
        project_address_state: addr.state || "",
        project_postal_code: addr.postal || "",
        address_line1: addr.line1 || "",
        address_line2: addr.line2 || "",
        address_city: addr.city || "",
        address_state: addr.state || "",
        address_postal_code: addr.postal || "",
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
        if (status && status !== 400) break;
      }
    }
    throw lastErr;
  }

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

    const withAddr = [
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

      // Mandatory Address Checks
      if (!dLocal.address_line1.trim()) {
        toast.error("Project Address Line 1 is required.");
        return;
      }
      if (!dLocal.address_city.trim()) {
        toast.error("Project City is required.");
        return;
      }
      if (!dLocal.address_state.trim()) {
        toast.error("Project State is required.");
        return;
      }
      if (!dLocal.address_postal_code.trim()) {
        toast.error("Project ZIP/Postal Code is required.");
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
        line1: dLocal.address_line1,
        line2: dLocal.address_line2,
        city: dLocal.address_city,
        state: dLocal.address_state,
        postal: dLocal.address_postal_code,
      };

      if (agreementId) {
        // PATCH existing Agreement.
        const payload = {
          title: base.project_title,
          project_title: base.project_title,
          homeowner: homeownerField,
          description: base.description,
          project_type: base.project_type,
          project_subtype: base.project_subtype,

          // Force explicit address update
          project_address_same_as_homeowner: false,
          project_is_homeowner_address: false,

          // Send SPECIFIC keys
          project_address_line1: addr.line1 || "",
          project_address_line2: addr.line2 || "",
          project_address_city: addr.city || "",
          project_address_state: addr.state || "",
          project_postal_code: addr.postal || "",

          // Send GENERIC keys (for fallback)
          address_line1: addr.line1 || "",
          address_line2: addr.line2 || "",
          address_city: addr.city || "",
          address_state: addr.state || "",
          address_postal_code: addr.postal || "",

          // Legacy alias support
          project_zip: addr.postal || "",
        };

        try {
          setLast400(null);
          await api.patch(`/projects/agreements/${agreementId}/`, payload);
          await loadEdit();
        } catch (e1) {
          console.error("Step1 PATCH failed", e1?.response || e1);
          setLast400(e1?.response?.data || { detail: "Save failed." });
          toast.error("Could not save Step 1. Please review any errors.");
          return;
        }

        toast.success("Details saved.");

        if (next) {
          goStep(2);
        }
      } else {
        // CREATE
        try {
          const payload = {
            ...base,
            project_address_same_as_homeowner: false,

            project_address_line1: addr.line1,
            project_address_line2: addr.line2,
            project_address_city: addr.city,
            project_address_state: addr.state,
            project_postal_code: addr.postal,

            address_line1: addr.line1,
            address_line2: addr.line2,
            address_city: addr.city,
            address_state: addr.state,
            address_postal_code: addr.postal,
          };

          const { data: created } = await api.post("/projects/agreements/", payload);
          const newId = created?.id ?? created?.pk;
          if (!newId) return toast.error("Could not determine new Agreement ID.");

          toast.success("Agreement created.");
          navigate(
            `${APP_PREFIX}/agreements/${newId}/wizard?step=${next ? 2 : 1}`,
            { replace: true }
          );
        } catch (e0) {
          const data = e0?.response?.data;
          setLast400(data || { detail: "Save failed." });
          toast.error("Could not create Agreement. Please check fields.");
        }
      }
    } catch (e) {
      console.error(e);
      const data = e?.response?.data;
      setLast400(data || { detail: e?.message || "Save failed" });
      toast.error(`Save failed: ${e?.message}`);
    }
  };

  /* ── Step 2 ── */
  const onLocalChange = (e) => {
    const { name, value } = e.target;
    setDLocal((s) => ({
      ...s,
      [name]: name === "start" || name === "end" ? toDateOnly(value) : value,
    }));
  };

  const onMLocalChange = (key, value) => {
    setMLocal((s) => ({ ...s, [key]: value }));
  };

  const saveMilestone = async (m) => {
    try {
      // Front-end validation
      const title = String(m.title || "").trim();
      if (!title) {
        toast.error("Milestone title is required.");
        return;
      }

      const amountNum = Number(m.amount);
      if (!Number.isFinite(amountNum)) {
        toast.error("Milestone amount must be a valid number.");
        return;
      }

      // Map inline fields (start/end) to backend date fields
      const startIso = toDateOnly(m.start || m.start_date || "");
      const endIso = toDateOnly(
        m.end || m.end_date || m.completion_date || m.due_date || ""
      );

      const basePayload = {
        title,
        description: m.description || "",
        amount: amountNum,
        agreement: agreementId,
        start_date: startIso || null,
        completion_date: endIso || null,
      };

      const url = m.id
        ? `/projects/agreements/${agreementId}/milestones/${m.id}/`
        : `/projects/milestones/`;
      const method = m.id ? api.put : api.post;

      const attempt = (payload) => method(url, payload);

      try {
        const { data } = await attempt(basePayload);

        if (m.id) {
          setMilestones((prev) => prev.map((x) => (x.id === m.id ? data : x)));
        } else {
          setMilestones((prev) => [...prev, data]);
        }

        setMLocal({
          title: "",
          description: "",
          amount: "",
          start: "",
          end: "",
        });
        setEditMilestone(null);
        toast.success(m.id ? "Updated" : "Added");
      } catch (err1) {
        const resp = err1?.response;
        const body = resp?.data;

        const raw =
          body &&
          (typeof body === "string" ? body : JSON.stringify(body));
        const isOverlap =
          raw && raw.toLowerCase().includes("overlap");

        if (isOverlap) {
          const ok = window.confirm(
            "This milestone overlaps an existing milestone in the same agreement.\n\nDo you want to save anyway?"
          );
          if (!ok) return;

          const payload2 = { ...basePayload, allow_overlap: true };

          try {
            const { data } = await attempt(payload2);

            if (m.id) {
              setMilestones((prev) =>
                prev.map((x) => (x.id === m.id ? data : x))
              );
            } else {
              setMilestones((prev) => [...prev, data]);
            }

            setMLocal({
              title: "",
              description: "",
              amount: "",
              start: "",
              end: "",
            });
            setEditMilestone(null);
            toast.success(
              m.id
                ? "Updated (overlap allowed)"
                : "Added (overlap allowed)"
            );
          } catch (err2) {
            const r2 = err2?.response;
            const b2 =
              (r2?.data &&
                (typeof r2.data === "string"
                  ? r2.data
                  : JSON.stringify(r2.data))) ||
              r2?.statusText ||
              err2?.message ||
              "Failed to save milestone.";
            toast.error(String(b2));
          }
        } else {
          const detail =
            (body &&
              (typeof body === "string"
                ? body
                : JSON.stringify(body))) ||
            resp?.statusText ||
            err1?.message ||
            "Failed to save milestone.";
          toast.error(String(detail));
        }
      }
    } catch (e) {
      console.error("Failed to save milestone:", e?.response || e);
      const detail =
        e?.response?.data?.detail ||
        e?.response?.data?.non_field_errors?.[0] ||
        e?.message ||
        "Failed to save milestone.";
      toast.error(String(detail));
    }
  };

  const deleteMilestone = async (id) => {
    if (!id) return;
    try {
      await api.delete(`/projects/milestones/${id}/`);
      setMilestones((s) => s.filter((m) => m.id !== id));
      toast.success("Deleted milestone.");
    } catch (e) {
      console.error("Failed to delete milestone", e?.response || e);
      toast.error("Failed to delete.");
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
      const res = await api.get(
        `/projects/agreements/${agreementId}/preview_pdf/`,
        {
          responseType: "blob",
          params: { stream: 1 },
        }
      );

      // Revoke any prior preview URL to avoid memory leaks
      if (pdfUrl) {
        try {
          URL.revokeObjectURL(pdfUrl);
        } catch {}
      }

      const blob = new Blob([res.data], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);

      setPdfUrl(url);
      setPdfOpen(true);

      try {
        await api.post(
          `/projects/agreements/${agreementId}/mark_previewed/`
        );
      } catch (e) {
        console.warn("mark_previewed failed (non-fatal):", e?.response || e);
      }
      setHasPreviewed(true);
    } catch (err) {
      console.error("Preview failed:", err);
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

  const unsignContractor = async () => {
    if (!agreementId) return toast.error("Agreement ID missing.");

    try {
      await api.post(`/projects/agreements/${agreementId}/contractor_unsign/`);
      toast.success("Contractor signature removed.");

      setHasPreviewed(false);
      setAckReviewed(false);
      setAckTos(false);
      setAckEsign(false);
      setTypedName("");

      await loadEdit();
    } catch (e) {
      console.error("Unsign error:", e?.response || e);
      toast.error(
        e?.response?.data?.detail ||
          "Could not unsign. Homeowner may have already signed."
      );
    }
  };

  const canSign =
    !!agreementId &&
    hasPreviewed &&
    ackReviewed &&
    ackTos &&
    ackEsign &&
    typedName.trim().length >= 2;

  const step4Label = useMemo(() => {
    if (!agreement) return "";
    const id = agreement.id ?? agreement.pk;
    const amend = agreement.amendment_number ?? agreement.amendment ?? 0;
    if (!id) return "";
    if (amend && amend > 0) {
      return `Agreement #${id} — Amendment ${amend}`;
    }
    return `Agreement #${id}`;
  }, [agreement]);

  /* ── render ── */
  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button type="button"
            key={t.step}
            onClick={() =>
              navigate(
                agreementId
                  ? `${APP_PREFIX}/agreements/${agreementId}/wizard?step=${t.step}`
                  : `${APP_PREFIX}/agreements/new?step=${t.step}`
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
                const { data } = await api.post(`/homeowners/`, body);
                created = data;
              } catch {
                // fallback: projects/homeowners if needed
                const { data } = await api.post(`/projects/homeowners/`, body);
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
          onLocalChange={onLocalChange}
          homeownerOptions={homeownerOptions}
          projectTypeOptions={projectTypeOptions}
          projectSubtypeOptions={projectSubtypeOptions}
        />
      )}

      {step === 2 && (
        <>
          <Step2Milestones
            agreementId={agreementId}
            milestones={milestones}
            mLocal={mLocal}
            onLocalChange={onLocalChange}
            onMLocalChange={onMLocalChange}
            saveMilestone={saveMilestone}
            deleteMilestone={deleteMilestone}
            editMilestone={editMilestone}
            setEditMilestone={setEditMilestone}
            updateMilestone={() => {}}
            onBack={() => goStep(1)}
            onNext={() => goStep(3)}
          />

          {editMilestone && (
            <MilestoneEditModal
              open={!!editMilestone}
              milestone={editMilestone}
              onClose={() => setEditMilestone(null)}
              onSaved={async () => {
                setEditMilestone(null);
                await loadEdit();
              }}
            />
          )}
        </>
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
          onBack={() => goStep(2)}
          onNext={() => goStep(4)}
        />
      )}

      {step === 4 && (
        <>
          {step4Label && (
            <div className="mb-3 text-sm font-medium text-gray-700">
              {step4Label}
            </div>
          )}
          <Step4Finalize
            agreement={agreement}
            dLocal={dStep4}
            isEdit={isEdit}
            goBack={() => goStep(3)}
            previewPdf={previewPdf}
            goPublic={goPublic}
            signing={signing}
            typedName={typedName}
            setTypedName={setTypedName}
            ackReviewed={ackReviewed}
            setAckReviewed={setAckReviewed}
            ackTos={ackTos}
            setAckTos={setAckTos}
            ackEsign={ackEsign}
            setAckEsign={setAckEsign}
            submitSign={signContractor}
            unsignContractor={unsignContractor}
            hasPreviewed={hasPreviewed}
            canSign={canSign}
            attachments={attachments}
            milestones={milestones}
            totals={totals}
            customWarranty={customWarranty}
            useDefaultWarranty={useDefaultWarranty}
            defaultWarrantyText={
              "Standard workmanship warranty: Contractor warrants all labor performed under this Agreement for one (1) year from substantial completion. Materials are covered by the manufacturer’s warranties. This warranty excludes damage caused by misuse, neglect, alteration, improper maintenance, or acts of God."
            }
          />
        </>
      )}

      <PdfPreviewModal
        open={pdfOpen}
        onClose={() => {
          setPdfOpen(false);
          if (pdfUrl) {
            try {
              URL.revokeObjectURL(pdfUrl);
            } catch {}
          }
          setPdfUrl(null);
        }}
        fileUrl={pdfUrl}
        title={step4Label || "Agreement Preview"}
      />

      {loading && (
        <div className="mt-4 text-sm text-gray-500">Loading…</div>
      )}
    </div>
  );
}
