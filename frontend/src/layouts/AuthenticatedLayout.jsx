// src/layouts/AuthenticatedLayout.jsx
import React, { useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "../components/Sidebar.jsx";

export default function AuthenticatedLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // simple helper to compose class names
  const cn = (...s) => s.filter(Boolean).join(" ");

  return (
    <div className="min-h-screen flex bg-gray-50">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar (off-canvas on mobile, static on desktop) */}
      <aside
        className={cn(
          // position & sizing
          "fixed inset-y-0 left-0 z-40 w-64 transform transition-transform duration-200",
          "bg-blue-900 text-white",
          // mobile: slide in/out
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
          // desktop: always visible and full height
          "md:static md:translate-x-0 md:min-h-screen"
        )}
        aria-label="Primary"
      >
        {/* Keep your Sidebar API intact */}
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      </aside>

      {/* Main content column */}
      <main className="flex-1 min-h-screen overflow-y-auto">
        {/* Mobile menu button */}
        <div className="md:hidden p-3">
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="px-3 py-2 rounded border text-blue-700 hover:bg-blue-50"
            type="button"
            aria-expanded={sidebarOpen ? "true" : "false"}
            aria-controls="primary-sidebar"
          >
            ☰ Menu
          </button>
        </div>

        {/* Page content wrapper */}
        <div className="max-w-7xl mx-auto p-4 md:p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
