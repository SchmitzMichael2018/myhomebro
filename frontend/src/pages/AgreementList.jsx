import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import InvoiceModal from "../components/InvoiceModal";

export default function AgreementList() {
  const [agreements, setAgreements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedInvoices, setSelectedInvoices] = useState([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalCategory, setModalCategory] = useState("");
  const token = localStorage.getItem("access");
  const navigate = useNavigate();

  useEffect(() => {
    const fetchAgreements = async () => {
      setLoading(true);
      try {
        const res = await fetch("http://127.0.0.1:8080/api/projects/agreements/", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (!res.ok) throw new Error("Failed to fetch agreements");
        const data = await res.json();
        setAgreements(data);
      } catch (err) {
        console.error("Error fetching agreements:", err);
        setAgreements([]);
      } finally {
        setLoading(false);
      }
    };

    fetchAgreements();
  }, [token]);

  const handleViewInvoices = (invoices) => {
    setSelectedInvoices(invoices);
    setModalCategory("Agreement");
    setModalVisible(true);
  };

  return (
    <div className="p-6">
      <h2 className="text-2xl font-semibold text-gray-800 mb-4">Agreements</h2>

      {loading ? (
        <p className="text-gray-500">Loading agreements...</p>
      ) : agreements.length === 0 ? (
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
              {agreements.map((a) => (
                <tr key={a.id} className="hover:bg-gray-50">
                  <td
                    className="py-2 px-4 font-mono text-blue-600 cursor-pointer"
                    onClick={() => navigate(`/agreements/${a.id}`)}
                  >
                    #{a.id}
                  </td>
                  <td className="py-2 px-4">{a.project_name}</td>
                  <td className="py-2 px-4">{a.homeowner_name}</td>
                  <td className="py-2 px-4">{a.start_date}</td>
                  <td className="py-2 px-4">{a.end_date}</td>
                  <td className="py-2 px-4">${parseFloat(a.total_cost).toLocaleString()}</td>
                  <td className="py-2 px-4">
                    {a.escrow_funded ? (
                      <span className="text-green-600 font-semibold">Funded</span>
                    ) : (
                      <span className="text-yellow-600 font-semibold">Pending</span>
                    )}
                  </td>
                  <td className="py-2 px-4">
                    <button
                      onClick={() => handleViewInvoices(a.milestone_invoices)}
                      className="text-blue-500 hover:underline"
                    >
                      {a.milestone_invoices?.length || 0} Invoices
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <InvoiceModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        invoices={selectedInvoices}
        category={modalCategory}
      />
    </div>
  );
}
