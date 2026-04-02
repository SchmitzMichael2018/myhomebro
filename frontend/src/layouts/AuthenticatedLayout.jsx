// src/layouts/AuthenticatedLayout.jsx
// v2026-02-17d — Mobile fix:
// - Floating hamburger is now a fallback and auto-hides when PageShell registers its own hamburger

import React, { useEffect, useRef } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "../components/Sidebar.jsx";
import ErrorBoundary from "../components/ErrorBoundary.jsx";
import MobileSidebarShell from "../components/MobileSidebarShell.jsx";
import { AssistantDockProvider } from "../components/AssistantDock.jsx";

const AUTH_LAYOUT_DEBUG_PREFIX = "[AuthenticatedLayoutDebug]";
let authenticatedLayoutInstanceSeq = 0;

export default function AuthenticatedLayout() {
  const instanceIdRef = useRef(++authenticatedLayoutInstanceSeq);
  const instanceId = instanceIdRef.current;
  const location = useLocation();
  const isDashboardRoute = /\/dashboard\/?$/.test(location.pathname || "");

  console.log(`${AUTH_LAYOUT_DEBUG_PREFIX} render`, {
    instanceId,
    path: location.pathname,
  });

  useEffect(() => {
    console.log(`${AUTH_LAYOUT_DEBUG_PREFIX} mount`, {
      instanceId,
      path: location.pathname,
    });
    return () => {
      console.log(`${AUTH_LAYOUT_DEBUG_PREFIX} unmount`, {
        instanceId,
        path: location.pathname,
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <MobileSidebarShell sidebar={<Sidebar variant="plain" />}>
      <AssistantDockProvider>
        <div style={{ display: "flex", minHeight: isDashboardRoute ? "auto" : "100vh" }}>
          <Sidebar />
          <main
            className="mhb-gradient-bg"
            style={{
              flex: 1,
              minHeight: isDashboardRoute ? "auto" : "100vh",
              display: "flex",
              flexDirection: "column",
              minWidth: 0,
            }}
          >
            <div style={{ flex: 1, overflow: isDashboardRoute ? "visible" : "auto", minHeight: 0 }}>
              <div className="mhb-content-pad">
                <ErrorBoundary>
                  <Outlet />
                </ErrorBoundary>
              </div>
            </div>
          </main>
        </div>
      </AssistantDockProvider>
    </MobileSidebarShell>
  );
}
