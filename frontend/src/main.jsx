// src/main.jsx
import "./index.css";               // ✅ this pulls Tailwind into the bundle
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

const mount = document.getElementById("root") || (() => {
  const el = document.createElement("div");
  el.id = "root";
  document.body.appendChild(el);
  return el;
})();

createRoot(mount).render(<App />);
