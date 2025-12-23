// src/pages/InvoicePage.jsx
// v2025-12-18-canonical-invoice-router-fullsize
//
// Purpose:
// - Routes public invoice links to the correct experience.
//   • With token  → MagicInvoice (homeowner approval flow)
//   • Without     → Full-size friendly explanation page
//
// All real invoice UI lives in:
// - InvoiceDetail.jsx (contractor)
// - MagicInvoice.jsx  (homeowner)

import React, { useEffect } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";

export default function InvoicePage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    const token = searchParams.get("token");
    if (id && token) {
      navigate(`/invoices/magic/${id}?token=${encodeURIComponent(token)}`, { replace: true });
    }
  }, [id, searchParams, navigate]);

  const token = searchParams.get("token");

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-3xl mx-auto bg-white rounded-xl shadow p-6 space-y-6">
        <div>
          <div className="text-sm text-slate-500">Invoice</div>
          <div className="text-3xl font-extrabold text-slate-900">#{id || "—"}</div>
        </div>

        {token ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-slate-700">
            Redirecting to your invoice…
          </div>
        ) : (
          <>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-lg font-extrabold text-slate-900">Secure access required</div>
              <div className="mt-1 text-sm text-slate-700">
                This invoice link requires a secure access token.
              </div>
              <div className="mt-2 text-sm text-slate-600">
                Please open the invoice email you received, or ask your contractor to resend it.
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => navigate("/")}
                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 font-bold"
              >
                Return Home
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
