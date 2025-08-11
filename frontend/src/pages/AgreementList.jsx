// src/pages/AgreementList.jsx (Updated with Continue Editing Button for Drafts)

import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import InvoiceModal from "../components/InvoiceModal";
import api from "../api";

export default function AgreementList() {
  const [agreements, setAgreements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedInvoices, setSelectedInvoices] = useState([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalCategory, setModalCategory] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [escrowFilter, setEscrowFilter] = useState("all");
  const [showOnlyDrafts, setShowOnlyDrafts] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 10;
  const navigate = useNavigate();

  useEffect(() => {
    const fetchAgreements = async () => {
      setLoading(true);
      try {
        const { data } = await api.get("/projects/agreements/");
        setAgreements(data);
        setError("");
      } catch (err) {
        console.error("Error fetching agreements:", err);
        setError("Failed to load agreements. Please try again later.");
        setAgreements([]);
      } finally {
        setLoading(false);
      }
    };
    fetchAgreements();
  }, []);

  const filteredAgreements = useMemo(() => {
    return agreements
      .filter((a) => {
        if (statusFilter === "active") return !a.is_archived;
        if (statusFilter === "archived") return a.is_archived;
        return true;
      })
      .filter((a) => {
        if (escrowFilter === "funded") return a.escrow_funded;
        if (escrowFilter === "pending") return !a.escrow_funded;
        return true;
      })
      .filter((a) => {
        if (showOnlyDrafts) return !a.signed_by_contractor;
        return true;
      })
      .filter((a) => {
        if (!searchTerm) return true;
        const target = `${a.project_name || a.project_title || ''} ${a.homeowner_name || a.homeowner?.name || ''} ${a.id}`.toLowerCase();
        return target.includes(searchTerm.toLowerCase());
      });
  }, [agreements, searchTerm, statusFilter, escrowFilter, showOnlyDrafts]);

  const paginatedAgreements = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredAgreements.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredAgreements, currentPage]);

  const totalPages = Math.ceil(filteredAgreements.length / ITEMS_PER_PAGE);

  const handleViewInvoices = (invoices, agreementId) => {
    setSelectedInvoices(invoices || []);
    setModalCategory("Agreement");
    setModalVisible(true);
  };

  const handleModalClose = () => {
    setModalVisible(false);
  };

  return (
    <div className="p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-4">
        <h2 className="text-2xl font-semibold text-gray-800">Agreements</h2>
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            placeholder="Search by project, homeowner, or ID..."
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
            className="border px-3 py-2 rounded shadow-sm"
          />
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setCurrentPage(1); }}
            className="border px-2 py-2 rounded"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
          <select
            value={escrowFilter}
            onChange={(e) => { setEscrowFilter(e.target.value); setCurrentPage(1); }}
            className="border px-2 py-2 rounded"
          >
            <option value="all">All Escrow</option>
            <option value="funded">Escrow Funded</option>
            <option value="pending">Escrow Pending</option>
          </select>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-600">
            <input
              type="checkbox"
              checked={showOnlyDrafts}
              onChange={() => setShowOnlyDrafts(prev => !prev)}
              className="form-checkbox h-4 w-4"
            />
            Only Drafts
          </label>
          <button
            onClick={() => navigate("/agreements/new")}
            className="bg-blue-600 text-white font-semibold px-4 py-2 rounded hover:bg-blue-700"
          >
            + New Agreement
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center text-blue-600 py-12">Loading agreements…</div>
      ) : error ? (
        <div className="text-center text-red-500 py-6">{error}</div>
      ) : filteredAgreements.length === 0 ? (
        <div className="text-gray-500">No agreements match your filters.</div>
      ) : (
        <div className="overflow-x-auto rounded shadow bg-white">
          <table className="min-w-full text-sm text-gray-700">
            <thead className="bg-gray-100 text-left">
              <tr>
                <th className="py-2 px-4">Agreement ID</th>
                <th className="py-2 px-4">Project</th>
                <th className="py-2 px-4">Homeowner</th>
                <th className="py-2 px-4">Start</th>
                <th className="py-2 px-4">End</th>
                <th className="py-2 px-4">Total</th>
                <th className="py-2 px-4">Escrow</th>
                <th className="py-2 px-4">Invoices</th>
                <th className="py-2 px-4">Action</th>
              </tr>
            </thead>
            <tbody>
              {paginatedAgreements.map((a) => (
                <tr key={a.id} className="hover:bg-gray-50">
                  <td className="py-2 px-4 font-mono text-blue-600 cursor-pointer underline" onClick={() => navigate(`/agreements/${a.id}`)}>
                    #{a.id}
                    {!a.signed_by_contractor && <span className="ml-2 text-xs text-yellow-700 bg-yellow-100 px-2 py-0.5 rounded-full">Draft</span>}
                  </td>
                  <td className="py-2 px-4">{a.project_name || a.project_title || "-"}</td>
                  <td className="py-2 px-4">{a.homeowner_name || a.homeowner?.name || "-"}</td>
                  <td className="py-2 px-4">{a.start_date || "—"}</td>
                  <td className="py-2 px-4">{a.end_date || "—"}</td>
                  <td className="py-2 px-4">${parseFloat(a.total_cost || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                  <td className="py-2 px-4">
                    <span className={`px-2 py-1 rounded text-white ${a.escrow_funded ? "bg-green-500" : "bg-yellow-500"}`}>
                      {a.escrow_funded ? "Funded" : "Pending"}
                    </span>
                  </td>
                  <td className="py-2 px-4">
                    <button
                      onClick={() => handleViewInvoices(a.milestone_invoices, a.id)}
                      className={`text-blue-500 hover:underline ${!a.milestone_invoices?.length ? "opacity-50 cursor-default" : ""}`}
                      disabled={!a.milestone_invoices?.length}
                    >
                      {a.milestone_invoices?.length || 0} Invoices
                    </button>
                  </td>
                  <td className="py-2 px-4">
                    {!a.signed_by_contractor && (
                      <button
                        onClick={() => navigate(`/agreements/new?id=${a.id}`)}
                        className="text-blue-600 hover:underline text-sm"
                      >
                        Continue Editing
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex justify-between items-center mt-6">
          <p className="text-sm text-gray-500">
            Page {currentPage} of {totalPages}
          </p>
          <div className="flex gap-2">
            <button disabled={currentPage === 1} onClick={() => setCurrentPage((p) => p - 1)} className="px-3 py-1 bg-gray-200 rounded disabled:opacity-50">Prev</button>
            <button disabled={currentPage === totalPages} onClick={() => setCurrentPage((p) => p + 1)} className="px-3 py-1 bg-gray-200 rounded disabled:opacity-50">Next</button>
          </div>
        </div>
      )}

      <InvoiceModal visible={modalVisible} onClose={handleModalClose} invoices={selectedInvoices} category={modalCategory} />
    </div>
  );
}
