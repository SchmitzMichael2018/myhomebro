// src/components/AgreementModal.jsx (Enhanced with Signature Type & Validation)

import React, { useState } from "react";
import api from "./api";
import SignatureCanvas from "./SignatureCanvas";
import { Spinner } from "./Spinner"; // Optional Spinner Component

const AgreementModal = ({ agreement, onClose, onSigned }) => {
  const [showSignaturePad, setShowSignaturePad] = useState(false);
  const [signed, setSigned] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [signatureType, setSignatureType] = useState("e-signature");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const handleSaveSignature = async ({ typedName, drawnSignature }) => {
    setLoading(true);
    setErrorMessage("");
    try {
      const response = await api.post(
        `/projects/agreements/${agreement.id}/sign/`,
        {
          signature_type: signatureType,
          typed_name: typedName,
          drawn_signature: drawnSignature,
        }
      );
      if (response.status === 200) {
        setSigned(true);
        onSigned();
        setShowSignaturePad(false);
      } else {
        throw new Error("Failed to sign the agreement. Please try again.");
      }
    } catch (error) {
      console.error("Error signing agreement:", error);
      setErrorMessage("An error occurred while signing. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50" role="dialog" aria-modal="true">
      <div className="bg-white p-6 rounded-lg shadow-lg max-w-md w-full relative">
        <h3 className="text-xl font-bold mb-2">{agreement.project_title || agreement.project_name}</h3>
        <p>Homeowner: {agreement.homeowner_name || "—"}</p>
        <p>Contractor: {agreement.contractor_name || "—"}</p>

        {!signed && (
          <>
            <div className="my-4">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                className="mr-2"
                id="accept-signature"
              />
              <label htmlFor="accept-signature">
                I agree to sign this agreement electronically in accordance with the {" "}
                <a
                  href="https://www.fdic.gov/regulations/laws/rules/6500-3170.html"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 underline"
                >
                  E-SIGN Act
                </a>.
              </label>
            </div>

            <div className="mt-4">
              <label className="block mb-2 font-semibold">Select Signature Type:</label>
              <select
                value={signatureType}
                onChange={(e) => setSignatureType(e.target.value)}
                className="w-full p-2 border rounded"
              >
                <option value="e-signature">E-Signature (Typed or Drawn)</option>
                <option value="digital-signature">Digital Signature (Secure)</option>
              </select>
            </div>

            {errorMessage && <p className="text-red-500 mt-2">{errorMessage}</p>}

            <button
              onClick={() => setShowSignaturePad(true)}
              disabled={!accepted || loading}
              className={`mt-4 px-6 py-2 text-white rounded ${loading ? "bg-gray-400" : "bg-blue-600 hover:bg-blue-700"}`}
            >
              {loading ? <Spinner /> : "Sign Agreement"}
            </button>
          </>
        )}

        {showSignaturePad && (
          <SignatureCanvas onSave={handleSaveSignature} />
        )}

        {signed && (
          <p className="text-green-600 font-bold mt-4">✅ Agreement Signed Successfully</p>
        )}

        <button
          onClick={onClose}
          className="absolute top-2 right-2 text-gray-500 hover:text-gray-700"
          aria-label="Close"
        >
          ✖
        </button>
      </div>
    </div>
  );
};

export default AgreementModal;
