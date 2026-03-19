// src/components/PageShell.jsx
import React, { useEffect } from "react";
import { useMobileSidebar } from "./MobileSidebarShell.jsx";

/**
 * PageShell
 * - Header with larger, framed logo (matches landing page style)
 * - Title and subtitle with increased sizes
 * - Mobile: header hamburger opens the sidebar overlay
 */
export default function PageShell({ title, subtitle, children, showLogo = true }) {
  const { openSidebar, registerHeaderHamburger, unregisterHeaderHamburger } =
    useMobileSidebar();

  // Tell the shell this page header includes a hamburger (so it can hide the floating fallback)
  useEffect(() => {
    registerHeaderHamburger?.();
    return () => unregisterHeaderHamburger?.();
  }, [registerHeaderHamburger, unregisterHeaderHamburger]);

  return (
    <div className="mhb-container">
      {(title || showLogo) && (
        <header>
          <div className="mhb-topbar">
            {/* ✅ Mobile header hamburger */}
            <button
              type="button"
              onClick={openSidebar}
              aria-label="Open menu"
              className="md:hidden mr-2 inline-flex items-center justify-center rounded-lg bg-white/80 backdrop-blur px-3 py-2 shadow border border-black/10 active:scale-[0.99]"
              style={{ lineHeight: 1 }}
            >
              <span className="text-xl leading-none">☰</span>
            </button>

            {showLogo ? (
              <div className="mhb-logo-frame mhb-logo-lg" title="MyHomeBro">
                <img
                  src={new URL("../assets/myhomebro_logo.png", import.meta.url).href}
                  alt="MyHomeBro"
                />
              </div>
            ) : null}

            <div style={{ minWidth: 0 }}>
              {title ? <h1 className="mhb-page-title">{title}</h1> : null}
              {subtitle ? <div className="mhb-page-subtitle">{subtitle}</div> : null}
            </div>
          </div>
        </header>
      )}
      {children}
    </div>
  );
}
