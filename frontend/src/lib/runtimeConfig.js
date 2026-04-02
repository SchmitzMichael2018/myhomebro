const DEFAULT_LOCAL_BACKEND_ORIGIN = "http://127.0.0.1:8000";

function normalizeOrigin(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.replace(/\/+$/, "");
}

function normalizeApiBase(value) {
  const origin = normalizeOrigin(value);
  if (!origin) return "";
  return origin.endsWith("/api") ? origin : `${origin}/api`;
}

export function getApiBaseUrl() {
  const configured =
    import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_BACKEND_BASE_URL || "";

  if (configured) {
    return normalizeApiBase(configured);
  }

  if (import.meta.env.DEV) {
    return `${DEFAULT_LOCAL_BACKEND_ORIGIN}/api`;
  }

  return "/api";
}

export function getStripePublishableKey() {
  return String(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || "").trim();
}
