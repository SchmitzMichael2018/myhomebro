// src/components/InviteContractorModal.jsx
import React, { useMemo, useState } from "react";
import Modal from "./Modal";
import toast from "react-hot-toast";

/**
 * InviteContractorModal
 *
 * ✅ Backend routes (per your core/urls.py + projects/urls.py):
 *   POST /api/projects/invites/              (public)
 *   GET  /api/projects/invites/<token>/      (public)
 *   POST /api/projects/invites/<token>/accept/ (auth)
 *
 * This modal is the public customer form (no account).
 */
export default function InviteContractorModal({
  isOpen,
  onClose,
  apiBaseUrl = "/api", // matches api.js BASE_URL
}) {
  const [submitting, setSubmitting] = useState(false);

  const [homeownerName, setHomeownerName] = useState("");
  const [homeownerEmail, setHomeownerEmail] = useState("");
  const [homeownerPhone, setHomeownerPhone] = useState("");

  const [contractorEmail, setContractorEmail] = useState("");
  const [contractorPhone, setContractorPhone] = useState("");

  const [message, setMessage] = useState("");

  const canSubmit = useMemo(() => {
    const hn = homeownerName.trim().length > 1;
    const he = homeownerEmail.trim().includes("@");
    const hasContractor =
      contractorEmail.trim().includes("@") || contractorPhone.trim().length >= 7;
    return hn && he && hasContractor && !submitting;
  }, [homeownerName, homeownerEmail, contractorEmail, contractorPhone, submitting]);

  function resetForm() {
    setHomeownerName("");
    setHomeownerEmail("");
    setHomeownerPhone("");
    setContractorEmail("");
    setContractorPhone("");
    setMessage("");
  }

  async function submitInvite(e) {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    try {
      const payload = {
        homeowner_name: homeownerName.trim(),
        homeowner_email: homeownerEmail.trim().toLowerCase(),
        homeowner_phone: homeownerPhone.trim(),
        contractor_email: contractorEmail.trim().toLowerCase(),
        contractor_phone: contractorPhone.trim(),
        message: message.trim(),
      };

      // ✅ Correct endpoint for your backend routing
      const url = `${apiBaseUrl}/projects/invites/`;

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      let data = null;
      try {
        data = await res.json();
      } catch {}

      if (!res.ok) {
        const msg =
          data?.detail ||
          data?.error ||
          "Invite could not be sent. Please double-check the info and try again.";
        throw new Error(msg);
      }

      toast.success("Invite sent! The contractor will receive an email/SMS link.");
      resetForm();
      onClose?.();
    } catch (err) {
      toast.error(err?.message || "Invite failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal visible={!!isOpen} onClose={onClose} title="Invite a Contractor">
      <form onSubmit={submitInvite} className="space-y-4">
        <p className="text-sm text-gray-600">
          Invite your contractor to use MyHomeBro for secure escrow payments and project tracking.
          <br />
          <span className="font-medium">No customer account required.</span>
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Your Name <span className="text-red-500">*</span>
            </label>
            <input
              value={homeownerName}
              onChange={(e) => setHomeownerName(e.target.value)}
              type="text"
              className="w-full mt-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring"
              placeholder="Jane Doe"
              autoComplete="name"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Your Email <span className="text-red-500">*</span>
            </label>
            <input
              value={homeownerEmail}
              onChange={(e) => setHomeownerEmail(e.target.value)}
              type="email"
              className="w-full mt-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring"
              placeholder="jane@email.com"
              autoComplete="email"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Your Phone (optional)
            </label>
            <input
              value={homeownerPhone}
              onChange={(e) => setHomeownerPhone(e.target.value)}
              type="tel"
              className="w-full mt-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring"
              placeholder="(555) 555-5555"
              autoComplete="tel"
            />
          </div>

          <div className="md:col-span-2 border-t pt-3" />

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Contractor Email
            </label>
            <input
              value={contractorEmail}
              onChange={(e) => setContractorEmail(e.target.value)}
              type="email"
              className="w-full mt-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring"
              placeholder="contractor@email.com"
              autoComplete="email"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Contractor Phone
            </label>
            <input
              value={contractorPhone}
              onChange={(e) => setContractorPhone(e.target.value)}
              type="tel"
              className="w-full mt-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring"
              placeholder="(555) 555-5555"
              autoComplete="tel"
            />
          </div>

          <div className="md:col-span-2">
            <div className="text-xs text-gray-500">
              Provide at least one: contractor email or phone.
            </div>
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700">
              Message (optional)
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              className="w-full mt-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring"
              placeholder="Hi! I’d like to use MyHomeBro for our project payments and milestones."
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border bg-white hover:bg-gray-50"
            disabled={submitting}
          >
            Cancel
          </button>

          <button
            type="submit"
            className={`px-4 py-2 rounded-lg font-semibold ${
              canSubmit
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "bg-gray-200 text-gray-500 cursor-not-allowed"
            }`}
            disabled={!canSubmit}
          >
            {submitting ? "Sending..." : "Send Invite"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
