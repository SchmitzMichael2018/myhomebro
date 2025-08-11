import { useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import api from "../api";
import Modal from "./Modal";

function getStatusText(status) {
  if (status === "paid") return "Paid";
  if (status === "approved") return "Approved";
  if (status === "completed" || status === "complete") return "Completed";
  if (status === "pending") return "Incomplete";
  if (status === "disputed") return "Disputed";
  return status;
}

export default function InvoiceModal({ visible, onClose, invoices, category }) {
  const [loadingId, setLoadingId] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  if (!visible) return null;

  const handleAction = async (id, action) => {
    setLoadingId(id);
    setErrorMessage("");
    try {
      const res = await api.patch(`/projects/invoices/${id}/${action}/`);
      if (res.status === 200) {
        alert(`Invoice ${action.replace("_", " ")} successfully.`);
        onClose();
      } else {
        setErrorMessage(`Failed to ${action} invoice. Please try again.`);
      }
    } catch (err) {
      console.error("Error updating invoice:", err);
      setErrorMessage("An error occurred. Please try again.");
    } finally {
      setLoadingId(null);
    }
  };

  const handleDownloadPDF = () => {
    setPdfLoading(true);
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text(`${category} Invoices - ${new Date().toLocaleDateString()}`, 14, 18);

    autoTable(doc, {
      startY: 24,
      head: [["ID", "Project", "Amount", "Status"]],
      body: invoices.map((inv) => [
        inv.id,
        inv.project_title || inv.project_name,
        (inv.amount_due ?? inv.amount).toLocaleString("en-US", {
          style: "currency",
          currency: "USD",
        }),
        getStatusText(inv.status),
      ]),
      foot: [
        [
          "",
          "Total",
          invoices
            .reduce(
              (acc, inv) => acc + parseFloat((inv.amount_due ?? inv.amount) || 0),
              0
            )
            .toLocaleString("en-US", { style: "currency", currency: "USD" }),
          "",
        ],
      ],
    });

    doc.save(
      `${category.toLowerCase().replace(/\s+/g, "_")}_invoices_${new Date()
        .toLocaleDateString()
        .replace(/\//g, "-")}.pdf`
    );
    setPdfLoading(false);
  };

  return (
    <Modal visible={visible} title={`${category} Milestone Invoices`} onClose={onClose}>
      <div className="space-y-4">
        {errorMessage && (
          <p className="text-red-500 mb-4 text-center">{errorMessage}</p>
        )}

        {invoices.length === 0 ? (
          <p className="text-gray-500 text-center py-8">
            No invoices found in this category.
          </p>
        ) : (
          <>
            <div className="flex justify-between items-center mb-4">
              <button
                type="button"
                onClick={handleDownloadPDF}
                className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700 flex items-center"
                disabled={pdfLoading}
              >
                {pdfLoading ? (
                  <>
                    <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    </svg>
                    Generating PDF...
                  </>
                ) : (
                  "Download PDF"
                )}
              </button>
            </div>

            <table className="min-w-full text-sm border border-gray-200">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-2 text-left">ID</th>
                  <th className="px-4 py-2 text-left">Project</th>
                  <th className="px-4 py-2 text-left">Amount</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const amount = parseFloat(inv.amount_due ?? inv.amount ?? 0);
                  return (
                    <tr key={inv.id} className="border-t hover:bg-gray-50">
                      <td className="px-4 py-2 font-mono">#{inv.id}</td>
                      <td className="px-4 py-2">{inv.project_title || inv.project_name}</td>
                      <td className="px-4 py-2">
                        {amount.toLocaleString("en-US", {
                          style: "currency",
                          currency: "USD",
                        })}
                      </td>
                      <td className="px-4 py-2">{getStatusText(inv.status)}</td>
                      <td className="px-4 py-2 space-x-2">
                        {inv.status === "pending" && (
                          <button
                            type="button"
                            onClick={() => handleAction(inv.id, "mark_complete")}
                            className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
                            disabled={loadingId === inv.id || pdfLoading}
                          >
                            {loadingId === inv.id ? "..." : "Mark Complete"}
                          </button>
                        )}
                        {inv.status === "completed" && (
                          <button
                            type="button"
                            onClick={() => handleAction(inv.id, "approve")}
                            className="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600"
                            disabled={loadingId === inv.id || pdfLoading}
                          >
                            {loadingId === inv.id ? "..." : "Approve"}
                          </button>
                        )}
                        {inv.status !== "paid" && (
                          <button
                            type="button"
                            onClick={() => handleAction(inv.id, "dispute")}
                            className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600"
                            disabled={loadingId === inv.id || pdfLoading}
                          >
                            {loadingId === inv.id ? "..." : "Dispute"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>
    </Modal>
  );
}
