// src/pages/AgreementReview.jsx
import React, { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import toast from "react-hot-toast";
import {
  agreementPreviewHref,
  agreementPdfHref,
  postAgreementEmail,
} from "../api/signing";

/**
 * AgreementReview
 * - Shows a full inline PDF preview using the new GET /agreements/:id/pdf/preview/ action.
 * - Provides quick actions: Open PDF, Copy link, (optional) Email link.
 * - No legacy POST preview calls.
 */
export default function AgreementReview() {
  const { id } = useParams();
  const [emailForm, setEmailForm] = useState({
    to: "",
    subject: "Review your agreement",
    message:
      "Hi,\n\nPlease review your agreement at the link below. Let me know if you have any questions.\n\nThanks,\n",
  });
  const [sending, setSending] = useState(false);

  const previewSrc = useMemo(() => agreementPreviewHref(id), [id]);
  const pdfHref = useMemo(() => agreementPdfHref(id), [id]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(previewSrc);
      toast.success("Preview link copied!");
    } catch {
      toast.error("Unable to copy link.");
    }
  };

  const openPdf = () => {
    window.open(pdfHref, "_blank", "noopener,noreferrer");
  };

  const handleEmailChange = (e) =>
    setEmailForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const sendEmail = async (e) => {
    e.preventDefault();
    if (!emailForm.to.trim()) {
      toast.error("Recipient email is required.");
      return;
    }
    setSending(true);
    const payload = {
      ...emailForm,
      preview_url: previewSrc,
      pdf_url: pdfHref,
    };
    const res = await postAgreementEmail(id, payload);
    setSending(false);
    if (res.ok) {
      toast.success("Email request sent.");
      return;
    }
    toast.error(res.error || "Email failed.");
  };

  return (
    <div className="flex flex-col h-screen">
      {/* Top bar */}
      <div className="p-3 border-b bg-white flex items-center gap-2">
        <div className="font-semibold">Agreement Review</div>
        <div className="flex-1" />
        <button
          onClick={copyLink}
          className="px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-50"
        >
          Copy Preview Link
        </button>
        <button
          onClick={openPdf}
          className="px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700"
        >
          Open PDF
        </button>
      </div>

      {/* Content */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] flex-1 min-h-0">
        {/* PDF preview */}
        <div className="min-h-0">
          <iframe
            title={`Agreement ${id} Preview`}
            src={previewSrc}
            className="w-full h-full border-0"
          />
        </div>

        {/* Share (optional) */}
        <div className="border-l p-4 hidden lg:block">
          <div className="font-semibold mb-2">Share via Email (optional)</div>
          <form onSubmit={sendEmail} className="space-y-3">
            <div>
              <label className="block text-sm font-medium">To</label>
              <input
                type="email"
                name="to"
                value={emailForm.to}
                onChange={handleEmailChange}
                className="mt-1 w-full border rounded px-3 py-2"
                placeholder="customer@example.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Subject</label>
              <input
                name="subject"
                value={emailForm.subject}
                onChange={handleEmailChange}
                className="mt-1 w-full border rounded px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Message</label>
              <textarea
                name="message"
                value={emailForm.message}
                onChange={handleEmailChange}
                rows={6}
                className="mt-1 w-full border rounded px-3 py-2"
              />
            </div>
            <button
              type="submit"
              disabled={sending}
              className={`w-full py-2 rounded ${
                sending ? "bg-gray-400" : "bg-blue-600 hover:bg-blue-700"
              } text-white font-semibold`}
            >
              {sending ? "Sending…" : "Send Email"}
            </button>
            <p className="text-xs text-gray-500">
              Note: If your server doesn’t yet expose an agreement email endpoint,
              this will show a friendly error. The preview and PDF actions work regardless.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
