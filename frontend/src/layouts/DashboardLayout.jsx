// src/layouts/DashboardLayout.jsx
// v2026-02-17d — Mobile fix:
// - Floating hamburger is now a fallback and auto-hides when PageShell registers its own hamburger

import React from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "../components/Sidebar.jsx";
import MobileSidebarShell from "../components/MobileSidebarShell.jsx";

export default function DashboardLayout() {
  return (
    <MobileSidebarShell sidebar={<Sidebar variant="plain" />}>
      <div className="min-h-screen flex bg-gray-50">
        <Sidebar />
        <main className="flex-1">
          <div className="mx-auto max-w-7xl p-4 md:p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </MobileSidebarShell>
  );
}
