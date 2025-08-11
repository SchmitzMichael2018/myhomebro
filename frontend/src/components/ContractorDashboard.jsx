// src/components/ContractorDashboard.jsx

import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import EarningsChart from "./EarningsChart";
import MilestoneStatCard from "./MilestoneStatCard";
import Modal from "react-modal";
import toast from "react-hot-toast";
import api from "../api";

if (typeof document !== "undefined") {
  Modal.setAppElement("#root");
}

const STATUS_MAP = {
  total: () => true,
  incomplete: inv => inv.status === "pending",
  complete: inv => inv.status === "completed",
  pending_approval: inv => inv.status === "pending_approval",
  approved: inv => inv.status === "approved",
  earned: inv => inv.status === "paid",
};

export default function ContractorDashboard() {
  const [invoices, setInvoices] = useState([]);
  const [agreements, setAgreements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showDrillDown, setShowDrillDown] = useState(false);
  const [drillFilter, setDrillFilter] = useState("total");
  const [searchTerm, setSearchTerm] = useState("");
  const [error, setError] = useState("");

  const navigate = useNavigate();

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
      toast.error("Could not load dashboard data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const filteredInvoices = useMemo(() => {
    return invoices
      .filter(STATUS_MAP[drillFilter] || (() => true))
      .filter(inv =>
        inv.project_title?.toLowerCase().includes(searchTerm.toLowerCase())
      );
  }, [drillFilter, invoices, searchTerm]);

  const totalEarned = useMemo(() =>
    invoices
      .filter(inv => inv.status === "paid")
      .reduce((sum, inv) => sum + parseFloat(inv.amount_due || 0), 0),
    [invoices]
  );

  const handleStatClick = (key) => {
    setDrillFilter(key);
    setShowDrillDown(true);
  };

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-8">
      <div className="flex flex-col md:flex-row md:justify-between md:items-center mb-6 gap-6">
        <div>
          <h2 className="text-3xl font-bold text-blue-800 mb-2">Contractor Dashboard</h2>
          <p className="text-gray-600">Track your milestones, invoices, and earnings at a glance.</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={fetchData}
            className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg shadow transition"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Stat Cards */}
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
            data={invoices.filter(STATUS_MAP[key] || (() => true)).length}
            onClick={() => handleStatClick(key)}
            active={drillFilter === key && showDrillDown}
          />
        ))}
      </div>

      {/* Earnings Chart */}
      <div className="bg-white rounded-2xl shadow p-6 mb-8">
        <h3 className="text-lg font-bold mb-4 text-blue-700">Earnings Overview</h3>
        <EarningsChart invoices={invoices} />
        <div className="mt-4 text-green-700 font-bold">
          Total Earned: ${totalEarned.toLocaleString("en-US", { minimumFractionDigits: 2 })}
        </div>
      </div>

      {/* Search */}
      <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
        <input
          type="text"
          placeholder="Search invoices or projects..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="p-2 border rounded flex-1 md:max-w-xs"
        />
        {loading && <p className="text-blue-500">Loading...</p>}
      </div>

      {/* Invoice Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredInvoices.slice(0, 6).map(inv => (
          <div
            key={inv.id}
            className="bg-white rounded-xl shadow p-5 flex flex-col gap-2 hover:ring-2 hover:ring-blue-300 transition cursor-pointer"
            onClick={() => navigate(`/invoices/${inv.id}`)}
          >
            <div className="flex justify-between items-center">
              <span className="font-bold text-blue-700">{inv.project_title || "Untitled Project"}</span>
              <span className={`px-2 py-1 rounded text-xs ${
                inv.status === "paid"
                  ? "bg-green-100 text-green-700"
                  : inv.status === "pending"
                  ? "bg-yellow-100 text-yellow-800"
                  : "bg-gray-100 text-gray-700"
              }`}>
                {inv.status.replace("_", " ").replace(/^\w/, c => c.toUpperCase())}
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
                onClick={(e) => {
                  e.stopPropagation();
                  setDrillFilter("total");
                  setShowDrillDown(true);
                }}
                className="px-3 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 text-sm font-semibold"
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

      {/* Drill-Down Modal */}
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
