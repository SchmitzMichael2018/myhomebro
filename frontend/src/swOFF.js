import { PWA_FLAGS } from "./lib/pwaFlags.js";
import { disablePwa } from "./lib/pwaLifecycle.js";

export function unregister() {
  if (PWA_FLAGS.enabled) return Promise.resolve();
  return disablePwa();
}
