// frontend/src/utils/globalEndpointShim.js
// v2025-10-13 — global endpoint shim for fetch + XHR (same-origin)
// Rewrites /api/projects/customers and /api/customers → /api/homeowners.

(function () {
  if (typeof window === "undefined") return;

  const ORIGIN = window.location.origin;

  // Show a one-time boot log so we can confirm it loaded
  if (!window.__MYHOMEBRO_SHIM_BOOT__) {
    // eslint-disable-next-line no-console
    console.log("globalEndpointShim boot");
    window.__MYHOMEBRO_SHIM_BOOT__ = true;
  }

  const MAP = [
    ["/api/projects/customers", "/api/homeowners"],
    ["/api/customers", "/api/homeowners"],
  ];

  const rewrite = (url) => {
    try {
      const u = new URL(url, ORIGIN);
      if (u.origin !== ORIGIN) return url; // only same-origin
      let path = u.pathname + u.search + u.hash;
      for (const [from, to] of MAP) {
        if (path === from || path.startsWith(from + "/") || path.startsWith(from + "?")) {
          const replaced = path.replace(from, to);
          const finalUrl = u.origin + replaced;
          if (process?.env?.NODE_ENV !== "production") {
            // eslint-disable-next-line no-console
            console.log(`[global-shim] ${from} → ${to} :: ${path} → ${replaced}`);
          }
          return finalUrl;
        }
      }
      return url;
    } catch {
      // simple fallback for already-relative strings
      let out = String(url || "");
      for (const [from, to] of MAP) {
        if (out === from || out.startsWith(from + "/") || out.startsWith(from + "?")) {
          out = out.replace(from, to);
          if (process?.env?.NODE_ENV !== "production") {
            // eslint-disable-next-line no-console
            console.log(`[global-shim-fallback] ${from} → ${to} :: ${url} → ${out}`);
          }
          return out;
        }
      }
      return url;
    }
  };

  // Patch fetch
  if (typeof window.fetch === "function" && !window.__MYHOMEBRO_FETCH_SHIM__) {
    const origFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      try {
        if (typeof input === "string") input = rewrite(input);
        else if (input && typeof input.url === "string") {
          const RequestCtor = input.constructor || Request;
          const newUrl = rewrite(input.url);
          if (newUrl !== input.url) input = new RequestCtor(newUrl, input);
        }
      } catch {}
      return origFetch(input, init);
    };
    window.__MYHOMEBRO_FETCH_SHIM__ = true;
  }

  // Patch XHR
  if (window.XMLHttpRequest && !window.__MYHOMEBRO_XHR_SHIM__) {
    const OrigOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, async, user, password) {
      try { url = rewrite(url); } catch {}
      return OrigOpen.call(this, method, url, async, user, password);
    };
    window.__MYHOMEBRO_XHR_SHIM__ = true;
  }
})();
