import React from 'react';
import { Link } from 'react-router-dom';
import { Edit, Trash2, Send, FileDown, ShieldCheck, DollarSign, CopyPlus } from 'lucide-react';

export default function AgreementActionButtons({
  agreement,
  isLoading,
  onSign,
  onSendInvite,
  onFund,
  onDownloadPDF,
  onDelete,
  onAmend,
}) {
  const canEdit     = !agreement.signed_by_contractor;
  const canSign     = !agreement.signed_by_contractor;
  const canSend     = agreement.signed_by_contractor && !agreement.signed_by_homeowner;
  const canFund     = agreement.is_fully_signed && !agreement.escrow_funded;
  const canDownload = agreement.escrow_funded;
  const canAmend    = agreement.is_fully_signed;

  return (
    <div className="bg-white p-4 rounded-lg shadow-sm border">
      <h3 className="font-bold text-lg mb-4">Agreement Actions</h3>
      <div className="flex flex-wrap gap-3">

        {canEdit && (
          <Link to={`/agreements/${agreement.id}/edit`} className="flex items-center px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700">
            <Edit size={18} className="mr-2" /> Edit Agreement
          </Link>
        )}

        {canSign && (
          <button onClick={onSign} disabled={isLoading} className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400">
            <ShieldCheck size={18} className="mr-2" /> Review & Sign
          </button>
        )}

        {canSend && (
          <button onClick={onSendInvite} disabled={isLoading} className="flex items-center px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:bg-gray-400">
            <Send size={18} className="mr-2" /> Send Invite
          </button>
        )}

        {canFund && (
          <button onClick={onFund} disabled={isLoading} className="flex items-center px-4 py-2 bg-yellow-600 text-white rounded-md hover:bg-yellow-700 disabled:bg-gray-400">
            <DollarSign size={18} className="mr-2" /> Fund Escrow
          </button>
        )}

        {canDownload && (
          <button onClick={onDownloadPDF} disabled={isLoading} className="flex items-center px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400">
            <FileDown size={18} className="mr-2" /> Download Executed PDF
          </button>
        )}

        {canAmend && (
          <button onClick={onAmend} disabled={isLoading} className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-gray-400">
            <CopyPlus size={18} className="mr-2" /> Amend Agreement
          </button>
        )}

        <button onClick={onDelete} disabled={isLoading} className="flex items-center px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:bg-gray-400 ml-auto">
          <Trash2 size={18} className="mr-2" /> Delete
        </button>
      </div>
    </div>
  );
}
