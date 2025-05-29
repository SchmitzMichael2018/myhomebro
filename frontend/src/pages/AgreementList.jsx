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
  const [selectedAgreementId, setSelectedAgreementId] = useState(null);
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

  // Filtered Agreements based on Search Term
  const filteredAgreements = useMemo(() => {
    if (!searchTerm) return agreements;
    return agreements.filter(
      (a) =>
        (a.project_name || a.project_title || "-").toLowerCase().includes(searchTerm.toLowerCase()) ||
        (a.homeowner_name || a.homeowner?.name || "-").toLowerCase().includes(searchTerm.toLowerCase()) ||
        String(a.id).includes(searchTerm)
    );
  }, [agreements, searchTerm]);

  const handleViewInvoices = (invoices, agreementId) => {
    setSelectedInvoices(invoices || []);
    setModalCategory("Agreement");
    setSelectedAgreementId(agreementId);
    setModalVisible(true);
  };

  const handleModalClose = () => {
    setModalVisible(false);
    setSelectedAgreementId(null);
    // Uncomment the line below if you want to refresh data on modal close
    // fetchAgreements();
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-semibold text-gray-800">Agreements</h2>
        <input
          type="text"
          placeholder="Search by project, homeowner, or ID..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="border px-4 py-2 rounded shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="flex items-center space-x-2 text-blue-500">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            </svg>
            <p>Loading agreements...</p>
          </div>
        </div>
      ) : error ? (
        <div className="text-center text-red-500">
          <p>{error}</p>
        </div>
      ) : filteredAgreements.length === 0 ? (
        <p className="text-gray-500">No agreements found.</p>
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
              </tr>
            </thead>
            <tbody>
              {filteredAgreements.map((a) => (
                <tr
                  key={a.id}
                  className={`hover:bg-gray-50 ${selectedAgreementId === a.id ? "bg-blue-50" : ""}`}
                >
                  <td
                    className="py-2 px-4 font-mono text-blue-600 cursor-pointer underline"
                    onClick={() => navigate(`/agreements/${a.id}`)}
                  >
                    #{a.id}
                  </td>
                  <td className="py-2 px-4">{a.project_name || a.project_title || "-"}</td>
                  <td className="py-2 px-4">{a.homeowner_name || a.homeowner?.name || "-"}</td>
                  <td className="py-2 px-4">{a.start_date || "—"}</td>
                  <td className="py-2 px-4">{a.end_date || "—"}</td>
                  <td className="py-2 px-4">
                    ${parseFloat(a.total_cost || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td className="py-2 px-4">
                    <span
                      className={`px-2 py-1 rounded text-white ${
                        a.escrow_funded ? "bg-green-500" : "bg-yellow-500"
                      }`}
                    >
                      {a.escrow_funded ? "Funded" : "Pending"}
                    </span>
                  </td>
                  <td className="py-2 px-4">
                    <button
                      onClick={() => handleViewInvoices(a.milestone_invoices, a.id)}
                      className={`text-blue-500 hover:underline ${!a.milestone_invoices?.length ? "opacity-50 cursor-default" : ""}`}
                      aria-label={`View invoices for agreement #${a.id}`}
                      disabled={!a.milestone_invoices?.length}
                    >
                      {a.milestone_invoices?.length || 0} Invoices
                    </button>
                    {/* If your backend uses `a.invoices` instead, change all `milestone_invoices` to `invoices` above */}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <InvoiceModal
        visible={modalVisible}
        onClose={handleModalClose}
        invoices={selectedInvoices}
        category={modalCategory}
      />
    </div>
  );
}



