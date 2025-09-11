// src/layouts/DashboardLayout.jsx
import React from "react";
import { Outlet } from "react-router-dom";

// If your Sidebar file is somewhere else, adjust this path.
import Sidebar from "../components/Sidebar.jsx";

export default function DashboardLayout() {
  return (
    <div className="min-h-screen flex bg-gray-50">
      <Sidebar />
      <main className="flex-1">
        <div className="mx-auto max-w-7xl p-4 md:p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
