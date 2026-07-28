// src/components/MobileSidebarShell.jsx
// v2026-02-17d — Mobile Phase 2.1 fix:
// - Always allow a floating hamburger fallback (so pages without PageShell can open the sidebar)
// - PageShell registers that it has its own hamburger; the shell auto-hides the floating one to prevent duplicates

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

const MOBILE_SIDEBAR_DEBUG_PREFIX = "[MobileSidebarShellDebug]";
let mobileSidebarShellInstanceSeq = 0;

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
  const instanceIdRef = useRef(++mobileSidebarShellInstanceSeq);
  const instanceId = instanceIdRef.current;
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const mobilePanelRef = useRef(null);
  const lastTriggerRef = useRef(null);
  const wasOpenRef = useRef(false);

  console.log(`${MOBILE_SIDEBAR_DEBUG_PREFIX} render`, {
    instanceId,
    path: location.pathname,
    open,
  });

  useEffect(() => {
    console.log(`${MOBILE_SIDEBAR_DEBUG_PREFIX} mount`, {
      instanceId,
      path: location.pathname,
    });
    return () => {
      console.log(`${MOBILE_SIDEBAR_DEBUG_PREFIX} unmount`, {
        instanceId,
        path: location.pathname,
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tracks whether the current page header provides its own hamburger (PageShell does).
  const [headerHamburgerPresent, setHeaderHamburgerPresent] = useState(false);
  const openSidebar = useCallback(() => {
    lastTriggerRef.current = document.activeElement;
    setOpen(true);
  }, []);
  const closeSidebar = useCallback(() => setOpen(false), []);
  const toggleSidebar = useCallback(() => {
    if (!open) lastTriggerRef.current = document.activeElement;
    setOpen((value) => !value);
  }, [open]);
  const registerHeaderHamburger = useCallback(() => setHeaderHamburgerPresent(true), []);
  const unregisterHeaderHamburger = useCallback(() => setHeaderHamburgerPresent(false), []);

  const ctx = useMemo(
    () => ({
      isOpen: open,
      openSidebar,
      closeSidebar,
      toggleSidebar,
      registerHeaderHamburger,
      unregisterHeaderHamburger,
      headerHamburgerPresent,
    }),
    [closeSidebar, headerHamburgerPresent, open, openSidebar, registerHeaderHamburger, toggleSidebar, unregisterHeaderHamburger]
  );

  // Close on route change
  useEffect(() => {
    setOpen(false);
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

  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      window.requestAnimationFrame(() => mobilePanelRef.current?.focus());
      return;
    }
    if (wasOpenRef.current) {
      wasOpenRef.current = false;
      window.requestAnimationFrame(() => lastTriggerRef.current?.focus?.());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <MobileSidebarContext.Provider value={ctx}>
      <div className="mhb-mobile-sidebar-shell min-h-screen bg-slate-50">
        {/* ✅ Floating hamburger fallback (mobile only, only if header did NOT register one) */}
        {!headerHamburgerPresent ? (
          <button
            type="button"
            onClick={openSidebar}
            aria-label="Open navigation menu"
            aria-expanded={open}
            aria-controls="authenticated-mobile-navigation"
            data-testid="authenticated-mobile-menu-button"
            className="fixed left-4 top-[calc(1rem+env(safe-area-inset-top))] z-50 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white/95 text-slate-800 shadow backdrop-blur active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 md:hidden"
          >
            <span className="text-xl leading-none">☰</span>
          </button>
        ) : null}

        {/* Render app content exactly once */}
        {children}

        {/* Mobile overlay */}
        {open && (
          <div className="fixed inset-0 z-[60] md:hidden">
            {/* Backdrop */}
            <button
              type="button"
              aria-label="Close navigation"
              className="absolute inset-0 bg-black/40"
              onClick={() => setOpen(false)}
            />

            {/* Slide-in panel */}
            <div
              ref={mobilePanelRef}
              id="authenticated-mobile-navigation"
              tabIndex={-1}
              data-testid="authenticated-mobile-navigation-drawer"
              className="mhb-mobile-sidebar-drawer absolute bottom-0 left-0 top-0 flex w-[min(86vw,360px)] max-w-[calc(100vw-env(safe-area-inset-right)-1rem)] flex-col overflow-hidden border-r border-sky-300/15 bg-[#031126] pl-[env(safe-area-inset-left)] pt-[env(safe-area-inset-top)] shadow-[18px_0_48px_rgba(0,4,14,0.5)] outline-none"
              role="dialog"
              aria-modal="true"
              aria-label="Authenticated navigation"
            >
              {/* Header */}
              <div className="flex min-h-14 shrink-0 items-center justify-between border-b border-sky-300/15 bg-[#061a36] px-4">
                <div className="text-sm font-bold tracking-wide text-sky-50">Menu</div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close menu"
                  className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-sky-100 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-sky-300"
                >
                  ✕
                </button>
              </div>

              {/* Body */}
              <div className="min-h-0 flex-1 overflow-hidden" data-testid="authenticated-mobile-navigation-body">
                {sidebar}
              </div>
            </div>
          </div>
        )}
      </div>
    </MobileSidebarContext.Provider>
  );
}
