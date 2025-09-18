// src/components/Sidebar.jsx
import React, { useCallback } from "react";
import { NavLink, useNavigate } from "react-router-dom";

/**
 * Compact, route-aligned sidebar.
 * - Highlights active route via NavLink
 * - Includes "My Profile"
 * - Adds a footer Logout button (clears JWT and returns to landing)
 */
export default function Sidebar() {
  const navigate = useNavigate();

  const handleLogout = useCallback(() => {
    try {
      localStorage.removeItem("access");
      localStorage.removeItem("refresh");
    } catch {}
    // If you set Authorization header globally somewhere, clear it here too.
    // e.g., api.defaults.headers.common.Authorization = undefined;
    navigate("/", { replace: true });
  }, [navigate]);

  const Item = ({ to, label, emoji }) => (
    <NavLink
      to={to}
      className={({ isActive }) =>
        [
          "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition",
          "text-slate-700 hover:bg-white hover:text-slate-900",
          isActive ? "bg-white text-slate-900 shadow-sm ring-1 ring-black/5" : "bg-white/60",
        ].join(" ")
      }
      end={to === "/dashboard"}
      title={label}
    >
      <span className="text-base" aria-hidden="true">{emoji}</span>
      <span>{label}</span>
    </NavLink>
  );

  return (
    <aside
      className="hidden md:flex md:flex-col md:w-60 lg:w-64 border-r border-black/5 bg-white/50 backdrop-blur-md"
      style={{ minHeight: "100vh" }}
    >
      {/* Brand */}
      <div className="px-4 pt-4 pb-3 border-b border-black/5">
        <div className="flex items-center gap-2">
          {/* If your logo path differs, update src accordingly */}
          <img
            src="/static/assets/myhomebro_logo.png"
            onError={(e) => { e.currentTarget.style.display = "none"; }}
            alt="MyHomeBro"
            className="h-8 w-8 rounded-md object-contain"
          />
          <div>
            <div className="text-base font-extrabold tracking-tight text-slate-900">MyHomeBro</div>
            <div className="text-xs text-slate-500">Contractor Console</div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-auto px-3 py-4 space-y-6">
        <div>
          <div className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
            Main
          </div>
          <div className="space-y-1">
            <Item to="/dashboard" label="Dashboard" emoji="🏠" />
            <Item to="/agreements" label="Agreements" emoji="📄" />
            <Item to="/milestones" label="Milestones" emoji="🧩" />
            <Item to="/invoices" label="Invoices" emoji="💳" />
            <Item to="/customers" label="Customers" emoji="👥" />
            <Item to="/calendar" label="Calendar" emoji="🗓️" />
            <Item to="/expenses" label="Expenses" emoji="📊" />
            <Item to="/disputes" label="Disputes" emoji="⚖️" />
            <Item to="/business-analysis" label="Business Dashboard" emoji="📈" />
          </div>
        </div>

        <div>
          <div className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
            Account
          </div>
          <div className="space-y-1">
            <Item to="/profile" label="My Profile" emoji="👤" />
            {/* Keep this if you use it; otherwise remove */}
            <Item to="/onboarding" label="Stripe Onboarding" emoji="🔗" />
          </div>
        </div>
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-black/5">
        <button
          type="button"
          onClick={handleLogout}
          title="Logout"
          className="w-full flex items-center justify-center gap-2 rounded-md bg-rose-600 hover:bg-rose-700 text-white text-sm font-extrabold px-3 py-2 shadow-sm ring-1 ring-black/5"
        >
          <span aria-hidden="true">↩︎</span>
          <span>Logout</span>
        </button>
        <div className="mt-2 text-[11px] text-slate-500 text-center">
          © {new Date().getFullYear()} MyHomeBro
        </div>
      </div>
    </aside>
  );
}
