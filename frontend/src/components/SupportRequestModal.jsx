import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";

import Modal from "./Modal.jsx";
import { createSupportTicket } from "../api";

const CATEGORY_OPTIONS = [
  { value: "account_login", label: "Account / Login" },
  { value: "agreement_help", label: "Agreement Help" },
  { value: "payment_escrow", label: "Payment / Escrow" },
  { value: "invoice_issue", label: "Invoice Issue" },
  { value: "dispute_review", label: "Dispute / Review" },
  { value: "contractor_profile", label: "Contractor Profile" },
  { value: "customer_intake", label: "Customer Intake" },
  { value: "technical_problem", label: "Technical Problem" },
  { value: "general_question", label: "General Question" },
];

const PRIORITY_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

function categoryLabel(value) {
  return CATEGORY_OPTIONS.find((option) => option.value === value)?.label || value || "General Question";
}

function priorityLabel(value) {
  return PRIORITY_OPTIONS.find((option) => option.value === value)?.label || value || "Normal";
}

export default function SupportRequestModal({
  visible = false,
  onClose,
  defaultEmail = "",
  defaultCategory = "general_question",
  defaultSubject = "",
  relatedObjectType = "",
  relatedObjectId = "",
  onSubmitted,
}) {
  const initialForm = useMemo(
    () => ({
      email: defaultEmail || "",
      subject: defaultSubject || "",
      category: defaultCategory || "general_question",
      priority: "normal",
      message: "",
      attachment: null,
    }),
    [defaultEmail, defaultCategory, defaultSubject]
  );

  const [form, setForm] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [submittedTicket, setSubmittedTicket] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!visible) return;
    setForm({
      email: defaultEmail || "",
      subject: defaultSubject || "",
      category: defaultCategory || "general_question",
      priority: "normal",
      message: "",
      attachment: null,
    });
    setSubmittedTicket(null);
    setSubmitting(false);
  }, [visible, defaultEmail, defaultCategory, defaultSubject]);

  const updateField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitting) return;

    const subject = String(form.subject || "").trim();
    const message = String(form.message || "").trim();
    const email = String(form.email || "").trim();
    if (!subject || !message || !email) {
      toast.error("Please add your email, subject, and message.");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        email,
        subject,
        category: form.category,
        priority: form.priority,
        message,
      };
      if (relatedObjectType) payload.related_object_type = relatedObjectType;
      if (relatedObjectId) payload.related_object_id = relatedObjectId;
      if (form.attachment) payload.attachment = form.attachment;

      const ticket = await createSupportTicket(payload);
      setSubmittedTicket(ticket);
      onSubmitted?.(ticket);
      toast.success(`Support request submitted: ${ticket?.ticket_number || "ticket created"}`);
    } catch (error) {
      console.error(error);
      toast.error("Unable to submit support request.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} title="Support Request" onClose={onClose} testId="support-request-modal">
      {submittedTicket ? (
        <div data-testid="support-request-success" className="space-y-4">
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
            <div className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-700">
              Support request submitted
            </div>
            <div className="mt-2 text-2xl font-black text-emerald-950" data-testid="support-ticket-number">
              Ticket: {submittedTicket.ticket_number}
            </div>
            <div className="mt-3 text-sm text-emerald-900">
              We sent a confirmation email to <span className="font-semibold">{submittedTicket.email || form.email}</span>.
            </div>
            <div className="mt-2 text-sm text-emerald-900">
              Please reference ticket <span className="font-semibold">{submittedTicket.ticket_number}</span> in future communication.
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                onClose?.();
                navigate("/app/support");
              }}
              className="inline-flex items-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              View My Tickets
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Close
            </button>
          </div>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block md:col-span-2">
              <span className="mb-1 block text-sm font-semibold text-slate-700">Email</span>
              <input
                data-testid="support-email-input"
                type="email"
                value={form.email}
                onChange={(event) => updateField("email", event.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none ring-0 focus:border-slate-500"
                placeholder="you@example.com"
              />
            </label>

            <label className="block md:col-span-2">
              <span className="mb-1 block text-sm font-semibold text-slate-700">Subject</span>
              <input
                data-testid="support-subject-input"
                type="text"
                value={form.subject}
                onChange={(event) => updateField("subject", event.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none ring-0 focus:border-slate-500"
                placeholder="What can we help with?"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-slate-700">Category</span>
              <select
                data-testid="support-category-select"
                value={form.category}
                onChange={(event) => updateField("category", event.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none ring-0 focus:border-slate-500"
              >
                {CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-slate-700">Priority</span>
              <select
                data-testid="support-priority-select"
                value={form.priority}
                onChange={(event) => updateField("priority", event.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none ring-0 focus:border-slate-500"
              >
                {PRIORITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block md:col-span-2">
              <span className="mb-1 block text-sm font-semibold text-slate-700">Message</span>
              <textarea
                data-testid="support-message-input"
                rows={6}
                value={form.message}
                onChange={(event) => updateField("message", event.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none ring-0 focus:border-slate-500"
                placeholder="Tell us what happened and any details that will help us help you."
              />
            </label>

            <label className="block md:col-span-2">
              <span className="mb-1 block text-sm font-semibold text-slate-700">Attachment</span>
              <input
                data-testid="support-attachment-input"
                type="file"
                onChange={(event) => updateField("attachment", event.target.files?.[0] || null)}
                className="block w-full text-sm text-slate-700 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-slate-800"
              />
              {form.attachment ? (
                <div className="mt-2 text-xs text-slate-500">Selected: {form.attachment.name}</div>
              ) : null}
            </label>
          </div>

          {relatedObjectType || relatedObjectId ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
              Linked to {relatedObjectType || "related item"}
              {relatedObjectId ? ` #${relatedObjectId}` : ""}
            </div>
          ) : null}

          <div className="flex flex-wrap justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Close
            </button>
            <button
              type="submit"
              disabled={submitting}
              data-testid="support-submit-button"
              className="inline-flex items-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Submitting..." : "Submit Support Request"}
            </button>
          </div>
        </form>
      )}
      <div className="mt-4 text-xs text-slate-500">
        Ticket categories and priority levels are shown here for support routing only.
      </div>
    </Modal>
  );
}

export { CATEGORY_OPTIONS, PRIORITY_OPTIONS, categoryLabel, priorityLabel };
