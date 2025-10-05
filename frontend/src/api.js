// src/api.js
import axios from "axios";

/**
 * Axios core with resilient auth:
 * - In-memory token (preferred) + storage fallback (access/accessToken)
 * - Always attaches Authorization: Bearer … to every request (incl. DELETE)
 * - Legacy URL rewrites → /projects/*
 * - Forces JSON for non-attachment writes to avoid 415
 * - 401 refresh-once; 415 auto-recovery; 405 /contractors/me/ fallback
 */

const TOK = { access: "access", refresh: "refresh", legacyAccess: "accessToken" };
const BASE_URL = "/api";

// ---------- In-memory tokens (survive storage blocking within the tab) ----------
let MEM_ACCESS = null;
let MEM_REFRESH = null;

// ---------- Helpers ----------
const isFormData = (v) => typeof FormData !== "undefined" && v instanceof FormData;
const isBlob = (v) => typeof Blob !== "undefined" && v instanceof Blob;
const isURLSearchParams = (v) => typeof URLSearchParams !== "undefined" && v instanceof URLSearchParams;

const LEGACY_PREFIX_MAP = [
  ["/homeowners", "/projects/homeowners"],
  ["/milestones", "/projects/milestones"],
  ["/contractors", "/projects/contractors"],
  ["/attachments", "/projects/attachments"],
  ["/expenses", "/projects/expenses"],
];

const isAbsoluteUrl = (url) => /^https?:\/\//i.test(url);
function rewriteLegacyUrl(url) {
  if (!url || typeof url !== "string" || isAbsoluteUrl(url)) return url;
  for (const [oldPfx, newPfx] of LEGACY_PREFIX_MAP) {
    if (url === oldPfx || url.startsWith(oldPfx + "/") || url.startsWith(oldPfx + "?")) {
      return newPfx + url.slice(oldPfx.length);
    }
  }
  return url;
}
function isAttachmentRoute(url = "") {
  if (!url) return false;
  const u = String(url);
  return (
    /\/attachments\/?(\?|$|\/)/i.test(u) ||
    /\/milestone-files\/?(\?|$|\/)/i.test(u) ||
    /\/license-upload\/?(\?|$|\/)/i.test(u) ||
    /\/upload\/?(\?|$|\/)/i.test(u)
  );
}

// ---------- Storage token helpers ----------
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
  } catch {
    return null;
  }
};
export const getRefreshToken = () => {
  if (MEM_REFRESH) return MEM_REFRESH;
  try {
    return localStorage.getItem(TOK.refresh) || sessionStorage.getItem(TOK.refresh);
  } catch {
    return null;
  }
};
function inferRememberFromStorage() {
  try {
    if (localStorage.getItem(TOK.refresh)) return true;   // persisted
    if (sessionStorage.getItem(TOK.refresh)) return false; // session-only
  } catch {}
  return true; // default: persist
}

// ---------- Public API for login/logout ----------
export function setAuthToken(access, refresh = null, remember = true) {
  MEM_ACCESS = access || null;
  MEM_REFRESH = refresh || null;
  try {
    const store = remember ? localStorage : sessionStorage;
    const other = remember ? sessionStorage : localStorage;

    if (access) {
      store.setItem(TOK.access, access);
      // keep legacy key in sync for older code paths
      store.setItem(TOK.legacyAccess, access);
    }
    if (refresh) store.setItem(TOK.refresh, refresh);

    other.removeItem(TOK.access);
    other.removeItem(TOK.refresh);
    other.removeItem(TOK.legacyAccess);
  } catch {}
  applyAuthHeader(access);
}
// back-compat alias some code may still call
export const setTokens = (access, refresh, remember = true) =>
  setAuthToken(access, refresh, remember);

export function clearAuth() {
  MEM_ACCESS = null;
  MEM_REFRESH = null;
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

function applyAuthHeader(token) {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
    axios.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common.Authorization;
    delete axios.defaults.headers.common.Authorization;
  }
}

// ---------- Axios instance ----------
const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  withCredentials: false, // avoid session/CSRF ambiguity
});

// Ensure JSON for non-attachment writes
function normalizeForJson(config) {
  const method = (config.method || "get").toLowerCase();
  const wantsBody = /post|put|patch/.test(method);
  if (!wantsBody) return config;

  const url = config.url || "";
  if (isAttachmentRoute(url)) return config;

  const existingCT =
    (config.headers && (config.headers["Content-Type"] || config.headers["content-type"])) ||
    (api.defaults.headers && api.defaults.headers["Content-Type"]);

  const body = config.data;
  const shouldForceJson =
    !existingCT && !isFormData(body) && !isBlob(body) && !isURLSearchParams(body);

  if (shouldForceJson) {
    config.headers = {
      ...(config.headers || {}),
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }
  return config;
}

// Optional GET retry
const RETRY = { enableGetRetry: false, max: 2, baseDelayMs: 250 };
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const isTransient = (err) => !err?.response || [502, 503, 504].includes(err.response.status);

// Interceptors
function installInterceptors(instance) {
  instance.interceptors.request.use((config) => {
    // Prefer in-memory token; fallback to storage
    const token = MEM_ACCESS || getAccessToken();
    if (token) {
      config.headers = { ...(config.headers || {}), Authorization: `Bearer ${token}` };
    } else if (config.headers?.Authorization) {
      delete config.headers.Authorization;
    }

    if (config.url && !isAbsoluteUrl(config.url)) {
      config.url = rewriteLegacyUrl(config.url);
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
      const original = error.config || {};

      // Optional GET retry
      if (
        RETRY.enableGetRetry &&
        (original.method || "get").toLowerCase() === "get" &&
        isTransient(error) &&
        (original._retry_count || 0) < RETRY.max
      ) {
        original._retry_count = (original._retry_count || 0) + 1;
        const delay = RETRY.baseDelayMs * 2 ** (original._retry_count - 1);
        await sleep(delay);
        return instance(original);
      }

      // 401 refresh-once
      if (error.response && error.response.status === 401 && !original._retry) {
        original._retry = true;

        if (isRefreshing) {
          return new Promise((resolve, reject) => {
            queue.push({
              resolve: (token) => {
                if (token) original.headers = { ...(original.headers || {}), Authorization: `Bearer ${token}` };
                resolve(instance(original));
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
            } catch (e) {
              if (i === candidates.length - 1) throw e;
            }
          }

          const newAccess = data?.access || data?.access_token;
          if (typeof newAccess !== "string" || !newAccess) throw new Error("No access token returned on refresh.");

          // Reapply tokens to memory & storage
          setAuthToken(newAccess, refresh, inferRememberFromStorage());

          flush(null, newAccess);
          original.headers = { ...(original.headers || {}), Authorization: `Bearer ${newAccess}` };
          return instance(original);
        } catch (err) {
          flush(err, null);
          clearAuth();
          throw err;
        } finally {
          isRefreshing = false;
        }
      }

      // 415 recovery (multipart -> JSON) excluding attachments
      if (
        error.response &&
        error.response.status === 415 &&
        /post|put|patch/i.test(original.method || "") &&
        !isAttachmentRoute(original.url || "") &&
        isFormData(original.data) &&
        !original._retried_as_json
      ) {
        const obj = {};
        original.data.forEach?.((v, k) => {
          if (!(v instanceof Blob)) obj[k] = v;
        });
        const retryConfig = {
          ...original,
          data: obj,
          headers: { ...(original.headers || {}), "Content-Type": "application/json", Accept: "application/json" },
          _retried_as_json: true,
        };
        return instance(retryConfig);
      }

      // 405 fallback for /contractors/me/
      if (
        error.response &&
        error.response.status === 405 &&
        /\/contractors\/me\/?/.test(original.url || "") &&
        /patch|put/i.test(original.method || "")
      ) {
        try {
          const meResp = await instance.get("/projects/contractors/me/");
          const id = meResp?.data?.id ?? meResp?.data?.pk;
          if (!id) throw new Error("Could not resolve contractor id from /contractors/me/");
          const retryConfig = {
            ...original,
            url: (original.url || "").replace(/contractors\/me\/?/, `contractors/${id}/`),
            _retry: true,
          };
          return instance(retryConfig);
        } catch {/* ignore */}
      }

      return Promise.reject(error);
    }
  );
}

installInterceptors(api);
installInterceptors(axios);

// Seed Authorization at boot (covers hard refresh)
applyAuthHeader(getAccessToken());

// Convenience helper for attachments
export function uploadMultipart(url, formData) {
  return api.post(url, formData); // browser sets boundary automatically
}

export default api;
