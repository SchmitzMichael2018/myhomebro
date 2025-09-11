// src/pages/AgreementForm.legacy.jsx
import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Legacy form shim:
 * Prevents old code from posting { title, project_type, ... } payloads.
 * Redirects users to the new Wizard at /agreements/new.
 */
export default function AgreementFormLegacy() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate("/agreements/new", { replace: true, state: { fromLegacy: true } });
  }, [navigate]);

  return (
    <div className="max-w-xl mx-auto mt-16 bg-white rounded shadow p-6 text-center">
      <h2 className="text-2xl font-bold mb-2">This page moved</h2>
      <p className="text-gray-600">Redirecting to the new Agreement Wizard…</p>
      <p className="mt-4">
        If not redirected,{" "}
        <button
          onClick={() => navigate("/agreements/new", { replace: true })}
          className="text-blue-600 hover:underline"
        >
          click here
        </button>.
      </p>
    </div>
  );
}
