// src/layout/AuthenticatedLayout.jsx
import React from "react";
import { Outlet, NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import Logo from "../assets/myhomebro_logo.png";

export default function AuthenticatedLayout() {
  const { logout } = useAuth();
  const linkClass = ({ isActive }) =>
    `flex items-center gap-3 px-4 py-2 rounded-lg transition
     ${isActive ? "bg-white/10 text-white" : "text-white/80 hover:bg-white/10"}`;

  return (
    <div className="min-h-screen flex bg-slate-50">
      {/* Sidebar */}
      <aside className="w-64 bg-[#102a71] text-white flex flex-col">
        <div className="p-4 flex items-center gap-3 border-b border-white/10">
          <img src={Logo} alt="MyHomeBro" className="w-10 h-10 object-contain" />
          <div>
            <div className="text-sm opacity-80">MyHomeBro</div>
            <div className="text-xs opacity-60 -mt-1">CONTRACTOR</div>
          </div>
        </div>

        <nav className="p-3 flex-1 space-y-1">
          <NavLink to="/profile" className={linkClass}>My Profile</NavLink>
          <NavLink to="/dashboard" className={linkClass}>Dashboard</NavLink>
          <NavLink to="/customers" className={linkClass}>Customers</NavLink>
          <NavLink to="/agreements" className={linkClass}>Agreements</NavLink>

          {/* NEW */}
          <NavLink to="/milestones" className={linkClass}>Milestones</NavLink>

          <NavLink to="/invoices" className={linkClass}>Invoices</NavLink>
          <NavLink to="/business-analytics" className={linkClass}>Business Analytics</NavLink>
          <NavLink to="/calendar" className={linkClass}>Calendar</NavLink>
          <NavLink to="/send-message" className={linkClass}>Send Message</NavLink>
          <NavLink to="/disputes" className={linkClass}>Disputes</NavLink>
          <NavLink to="/stripe-onboarding" className={linkClass}>Stripe Onboarding</NavLink>
        </nav>

        <div className="p-3">
          <button
            onClick={logout}
            className="w-full bg-red-600 hover:bg-red-700 text-white rounded-lg py-2"
          >
            Logout
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1">
        <div className="max-w-6xl mx-auto p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
