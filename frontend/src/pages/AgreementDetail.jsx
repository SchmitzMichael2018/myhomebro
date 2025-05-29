// src/pages/AgreementDetail.jsx

import React, { useEffect, useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "../api";
import InvoiceModal from "../components/InvoiceModal";

// --- SignatureModal: For agreement signing with legal disclaimer ---
function SignatureModal({ visible, onClose, onSubmit, loading }) {
  const [accepted, setAccepted] = useState(false);
  const [typedName, setTypedName] = useState("");
  if (!visible) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded shadow max-w-sm w-full relative">
        <button
          onClick={onClose}
          className="absolute top-2 right-2 text-gray-500 hover:text-gray-700 text-xl"
          aria-label="Close"
        >
          ✖
        </button>
        <h3 className="text-xl font-bold mb-2">Sign Agreement</h3>
        <div className="mb-3 p-2 bg-yellow-100 text-yellow-800 border-l-4 border-yellow-500 rounded">
          <strong>Important:</strong> This agreement is <u>only valid and enforceable if the escrow account is fully funded</u>. If escrow is not funded, this agreement is considered null and void.
        </div>
        <div className="mb-4">
          <input
            type="checkbox"
            id="accept-signature"
            checked={accepted}
            onChange={e => setAccepted(e.target.checked)}
            className="mr-2"
          />
          <label htmlFor="accept-signature">
            I agree that checking this box and typing my name below serves as my electronic signature, legally binding under the{" "}
            <a href="https://www.fdic.gov/regulations/laws/rules/6500-3170.html" target="_blank" rel="noopener noreferrer" className="text-blue-500 underline">E-SIGN Act</a>.
          </label>
        </div>
        <input
          type="text"
          value={typedName}
          onChange={e => setTypedName(e.target.value)}
          placeholder="Type your name"
          className="w-full p-2 border rounded mb-4"
          disabled={!accepted}
        />
        <button
          onClick={() => onSubmit(typedName)}
          disabled={!accepted || !typedName.trim() || loading}
          className={`w-full bg-green-600 text-white py-2 rounded ${(!accepted || !typedName.trim() || loading) ? "opacity-60 cursor-not-allowed" : ""}`}
        >
          {loading ? "Signing..." : "Sign Agreement"}
        </button>
      </div>
    </div>
  );
}

// --- EscrowPromptModal: After signing, prompt user to fund escrow ---
function EscrowPromptModal({ visible, onClose, stripeClientSecret }) {
  if (!visible) return null;

  // Example: direct link to a pay page, or embed Stripe Elements here
  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded shadow max-w-md w-full relative">
        <button
          onClick={onClose}
          className="absolute top-2 right-2 text-gray-500 hover:text-gray-700 text-xl"
          aria-label="Close"
        >
          ✖
        </button>
        <h3 className="text-xl font-bold mb-2">Escrow Funding Required</h3>
        <p className="mb-4">
          Agreement signed! To activate and enforce this agreement, you must fund the escrow account.
        </p>
        <a
          href={`/pay?client_secret=${stripeClientSecret}`}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full bg-blue-600 text-white py-2 rounded text-center font-bold hover:bg-blue-700"
        >
          Fund Escrow with Stripe
        </a>
        <p className="text-xs text-gray-500 mt-3">
          You will be redirected to Stripe’s secure payment page.
        </p>
      </div>
    </div>
  );
}

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

  // Signature modal
  const [signatureModalVisible, setSignatureModalVisible] = useState(false);
  const [signatureLoading, setSignatureLoading] = useState(false);

  // Escrow funding prompt
  const [showEscrowPrompt, setShowEscrowPrompt] = useState(false);
  const [stripeClientSecret, setStripeClientSecret] = useState("");

  // Fetch agreement (and its milestone_invoices)
  const fetchAgreement = async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get(`/projects/agreements/${id}/`);
      setAgreement(data);
    } catch (err) {
      console.error(err);
      setError("Failed to load agreement. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAgreement();
    // eslint-disable-next-line
  }, [id]);

  // Handle “View” button in table
  const handleViewInvoices = (invoices, category) => {
    setSelectedInvoices(invoices);
    setModalCategory(category);
    setModalVisible(true);
  };

  // Close modal and refetch agreement (to update any invoice state)
  const handleModalClose = () => {
    setModalVisible(false);
    fetchAgreement();
  };

  // Handle user signature (open modal)
  const handleSign = () => {
    setSignatureModalVisible(true);
  };

  // Actually sign the agreement (with typed name)
  const handleSignatureSubmit = async (typedName) => {
    setSignatureLoading(true);
    try {
      await api.patch(`/projects/agreements/${id}/sign/`, {
        typed_name: typedName,
        accepted: true,
        signed_at: new Date().toISOString(),
      });
      setSignatureModalVisible(false);
      // Prompt for escrow funding
      const res = await api.post(`/projects/agreements/${id}/fund_escrow/`);
      setStripeClientSecret(res.data.client_secret);
      setShowEscrowPrompt(true);
      fetchAgreement();
    } catch (err) {
      alert("Failed to sign agreement. Please try again.");
      console.error(err);
    } finally {
      setSignatureLoading(false);
    }
  };

  // Download PDF
  const handleDownloadPDF = async () => {
    try {
      const token = localStorage.getItem("access");
      const response = await fetch(
        `/api/projects/agreements/${id}/pdf/`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      if (!response.ok) throw new Error("PDF download failed");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = url;
      link.download = `agreement_${id}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert("Failed to download PDF. Please try again.");
      console.error(err);
    }
  };

  // Invoice action: approve | dispute | mark_paid (patch)
  const handleInvoiceAction = async (invoiceId, action) => {
    setActionLoading(true);
    try {
      await api.patch(`/projects/invoices/${invoiceId}/${action}/`);
      fetchAgreement();
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(false);
    }
  };

  // Total of all invoice amounts
  const totalInvoicesAmount = useMemo(() => {
    if (!agreement?.milestone_invoices) return "0.00";
    const sum = agreement.milestone_invoices
      .reduce((acc, inv) => {
        const amt = inv.amount_due ?? inv.amount;
        return acc + parseFloat(amt || 0);
      }, 0);
    return sum.toFixed(2);
  }, [agreement]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-blue-500">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-red-500">{error}</p>
          <button
            onClick={() => navigate("/agreements")}
            className="mt-4 text-blue-500 hover:underline"
          >
            Back to Agreements
          </button>
        </div>
      </div>
    );
  }

  if (!agreement) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">Agreement not found.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <button
        onClick={() => navigate("/agreements")}
        className="text-blue-500 hover:underline"
      >
        ← Back
      </button>

      {/* Project Summary Card */}
      <div className="bg-blue-50 border-l-4 border-blue-600 p-4 mb-4 rounded shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold mb-1">{agreement.project_title_display || agreement.project_title || agreement.project_name}</h2>
          <p className="mb-1"><strong>Homeowner:</strong> {agreement.homeowner_name || agreement.homeowner?.name || "—"}</p>
          <p className="mb-1"><strong>Email:</strong> {agreement.homeowner_email || agreement.homeowner?.email || "—"}</p>
        </div>
        <div className="mt-3 sm:mt-0 flex flex-col sm:items-end">
          <p>
            <strong>Total Cost:</strong>{" "}
            <span className="text-blue-800 font-semibold">${parseFloat(agreement.total_cost).toFixed(2)}</span>
          </p>
          <p>
            <strong>Status:</strong>{" "}
            {agreement.escrow_funded
              ? <span className="text-green-700">✅ Escrow Funded</span>
              : agreement.project_signed
                ? <span className="text-yellow-700">❌ Awaiting Funding</span>
                : <span className="text-red-700">❌ Not Signed</span>
            }
          </p>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex space-x-4">
        {!agreement.project_signed && (
          <button
            onClick={handleSign}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
            disabled={actionLoading}
          >
            Sign Agreement
          </button>
        )}
        {agreement.project_signed && !agreement.escrow_funded && (
          <button
            onClick={async () => {
              // Prompt for funding if user wants to manually fund again
              const res = await api.post(`/projects/agreements/${id}/fund_escrow/`);
              setStripeClientSecret(res.data.client_secret);
              setShowEscrowPrompt(true);
            }}
            className="px-4 py-2 bg-yellow-500 text-white rounded hover:bg-yellow-600"
            disabled={actionLoading}
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

      {/* Milestone Invoices Table */}
      <div className="bg-white p-6 rounded shadow">
        <h3 className="text-xl font-semibold mb-4">Milestone Invoices</h3>
        {agreement.milestone_invoices && agreement.milestone_invoices.length > 0 ? (
          <>
            <p className="mb-2">
              <strong>Total Invoices:</strong> ${totalInvoicesAmount}
            </p>
            <table className="w-full text-sm border">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-3 py-2 text-left">Project</th>
                  <th className="px-3 py-2 text-left">Due Date</th>
                  <th className="px-3 py-2 text-left">Amount</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {agreement.milestone_invoices.map((inv) => {
                  const amt = inv.amount_due ?? inv.amount;
                  return (
                    <tr key={inv.id} className="border-t hover:bg-gray-50">
                      <td className="px-3 py-2">{inv.project_title || "—"}</td>
                      <td className="px-3 py-2">{inv.due_date || "—"}</td>
                      <td className="px-3 py-2">${parseFloat(amt || 0).toFixed(2)}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`px-2 py-1 rounded ${
                            inv.status === "paid"
                              ? "bg-green-100 text-green-700"
                              : inv.status === "pending"
                              ? "bg-yellow-100 text-yellow-700"
                              : inv.status === "approved"
                              ? "bg-blue-100 text-blue-700"
                              : inv.status === "disputed"
                              ? "bg-red-200 text-red-700"
                              : "bg-red-100 text-red-700"
                          }`}
                        >
                          {getStatusLabel(inv.status)}
                        </span>
                      </td>
                      <td className="px-3 py-2 space-x-2">
                        {inv.status === "pending" && (
                          <>
                            <button
                              onClick={() =>
                                handleInvoiceAction(inv.id, "approve")
                              }
                              className="px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
                              disabled={actionLoading}
                            >
                              Approve
                            </button>
                            <button
                              onClick={() =>
                                handleInvoiceAction(inv.id, "dispute")
                              }
                              className="px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600"
                              disabled={actionLoading}
                            >
                              Dispute
                            </button>
                          </>
                        )}
                        {inv.status === "approved" && (
                          <button
                            onClick={() =>
                              handleInvoiceAction(inv.id, "mark_paid")
                            }
                            className="px-2 py-1 bg-green-500 text-white rounded hover:bg-green-600"
                            disabled={actionLoading}
                          >
                            Mark Paid
                          </button>
                        )}
                        <button
                          onClick={() =>
                            handleViewInvoices([inv], "Invoice Details")
                          }
                          className="px-2 py-1 bg-gray-500 text-white rounded hover:bg-gray-600"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        ) : (
          <p className="text-gray-500">No invoices yet.</p>
        )}
      </div>

      {/* Invoice Modal */}
      {modalVisible && (
        <InvoiceModal
          visible={modalVisible}
          onClose={handleModalClose}
          invoices={selectedInvoices}
          category={modalCategory}
        />
      )}

      {/* Signature Modal */}
      <SignatureModal
        visible={signatureModalVisible}
        onClose={() => setSignatureModalVisible(false)}
        onSubmit={handleSignatureSubmit}
        loading={signatureLoading}
      />

      {/* Escrow Prompt Modal */}
      <EscrowPromptModal
        visible={showEscrowPrompt}
        onClose={() => setShowEscrowPrompt(false)}
        stripeClientSecret={stripeClientSecret}
      />
    </div>
  );
};

export default AgreementDetail;









