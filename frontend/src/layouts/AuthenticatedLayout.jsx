// src/layouts/AuthenticatedLayout.jsx
// v2026-02-17d — Mobile fix:
// - Floating hamburger is now a fallback and auto-hides when PageShell registers its own hamburger

import React, { useEffect, useRef } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "../components/Sidebar.jsx";
import ErrorBoundary from "../components/ErrorBoundary.jsx";
import MobileSidebarShell from "../components/MobileSidebarShell.jsx";
import { AssistantDockProvider } from "../components/AssistantDock.jsx";
import NotificationBell from "../components/NotificationBell.jsx";

const AUTH_LAYOUT_DEBUG_PREFIX = "[AuthenticatedLayoutDebug]";
let authenticatedLayoutInstanceSeq = 0;

export default function AuthenticatedLayout() {
  const instanceIdRef = useRef(++authenticatedLayoutInstanceSeq);
  const instanceId = instanceIdRef.current;
  const location = useLocation();

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
        <div className="pointer-events-none fixed right-4 top-4 z-40">
          <div className="pointer-events-auto">
            <NotificationBell />
          </div>
        </div>
        <div className="flex h-screen w-full overflow-hidden">
          <Sidebar />
          <main
            className="mhb-gradient-bg"
            style={{
              flex: 1,
              height: "100vh",
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              minWidth: 0,
              overflowY: "auto",
              overflowX: "hidden",
            }}
          >
            <div style={{ flex: 1, minHeight: 0 }}>
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
