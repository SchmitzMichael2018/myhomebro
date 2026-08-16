// src/layouts/AuthenticatedLayout.jsx
// v2026-02-17d — Mobile fix:
// - Floating hamburger is now a fallback and auto-hides when PageShell registers its own hamburger

import React, { Suspense, useEffect } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import Sidebar from "../components/Sidebar.jsx";
import ErrorBoundary from "../components/ErrorBoundary.jsx";
import MobileSidebarShell from "../components/MobileSidebarShell.jsx";
import { AssistantDockProvider, GlobalCopilotTrigger } from "../components/AssistantDock.jsx";
import NotificationBell from "../components/NotificationBell.jsx";
import AppearanceMenu from "../components/AppearanceMenu.jsx";
import OperationalBackground from "../components/OperationalBackground.jsx";
import RouteLoadingFallback from "../components/RouteLoadingFallback.jsx";
import { AppearanceProvider } from "../context/AppearanceContext.jsx";
import CaptureLauncher from "../components/capture/CaptureLauncher.jsx";
import { isCaptureInboxEnabled } from "../lib/captureFlags.js";

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
              <header
                className="pointer-events-none fixed z-40"
                style={{
                  right: "max(1rem, env(safe-area-inset-right, 0px))",
                  top: "max(1rem, env(safe-area-inset-top, 0px))",
                }}
                aria-label="Application actions"
                data-testid="global-header-actions"
              >
                <div className="pointer-events-auto flex items-center gap-2">
                  {isCaptureInboxEnabled() ? <CaptureLauncher /> : null}
                  <GlobalCopilotTrigger />
                  <AppearanceMenu />
                  <NotificationBell />
                </div>
              </header>
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
                      {location.state?.fromGuidedHelp ? (
                        <Link
                          to="/app/guided-onboarding"
                          className="guided-hub__return-link"
                          aria-label="Back to Guided Help"
                        >
                          <ArrowLeft aria-hidden="true" size={17} />
                          Back to Guided Help
                        </Link>
                      ) : null}
                      <ErrorBoundary>
                        <Suspense fallback={<RouteLoadingFallback operational />}>
                          <Outlet />
                        </Suspense>
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
