// src/serviceWorker.js
// Always unregister – prevents SW retry loops & stale caches
export function register() {}

export function unregister() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.getRegistrations()
      .then((regs) => regs.forEach((r) => r.unregister()))
      .catch(() => {});

    // optional but helpful: clear any old runtime caches
    if (window.caches?.keys) {
      caches.keys()
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .catch(() => {});
    }
  }
}
