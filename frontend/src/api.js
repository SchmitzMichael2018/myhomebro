// ~/backend/frontend/src/api.js
// v2025-11-11 — stable-auth shim + canonical /projects/homeowners + onboarding redirect

console.log("api.js v2025-11-11-stable-auth-shim+canonical");

import axios from "axios";

const TOK = { access: "access", refresh: "refresh", legacyAccess: "accessToken" };
const BASE_URL = "/api";

let MEM_ACCESS = null;
let MEM_REFRESH = null;

const isFormData = (v) => typeof FormData !== "undefined" && v instanceof FormData;
const isBlob = (v) => typeof Blob !== "undefined" && v instanceof Blob;
const isURLSearchParams = (v) => typeof URLSearchParams !== "undefined" && v instanceof URLSearchParams;
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const SAME_ORIGIN = (typeof window !== "undefined" && window.location?.origin) || "";

// No-Auth header endpoints
const NO_AUTH_HEADER_PATHS = new Set([
  "/auth/login/", "/auth/refresh/", "/auth/register/",
  "/auth/password-reset/request/", "/auth/password-reset/confirm/", "/auth/password-reset/complete/",
  "/token/", "/token/refresh/", "/accounts/token/", "/accounts/token/refresh/",
  "/auth/jwt/create/", "/auth/jwt/refresh/",
]);

// ✅ Canonicalize to /projects/* (avoid posting to removed alias /homeowners/)
const ENDPOINT_REMAP = [
  // Customers/Homeowners
  ["/customers", "/projects/homeowners"],
  ["/homeowners", "/projects/homeowners"],

  // Other project resources
  ["/milestones", "/projects/milestones"],
  ["/contractors", "/projects/contractors"],
  ["/attachments", "/projects/attachments"],
  ["/expenses", "/projects/expenses"],

  // Onboarding helpers
  ["/api/projects/contractor-onboarding-status", "/payments/onboarding/status"],
  ["/api/projects/contractor-onboarding",       "/payments/onboarding/start"],
  ["/api/projects/contractor-onboarding-manage", "/payments/onboarding/manage"],
];

function normalizePath(url) {
  if (!url || typeof url !== "string") return "/";
  const [path, rest] = url.split(/(?=[?#])/);
  const fixed = ("/" + path).replace(/\/{2,}/g, "/");
  return rest ? fixed + rest : fixed;
}

function remapRelativePath(pathWithQuery) {
  const path = normalizePath(pathWithQuery);
  for (const [legacy, target] of ENDPOINT_REMAP) {
    const base = legacy.endsWith("/") ? legacy.slice(0, -1) : legacy;
    if (path === base || path === base + "/" || path.startsWith(base + "/") || path.startsWith(base + "?")) {
      const replaced = path.replace(base, target);
      if (process?.env?.NODE_ENV !== "production") {
        console.log(`[api-shim] ${legacy} → ${target} :: ${path} → ${replaced}`);
      }
      return replaced;
    }
  }
  return path;
}

function remapAny(url) {
  if (!url) return url;
  try {
    const u = new URL(url, SAME_ORIGIN || "http://localhost");
    const isAbsolute = /^[a-z]+:\/\//i.test(url);
    const sameOrigin = SAME_ORIGIN && u.origin === SAME_ORIGIN;
    if (isAbsolute && sameOrigin) {
      const rebuiltPath = remapRelativePath(u.pathname + u.search + u.hash);
      return u.origin + rebuiltPath;
    }
  } catch {}
  return remapRelativePath(url);
}

function pathOnly(url) {
  try { return new URL(url, "https://dummy.local").pathname; }
  catch { return (url || "").replace(/[?#].*$/, ""); }
}

// Token helpers
export const getAccessToken = () => {
  if (MEM_ACCESS) return MEM_ACCESS;
  try {
    return (
      localStorage.getItem(TOK.access) ||
      sessionStorage.getItem(TOK.access) ||
      localStorage.getItem(TOK.legacyAccess) ||
      sessionStorage.getItem(TOK.legacyAccess) ||
      null
    );
  } catch { return null; }
};
export const getRefreshToken = () => {
  if (MEM_REFRESH) return MEM_REFRESH;
  try { return localStorage.getItem(TOK.refresh) || sessionStorage.getItem(TOK.refresh); }
  catch { return null; }
};
function inferRememberFromStorage() {
  try {
    if (localStorage.getItem(TOK.refresh)) return true;
    if (sessionStorage.getItem(TOK.refresh)) return false;
  } catch {}
  return true;
}

const api = axios.create({ baseURL: BASE_URL, timeout: 30000, withCredentials: false });

function applyAuthHeader(token) {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
    axios.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common.Authorization;
    delete axios.defaults.headers.common.Authorization;
  }
}
export function setAuthToken(access, refresh = null, remember = true) {
  MEM_ACCESS = access || null;
  MEM_REFRESH = refresh || null;
  try {
    const store = remember ? localStorage : sessionStorage;
    const other = remember ? sessionStorage : localStorage;
    if (access) { store.setItem(TOK.access, access); store.setItem(TOK.legacyAccess, access); }
    if (refresh) store.setItem(TOK.refresh, refresh);
    other.removeItem(TOK.access); other.removeItem(TOK.refresh); other.removeItem(TOK.legacyAccess);
  } catch {}
  applyAuthHeader(access);
}
export const setTokens = (a, r, remember = true) => setAuthToken(a, r, remember);
export function clearAuth() {
  MEM_ACCESS = null; MEM_REFRESH = null;
  try {
    localStorage.removeItem(TOK.access);
    localStorage.removeItem(TOK.refresh);
    localStorage.removeItem(TOK.legacyAccess);
    sessionStorage.removeItem(TOK.access);
    sessionStorage.removeItem(TOK.refresh);
    sessionStorage.removeItem(TOK.legacyAccess);
  } catch {}
  applyAuthHeader(null);
}

function normalizeForJson(config) {
  const method = (config.method || "get").toLowerCase();
  const wantsBody = /post|put|patch/.test(method);
  if (!wantsBody) return config;

  const url = config.url || "";
  const isAttachment =
    /\/attachments\/?(\?|$|\/)/i.test(url) ||
    /\/milestone-files\/?(\?|$|\/)/i.test(url) ||
    /\/license-upload\/?(\?|$|\/)/i.test(url) ||
    /\/upload\/?(\?|$|\/)/i.test(url);
  if (isAttachment) return config;

  const existingCT =
    (config.headers && (config.headers["Content-Type"] || config.headers["content-type"])) ||
    (api.defaults.headers && api.defaults.headers["Content-Type"]);

  const body = config.data;
  const shouldForceJson = !existingCT && !isFormData(body) && !isBlob(body) && !isURLSearchParams(body);
  if (shouldForceJson) {
    config.headers = { ...(config.headers || {}), "Content-Type": "application/json", Accept: "application/json" };
  }
  return config;
}

function installInterceptors(instance) {
  instance.interceptors.request.use((config) => {
    if (config.url) config.url = remapAny(config.url);
    // de-dupe "/api"
    if (instance.defaults.baseURL === "/api" && typeof config.url === "string" && config.url.startsWith("/api/")) {
      config.url = config.url.slice(4);
    } else if (instance.defaults.baseURL === "/api" && config.url === "/api") {
      config.url = "/";
    }
    const p = pathOnly(config.url || "");
    if (NO_AUTH_HEADER_PATHS.has(p)) {
      if (config.headers?.Authorization) delete config.headers.Authorization;
    } else {
      const token = MEM_ACCESS || getAccessToken();
      if (token) config.headers = { ...(config.headers || {}), Authorization: `Bearer ${token}` };
      else if (config.headers?.Authorization) delete config.headers.Authorization;
    }
    return normalizeForJson(config);
  });

  let isRefreshing = false;
  let queue = [];
  const flush = (err, newToken) => {
    queue.forEach(({ resolve, reject }) => (err ? reject(err) : resolve(newToken)));
    queue = [];
  };

  instance.interceptors.response.use(
    (res) => res,
    async (error) => {
      const { response, config } = error || {};
      const status = response?.status;
      const method = (config?.method || "").toLowerCase();
      const url = config?.url || "";
      const data = response?.data || {};

      // Contractor required → redirect to onboarding (robust)
      if (status === 403) {
        const code = data?.code;
        const detail = typeof data?.detail === "string" ? data.detail.toLowerCase() : "";
        const contractorRequired =
          code === "contractor_required" ||
          (detail.includes("contractor") && detail.includes("profile")) ||
          // fallback: if backend returns plain 403 without payload
          true;
        const isHomeownerCreate =
          method === "post" && (url.endsWith("/projects/homeowners/") || url.endsWith("/homeowners/"));
        if (contractorRequired && isHomeownerCreate) {
          try {
            window.dispatchEvent(new CustomEvent("mhb:onboardingRequired", {
              detail: { source: "homeowners:create", ts: Date.now() },
            }));
          } catch {}
          window.location.assign("/onboarding");
          return new Promise(() => {}); // swallow
        }
      }

      // JWT refresh
      if (status !== 401) return Promise.reject(error);
      const p = pathOnly(config?.url || "");
      if (NO_AUTH_HEADER_PATHS.has(p)) return Promise.reject(error);
      if (config._retry) return Promise.reject(error);
      config._retry = true;

      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          queue.push({
            resolve: (token) => {
              if (token) config.headers = { ...(config.headers || {}), Authorization: `Bearer ${token}` };
              resolve(instance(config));
            },
            reject,
          });
        });
      }

      isRefreshing = true;
      const refresh = MEM_REFRESH || getRefreshToken();
      if (!refresh) {
        isRefreshing = false;
        clearAuth();
        return Promise.reject(error);
      }

      const candidates = ["/auth/refresh/", "/token/refresh/", "/projects/token/refresh/"];
      try {
        let data;
        for (let i = 0; i < candidates.length; i++) {
          try {
            const resp = await instance.post(candidates[i], { refresh });
            data = resp.data;
            break;
          } catch (e) { if (i === candidates.length - 1) throw e; }
          }
        const newAccess = data?.access || data?.access_token;
        if (!newAccess) throw new Error("No access token on refresh.");
        setAuthToken(newAccess, refresh, inferRememberFromStorage());
        flush(null, newAccess);
        config.headers = { ...(config.headers || {}), Authorization: `Bearer ${newAccess}` };
        return instance(config);
      } catch (err) {
        flush(err, null);
        clearAuth();
        throw err;
      } finally {
        isRefreshing = false;
      }
    }
  );
}

installInterceptors(api);
installInterceptors(axios);
applyAuthHeader(getAccessToken());

export function uploadMultipart(url, formData) { return api.post(url, formData); }
export default api;
