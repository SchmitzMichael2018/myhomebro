import React from 'react';

export default function AgreementHeader({ agreement }) {
  if (!agreement) return null;
  const { project } = agreement;
  const title = project?.title || 'Untitled Agreement';

  const status = (() => {
    if (agreement.is_fully_signed) return agreement.escrow_funded ? 'Funded' : 'Signed';
    if (agreement.signed_by_homeowner || agreement.signed_by_contractor) return 'Partially Signed';
    return 'Pending Signatures';
  })();

  const statusClass = {
    Funded: 'bg-green-100 text-green-800',
    Signed: 'bg-blue-100 text-blue-800',
    'Partially Signed': 'bg-indigo-100 text-indigo-800',
    'Pending Signatures': 'bg-yellow-100 text-yellow-800',
  }[status];

  return (
    <div className="flex items-center justify-between mb-6">
      <h1 className="text-3xl font-bold text-gray-800">{title}</h1>
      <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusClass}`}>{status}</span>
    </div>
  );
}