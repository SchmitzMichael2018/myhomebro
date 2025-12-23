// src/components/DashboardRouter.jsx
// v2025-11-16 — Route switcher: Contractor vs Employee dashboard

import React from "react";
import { Navigate } from "react-router-dom";
import { useWhoAmI } from "../hooks/useWhoAmI";
import { useAuth } from "../context/AuthContext";

// Contractor dashboard lives under components
import ContractorDashboard from "../components/ContractorDashboard.jsx";
// Employee dashboard under pages (adjust if yours is different)
import EmployeeDashboard from "../pages/EmployeeDashboard.jsx";

export default function DashboardRouter() {
  const { isAuthenticated } = useAuth();
  const { data, loading, error, isContractor, isEmployee } = useWhoAmI();

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-sm text-slate-500">Loading your workspace…</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50">
        <p className="text-red-500 text-sm mb-2">
          We couldn’t determine your role.
        </p>
        <p className="text-xs text-slate-500">
          Try refreshing the page or logging out and back in.
        </p>
      </div>
    );
  }

  if (isEmployee) {
    return <EmployeeDashboard />;
  }

  if (isContractor) {
    return <ContractorDashboard />;
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50">
      <p className="text-sm text-slate-700 mb-1">
        Your account doesn’t have a contractor workspace yet.
      </p>
      <p className="text-xs text-slate-500">
        If you believe this is an error, contact support or your account admin.
      </p>
    </div>
  );
}
