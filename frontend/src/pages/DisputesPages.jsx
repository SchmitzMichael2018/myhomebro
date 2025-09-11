import React, { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";

const money = (n) =>
  Number(n || 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });

const DisputesTable = ({ disputes }) => (
  <div className="overflow-x-auto bg-white rounded-lg shadow">
    <table className="min-w-full text-sm">
      <thead className="bg-gray-50">
        <tr>
          <th className="p-3 text-left font-semibold text-gray-600">Invoice #</th>
          <th className="p-3 text-left font-semibold text-gray-600">Project</th>
          <th className="p-3 text-left font-semibold text-gray-600">Homeowner</th>
          <th className="p-3 text-left font-semibold text-gray-600">Status</th>
          <th className="p-3 text-right font-semibold text-gray-600">Amount</th>
          <th className="p-3 text-center font-semibold text-gray-600">Disputed On</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-200">
        {disputes.map((inv) => {
          const disputedAt =
            inv.disputed_at || inv.updated_at || inv.created_at || null;
          return (
            <tr key={inv.id} className="hover:bg-gray-50">
              <td className="p-3 font-mono">
                <Link to={`/invoices/${inv.id}`} className="text-blue-600 hover:underline">
                  {inv.invoice_number || `#${inv.id}`}
                </Link>
              </td>
              <td className="p-3">{inv.project_title || inv.agreement_title || "-"}</td>
              <td className="p-3">{inv.homeowner_name || "-"}</td>
              <td className="p-3 capitalize">{String(inv.status || "-").replace("_", " ")}</td>
              <td className="p-3 text-right font-semibold">
                {money(inv.amount_due ?? inv.amount)}
              </td>
              <td className="p-3 text-center">
                {disputedAt ? new Date(disputedAt).toLocaleDateString() : "—"}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

export default function DisputesPage() {
  const [disputes, setDisputes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchDisputes = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      // Backend should return only disputed invoices.
      const { data } = await api.get("/invoices/", { params: { status: "disputed" } });
      const rows = Array.isArray(data) ? data : data?.results ?? [];
      setDisputes(rows);
    } catch (err) {
      setError("Failed to load disputed invoices.");
      toast.error("Failed to load disputed invoices.");
      console.error("Fetch disputes error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDisputes();
  }, [fetchDisputes]);

  let content;
  if (loading) content = <p className="text-center text-gray-500 py-10">Loading disputes...</p>;
  else if (error) content = <p className="text-center text-red-500 py-10">{error}</p>;
  else if (disputes.length === 0) content = <p className="text-center text-gray-500 py-10">🎉 No disputed invoices found.</p>;
  else content = <DisputesTable disputes={disputes} />;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-800">Dispute Center</h1>
        <button
          onClick={fetchDisputes}
          disabled={loading}
          className="text-blue-600 text-sm hover:underline disabled:text-gray-400"
        >
          Refresh
        </button>
      </div>
      <p className="text-gray-600 mb-6">
        Review and manage all invoices that have been marked as <b>disputed</b> by homeowners.
      </p>
      {content}
    </div>
  );
}
