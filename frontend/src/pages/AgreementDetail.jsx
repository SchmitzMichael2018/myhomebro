// src/pages/AgreementDetail.jsx
import React, { useEffect, useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "../api";
import InvoiceModal from "../components/InvoiceModal";
import AgreementStatus from '../components/AgreementStatus';
import SignatureModal from '../components/SignatureModal'; // ✅ use shared modal
import EscrowPromptModal from '../components/EscrowPromptModal'; // future integration

function getStatusLabel(status) {
  if (!status) return "Unknown";
  return status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ');
}

const AgreementDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  const [agreement, setAgreement] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");

  const [modalVisible, setModalVisible] = useState(false);
  const [selectedInvoices, setSelectedInvoices] = useState([]);
  const [modalCategory, setModalCategory] = useState("");

  const [signatureModalVisible, setSignatureModalVisible] = useState(false);
  const [signatureLoading, setSignatureLoading] = useState(false);

  const [showEscrowPrompt, setShowEscrowPrompt] = useState(false);
  const [stripeClientSecret, setStripeClientSecret] = useState("");

  const fetchAgreement = async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get(`/projects/agreements/${id}/`);
      setAgreement(data);
    } catch (err) {
      setError("Failed to load agreement. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAgreement();
  }, [id]);

  const handleViewInvoices = (invoices, category) => {
    setSelectedInvoices(invoices);
    setModalCategory(category);
    setModalVisible(true);
  };

  const handleModalClose = () => {
    setModalVisible(false);
    fetchAgreement();
  };

  const handleSign = () => {
    setSignatureModalVisible(true);
  };

  const handleSignatureSubmit = async (typedName) => {
    setSignatureLoading(true);
    try {
      await api.patch(`/projects/agreements/${id}/sign/`, {
        typed_name: typedName,
        accepted: true,
        signed_at: new Date().toISOString(),
      });
      setSignatureModalVisible(false);
      const res = await api.post(`/projects/agreements/${id}/fund_escrow/`);
      setStripeClientSecret(res.data.client_secret);
      setShowEscrowPrompt(true);
      fetchAgreement();
    } catch (err) {
      alert("Failed to sign agreement.");
    } finally {
      setSignatureLoading(false);
    }
  };

  const handleDownloadPDF = async () => {
    try {
      const token = localStorage.getItem("access");
      const response = await fetch(`/api/projects/agreements/${id}/pdf/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("PDF download failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `agreement_${id}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      alert("Failed to download PDF.");
    }
  };

  const handleInvoiceAction = async (invoiceId, action) => {
    setActionLoading(true);
    try {
      await api.patch(`/projects/invoices/${invoiceId}/${action}/`);
      fetchAgreement();
    } finally {
      setActionLoading(false);
    }
  };

  const totalInvoicesAmount = useMemo(() => {
    if (!agreement?.milestone_invoices) return "0.00";
    return agreement.milestone_invoices
      .reduce((acc, inv) => acc + parseFloat(inv.amount || 0), 0)
      .toFixed(2);
  }, [agreement]);

  if (loading) return <div className="p-6 text-center">Loading...</div>;
  if (error) return <div className="p-6 text-center text-red-500">{error}</div>;
  if (!agreement) return <div className="p-6 text-center text-gray-500">Agreement not found.</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <button onClick={() => navigate("/agreements")} className="text-blue-500 hover:underline">← Back</button>

      <div className="bg-blue-50 border-l-4 border-blue-600 p-4 rounded shadow-sm">
        <h2 className="text-2xl font-bold mb-1">{agreement.project_title || "Untitled Project"}</h2>
        <p><strong>Homeowner:</strong> {agreement.homeowner_name}</p>
        <p><strong>Total Cost:</strong> ${parseFloat(agreement.total_cost).toFixed(2)}</p>
        <p>
          <strong>Status:</strong>{" "}
          {agreement.escrow_funded
            ? "✅ Escrow Funded"
            : agreement.project_signed
              ? "❌ Awaiting Funding"
              : "❌ Not Signed"}
        </p>
      </div>

      <AgreementStatus agreement={agreement} />

      <div className="flex space-x-4">
        {!agreement.project_signed && (
          <button
            onClick={handleSign}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
          >
            Sign Agreement
          </button>
        )}
        {agreement.project_signed && !agreement.escrow_funded && (
          <button
            onClick={async () => {
              const res = await api.post(`/projects/agreements/${id}/fund_escrow/`);
              setStripeClientSecret(res.data.client_secret);
              setShowEscrowPrompt(true);
            }}
            className="px-4 py-2 bg-yellow-500 text-white rounded hover:bg-yellow-600"
          >
            Fund Escrow
          </button>
        )}
        <button
          onClick={handleDownloadPDF}
          className="px-4 py-2 bg-blue-700 text-white rounded hover:bg-blue-800"
        >
          Download PDF
        </button>
      </div>

      {/* Invoice Table */}
      <div className="bg-white p-6 rounded shadow">
        <h3 className="text-xl font-semibold mb-4">Milestone Invoices</h3>
        {agreement.milestone_invoices?.length > 0 ? (
          <>
            <p><strong>Total:</strong> ${totalInvoicesAmount}</p>
            <table className="w-full mt-3 border text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="p-2 text-left">Project</th>
                  <th className="p-2">Amount</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {agreement.milestone_invoices.map(inv => (
                  <tr key={inv.id} className="border-t hover:bg-gray-50">
                    <td className="p-2">{inv.project_title}</td>
                    <td className="p-2">${parseFloat(inv.amount || 0).toFixed(2)}</td>
                    <td className="p-2">{getStatusLabel(inv.status)}</td>
                    <td className="p-2 space-x-2">
                      {inv.status === "pending" && (
                        <>
                          <button onClick={() => handleInvoiceAction(inv.id, "approve")} className="bg-blue-500 text-white px-2 py-1 rounded">Approve</button>
                          <button onClick={() => handleInvoiceAction(inv.id, "dispute")} className="bg-red-500 text-white px-2 py-1 rounded">Dispute</button>
                        </>
                      )}
                      {inv.status === "approved" && (
                        <button onClick={() => handleInvoiceAction(inv.id, "mark_paid")} className="bg-green-600 text-white px-2 py-1 rounded">Mark Paid</button>
                      )}
                      <button onClick={() => handleViewInvoices([inv], "Invoice")} className="bg-gray-500 text-white px-2 py-1 rounded">View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p className="text-gray-500">No invoices yet.</p>
        )}
      </div>

      {/* Modals */}
      <InvoiceModal
        visible={modalVisible}
        onClose={handleModalClose}
        invoices={selectedInvoices}
        category={modalCategory}
      />
      <SignatureModal
        visible={signatureModalVisible}
        onClose={() => setSignatureModalVisible(false)}
        onSubmit={handleSignatureSubmit}
        loading={signatureLoading}
      />
      <EscrowPromptModal
        visible={showEscrowPrompt}
        onClose={() => setShowEscrowPrompt(false)}
        stripeClientSecret={stripeClientSecret}
      />
    </div>
  );
};

export default AgreementDetail;
