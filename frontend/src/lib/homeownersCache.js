// src/lib/homeownersCache.js
let cache = null;
let promise = null;
let last = 0;
const TTL = 60 * 1000; // 1 minute

export function clearHomeownersCache() {
  cache = null; promise = null; last = 0;
}

export async function loadHomeowners(api, opts = {}) {
  // allow old boolean style too
  const { force = typeof opts === "boolean" ? opts : false, signal } =
    typeof opts === "object" ? opts : { force: !!opts };

  const now = Date.now();
  if (!force && cache && (now - last) < TTL) return cache; // serve from cache
  if (promise) return promise;                              // share in-flight

  promise = api.get("/homeowners/", { signal })
    .then(({ data }) => {
      cache = Array.isArray(data) ? data : (data?.results || []);
      last = Date.now();
      return cache;
    })
    .finally(() => { promise = null; });

  return promise;
}
