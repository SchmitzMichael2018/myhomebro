// frontend/src/components/AgreementEdit.jsx
import React from "react";
import { useParams, useLocation, Navigate } from "react-router-dom";
import AgreementWizard from "./AgreementWizard";

export default function AgreementEdit() {
  const { id } = useParams();
  const { pathname, search } = useLocation();

  // If user is on /agreements/:id/edit, normalize to wizard step 1
  const isLegacyEditPath = /^\/agreements\/\d+\/edit\/?$/.test(pathname);
  if (isLegacyEditPath) {
    const sp = new URLSearchParams(search || "");
    if (!sp.get("step")) sp.set("step", "1");
    return <Navigate replace to={`/agreements/${id}/wizard?${sp.toString()}`} />;
  }

  // Fallback: render wizard directly (covers any router setups that point here)
  return <AgreementWizard />;
}
