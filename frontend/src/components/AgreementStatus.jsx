// src/components/AgreementStatus.jsx
import React from "react";
import { format, parseISO } from "date-fns";

/**
 * Normalizes multiple serializer shapes:
 *  - signed_by_homeowner / signed_by_contractor
 *  - is_fully_signed, project_signed
 *  - signed_at_* dates (optional)
 *  - escrow_funded
 */
function pickBool(...vals) {
  for (const v of vals) if (typeof v === "boolean") return v;
  return false;
}
function pickStr(...vals) {
  for (const v of vals) if (typeof v === "string" && v) return v;
  return null;
}
function prettyDate(s) {
  try {
    return s ? format(parseISO(s), "PPP") : null;
  } catch {
    return null;
  }
}
const Dot = ({ ok }) => (
  <span className={`w-3 h-3 rounded-full inline-block mr-2 ${ok ? "bg-green-500" : "bg-yellow-500"}`} />
);

export default function AgreementStatus({ agreement }) {
  if (!agreement) return <div>Loading status...</div>;

  // Booleans from flat OR nested shapes
  const signedByHomeowner = pickBool(
    agreement.signed_by_homeowner,
    agreement.project?.signed_by_homeowner
  );
  const signedByContractor = pickBool(
    agreement.signed_by_contractor,
    agreement.project?.signed_by_contractor
  );
  const fullySigned = pickBool(
    agreement.is_fully_signed,
    agreement.project_signed,
    (signedByHomeowner && signedByContractor)
  );
  const escrowFunded = pickBool(
    agreement.escrow_funded,
    agreement.project?.escrow_funded
  );

  // Optional timestamps (flat or nested)
  const homeownerDate = pickStr(
    agreement.signed_at_homeowner,
    agreement.project?.signed_at_homeowner
  );
  const contractorDate = pickStr(
    agreement.signed_at_contractor,
    agreement.project?.signed_at_contractor
  );

  return (
    <div className="bg-gray-100 p-4 rounded-lg shadow mt-4">
      <h4 className="text-lg font-bold mb-3">Signature & Escrow Status</h4>

      <div className="space-y-2">
        <p className="flex items-center text-gray-800">
          <Dot ok={signedByHomeowner} />
          Homeowner: {signedByHomeowner ? "Signed" : "Pending"}
          {signedByHomeowner && prettyDate(homeownerDate) && (
            <span className="text-xs text-gray-500 ml-2">{prettyDate(homeownerDate)}</span>
          )}
        </p>

        <p className="flex items-center text-gray-800">
          <Dot ok={signedByContractor} />
          Contractor: {signedByContractor ? "Signed" : "Pending"}
          {signedByContractor && prettyDate(contractorDate) && (
            <span className="text-xs text-gray-500 ml-2">{prettyDate(contractorDate)}</span>
          )}
        </p>

        <p className="flex items-center text-gray-800">
          <Dot ok={fullySigned} />
          Overall: {fullySigned ? "Fully Signed" : "Awaiting Signatures"}
        </p>

        <p className="flex items-center text-gray-800">
          <Dot ok={escrowFunded} />
          Escrow: {escrowFunded ? "Funded" : "Pending"}
        </p>
      </div>
    </div>
  );
}
