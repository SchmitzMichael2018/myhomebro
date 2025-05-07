import { useState, useEffect, useMemo } from "react";
import Modal from "react-modal";
import EarningsChart from "./components/EarningsChart";
import MilestoneStatCard from "./components/MilestoneStatCard";

Modal.setAppElement("#root");

export default function ContractorDashboard() {
  const [invoices, setInvoices] = useState([]);
  const [agreements, setAgreements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [showDrillDown, setShowDrillDown] = useState(false);
  const [drillFilter, setDrillFilter] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedAgreementInvoices, setSelectedAgreementInvoices] = useState([]);
  const token = localStorage.getItem("access");

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [invoiceRes, agreementRes] = await Promise.all([
          fetch("http://127.0.0.1:8080/api/projects/invoices/", {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch("http://127.0.0.1:8080/api/projects/agreements/", {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);
        const invoiceData = await invoiceRes.json();
        const agreementData = await agreementRes.json();

        setInvoices(Array.isArray(invoiceData) ? invoiceData : []);
        setAgreements(Array.isArray(agreementData) ? agreementData : []);
      } catch (err) {
        console.error("Error fetching data", err);
        setInvoices([]);
        setAgreements([]);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [token]);

  const milestoneStats = useMemo(() => {
    const stats = {
      total: { count: 0, total: 0 },
      incomplete: { count: 0, total: 0 },
      complete: { count: 0, total: 0 },
      pending_approval: { count: 0, total: 0 },
      approved: { count: 0, total: 0 },
      earned: { count: 0, total: 0 },
    };

    invoices.forEach((inv) => {
      const amount = parseFloat(inv.amount_due) || 0;
      stats.total.count++;
      stats.total.total += amount;

      if (!inv.is_complete) {
        stats.incomplete.count++;
        stats.incomplete.total += amount;
      } else {
        stats.complete.count++;
        stats.complete.total += amount;

        if (inv.is_complete && !inv.is_approved) {
          stats.pending_approval.count++;
          stats.pending_approval.total += amount;
        }

        if (inv.is_approved) {
          stats.approved.count++;
          stats.approved.total += amount;
          stats.earned.count++;
          stats.earned.total += amount;
        }
      }
    });

    return stats;
  }, [invoices]);

  const filteredInvoices = useMemo(() => {
    if (!drillFilter || !invoices) return [];
    return invoices.filter((inv) => {
      const matchFilter = {
        complete: inv.is_complete && !inv.is_approved,
        approved: inv.is_approved && !inv.is_paid,
        earned: inv.is_paid,
        pending_approval: inv.is_complete && !inv.is_approved,
        incomplete: !inv.is_complete,
        total: true,
      };

      const matchesSearch =
        inv.project_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        inv.homeowner_name?.toLowerCase().includes(searchTerm.toLowerCase());

      return matchFilter[drillFilter] && matchesSearch;
    });
  }, [drillFilter, invoices, searchTerm]);

  const handleAction = async (id, action) => {
    const confirmed = window.confirm(`Are you sure you want to ${action.replace("_", " ")} this invoice?`);
    if (!confirmed) return;
    try {
      const res = await fetch(`http://127.0.0.1:8080/api/projects/invoices/${id}/${action}/`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const updated = await res.json();
        setInvoices((prev) => prev.map((inv) => (inv.id === id ? { ...inv, ...updated } : inv)));
      }
    } catch (err) {
      alert("Error performing action.");
    }
  };

  const handleAgreementClick = (agreementId) => {
    const related = invoices.filter((inv) => inv.agreement === agreementId);
    setSelectedAgreementInvoices(related);
    setShowDrillDown(true);
    setDrillFilter("by_agreement");
  };

  return (
    <div className="p-6 space-y-8">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {["Total Milestone Invoices", "Milestones Incomplete", "Milestones Complete", "Completed - Pending Approval", "Completed & Approved", "Total Earned"].map((label, i) => {
          const keys = ["total", "incomplete", "complete", "pending_approval", "approved", "earned"];
          const icons = ["🧾", "⚠️", "✅", "🕓", "✔️", "💵"];
          return (
            <MilestoneStatCard
              key={keys[i]}
              label={label}
              data={milestoneStats[keys[i]]}
              icon={icons[i]}
              onClick={() => {
                setDrillFilter(keys[i]);
                setShowDrillDown(true);
              }}
            />
          );
        })}
      </div>

      {/* Agreements Table */}
      <div className="overflow-x-auto mt-10">
        <h3 className="text-lg font-semibold mb-2">Agreements</h3>
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="px-4 py-2 text-left">ID</th>
              <th className="px-4 py-2 text-left">Project Name</th>
              <th className="px-4 py-2 text-left">Homeowner</th>
              <th className="px-4 py-2 text-left">Invoices</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {agreements.map((agr) => {
              const invCount = invoices.filter((inv) => inv.agreement === agr.id).length;
              return (
                <tr key={agr.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2">{agr.id}</td>
                  <td className="px-4 py-2">{agr.project_name}</td>
                  <td className="px-4 py-2">{agr.homeowner_name}</td>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => handleAgreementClick(agr.id)}
                      className="text-blue-600 underline hover:text-blue-800"
                    >
                      {invCount}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Drill Down Modal */}
      <Modal
        isOpen={showDrillDown}
        onRequestClose={() => setShowDrillDown(false)}
        className="bg-white p-6 max-w-3xl mx-auto mt-24 rounded shadow-lg"
        overlayClassName="fixed inset-0 bg-black bg-opacity-50 z-50 flex justify-center items-start"
      >
        <h2 className="text-xl font-bold mb-4 capitalize">
          {drillFilter === "by_agreement" ? "Invoices by Agreement" : `${drillFilter?.replace("_", " ")} Invoices`}
        </h2>

        {drillFilter !== "by_agreement" && (
          <input
            type="text"
            placeholder="Search by project or homeowner"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full p-2 mb-4 border rounded"
          />
        )}

        {(drillFilter === "by_agreement" ? selectedAgreementInvoices : filteredInvoices).length === 0 ? (
          <p>No invoices found.</p>
        ) : (
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left">ID</th>
                <th className="px-4 py-2 text-left">Project</th>
                <th className="px-4 py-2 text-left">Homeowner</th>
                <th className="px-4 py-2 text-left">Amount</th>
                <th className="px-4 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(drillFilter === "by_agreement" ? selectedAgreementInvoices : filteredInvoices).map((inv) => (
                <tr key={inv.id}>
                  <td className="px-4 py-2">{inv.id}</td>
                  <td className="px-4 py-2">{inv.project_name}</td>
                  <td className="px-4 py-2">{inv.homeowner_name}</td>
                  <td className="px-4 py-2">${parseFloat(inv.amount_due).toFixed(2)}</td>
                  <td className="px-4 py-2">
                    {inv.is_paid
                      ? "Paid"
                      : inv.is_approved
                      ? "Approved"
                      : inv.is_complete
                      ? "Complete"
                      : "Pending"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <button onClick={() => setShowDrillDown(false)} className="mt-6 text-sm text-gray-600 hover:underline">
          Close
        </button>
      </Modal>
    </div>
  );
}




