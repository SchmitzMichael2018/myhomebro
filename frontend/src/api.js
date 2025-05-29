// src/api.js
import axios from "axios";

// --- Create an Axios instance that always uses “/api” ---
// In dev, Vite will proxy /api/* to your Django backend.
// In production, this will work with your deployed API.
const api = axios.create({
  baseURL: "/api",
});

// --- Refresh mutex & queue to prevent duplicate refreshes ---
let isRefreshing = false;
let refreshQueue = [];

// Helper: Retry queued requests with new token
function processQueue(newToken) {
  refreshQueue.forEach(cb => cb(newToken));
  refreshQueue = [];
}

// --- Attach the access token to every request ---
api.interceptors.request.use(cfg => {
  const token = localStorage.getItem("access");
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

// --- On 401, try to refresh ONCE, then auto-logout ---
api.interceptors.response.use(
  resp => resp,
  async err => {
    const original = err.config;
    if (err.response?.status === 401 && !original._retry) {
      original._retry = true;

      if (isRefreshing) {
        // Wait for the in-flight refresh to finish
        return new Promise(resolve => {
          refreshQueue.push(newToken => {
            original.headers.Authorization = `Bearer ${newToken}`;
            resolve(api(original));
          });
        });
      }

      isRefreshing = true;
      const refreshToken = localStorage.getItem("refresh");
      if (refreshToken) {
        try {
          // Use plain axios to avoid infinite loop
          const { data } = await axios.post("/api/auth/refresh/", {
            refresh: refreshToken,
          });
          const newAccess = data.access;
          localStorage.setItem("access", newAccess);
          api.defaults.headers.common.Authorization = `Bearer ${newAccess}`;

          processQueue(newAccess);
          original.headers.Authorization = `Bearer ${newAccess}`;
          return api(original);
        } catch (refreshErr) {
          clearSession("Session expired. Please sign in again.");
          return Promise.reject(refreshErr);
        } finally {
          isRefreshing = false;
        }
      } else {
        clearSession("Session expired. Please sign in again.");
      }
    }
    return Promise.reject(err);
  }
);

// --- Logout helper: Remove tokens and redirect to signin ---
export function clearSession(message = "Please sign in again.") {
  localStorage.removeItem("access");
  localStorage.removeItem("refresh");
  if (message) alert(message);
  window.location.href = "/signin";
}

export default api;












