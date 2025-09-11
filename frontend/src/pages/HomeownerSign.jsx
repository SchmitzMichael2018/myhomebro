// frontend/src/pages/HomeownerSign.jsx
import React, { useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";

export default function HomeownerSign() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const token = sp.get("token") || "";
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    if (!name.trim()) return toast.error("Please type your full name.");
    if (!token) return toast.error("Missing access token.");
    setSubmitting(true);
    try {
      await api.post(`/projects/agreements/${id}/sign/`, {
        role: "homeowner",
        signature_name: name.trim(),
        homeowner_access_token: token,
      });
      setDone(true);
      toast.success("Signed. Thank you!");
    } catch (e) {
      console.error(e);
      toast.error(e?.response?.data?.detail || "Unable to sign.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6 flex items-center justify-center">
      <div className="max-w-xl w-full bg-white rounded-2xl shadow p-6">
        <h1 className="text-2xl font-bold text-gray-800 mb-1">Agreement Signature</h1>
        <p className="text-gray-600 mb-6">Agreement #{id}</p>

        {done ? (
          <div className="rounded-lg bg-green-50 p-4 text-green-800">
            ✅ Your signature has been recorded. You may close this page.
          </div>
        ) : (
          <>
            <label className="block mb-3">
              <span className="text-sm text-gray-700">Type your full legal name</span>
              <input
                className="mt-1 w-full rounded border px-3 py-2"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="John A. Smith"
              />
            </label>

            <button
              onClick={submit}
              disabled={submitting}
              className="rounded bg-emerald-600 text-white px-5 py-2 hover:bg-emerald-700 disabled:opacity-50"
            >
              {submitting ? "Submitting…" : "Sign Agreement"}
            </button>
          </>
        )}
        <p className="mt-4 text-xs text-gray-500">
          Your IP address and timestamp will be stored with your signature for audit purposes.
        </p>
      </div>
    </div>
  );
}
