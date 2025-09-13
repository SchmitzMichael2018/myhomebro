// src/components/PageShell.jsx
import React from "react";

/**
 * PageShell
 * - Header with larger, framed logo (matches landing page style)
 * - Title and subtitle with increased sizes
 * - Logo path: /static/assets/myhomebro_logo.png (stable)
 */
export default function PageShell({ title, subtitle, children, showLogo = true }) {
  return (
    <div className="mhb-container">
      {(title || showLogo) && (
        <header>
          <div className="mhb-topbar">
            {showLogo ? (
              <div className="mhb-logo-frame mhb-logo-lg" title="MyHomeBro">
                <img src="/static/assets/myhomebro_logo.png" alt="MyHomeBro" />
              </div>
            ) : null}
            <div>
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
