import { registerSW } from "virtual:pwa-register";

export const PWA_CACHE_PREFIX = "myhomebro-";
export const PWA_VERSION = String(import.meta.env.VITE_APP_VERSION || "dev");

export async function clearPwaCaches({ includeStatic = false } = {}) {
  if (!globalThis.caches?.keys) return [];
  const keys = await caches.keys();
  const targets = keys.filter((key) => (
    key.startsWith(PWA_CACHE_PREFIX)
    || key.startsWith("workbox-")
    || (includeStatic && /precache|runtime/i.test(key))
  ));
  await Promise.all(targets.map((key) => caches.delete(key)));
  return targets;
}

export async function disablePwa() {
  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  }
  await clearPwaCaches({ includeStatic: true });
}

export function registerPwa(callbacks = {}) {
  return registerSW({
    immediate: true,
    onNeedRefresh: callbacks.onNeedRefresh,
    onOfflineReady: callbacks.onOfflineReady,
    onRegisteredSW: callbacks.onRegistered,
    onRegisterError: callbacks.onRegisterError,
  });
}

export function isStandalonePwa() {
  return Boolean(
    window.matchMedia?.("(display-mode: standalone)")?.matches
    || window.navigator.standalone
  );
}

