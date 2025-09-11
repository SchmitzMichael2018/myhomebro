// src/lib/agreements.js
import api from "@/api";

/* ---------------- helpers ---------------- */
const moneyToNumber = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = parseFloat(String(v).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
};

const isEmptyMilestone = (m) =>
  !((m?.title && m.title.trim()) ||
    (m?.description && m.description.trim()) ||
    m?.due_date ||
    m?.start ||
    m?.end ||
    m?.start_date ||
    m?.completion_date ||
    moneyToNumber(m?.amount) !== null);

const stripNulls = (obj) => {
  if (Array.isArray(obj)) return obj.map(stripNulls);
  if (obj && typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      const vv = stripNulls(v);
      if (vv !== null && vv !== undefined) out[k] = vv;
    }
    return out;
  }
  return obj;
};

/* -------------- state -> draft -------------- */
function resolveHomeownerId(state) {
  // Accept many shapes: homeownerId, homeowner_id, homeowner (number or object), customer.id
  const raw =
    state?.homeownerId ??
    state?.homeowner_id ??
    (typeof state?.homeowner === "number"
      ? state.homeowner
      : state?.homeowner?.id) ??
    state?.customer?.id;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function resolveProjectTitle(state) {
  // Accept both keys
  return (
    (state?.project_title && String(state.project_title)) ||
    (state?.projectName && String(state.projectName)) ||
    ""
  );
}

/** Normalize whatever Step 1/2 produced into a neutral draft */
function toMapperDraft(state) {
  const homeownerId = resolveHomeownerId(state);
  const title = resolveProjectTitle(state);

  // normalize milestones from multiple shapes
  const rawMs = Array.isArray(state?.milestones) ? state.milestones : [];

  const milestones = rawMs.map((m, i) => {
    const amount = m?.amount;
    const start =
      m?.start_date ?? m?.start ?? null;
    const end =
      m?.completion_date ?? m?.end ?? m?.end_date ?? null;
    // choose a canonical due_date for create:
    const due = m?.due_date ?? end ?? start ?? null;

    return {
      order: m?.order ?? i + 1,
      title: m?.title || "",
      description: m?.description || "",
      amount, // normalized later
      // keep all commonly seen date keys so backend serializers that accept them won't choke
      due_date: due,
      start_date: start,
      completion_date: end,
      days: Number(m?.days || 0),
      hours: Number(m?.hours || 0),
      minutes: Number(m?.minutes || 0),
      // duration_minutes also appears in some flows:
      duration_minutes: Number(m?.duration_minutes || 0),
    };
  });

  return {
    customer: homeownerId ? { id: homeownerId } : null,
    project: {
      title,
      start_date: state?.start_date || state?.project_start_date || null,
      end_date: state?.end_date || state?.project_end_date || null,
      // Optional metadata if your backend uses them:
      project_type: state?.project_type || state?.projectType || null,
      project_subtype: state?.project_subtype || state?.projectSubtype || null,
      description: state?.description || null,
      use_customer_address: !!state?.useCustomerAddress,
      project_street_address: state?.project_street_address || null,
      project_address_line_2: state?.project_address_line_2 || null,
      project_city: state?.project_city || null,
      project_state: state?.project_state || null,
      project_zip_code: state?.project_zip_code || null,
    },
    milestones,
    termsAccepted: !!state?.termsAccepted,
  };
}

/* -------------- draft -> payload -------------- */
export function toAgreementPayload(draft, { removeEmptyMilestones = true, omitNulls = true } = {}) {
  const milestones = (draft.milestones || [])
    .filter((m) => (removeEmptyMilestones ? !isEmptyMilestone(m) : true))
    .map((m, i) => ({
      order: m.order ?? i + 1,
      title: (m.title || "").trim() || null,
      description: (m.description || "").trim() || null,
      // keep most common date keys (your create serializer can ignore extras)
      due_date: m.due_date || null,                 // "YYYY-MM-DD"
      start_date: m.start_date || null,
      completion_date: m.completion_date || null,
      days: Number(m.days || 0),
      hours: Number(m.hours || 0),
      minutes: Number(m.minutes || 0),
      // some UIs store a single duration field:
      duration_minutes: Number(m.duration_minutes || 0),
      amount: moneyToNumber(m.amount),              // null if blank/invalid
    }));

  const total_cost_raw = milestones.reduce(
    (sum, m) => sum + (moneyToNumber(m.amount) || 0),
    0
  );
  const total_cost = Number(total_cost_raw.toFixed(2));
  const milestone_count = milestones.length;

  const homeownerId = draft.customer?.id ?? null;
  const project_title = (draft.project?.title || "").trim() || null;

  let payload = {
    // Parties — include BOTH to satisfy whichever field your DRF serializer expects
    homeowner: homeownerId,
    homeowner_id: homeownerId,

    // Required fields your API complained about
    project_title,            // ✅ REQUIRED
    total_cost,               // ✅ REQUIRED

    // Optional but useful:
    milestone_count,
    start_date: draft.project?.start_date || null,
    end_date: draft.project?.end_date || null,
    terms_accepted: !!draft.termsAccepted,

    // Extra metadata if your backend wants them (harmless if ignored)
    project_type: draft.project?.project_type || null,
    project_subtype: draft.project?.project_subtype || null,
    description: draft.project?.description || null,
    use_customer_address: draft.project?.use_customer_address ?? null,
    project_street_address: draft.project?.project_street_address || null,
    project_address_line_2: draft.project?.project_address_line_2 || null,
    project_city: draft.project?.project_city || null,
    project_state: draft.project?.project_state || null,
    project_zip_code: draft.project?.project_zip_code || null,

    // Line items
    milestones,
  };

  payload = omitNulls ? stripNulls(payload) : payload;

  // Optional debug: set window.MYHOMEBRO_DEBUG = true in console to inspect outgoing payload
  try {
    if (window?.MYHOMEBRO_DEBUG) {
      // eslint-disable-next-line no-console
      console.debug("[agreements] payload", payload);
    }
  } catch {}

  return payload;
}

/* -------------- validation -------------- */
export function validateAgreementDraft(draft) {
  const errs = [];
  const title = (draft?.project?.title || "").trim();
  if (!title) errs.push("Project title is required.");

  const ms = (draft?.milestones || []).filter((m) => !isEmptyMilestone(m));
  if (ms.length === 0) errs.push("Add at least one milestone.");

  const total = ms.reduce((sum, m) => sum + (moneyToNumber(m.amount) || 0), 0);
  if (total <= 0) errs.push("Total cost must be greater than 0.");

  const homeownerId = draft?.customer?.id;
  if (!homeownerId) errs.push("Homeowner is required.");

  ms.forEach((m, i) => {
    const idx = i + 1;
    const amt = moneyToNumber(m.amount);
    if (!(m.title || "").trim()) errs.push(`Milestone ${idx}: title is required.`);
    if (amt === null || amt <= 0) errs.push(`Milestone ${idx}: amount must be > 0.`);
  });

  return errs;
}

/* -------------- DRF error shaping -------------- */
function flattenErrors(node, path = "") {
  const lines = [];
  if (Array.isArray(node)) {
    node.forEach((v, i) => lines.push(...flattenErrors(v, `${path}[${i}]`)));
  } else if (node && typeof node === "object") {
    Object.entries(node).forEach(([k, v]) => {
      const next = path ? `${path}.${k}` : k;
      lines.push(...flattenErrors(v, next));
    });
  } else if (node !== undefined && node !== null) {
    lines.push(`${path}: ${String(node)}`);
  }
  return lines;
}

function asNiceError(err, fallback = "Request failed") {
  const r = err?.response;
  if (r?.status === 400 && r?.data) {
    const details = r.data;
    const msg = flattenErrors(details).join(" | ") || "Bad Request";
    const e = new Error(msg);
    e.details = details;
    e.status = 400;
    return e;
  }
  return err?.message ? err : new Error(fallback);
}

/* -------------- POST with resilient fallbacks -------------- */
async function postWithFallbacks(payload, opts = {}) {
  // Prefer the modern projects route. Keep homeowner_id included above.
  const attempts = [
    { url: "/projects/agreements/", body: payload },
    // Some older deployments only accept homeowner_id; but we're already including both.
    // Try older base route as a last resort:
    { url: "/agreements/", body: payload },
  ];

  let lastErr = null;
  for (const attempt of attempts) {
    try {
      const { data } = await api.post(attempt.url, attempt.body, { signal: opts.signal });
      return data;
    } catch (err) {
      lastErr = asNiceError(err);
      const status = err?.response?.status;
      if (status && status !== 400 && status !== 404) break; // stop on hard errors
    }
  }
  throw lastErr || new Error("Agreement creation failed");
}

/* -------------- public API -------------- */
export async function createAgreement(draft, opts = {}) {
  const payload = toAgreementPayload(draft, { removeEmptyMilestones: true, omitNulls: true });
  try {
    return await postWithFallbacks(payload, opts);
  } catch (err) {
    throw asNiceError(err);
  }
}

export async function createAgreementFromWizardState(state, opts = {}) {
  const draft = toMapperDraft(state);
  const errs = validateAgreementDraft(draft);
  if (errs.length) {
    const e = new Error(errs.join(" | "));
    e.status = 400;
    throw e;
  }
  return await createAgreement(draft, opts);
}
