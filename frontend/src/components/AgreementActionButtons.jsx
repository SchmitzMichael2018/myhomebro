// src/components/AgreementActionButtons.jsx
import React from "react";
import { Link } from "react-router-dom";
import {
  Edit,
  Trash2,
  Send,
  FileDown,
  ShieldCheck,
  DollarSign,
  CopyPlus,
  Link2,
  Archive,
  ArchiveRestore,
} from "lucide-react";

/**
 * AgreementActionButtons
 *
 * Props:
 * - agreement: Agreement detail/list object
 * - isLoading: boolean
 * - onSign: () => void                         // contractor sign action (open modal or inline)
 * - onSendInvite: () => void                   // send homeowner email invite
 * - onCopyLink?: () => void                    // copy homeowner magic sign link
 * - onFund: () => void                         // start escrow funding
 * - onDownloadPDF: () => void                  // download executed (or latest) PDF
 * - onDelete: () => void                       // delete (draft only)
 * - onAmend: () => void                        // create amendment from executed
 * - onArchive?: () => void                     // archive non-draft
 * - onUnarchive?: () => void                   // unarchive
 */
export default function AgreementActionButtons({
  agreement,
  isLoading = false,
  onSign,
  onSendInvite,
  onCopyLink,
  onFund,
  onDownloadPDF,
  onDelete,
  onAmend,
  onArchive,
  onUnarchive,
}) {
  const status = String(agreement?.status || "draft").toLowerCase();
  const isDraft = status === "draft";
  const contractorSigned = !!agreement?.signed_by_contractor;
  const homeownerSigned = !!agreement?.signed_by_homeowner;
  const fullySigned = !!agreement?.is_fully_signed || (contractorSigned && homeownerSigned);
  const escrowFunded = !!agreement?.escrow_funded;
  const hasPdf = !!agreement?.pdf_file; // if your API exposes it
  const isArchived = !!agreement?.is_archived;

  // Capabilities
  const canEdit = !contractorSigned; // editing disabled after contractor signs (adjust if you allow edits)
  const canSign = !contractorSigned; // contractor review & sign
  const canSend = contractorSigned && !homeownerSigned; // invite homeowner after contractor signs
  const canCopy = !!agreement?.homeowner_access_token && !homeownerSigned && typeof onCopyLink === "function";
  const canFund = fullySigned && !escrowFunded; // fund only when fully signed
  const canDownload = hasPdf || fullySigned || escrowFunded; // executed PDF usually available once signed
  const canAmend = fullySigned; // amendment after execution
  const canDelete = isDraft; // destructive delete only for drafts
  const canArchive = !isDraft && !isArchived && typeof onArchive === "function";
  const canUnarchive = !isDraft && isArchived && typeof onUnarchive === "function";

  return (
    <div className="bg-white p-4 rounded-lg shadow-sm border">
      <h3 className="font-bold text-lg mb-4">Agreement Actions</h3>

      <div className="flex flex-wrap items-center gap-3" aria-busy={isLoading ? "true" : "false"}>
        {/* Edit */}
        {canEdit && (
          <Link
            to={`/agreements/${agreement.id}/edit`}
            className="flex items-center px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
            aria-disabled={isLoading}
          >
            <Edit size={18} className="mr-2" /> Edit Agreement
          </Link>
        )}

        {/* Contractor Review & Sign */}
        {canSign && (
          <button
            onClick={onSign}
            disabled={isLoading}
            className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
          >
            <ShieldCheck size={18} className="mr-2" /> Review &amp; Sign
          </button>
        )}

        {/* Send homeowner invite */}
        {canSend && (
          <button
            onClick={onSendInvite}
            disabled={isLoading}
            className="flex items-center px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:bg-gray-400"
          >
            <Send size={18} className="mr-2" /> Send Invite
          </button>
        )}

        {/* Copy homeowner link (magic link) */}
        {canCopy && (
          <button
            onClick={onCopyLink}
            disabled={isLoading}
            className="flex items-center px-4 py-2 bg-purple-100 text-purple-800 rounded-md hover:bg-purple-200 disabled:opacity-60"
            title="Copy homeowner signing link"
          >
            <Link2 size={18} className="mr-2" /> Copy Sign Link
          </button>
        )}

        {/* Fund escrow */}
        {canFund && (
          <button
            onClick={onFund}
            disabled={isLoading}
            className="flex items-center px-4 py-2 bg-amber-600 text-white rounded-md hover:bg-amber-700 disabled:bg-gray-400"
          >
            <DollarSign size={18} className="mr-2" /> Fund Escrow
          </button>
        )}

        {/* Download PDF */}
        {canDownload && (
          <button
            onClick={onDownloadPDF}
            disabled={isLoading}
            className="flex items-center px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400"
          >
            <FileDown size={18} className="mr-2" /> Download PDF
          </button>
        )}

        {/* Amend (clone executed agreement) */}
        {canAmend && (
          <button
            onClick={onAmend}
            disabled={isLoading}
            className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-gray-400"
          >
            <CopyPlus size={18} className="mr-2" /> Amend Agreement
          </button>
        )}

        {/* Grow to push destructive to the end */}
        <div className="flex-1" />

        {/* Archive / Unarchive */}
        {canArchive && (
          <button
            onClick={onArchive}
            disabled={isLoading}
            className="flex items-center px-3 py-2 border rounded-md hover:bg-gray-50 disabled:opacity-60"
            title="Archive this agreement"
          >
            <Archive size={18} className="mr-2" /> Archive
          </button>
        )}
        {canUnarchive && (
          <button
            onClick={onUnarchive}
            disabled={isLoading}
            className="flex items-center px-3 py-2 border rounded-md hover:bg-gray-50 disabled:opacity-60"
            title="Unarchive this agreement"
          >
            <ArchiveRestore size={18} className="mr-2" /> Unarchive
          </button>
        )}

        {/* Delete (draft only) */}
        {canDelete && (
          <button
            onClick={onDelete}
            disabled={isLoading}
            className="flex items-center px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:bg-gray-400"
            title="Delete draft"
          >
            <Trash2 size={18} className="mr-2" /> Delete Draft
          </button>
        )}
      </div>
    </div>
  );
}
