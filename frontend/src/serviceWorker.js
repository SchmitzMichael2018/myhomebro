// Backward-compatible PWA lifecycle facade.
// New code uses pwaLifecycle directly; legacy callers remain safe during rollout.
import { PWA_FLAGS } from "./lib/pwaFlags.js";
import { disablePwa, registerPwa } from "./lib/pwaLifecycle.js";

export function register(callbacks) {
  if (!PWA_FLAGS.enabled) return null;
  return registerPwa(callbacks);
}

export function unregister() {
  if (PWA_FLAGS.enabled) return Promise.resolve();
  return disablePwa();
}
