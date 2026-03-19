// src/components/InviteContractorButton.jsx
import React, { useState } from "react";
import InviteContractorModal from "./InviteContractorModal";

export default function InviteContractorButton({
  label = "Invite Your Contractor",
  className = "",
  apiBaseUrl = "/api", // ✅ matches api.js BASE_URL
}) {
  const [open, setOpen] = useState(false);

  // Match LandingPage CTA button styling
  const buttonStyle = {
    padding: "12px 18px",
    borderRadius: 12,
    border: "1px solid #e5e7eb",
    background: "#ffffff",
    color: "#0f172a",
    fontWeight: 800,
    minHeight: 44,
    boxShadow: "0 8px 22px rgba(0,0,0,.16)",
    cursor: "pointer",
  };

  return (
    <>
      <button
        type="button"
        style={buttonStyle}
        className={className}
        onClick={() => setOpen(true)}
      >
        {label}
      </button>

      <InviteContractorModal
        isOpen={open}
        onClose={() => setOpen(false)}
        apiBaseUrl={apiBaseUrl}
      />
    </>
  );
}
