// src/layouts/AuthenticatedLayout.jsx
// v2026-02-17d — Mobile fix:
// - Floating hamburger is now a fallback and auto-hides when PageShell registers its own hamburger

import React from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "../components/Sidebar.jsx";
import ErrorBoundary from "../components/ErrorBoundary.jsx";
import MobileSidebarShell from "../components/MobileSidebarShell.jsx";

export default function AuthenticatedLayout() {
  return (
    <MobileSidebarShell sidebar={<Sidebar variant="plain" />}>
      <div style={{ display: "flex", minHeight: "100vh" }}>
        <Sidebar />
        <main
          className="mhb-gradient-bg"
          style={{
            flex: 1,
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
          }}
        >
          <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
            <div className="mhb-content-pad">
              <ErrorBoundary>
                <Outlet />
              </ErrorBoundary>
            </div>
          </div>
        </main>
      </div>
    </MobileSidebarShell>
  );
}
