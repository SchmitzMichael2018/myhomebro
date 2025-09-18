// src/layouts/AuthenticatedLayout.jsx
import React from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "../components/Sidebar.jsx";
import ErrorBoundary from "../components/ErrorBoundary.jsx";
// (Optional) If authenticated-layout.css only styled the removed topbar, you can delete that file.
// import "./authenticated-layout.css";

export default function AuthenticatedLayout() {
  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar />
      <main
        className="mhb-gradient-bg"
        style={{
          flex: 1,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          minWidth: 0, // prevents flex overflow issues
        }}
      >
        {/* Scrollable content area */}
        <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
          <div className="mhb-content-pad">
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </div>
        </div>
      </main>
    </div>
  );
}
