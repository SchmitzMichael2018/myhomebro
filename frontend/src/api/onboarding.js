// ~/backend/frontend/src/api/onboarding.js
// v2025-10-17 stripe-onboarding-shim — calls the *payments* endpoints

import axios from "axios";

/**
 * We use a local axios instance so we don't disturb your main api.js.
 * If your app sets auth headers globally, you can copy that logic here
 * or rely on browser-stored tokens as needed.
 */
const api = axios.create({
  baseURL: "/api",
  withCredentials: false,
});

// Optional: Attach Authorization header from localStorage if you use JWT "Bearer <token>"
api.interceptors.request.use((config) => {
  try {
    const raw = localStorage.getItem("auth");
    if (raw) {
      const { access } = JSON.parse(raw);
      if (access) config.headers.Authorization = `Bearer ${access}`;
    }
  } catch {}
  return config;
});

// ---- Stripe Onboarding endpoints (backend: payments app) ----

export async function getOnboardingStatus() {
  // Backend: /api/payments/onboarding/status/
  const { data } = await api.get("/payments/onboarding/status/");
  return data; // e.g. { is_onboarded: boolean, link: null|string, account_id: string|null }
}

export async function startOnboarding() {
  // Backend: /api/payments/onboarding/start/
  const { data } = await api.post("/payments/onboarding/start/");
  return data; // e.g. { url: "https://connect.stripe.com/..." }
}
