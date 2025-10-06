// src/main.jsx
import "./index.css";           // Tailwind / your global styles
// ⚠️ removed: import "./styles/mobile.css";

import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

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
