// src/components/AgreementStatus.jsx (Enhanced with Sign Date Support)

import React from 'react';
import { format, parseISO } from 'date-fns';

const StatusIndicator = ({ signed }) => {
  const color = signed ? 'bg-green-500' : 'bg-yellow-500';
  return <span className={`w-3 h-3 rounded-full inline-block mr-2 ${color}`}></span>;
};

export default function AgreementStatus({ agreement }) {
  if (!agreement) return <div>Loading status...</div>;

  const signedByHomeowner = agreement.signed_by_homeowner;
  const signedByContractor = agreement.signed_by_contractor;
  const homeownerDate = agreement.signed_at_homeowner;
  const contractorDate = agreement.signed_at_contractor;

  return (
    <div className="bg-gray-100 p-4 rounded-lg shadow mt-4">
      <h4 className="text-lg font-bold mb-3">Signature Status</h4>
      <div className="space-y-2">
        <p className="flex items-center text-gray-800">
          <StatusIndicator signed={signedByHomeowner} />
          Homeowner: {signedByHomeowner ? "Signed" : "Pending"}
          {signedByHomeowner && homeownerDate && (
            <span className="text-xs text-gray-500 ml-2">{format(parseISO(homeownerDate), 'PPP')}</span>
          )}
        </p>
        <p className="flex items-center text-gray-800">
          <StatusIndicator signed={signedByContractor} />
          Contractor: {signedByContractor ? "Signed" : "Pending"}
          {signedByContractor && contractorDate && (
            <span className="text-xs text-gray-500 ml-2">{format(parseISO(contractorDate), 'PPP')}</span>
          )}
        </p>
      </div>
    </div>
  );
}
