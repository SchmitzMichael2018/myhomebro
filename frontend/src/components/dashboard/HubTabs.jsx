import React from "react";
import { NavLink } from "react-router-dom";

export default function HubTabs({ tabs = [], className = "" }) {
  if (!tabs.length) return null;

  return (
    <nav
      data-testid="hub-tabs"
      className={`flex flex-wrap gap-2 rounded-2xl border border-white/12 bg-slate-950/35 p-2 shadow-sm ${className}`.trim()}
      aria-label="Section tabs"
    >
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            [
              "inline-flex min-h-10 items-center rounded-xl px-3.5 py-2 text-sm font-semibold transition",
              isActive
                ? "bg-white text-slate-950 shadow-sm"
                : "border border-white/12 bg-slate-900/70 text-sky-100 hover:border-sky-300/35 hover:bg-sky-500/15",
            ].join(" ")
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
