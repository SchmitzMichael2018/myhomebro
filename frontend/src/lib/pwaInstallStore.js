import { useSyncExternalStore } from "react";

import { PWA_FLAGS } from "./pwaFlags.js";
import { isStandalonePwa } from "./pwaLifecycle.js";

export const PWA_INSTALL_DISMISS_KEY = "mhb.pwa.install-dismissed.v1";
export const PWA_INSTALL_DISMISS_MS = 14 * 24 * 60 * 60 * 1000;

function detectPlatform() {
  if (typeof navigator === "undefined") {
    return { ios: false, browser: "unknown" };
  }
  const agent = navigator.userAgent || "";
  const ipadDesktop = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  const ios = /iphone|ipad|ipod/i.test(agent) || ipadDesktop;
  if (ios) return { ios: true, browser: /crios/i.test(agent) ? "ios_chrome" : "ios_safari" };
  if (/edg\//i.test(agent)) return { ios: false, browser: "edge" };
  if (/android/i.test(agent) && /chrome|crios/i.test(agent)) {
    return { ios: false, browser: "android_chromium" };
  }
  if (/chrome|chromium/i.test(agent)) return { ios: false, browser: "chromium" };
  if (/firefox/i.test(agent)) return { ios: false, browser: "firefox" };
  if (/safari/i.test(agent)) return { ios: false, browser: "safari" };
  return { ios: false, browser: "unknown" };
}

const platform = detectPlatform();
const listeners = new Set();
let installEvent = null;
let promptInFlight = false;
let cachedState = null;
let cachedSnapshot = null;

let state = {
  enabled: PWA_FLAGS.enabled,
  serviceWorkerSupported: typeof navigator !== "undefined" && "serviceWorker" in navigator,
  serviceWorkerRegistered: false,
  manifestAvailable: null,
  promptAvailable: false,
  standalone: typeof window !== "undefined" ? isStandalonePwa() : false,
  appInstalled: false,
  ios: platform.ios,
  browser: platform.browser,
  registrationFailed: false,
  dialogOpen: false,
  explicitAction: false,
  promptOutcome: null,
  passiveDismissed: false,
};

function emit() {
  for (const listener of listeners) listener();
}

function update(patch) {
  state = { ...state, ...patch };
  emit();
}

export function trackPwaInstallEvent(name) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("mhb:analytics", {
      detail: { event: name, category: "pwa_install" },
    })
  );
}

export function classifyPwaInstallState(snapshot = state) {
  if (!snapshot.enabled) return "disabled";
  if (snapshot.standalone || snapshot.appInstalled) return "installed";
  // Browser-provided installability and iOS's manual flow are authoritative
  // even while the asynchronous registration diagnostic is still settling.
  if (snapshot.promptAvailable) return "native_prompt";
  if (snapshot.ios) return "ios_instructions";
  if (
    !snapshot.serviceWorkerSupported
    || snapshot.registrationFailed
    || snapshot.manifestAvailable === false
    || (snapshot.manifestAvailable === true && !snapshot.serviceWorkerRegistered)
  ) {
    return snapshot.serviceWorkerSupported ? "temporarily_unavailable" : "unsupported";
  }
  if (snapshot.browser === "firefox" || snapshot.browser === "safari") return "unsupported";
  return "manual_instructions";
}

export function getPwaInstallSnapshot() {
  if (cachedState === state && cachedSnapshot?.promptInFlight === promptInFlight) {
    return cachedSnapshot;
  }
  cachedState = state;
  cachedSnapshot = { ...state, classification: classifyPwaInstallState(state), promptInFlight };
  return cachedSnapshot;
}

export function subscribePwaInstall(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePwaInstall() {
  return useSyncExternalStore(subscribePwaInstall, getPwaInstallSnapshot, getPwaInstallSnapshot);
}

export function openPwaInstallDialog({ explicit = true } = {}) {
  if (!state.enabled) return;
  update({ dialogOpen: true, explicitAction: explicit });
  trackPwaInstallEvent(explicit ? "install_cta_clicked" : "install_cta_viewed");
}

export function closePwaInstallDialog() {
  update({ dialogOpen: false, explicitAction: false });
}

export function dismissPassivePwaInstall() {
  localStorage.setItem(PWA_INSTALL_DISMISS_KEY, String(Date.now()));
  update({ passiveDismissed: true });
}

export function passivePwaInstallAllowed() {
  if (state.passiveDismissed) return false;
  const dismissedAt = Number(localStorage.getItem(PWA_INSTALL_DISMISS_KEY) || 0);
  return !dismissedAt || Date.now() - dismissedAt >= PWA_INSTALL_DISMISS_MS;
}

export function markPwaRegistration({ registered = false, failed = false } = {}) {
  update({ serviceWorkerRegistered: registered, registrationFailed: failed });
  if (failed) trackPwaInstallEvent("install_unavailable");
}

export async function retryPwaInstallAvailability() {
  if (!state.enabled) return getPwaInstallSnapshot();
  let manifestAvailable = false;
  try {
    const response = await fetch("/manifest.webmanifest", {
      cache: "no-store",
      credentials: "same-origin",
    });
    manifestAvailable = response.ok
      && (response.headers.get("content-type") || "").includes("application/manifest+json");
  } catch {
    manifestAvailable = false;
  }
  let serviceWorkerRegistered = false;
  if (state.serviceWorkerSupported) {
    try {
      serviceWorkerRegistered = Boolean(await navigator.serviceWorker.getRegistration("/"));
    } catch {
      serviceWorkerRegistered = false;
    }
  }
  update({ manifestAvailable, serviceWorkerRegistered });
  if (!manifestAvailable) trackPwaInstallEvent("install_unavailable");
  return getPwaInstallSnapshot();
}

export async function invokePwaInstallPrompt() {
  if (!installEvent || promptInFlight) return { outcome: "unavailable" };
  promptInFlight = true;
  emit();
  try {
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    const outcome = choice?.outcome === "accepted" ? "accepted" : "dismissed";
    trackPwaInstallEvent(
      outcome === "accepted" ? "native_prompt_accepted" : "native_prompt_dismissed"
    );
    installEvent = null;
    update({ promptAvailable: false, promptOutcome: outcome, dialogOpen: false });
    return { outcome };
  } finally {
    promptInFlight = false;
    emit();
  }
}

export function setPwaInstallStateForTest(patch = {}, event = undefined) {
  if (event !== undefined) installEvent = event;
  update(patch);
}

if (typeof window !== "undefined") {
  const dismissedAt = Number(localStorage.getItem(PWA_INSTALL_DISMISS_KEY) || 0);
  state.passiveDismissed = Boolean(
    dismissedAt && Date.now() - dismissedAt < PWA_INSTALL_DISMISS_MS
  );
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installEvent = event;
    update({ promptAvailable: true });
    trackPwaInstallEvent("native_prompt_available");
  });
  window.addEventListener("appinstalled", () => {
    installEvent = null;
    update({
      appInstalled: true,
      standalone: true,
      promptAvailable: false,
      dialogOpen: false,
    });
    trackPwaInstallEvent("app_installed");
  });
  if (state.standalone) trackPwaInstallEvent("standalone_detected");
  if (state.enabled) queueMicrotask(() => retryPwaInstallAvailability());
}
