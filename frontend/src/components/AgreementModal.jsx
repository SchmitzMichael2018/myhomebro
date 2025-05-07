// src/components/AgreementModal.jsx
import React, { useState } from "react";
import axios from "axios";
import SignatureCanvas from "./SignatureCanvas";

const AgreementModal = ({ agreement, onClose, onSigned }) => {
  const [showSignaturePad, setShowSignaturePad] = useState(false);
  const [signed, setSigned] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [signatureType, setSignatureType] = useState("e-signature"); // Default to E-Signature

  const handleSaveSignature = async ({ typedName, drawnSignature }) => {
    try {
      const response = await axios.post(
        `/api/projects/agreements/${agreement.id}/sign/`,
        {
          signatureType,
          typedName,
          drawnSignature,
        },
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("access_token")}`,
          },
        }
      );

      if (response.status === 200) {
        alert("Agreement signed successfully.");
        setSigned(true);
        onSigned();
        setShowSignaturePad(false);
      }
    } catch (error) {
      console.error("Error signing agreement:", error);
      alert("Failed to sign the agreement. Please try again.");
    }
  };

  return (
    <div className="agreement-modal">
      <h3>{agreement.project_name}</h3>
      <p>Homeowner: {agreement.homeowner_name}</p>
      <p>Contractor: {agreement.contractor_name}</p>

      {!signed && (
        <>
          <div className="agreement-terms">
            <input 
              type="checkbox" 
              checked={accepted} 
              onChange={(e) => setAccepted(e.target.checked)} 
            />
            <label>
              I agree to sign this agreement electronically in accordance with the{" "}
              <a href="https://www.fdic.gov/regulations/laws/rules/6500-3170.html" target="_blank" rel="noopener noreferrer">
                E-SIGN Act
              </a>.
            </label>
          </div>

          <div className="signature-options">
            <label>Select Signature Type:</label>
            <select value={signatureType} onChange={(e) => setSignatureType(e.target.value)}>
              <option value="e-signature">E-Signature (Typed or Drawn)</option>
              <option value="digital-signature">Digital Signature (Secure)</option>
            </select>
          </div>

          <button 
            onClick={() => setShowSignaturePad(true)} 
            disabled={!accepted}>
            Sign Agreement
          </button>
        </>
      )}

      {showSignaturePad && (
        <SignatureCanvas onSave={handleSaveSignature} />
      )}

      {signed && <p className="signed-message">Agreement Signed ✅</p>}
      <button onClick={onClose}>Close</button>
    </div>
  );
};

export default AgreementModal;
