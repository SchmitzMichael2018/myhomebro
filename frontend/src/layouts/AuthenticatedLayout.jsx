// src/layouts/AuthenticatedLayout.jsx
// v2026-02-17d — Mobile fix:
// - Floating hamburger is now a fallback and auto-hides when PageShell registers its own hamburger

import React, { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "../components/Sidebar.jsx";
import ErrorBoundary from "../components/ErrorBoundary.jsx";
import MobileSidebarShell from "../components/MobileSidebarShell.jsx";
import { AssistantDockProvider, GlobalCopilotTrigger } from "../components/AssistantDock.jsx";
import NotificationBell from "../components/NotificationBell.jsx";
import AppearanceMenu from "../components/AppearanceMenu.jsx";
import OperationalBackground from "../components/OperationalBackground.jsx";
import { AppearanceProvider } from "../context/AppearanceContext.jsx";

export default function AuthenticatedLayout() {
  const location = useLocation();
  const isMarketing = location.pathname.startsWith("/app/marketing");

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.mhbSurface = isMarketing ? "curated-light" : "operational";
    return () => {
      delete root.dataset.mhbSurface;
    };
  }, [isMarketing]);

  return (
    <AppearanceProvider>
      <div
        data-mhb-surface={isMarketing ? "curated-light" : "operational"}
        className="mhb-authenticated-root"
      >
        {!isMarketing ? <OperationalBackground /> : null}
        <div className="mhb-authenticated-content">
          <MobileSidebarShell sidebar={<Sidebar variant="plain" />}>
            <AssistantDockProvider>
              <div className="pointer-events-none fixed right-4 top-4 z-40">
                <div className="pointer-events-auto flex items-center gap-2">
                  <GlobalCopilotTrigger />
                  <AppearanceMenu />
                  <NotificationBell />
                </div>
              </div>
              <div className="flex h-screen w-full overflow-hidden">
                <Sidebar />
                <main
                  className="mhb-gradient-bg mhb-authenticated-main"
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
        </div>
      </div>
    </AppearanceProvider>
  );
}
