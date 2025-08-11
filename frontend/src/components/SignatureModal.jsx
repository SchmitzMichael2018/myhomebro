// src/components/SignatureModal.jsx
import React, { useState, useEffect } from "react";
import { Spinner } from "./Spinner"; // Assuming a spinner component exists

export default function SignatureModal({ visible, onClose, onSubmit, loading, errorText }) {
  const [accepted, setAccepted] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [signatureFile, setSignatureFile] = useState(null);
  const [showFileError, setShowFileError] = useState(false);

  useEffect(() => {
    if (!visible) {
      setAccepted(false);
      setTypedName("");
      setSignatureFile(null);
      setShowFileError(false);
    }
  }, [visible]);

  if (!visible) return null;

  const handleFileChange = (e) => {
    setShowFileError(false);
    const file = e.target.files?.[0] || null;
    setSignatureFile(file);
  };

  const handleSubmit = () => {
    if (!typedName.trim() && !signatureFile) {
      setShowFileError(true);
      return;
    }
    onSubmit({ typedName: typedName.trim(), signatureFile });
  };

  const isSubmitDisabled = !accepted || loading || (!typedName.trim() && !signatureFile);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
      <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-md relative">
        <button onClick={onClose} className="absolute top-3 right-3 text-gray-400 hover:text-gray-600" aria-label="Close">&times;</button>
        
        <h3 className="text-xl font-bold mb-4">Sign Agreement</h3>

        <div className="mb-4 p-3 bg-yellow-100 text-yellow-900 text-sm border-l-4 border-yellow-500 rounded-r-lg space-y-2">
          <p>
            <strong>Important:</strong> By signing, you agree this constitutes a legally binding electronic signature per the{' '}
            <a 
              href="https://www.fdic.gov/regulations/laws/rules/6500-3170.html" 
              target="_blank" 
              rel="noopener noreferrer"
              className="font-semibold underline hover:text-yellow-900"
            >
              E-SIGN Act
            </a>.
          </p>
          <p>
            <strong>Please Note:</strong> Escrow account must be funded for this agreement to be considered valid.
          </p>
        </div>

        <div className="legal-documents-section mb-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
          <h4 className="text-md font-semibold text-gray-800">Legal Documents</h4>
          <p className="mt-1 text-xs text-gray-600">
            This agreement incorporates by reference the full Terms of Service and Privacy Policy.
          </p>
          
          <ul className="mt-3 space-y-1.5 text-sm">
            <li><a href="/legal/terms_of_service.html" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">View Summarized Terms (Web)</a></li>
            <li><a href="/static/legal/Full_terms_of_service.pdf" download className="text-blue-600 hover:underline">Download Full Binding Terms PDF</a></li>
            <li><a href="/legal/privacy_policy.html" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">View Summarized Privacy Policy (Web)</a></li>
            <li><a href="/static/legal/Full_privacy_policy.pdf" download className="text-blue-600 hover:underline">Download Full Binding Privacy Policy PDF</a></li>
          </ul>

          <hr className="my-4" />

          <label htmlFor="terms-agree" className="flex items-start cursor-pointer">
            <input
              type="checkbox"
              id="terms-agree"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 mt-0.5 shrink-0"
            />
            <span className="ml-3 text-sm text-gray-700">
              By checking this box, I acknowledge that I have read, understood, and agree to the MyHomeBro{' '}
              <a href="/legal/terms_of_service.html" target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-600 hover:underline">
                Terms of Service
              </a>{' '}and{' '}
              <a href="/legal/privacy_policy.html" target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-600 hover:underline">
                Privacy Policy
              </a>.
            </span>
          </label>
        </div>

        <div className={`transition-opacity duration-300 ${accepted ? 'opacity-100' : 'opacity-50'}`}>
          <input
            type="text"
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
            placeholder="Type your full name as signature"
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            disabled={!accepted}
          />

          <div className="text-center my-3 text-gray-500 font-semibold">— OR —</div>

          <div>
            <label htmlFor="signature-file" className="block text-sm font-medium text-gray-700 mb-1">Upload Signature Image</label>
            <input
              id="signature-file"
              type="file"
              accept="image/png, image/jpeg"
              onChange={handleFileChange}
              className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
              disabled={!accepted}
            />
          </div>
        </div>

        {(showFileError || errorText) && (
          <div className="mt-4 text-red-600 text-sm">
            {errorText || "You must provide either a typed name or upload a signature image."}
          </div>
        )}

        <div className="mt-6">
          <button
            onClick={handleSubmit}
            disabled={isSubmitDisabled}
            className="w-full bg-green-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? <Spinner /> : "Sign & Accept"}
          </button>
        </div>
      </div>
    </div>
  );
}
