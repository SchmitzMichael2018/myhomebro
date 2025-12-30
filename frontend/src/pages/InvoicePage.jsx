// src/pages/InvoicePage.jsx
// v2025-12-23 — homeowner magic-link invoice router (FINAL)
//
// URL format:
//   /invoice/:token
//
// Behavior:
// - Always routes homeowner to MagicInvoice
// - Never requires auth
// - Never redirects to contractor dashboard

import React, { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";

export default function InvoicePage() {
  const { token } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    if (token) {
      navigate(`/invoices/magic/${encodeURIComponent(token)}`, {
        replace: true,
      });
    }
  }, [token, navigate]);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="bg-white rounded-xl shadow p-6 max-w-md text-center space-y-4">
        <div className="text-lg font-extrabold text-slate-900">
          Opening your invoice…
        </div>
        <div className="text-sm text-slate-600">
          Please wait while we securely load your invoice.
        </div>
      </div>
    </div>
  );
}
