// src/components/MobileSidebarShell.jsx
// v2026-02-17d — Mobile Phase 2.1 fix:
// - Always allow a floating hamburger fallback (so pages without PageShell can open the sidebar)
// - PageShell registers that it has its own hamburger; the shell auto-hides the floating one to prevent duplicates

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

const MobileSidebarContext = createContext({
  isOpen: false,
  openSidebar: () => {},
  closeSidebar: () => {},
  toggleSidebar: () => {},
  registerHeaderHamburger: () => {},
  unregisterHeaderHamburger: () => {},
  headerHamburgerPresent: false,
});

export function useMobileSidebar() {
  return useContext(MobileSidebarContext);
}

/**
 * MobileSidebarShell
 *
 * - Desktop: renders children only (no interference). Your existing desktop Sidebar remains unchanged.
 * - Mobile: overlay sidebar + backdrop
 * - Auto-closes on route change
 * - Auto-closes on sidebar link click (event delegation)
 * - Body scroll lock while open
 *
 * Props:
 *   sidebar: ReactNode (your <Sidebar variant="plain" />)
 *   children: ReactNode (your existing layout tree)
 */
export default function MobileSidebarShell({ sidebar, children }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const mobilePanelRef = useRef(null);

  // Tracks whether the current page header provides its own hamburger (PageShell does).
  const [headerHamburgerPresent, setHeaderHamburgerPresent] = useState(false);

  const ctx = useMemo(
    () => ({
      isOpen: open,
      openSidebar: () => setOpen(true),
      closeSidebar: () => setOpen(false),
      toggleSidebar: () => setOpen((v) => !v),
      registerHeaderHamburger: () => setHeaderHamburgerPresent(true),
      unregisterHeaderHamburger: () => setHeaderHamburgerPresent(false),
      headerHamburgerPresent,
    }),
    [open, headerHamburgerPresent]
  );

  // Close on route change
  useEffect(() => {
    setOpen(false);
    // Reset header hamburger flag on navigation; PageShell will re-register if present.
    setHeaderHamburgerPresent(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search, location.hash]);

  // Close when clicking a nav element inside the mobile sidebar
  useEffect(() => {
    const el = mobilePanelRef.current;
    if (!el) return;

    const onClick = (e) => {
      const target = e.target;
      const closeHit =
        target?.closest?.("a") ||
        target?.closest?.("button") ||
        target?.closest?.('[role="menuitem"]') ||
        target?.closest?.("[data-close-sidebar]");

      if (closeHit) setOpen(false);
    };

    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [open]);

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <MobileSidebarContext.Provider value={ctx}>
      <div className="min-h-screen bg-slate-50">
        {/* ✅ Floating hamburger fallback (mobile only, only if header did NOT register one) */}
        {!headerHamburgerPresent ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            className="fixed top-4 left-4 z-50 inline-flex items-center justify-center rounded-lg bg-white/90 backdrop-blur px-3 py-2 shadow border border-slate-200 active:scale-[0.99] md:hidden"
          >
            <span className="text-xl leading-none">☰</span>
          </button>
        ) : null}

        {/* Render app content exactly once */}
        {children}

        {/* Mobile overlay */}
        {open && (
          <div className="fixed inset-0 z-40 md:hidden">
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/40"
              onClick={() => setOpen(false)}
            />

            {/* Slide-in panel */}
            <div
              ref={mobilePanelRef}
              className="absolute left-0 top-0 h-full w-[84vw] max-w-[340px] bg-white shadow-xl border-r border-slate-200"
              role="dialog"
              aria-modal="true"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
                <div className="text-sm font-semibold text-slate-700">Menu</div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close menu"
                  className="rounded-md px-2 py-1 text-slate-600 hover:bg-slate-100"
                >
                  ✕
                </button>
              </div>

              {/* Body */}
              <div className="h-[calc(100%-49px)] overflow-y-auto">
                {sidebar}
              </div>
            </div>
          </div>
        )}
      </div>
    </MobileSidebarContext.Provider>
  );
}
