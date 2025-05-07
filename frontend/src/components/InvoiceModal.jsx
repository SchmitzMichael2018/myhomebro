import { useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export default function InvoiceModal({ visible, onClose, invoices, category }) {
  const [loadingId, setLoadingId] = useState(null);
  const token = localStorage.getItem("access");

  if (!visible) return null;

  const handleAction = async (id, action) => {
    setLoadingId(id);
    try {
      const res = await fetch(`http://127.0.0.1:8080/api/projects/invoices/${id}/${action}/`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (res.ok) {
        alert(`Invoice ${action.replace("_", " ")} successfully.`);
      } else {
        alert(`Failed to ${action} invoice.`);
      }
    } catch (err) {
      console.error(err);
      alert("An error occurred.");
    } finally {
      setLoadingId(null);
    }
  };

  const handleDownloadPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text(`${category} Invoices`, 14, 18);

    autoTable(doc, {
      startY: 24,
      head: [["Project", "Amount", "Status"]],
      body: invoices.map((inv) => [
        inv.project_name,
        `$${parseFloat(inv.amount_due).toFixed(2)}`,
        inv.is_paid
          ? "Paid"
          : inv.is_approved
          ? "Approved"
          : inv.pending_approval
          ? "Pending Approval"
          : inv.is_complete
          ? "Completed"
          : "Incomplete",
      ]),
    });

    doc.save(`${category.toLowerCase().replace(/\s+/g, "_")}_invoices.pdf`);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-start p-8 overflow-y-auto z-50">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-4xl p-6 relative">
        <h3 className="text-2xl font-bold mb-4 text-gray-800">
          {category} Milestone Invoices
        </h3>

        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-500 hover:text-gray-800"
        >
          ✖
        </button>

        {invoices.length === 0 ? (
          <p className="text-gray-500 text-center py-8">
            No invoices found in this category.
          </p>
        ) : (
          <>
            <button
              onClick={handleDownloadPDF}
              className="mb-4 bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700"
            >
              Download PDF
            </button>
            <table className="min-w-full text-sm border border-gray-200">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-2 text-left">Project</th>
                  <th className="px-4 py-2 text-left">Amount</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-800">{inv.project_name}</td>
                    <td className="px-4 py-2 text-gray-800">
                      ${parseFloat(inv.amount_due).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                      })}
                    </td>
                    <td className="px-4 py-2 text-gray-800">
                      {inv.is_paid
                        ? "Paid"
                        : inv.is_approved
                        ? "Approved"
                        : inv.pending_approval
                        ? "Pending Approval"
                        : inv.is_complete
                        ? "Completed"
                        : "Incomplete"}
                    </td>
                    <td className="px-4 py-2 space-x-2">
                      {!inv.is_complete && (
                        <button
                          onClick={() => handleAction(inv.id, "mark_complete")}
                          className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
                          disabled={loadingId === inv.id}
                        >
                          {loadingId === inv.id ? "..." : "Mark Complete"}
                        </button>
                      )}
                      {inv.is_complete &&
                        inv.pending_approval &&
                        !inv.is_approved && (
                          <button
                            onClick={() => handleAction(inv.id, "approve")}
                            className="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600"
                            disabled={loadingId === inv.id}
                          >
                            {loadingId === inv.id ? "..." : "Approve"}
                          </button>
                        )}
                      {!inv.is_paid && (
                        <button
                          onClick={() => handleAction(inv.id, "dispute")}
                          className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600"
                          disabled={loadingId === inv.id}
                        >
                          {loadingId === inv.id ? "..." : "Dispute"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}




  