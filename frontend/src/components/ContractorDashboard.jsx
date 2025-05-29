import React, { useState, useEffect, useMemo } from "react";
import EarningsChart from "./EarningsChart";
import MilestoneStatCard from "./MilestoneStatCard";
import Modal from "react-modal";
import api from "../api";

Modal.setAppElement("#root");

const STATUS_MAP = {
  Total: () => true,
  Incomplete: inv => inv.status === "pending",
  Complete: inv => inv.status === "completed",
  "Pending Approval": inv => inv.status === "pending_approval",
  Approved: inv => inv.status === "approved",
  Earned: inv => inv.status === "paid",
};

export default function ContractorDashboard() {
  const [invoices, setInvoices] = useState([]);
  const [agreements, setAgreements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showDrillDown, setShowDrillDown] = useState(false);
  const [drillFilter, setDrillFilter] = useState("total");
  const [searchTerm, setSearchTerm] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError("");
      try {
        const [invoiceRes, agreementRes] = await Promise.all([
          api.get("/projects/invoices/"),
          api.get("/projects/agreements/"),
        ]);
        setInvoices(invoiceRes.data || []);
        setAgreements(agreementRes.data || []);
      } catch (err) {
        setError("Failed to load data. Please try again later.");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const filteredInvoices = useMemo(() => {
    return invoices
      .filter(inv => {
        switch (drillFilter) {
          case "total": return true;
          case "incomplete": return inv.status === "pending";
          case "complete": return inv.status === "completed";
          case "pending_approval": return inv.status === "pending_approval";
          case "approved": return inv.status === "approved";
          case "earned": return inv.status === "paid";
          default: return true;
        }
      })
      .filter(inv =>
        inv.project_title?.toLowerCase().includes(searchTerm.toLowerCase())
      );
  }, [drillFilter, invoices, searchTerm]);

  const handleRefresh = async () => {
    setLoading(true);
    setError("");
    try {
      const [invoiceRes, agreementRes] = await Promise.all([
        api.get("/projects/invoices/"),
        api.get("/projects/agreements/"),
      ]);
      setInvoices(invoiceRes.data || []);
      setAgreements(agreementRes.data || []);
    } catch {
      setError("Failed to refresh data. Please try again later.");
    } finally {
      setLoading(false);
    }
  };

  const handleStatClick = (key) => {
    setDrillFilter(key);
    setShowDrillDown(true);
  };

  const totalEarned = invoices
    .filter(inv => inv.status === "paid")
    .reduce((sum, inv) => sum + parseFloat(inv.amount_due || 0), 0);

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-8">
      <div className="flex flex-col md:flex-row md:justify-between md:items-center mb-6 gap-6">
        <div>
          <h2 className="text-3xl font-bold text-blue-800 mb-2">Contractor Dashboard</h2>
          <p className="text-gray-600">Track your milestones, invoices, and earnings at a glance.</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleRefresh}
            className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg shadow transition"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Stat cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-5 mb-8">
        {[
          { label: "Total", key: "total" },
          { label: "Incomplete", key: "incomplete" },
          { label: "Complete", key: "complete" },
          { label: "Pending Approval", key: "pending_approval" },
          { label: "Approved", key: "approved" },
          { label: "Earned", key: "earned" },
        ].map(({ label, key }) => (
          <MilestoneStatCard
            key={key}
            label={label}
            data={invoices.filter(STATUS_MAP[label] || (() => true)).length}
            onClick={() => handleStatClick(key)}
            active={drillFilter === key && showDrillDown}
          />
        ))}
      </div>

      {/* Earnings chart */}
      <div className="bg-white rounded-2xl shadow p-6 mb-8">
        <h3 className="text-lg font-bold mb-4 text-blue-700">Earnings Overview</h3>
        <EarningsChart invoices={invoices} />
        <div className="mt-4 text-green-700 font-bold">
          Total Earned: ${totalEarned.toLocaleString("en-US", { minimumFractionDigits: 2 })}
        </div>
      </div>

      {/* Search and table */}
      <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
        <input
          type="text"
          placeholder="Search invoices or projects..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="p-2 border rounded flex-1 md:max-w-xs"
        />
        <div className="flex gap-2 mt-2 md:mt-0">
          {error && <p className="text-red-500">{error}</p>}
          {loading && <p className="text-blue-500">Loading...</p>}
        </div>
      </div>

      {/* Invoice/agreements list (as cards or table) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredInvoices.slice(0, 6).map(inv => (
          <div key={inv.id} className="bg-white rounded-xl shadow p-5 flex flex-col gap-2 hover:ring-2 hover:ring-blue-300 transition">
            <div className="flex justify-between items-center">
              <span className="font-bold text-blue-700">{inv.project_title || "Untitled Project"}</span>
              <span className={`px-2 py-1 rounded text-xs ${
                inv.status === "paid"
                  ? "bg-green-100 text-green-700"
                  : inv.status === "pending"
                  ? "bg-yellow-100 text-yellow-800"
                  : "bg-gray-100 text-gray-700"
              }`}>
                {inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}
              </span>
            </div>
            <div className="text-sm text-gray-700">
              Homeowner: {inv.homeowner_name || "-"}
            </div>
            <div className="flex justify-between items-center mt-2">
              <span className="font-bold text-xl text-blue-700">
                ${parseFloat(inv.amount_due || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </span>
              <button
                className="px-3 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 text-sm font-semibold"
                onClick={() => {
                  setDrillFilter("total");
                  setShowDrillDown(true);
                }}
              >
                View
              </button>
            </div>
          </div>
        ))}
        {filteredInvoices.length === 0 && (
          <div className="col-span-full text-center text-gray-500 py-8">
            No invoices found.
          </div>
        )}
      </div>

      {/* Drill-down modal for filtered invoices */}
      <Modal
        isOpen={showDrillDown}
        onRequestClose={() => {
          setShowDrillDown(false);
          setDrillFilter("total");
        }}
        className="p-6 max-w-lg mx-auto bg-white rounded shadow-lg outline-none"
        overlayClassName="fixed inset-0 bg-black/50 flex justify-center items-center z-50"
        aria-modal="true"
        role="dialog"
      >
        <h2 className="text-xl font-bold mb-4 capitalize">
          {drillFilter.replace("_", " ")} Invoices
        </h2>
        {filteredInvoices.length > 0 ? (
          <ul className="space-y-2">
            {filteredInvoices.map(inv => (
              <li key={inv.id} className="p-2 border-b">
                <p><strong>{inv.project_title}</strong></p>
                <p>Amount: ${parseFloat(inv.amount_due).toFixed(2)}</p>
                <p>Status: {inv.status}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p>No invoices found.</p>
        )}
      </Modal>
    </div>
  );
}














