// src/components/PageShell.jsx
import React, { useEffect } from "react";
import { useMobileSidebar } from "./MobileSidebarShell.jsx";
import { pageShellOwnsMobileNavigation } from "../lib/mobileNavigation.js";

/**
 * PageShell
 * - Header with larger, framed logo (matches landing page style)
 * - Title and subtitle with increased sizes
 * - Mobile: header hamburger opens the sidebar overlay
 */
export default function PageShell({
  title,
  subtitle,
  children,
  showLogo = true,
  titleClassName = "",
  className = "",
  compact = false,
}) {
  const { isOpen, openSidebar, registerHeaderHamburger, unregisterHeaderHamburger } =
    useMobileSidebar();
  const hasHeader = pageShellOwnsMobileNavigation({ title, showLogo });

  // Tell the shell this page header includes a hamburger (so it can hide the floating fallback)
  useEffect(() => {
    if (!hasHeader) return undefined;
    registerHeaderHamburger?.();
    return () => unregisterHeaderHamburger?.();
  }, [hasHeader, registerHeaderHamburger, unregisterHeaderHamburger]);

  return (
    <div className={`mhb-container ${className}`.trim()}>
      {hasHeader && (
        <header>
          <div className={`mhb-topbar${compact ? " mb-3 gap-3" : ""}`}>
            {/* ✅ Mobile header hamburger */}
            <button
              type="button"
              onClick={openSidebar}
              aria-label="Open navigation menu"
              aria-expanded={isOpen}
              aria-controls="authenticated-mobile-navigation"
              data-testid="authenticated-mobile-menu-button"
              className="mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-black/10 bg-white/90 text-slate-800 shadow backdrop-blur active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 md:hidden"
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
              {title ? (
                <h1
                  className={`${
                    compact
                      ? `text-[1.9rem] font-extrabold tracking-[-0.02em] text-[#163B70] md:text-[2.25rem] ${titleClassName}`
                      : `mhb-page-title ${titleClassName}`
                  }`.trim()}
                >
                  {title}
                </h1>
              ) : null}
              {subtitle ? (
                <div className={compact ? "mt-1 text-sm font-medium text-slate-700 md:text-[15px]" : "mhb-page-subtitle"}>
                  {subtitle}
                </div>
              ) : null}
            </div>
          </div>
        </header>
      )}
      {children}
    </div>
  );
}
