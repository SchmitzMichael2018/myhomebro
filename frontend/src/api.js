// src/api.js
import axios from "axios";

/**
 * Central axios setup:
 * - Base URL: /api
 * - Attaches Authorization on every request (both instance AND global axios)
 * - Refreshes access token once on 401 and retries
 * - Rewrites a couple legacy endpoints to the new /projects/* paths
 */

const TOK = { access: "access", refresh: "refresh" };
const BASE_URL = "/api";

// --- Token helpers ---
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
    // prevent drift between storages
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

// Apply header to both our instance AND global axios default
function applyAuthHeader(token) {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
    axios.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common.Authorization;
    delete axios.defaults.headers.common.Authorization;
  }
}

// Map legacy endpoints → new ones (front-end shim)
const LEGACY_PREFIX_MAP = [
  // [oldPrefix, newPrefix]
  ["/homeowners", "/projects/homeowners"],
  ["/milestones", "/projects/milestones"],
];

// Rewriter for config.url like "/homeowners?page=1" → "/projects/homeowners?page=1"
function rewriteLegacyUrl(url) {
  if (!url || typeof url !== "string") return url;
  for (const [oldPfx, newPfx] of LEGACY_PREFIX_MAP) {
    if (url === oldPfx || url.startsWith(oldPfx + "/") || url.startsWith(oldPfx + "?")) {
      return newPfx + url.slice(oldPfx.length);
    }
  }
  return url;
}

// Build an axios instance
const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
});

// One set of interceptors, installed onto ANY axios instance we pass in
function installInterceptors(instance) {
  // Attach token + rewrite legacy paths
  instance.interceptors.request.use((config) => {
    // Always ensure Authorization is present from storage
    const token = getAccessToken();
    if (token) config.headers = { ...(config.headers || {}), Authorization: `Bearer ${token}` };

    // Rewrite legacy paths
    if (config.url) {
      // only rewrite path part, not full URLs to 3rd-party
      const isRelative = !/^https?:\/\//i.test(config.url);
      if (isRelative) config.url = rewriteLegacyUrl(config.url);
    }
    return config;
  });

  // Refresh-once on 401
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
      const original = error.config;
      if (!error.response || error.response.status !== 401 || original?._retry) {
        return Promise.reject(error);
      }

      original._retry = true;

      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          queue.push({
            resolve: (token) => {
              if (token) original.headers.Authorization = `Bearer ${token}`;
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

      // Most backends expose one of these (yours has /auth/refresh/)
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

        // persist in same storage type (remember vs session) by checking where refresh lives
        const remember = !!localStorage.getItem(TOK.refresh);
        setTokens(newAccess, refresh, remember);

        flush(null, newAccess);
        original.headers.Authorization = `Bearer ${newAccess}`;
        return instance(original);
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

// Install on our instance AND the global axios default (covers stray axios usages)
installInterceptors(api);
installInterceptors(axios);

// Ensure headers are set on load if tokens already exist (e.g., after refresh)
applyAuthHeader(getAccessToken() || null);

export default api;
