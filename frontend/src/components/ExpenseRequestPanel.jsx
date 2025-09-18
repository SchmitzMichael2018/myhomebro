// frontend/src/components/ExpenseRequestsPanel.jsx
import React, { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { listExpenses } from "../api/expenses";

export default function ExpenseRequestsPanel() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);

  const load = async () => {
    try {
      setLoading(true);
      const data = await listExpenses();
      const list = Array.isArray(data?.results)
        ? data.results
        : Array.isArray(data)
        ? data
        : [];
      setRows(list);
    } catch (e) {
      console.error(e);
      toast.error("Failed to load expenses.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statusBadge = (s) => {
    const base = "px-2 py-0.5 rounded text-xs font-semibold";
    switch (String(s || "").toLowerCase()) {
      case "draft":
        return <span className={`${base} bg-gray-200 text-gray-800`}>Draft</span>;
      case "contractor_signed":
        return <span className={`${base} bg-indigo-100 text-indigo-800`}>Signed</span>;
      case "pending":
        return <span className={`${base} bg-amber-100 text-amber-800`}>Sent</span>;
      case "approved":
        return <span className={`${base} bg-green-100 text-green-800`}>Accepted</span>;
      case "rejected":
        return <span className={`${base} bg-red-100 text-red-800`}>Rejected</span>;
      case "paid":
        return <span className={`${base} bg-emerald-200 text-emerald-900`}>Paid</span>;
      case "disputed":
        return <span className={`${base} bg-red-100 text-red-800`}>Disputed</span>;
      default:
        return <span className={`${base} bg-gray-100 text-gray-800`}>{s}</span>;
    }
  };

  const money = (n) => {
    const v = Number(n);
    return Number.isFinite(v) ? `$${v.toFixed(2)}` : n ?? "—";
  };

  return (
    <div className="rounded-xl border bg-white shadow-sm">
      <div className="px-5 py-4 border-b bg-gradient-to-r from-blue-50 to-white rounded-t-xl">
        <h3 className="text-lg font-semibold">Expense Requests</h3>
        <p className="text-sm text-gray-600 mt-1">
          Track expenses you’ve sent to homeowners.
        </p>
      </div>

      <div className="p-5">
        {loading ? (
          <div className="text-gray-600">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-gray-500 text-sm">No expenses yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border rounded">
              <thead className="bg-gray-50">
                <tr>
                  <th className="p-2 text-left border">Created</th>
                  <th className="p-2 text-left border">Agreement</th>
                  <th className="p-2 text-left border">Description</th>
                  <th className="p-2 text-right border">Amount</th>
                  <th className="p-2 text-left border">Status</th>
                  <th className="p-2 text-center border">Receipt</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="odd:bg-white even:bg-gray-50">
                    <td className="p-2 border">
                      {r.created_at ? new Date(r.created_at).toLocaleString() : "—"}
                    </td>
                    <td className="p-2 border">{r.agreement || "—"}</td>
                    <td className="p-2 border">{r.description}</td>
                    <td className="p-2 border text-right">{money(r.amount)}</td>
                    <td className="p-2 border">{statusBadge(r.status)}</td>
                    <td className="p-2 border text-center">
                      {r.receipt_url ? (
                        <a
                          className="text-blue-700 underline"
                          href={r.receipt_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
