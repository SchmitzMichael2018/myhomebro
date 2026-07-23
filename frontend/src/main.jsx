// src/main.jsx — load endpoint shim BEFORE anything else
import "./utils/globalEndpointShim";   // 👈 MUST be first so it patches fetch/XHR

import "./styles/design-tokens.css";   // Shared semantic design-system tokens
import "./index.css";                  // Tailwind / your global styles
// ⚠️ removed: import "./styles/mobile.css";

import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import {
  applyAppearanceToDocument,
  DARK_MEDIA_QUERY,
  readStoredAppearance,
  resolveAppearance,
} from "./context/AppearanceContext.jsx";

// Apply the authenticated operational appearance before React renders to avoid
// flashing the light theme while routes and profile data initialize.
if (window.location.pathname.startsWith("/app")) {
  const initialAppearance = readStoredAppearance();
  const systemDark = window.matchMedia?.(DARK_MEDIA_QUERY)?.matches ?? false;
  applyAppearanceToDocument(initialAppearance, resolveAppearance(initialAppearance, systemDark));
}

// Ensure there is a mount node. If #root doesn't exist, create it.
const mount =
  document.getElementById("root") ||
  (() => {
    const el = document.createElement("div");
    el.id = "root";
    document.body.appendChild(el);
    return el;
  })();

// Temporary visual cue so we can confirm DOM updates
if (!mount.firstChild) {
  const boot = document.createElement("div");
  boot.textContent = "Booting…";
  boot.style.cssText = "padding:16px;font:14px/1.4 system-ui, sans-serif;color:#334155";
  mount.appendChild(boot);
}

// Render the app (replaces the Booting… div)
createRoot(mount).render(<App />);
