// frontend/src/lib/homeownersCache.js
// v2025-10-15 customers-first + alias (/homeowners) + projects fallbacks + TTL cache

let cache = null;
let inflight = null;
let last = 0;
const TTL = 60 * 1000; // 1 minute

const pickArray = (raw) =>
  Array.isArray(raw?.results) ? raw.results : Array.isArray(raw) ? raw : [];

// --- normalizers ---
function normalizeCustomer(rec) {
  if (!rec || typeof rec !== "object") return null;
  const id = rec.id ?? rec.pk;
  if (!id) return null;
  const full_name = String(rec.full_name ?? rec.name ?? "").trim();
  const email = String(rec.email ?? "").trim();
  let first_name = "", last_name = "";
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
  const last_name  = String(rec.last_name  ?? rec.lastName  ?? "").trim();
  const email = String(rec.email ?? "").trim();
  const full_name = String(
    rec.full_name ?? rec.fullName ?? rec.name ?? [first_name, last_name].filter(Boolean).join(" ")
  ).trim();
  return { id, first_name, last_name, full_name, email, _src: "homeowners" };
}

const sortPeople = (list) =>
  [...list].sort((a, b) =>
    (a.full_name || a.last_name || a.email || `id:${a.id}`).localeCompare(
      b.full_name || b.last_name || b.email || `id:${b.id}`
    )
  );

export function labelForPerson(p) {
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

export function clearHomeownersCache() { cache = null; inflight = null; last = 0; }

/**
 * Customers-first list (axios instance `api` with baseURL "/api")
 * Tries in order and stops on first non-empty list:
 *   1) /api/customers/?page=1&page_size=1000&ordering=-created_at
 *   2) /api/homeowners/?page=1&page_size=1000&ordering=-created_at
 *   3) /api/projects/customers/?page=1&page_size=1000&ordering=-created_at
 *   4) /api/projects/homeowners/?page=1&page_size=1000&ordering=-created_at
 */
export async function loadHomeowners(api, { force = false, signal } = {}) {
  const now = Date.now();
  if (!force && cache && (now - last) < TTL) return cache;
  if (inflight) return inflight;

  const cfg = { params: { page: 1, page_size: 1000, ordering: "-created_at" }, signal };

  inflight = (async () => {
    // 1) customers
    try {
      const { data } = await api.get("/customers/", cfg);
      const list = pickArray(data).map(normalizeCustomer).filter(Boolean);
      if (list.length) return (cache = sortPeople(list), last = Date.now(), cache);
    } catch {}

    // 2) alias homeowners
    try {
      const { data } = await api.get("/homeowners/", cfg);
      const list = pickArray(data).map(normalizeHomeowner).filter(Boolean);
      if (list.length) return (cache = sortPeople(list), last = Date.now(), cache);
    } catch {}

    // 3) projects/customers
    try {
      const { data } = await api.get("/projects/customers/", cfg);
      const list = pickArray(data).map(normalizeCustomer).filter(Boolean);
      if (list.length) return (cache = sortPeople(list), last = Date.now(), cache);
    } catch {}

    // 4) projects/homeowners
    try {
      const { data } = await api.get("/projects/homeowners/", cfg);
      const list = pickArray(data).map(normalizeHomeowner).filter(Boolean);
      return (cache = sortPeople(list), last = Date.now(), cache);
    } catch {}

    return (cache = [], last = Date.now(), cache);
  })().finally(() => { inflight = null; });

  return inflight;
}

export default { loadHomeowners, clearHomeownersCache, labelForPerson };
