 // src/components/SignatureModal.jsx
import React, { useState } from "react";

export default function SignatureModal({ visible, onClose, onSubmit, loading }) {
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
            <a
              href="https://www.fdic.gov/regulations/laws/rules/6500-3170.html"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 underline"
            >
              E-SIGN Act
            </a>
            .
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
        {/* Optionally, show timestamp: */}
        {/* <div className="text-sm text-gray-500 mb-2">Timestamp: {new Date().toLocaleString()}</div> */}
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
