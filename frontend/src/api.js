// src/api.js
import axios from "axios";

/**
 * Central axios setup:
 * - Base URL: /api
 * - Attaches Authorization on every request (instance AND global axios)
 * - Refreshes access token once on 401 and retries
 * - Rewrites legacy endpoints to /projects/* paths
 * - Forces JSON for non-attachment writes to avoid 415s
 * - Auto-recovers from 415 (multipart sent to JSON endpoint) by retrying as JSON
 * - Fallback: if PATCH/PUT /contractors/me/ returns 405, retry as /contractors/{id}/
 */

const TOK = { access: "access", refresh: "refresh" };
const BASE_URL = "/api";

/* ---------------- Token helpers ---------------- */
export const getAccessToken = () => {
  try {
    return localStorage.getItem(TOK.access) || sessionStorage.getItem(TOK.access);
  } catch {
    return null;
  }
};
export const getRefreshToken = () => {
  try {
    return localStorage.getItem(TOK.refresh) || sessionStorage.getItem(TOK.refresh);
  } catch {
    return null;
  }
};

export const setTokens = (access, refresh, remember = true) => {
  try {
    const store = remember ? localStorage : sessionStorage;
    const other = remember ? sessionStorage : localStorage;

    if (access) store.setItem(TOK.access, access);
    if (refresh) store.setItem(TOK.refresh, refresh);

    // ensure only one storage holds tokens
    other.removeItem(TOK.access);
    other.removeItem(TOK.refresh);
  } catch { /* ignore */ }

  applyAuthHeader(access);
};

export const clearAuth = () => {
  try {
    localStorage.removeItem(TOK.access);
    localStorage.removeItem(TOK.refresh);
    sessionStorage.removeItem(TOK.access);
    sessionStorage.removeItem(TOK.refresh);
  } catch { /* ignore */ }
  applyAuthHeader(null);
};

/* --------------- Shared header applier --------------- */
function applyAuthHeader(token) {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
    axios.defaults.headers.common.Authorization = `Bearer ${token}`; // cover stray axios usage
  } else {
    delete api.defaults.headers.common.Authorization;
    delete axios.defaults.headers.common.Authorization;
  }
}

/* ----------------- Small type guards ----------------- */
const isFormData = (v) => typeof FormData !== "undefined" && v instanceof FormData;
const isBlob = (v) => typeof Blob !== "undefined" && v instanceof Blob;
const isURLSearchParams = (v) => typeof URLSearchParams !== "undefined" && v instanceof URLSearchParams;
const isPlainObject = (v) => v && typeof v === "object" && !Array.isArray(v) && !isFormData(v) && !isBlob(v) && !isURLSearchParams(v);

/* --------------- Legacy endpoint rewrite --------------- */
const LEGACY_PREFIX_MAP = [
  ["/homeowners", "/projects/homeowners"],
  ["/milestones", "/projects/milestones"],
  ["/contractors", "/projects/contractors"],
];

function rewriteLegacyUrl(url) {
  if (!url || typeof url !== "string") return url;
  for (const [oldPfx, newPfx] of LEGACY_PREFIX_MAP) {
    if (url === oldPfx || url.startsWith(oldPfx + "/") || url.startsWith(oldPfx + "?")) {
      return newPfx + url.slice(oldPfx.length);
    }
  }
  return url;
}

function isAttachmentRoute(url = "") {
  // Treat any .../attachments or .../attachments/ as "multipart ok"
  return /\/attachments\/?(\?|$)/.test(url);
}

/* --------------- Axios instance --------------- */
const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
});

/* -------- Ensure JSON for non-attachment writes -------- */
function normalizeForJson(config) {
  const method = (config.method || "get").toLowerCase();
  const wantsBody = /post|put|patch/.test(method);
  if (!wantsBody) return config;

  const url = config.url || "";
  const onAttachments = isAttachmentRoute(url);

  // Skip forcing JSON for attachment endpoints
  if (onAttachments) return config;

  // If the payload is NOT FormData/Blob/URLSearchParams, ensure JSON headers
  const body = config.data;
  if (!isFormData(body) && !isBlob(body) && !isURLSearchParams(body)) {
    config.headers = {
      ...(config.headers || {}),
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    // Axios will JSON.stringify plain objects automatically when content-type is application/json
  }
  return config;
}

/* -------- Convert FormData -> plain object (safe keys only) -------- */
function formDataToObject(fd) {
  const obj = {};
  fd.forEach((v, k) => {
    // Skip binary values when converting (JSON endpoints shouldn't get files)
    if (isBlob(v)) return;
    // For duplicate keys, last one wins (sufficient for our edit forms)
    obj[k] = v;
  });
  return obj;
}

function installInterceptors(instance) {
  // Request interceptor: attach token, rewrite legacy URLs, and enforce JSON when appropriate
  instance.interceptors.request.use((config) => {
    const token = getAccessToken();
    if (token) {
      config.headers = { ...(config.headers || {}), Authorization: `Bearer ${token}` };
    }

    if (config.url) {
      const isRelative = !/^https?:\/\//i.test(config.url);
      if (isRelative) config.url = rewriteLegacyUrl(config.url);
    }

    return normalizeForJson(config);
  });

  // Response interceptor: refresh-once for 401, 415 auto-recovery, 405 fallback for /contractors/me/
  let isRefreshing = false;
  let queue = [];

  const flush = (err, newToken) => {
    queue.forEach(({ resolve, reject }) => {
      if (err) reject(err);
      else resolve(newToken);
    });
    queue = [];
  };

  instance.interceptors.response.use(
    (res) => res,
    async (error) => {
      const original = error.config || {};

      /* ---------- 401 refresh-once ---------- */
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
        const refresh = getRefreshToken();
        if (!refresh) {
          isRefreshing = false;
          clearAuth();
          return Promise.reject(error);
        }

        const refreshEndpoints = ["/auth/refresh/", "/token/refresh/"];

        try {
          let data;
          for (let i = 0; i < refreshEndpoints.length; i++) {
            try {
              const resp = await instance.post(refreshEndpoints[i], { refresh });
              data = resp.data;
              break;
            } catch (e) {
              if (i === refreshEndpoints.length - 1) throw e;
            }
          }

          const newAccess = data?.access || data?.access_token;
          if (!newAccess) throw new Error("No access token returned on refresh.");

          const remember = !!localStorage.getItem(TOK.refresh);
          setTokens(newAccess, refresh, remember);

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

      /* ---------- 415 auto-recovery (multipart -> JSON) ---------- */
      if (
        error.response &&
        error.response.status === 415 &&
        original &&
        /post|put|patch/i.test(original.method || "") &&
        !isAttachmentRoute(original.url || "") &&
        isFormData(original.data) &&
        !original._retried_as_json
      ) {
        // Convert FormData (non-binary keys only) into a plain object and retry as JSON
        const jsonBody = formDataToObject(original.data);
        const retryConfig = {
          ...original,
          data: jsonBody,
          headers: {
            ...(original.headers || {}),
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          _retried_as_json: true,
        };
        return instance(retryConfig);
      }

      /* ---------- 405 fallback for /contractors/me/ update ---------- */
      if (
        error.response &&
        error.response.status === 405 &&
        original &&
        /\/contractors\/me\/?/.test(original.url || "") &&
        /patch|put/i.test(original.method || "")
      ) {
        try {
          // 1) load me to get id
          const meResp = await instance.get("/projects/contractors/me/");
          const id = meResp?.data?.id ?? meResp?.data?.pk;
          if (!id) throw new Error("Could not resolve contractor id from /contractors/me/");

          // 2) retry as /contractors/{id}/ with same payload
          const retryConfig = {
            ...original,
            url: (original.url || "").replace(/contractors\/me\/?/, `contractors/${id}/`),
            _retry: true, // avoid loops
          };
          return instance(retryConfig);
        } catch {
          // fall through to the original error if we still fail
        }
      }

      return Promise.reject(error);
    }
  );
}

// Install on both the instance and the global axios (defensive)
installInterceptors(api);
installInterceptors(axios);

// Set initial Authorization header if tokens exist
applyAuthHeader(getAccessToken() || null);

/* ----------------- Convenience helpers ----------------- */
/**
 * Upload a FormData body to a (probably) /attachments/ endpoint.
 * Do not set Content-Type manually; axios will include the boundary.
 * Example:
 *   const fd = new FormData();
 *   fd.append("agreement", agreementId);
 *   fd.append("title", "12-Month Workmanship Warranty");
 *   fd.append("file", file);
 *   await uploadMultipart(`/projects/agreements/${agreementId}/attachments/`, fd);
 */
export async function uploadMultipart(url, formData) {
  return api.post(url, formData); // headers set by browser; interceptor won't force JSON on attachments
}

export default api;
