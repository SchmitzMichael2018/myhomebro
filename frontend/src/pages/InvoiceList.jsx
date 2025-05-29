import React, { useState, useEffect, useMemo } from "react";
import api from "../api";

export default function InvoiceList() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [loadingId, setLoadingId] = useState(null);

  const fetchInvoices = async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/projects/invoices/");
      setInvoices(data);
    } catch (err) {
      console.error(err);
      setError("Failed to load invoices. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInvoices();
  }, []);

  const filteredInvoices = useMemo(() => {
    if (!searchTerm) return invoices;
    return invoices.filter((inv) => {
      const proj = inv.project_title?.toLowerCase() || "";
      const home = inv.homeowner_name?.toLowerCase() || "";
      return (
        proj.includes(searchTerm.toLowerCase()) ||
        home.includes(searchTerm.toLowerCase())
      );
    });
  }, [invoices, searchTerm]);

  // PATCH is more RESTful than POST for these status changes
  const handleAction = async (id, action) => {
    setLoadingId(id);
    setError("");
    try {
      const { data: updated } = await api.patch(
        `/projects/invoices/${id}/${action}/`
      );
      setInvoices((prev) =>
        prev.map((inv) => (inv.id === updated.id ? updated : inv))
      );
    } catch (err) {
      console.error(err);
      setError(`Failed to ${action} invoice.`);
    } finally {
      setLoadingId(null);
    }
  };

  const statusStyles = {
    pending: "bg-yellow-100 text-yellow-800",
    approved: "bg-blue-100 text-blue-800",
    disputed: "bg-red-100 text-red-800",
    paid: "bg-green-100 text-green-800",
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold">Invoices</h2>
        <input
          type="text"
          placeholder="Search by project or homeowner..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="border px-4 py-2 rounded shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {/* Optional Refresh Button */}
        {/* <button onClick={fetchInvoices} className="ml-4 text-blue-600 hover:underline">Refresh</button> */}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <p className="text-blue-500">Loading invoices...</p>
        </div>
      ) : error ? (
        <p className="text-red-500 mb-4">{error}</p>
      ) : filteredInvoices.length === 0 ? (
        <p className="text-gray-500">No invoices found.</p>
      ) : (
        filteredInvoices.map((inv) => {
          const amount = inv.amount_due ?? inv.amount;
          const statusLabel =
            inv.status.charAt(0).toUpperCase() + inv.status.slice(1);
          return (
            <div
              key={inv.id}
              className="bg-white shadow rounded p-4 mb-4 space-y-2"
            >
              <div className="font-semibold">Project: {inv.project_title || "-"}</div>
              <div>Homeowner: {inv.homeowner_name || "-"}</div>
              <div>
                Amount Due:{" "}
                {parseFloat(amount || 0).toLocaleString("en-US", {
                  style: "currency",
                  currency: "USD",
                })}
              </div>
              <div>
                Status:{" "}
                <span
                  className={`px-2 py-1 rounded ${statusStyles[inv.status] || "bg-gray-200"}`}
                >
                  {statusLabel}
                </span>
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                {inv.status === "pending" && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleAction(inv.id, "approve")}
                      disabled={loadingId === inv.id}
                      className="bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600"
                      aria-label={`Approve invoice #${inv.id}`}
                    >
                      {loadingId === inv.id ? "..." : "Approve"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAction(inv.id, "dispute")}
                      disabled={loadingId === inv.id}
                      className="bg-red-500 text-white px-3 py-1 rounded hover:bg-red-600"
                      aria-label={`Dispute invoice #${inv.id}`}
                    >
                      {loadingId === inv.id ? "..." : "Dispute"}
                    </button>
                  </>
                )}

                {inv.status === "approved" && (
                  <button
                    type="button"
                    onClick={() => handleAction(inv.id, "mark_paid")}
                    disabled={loadingId === inv.id}
                    className="bg-green-500 text-white px-3 py-1 rounded hover:bg-green-600"
                    aria-label={`Mark invoice #${inv.id} as paid`}
                  >
                    {loadingId === inv.id ? "..." : "Mark Paid"}
                  </button>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}





