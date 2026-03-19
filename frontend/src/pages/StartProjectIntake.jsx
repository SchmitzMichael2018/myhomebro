import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../api";

export default function StartProjectIntake() {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    customer_name: "",
    customer_email: "",
    customer_phone: "",
  });
  const [starting, setStarting] = useState(false);

  function setField(name, value) {
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function handleStart(e) {
    e.preventDefault();

    if (!String(form.customer_name || "").trim()) {
      toast.error("Please enter your name.");
      return;
    }
    if (!String(form.customer_email || "").trim()) {
      toast.error("Please enter your email.");
      return;
    }

    try {
      setStarting(true);

      const { data } = await api.post("/projects/public-intake/start/", {
        customer_name: form.customer_name,
        customer_email: form.customer_email,
        customer_phone: form.customer_phone,
      });

      const token = data?.token;
      if (!token) {
        toast.error("Could not start project intake.");
        return;
      }

      navigate(`/start-project/${token}`);
    } catch (e2) {
      toast.error(
        e2?.response?.data?.detail || "Could not start your project intake."
      );
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-2xl rounded-xl border bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-gray-900">Start Project Intake</h1>
        <p className="mt-2 text-sm text-gray-600">
          Tell us a little about yourself and we’ll open your project intake form.
        </p>

        <form onSubmit={handleStart} className="mt-6 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-900">Full Name</label>
            <input
              className="w-full rounded border px-3 py-2 text-sm"
              value={form.customer_name}
              onChange={(e) => setField("customer_name", e.target.value)}
              placeholder="Your full name"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-900">Email</label>
            <input
              className="w-full rounded border px-3 py-2 text-sm"
              value={form.customer_email}
              onChange={(e) => setField("customer_email", e.target.value)}
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-900">Phone</label>
            <input
              className="w-full rounded border px-3 py-2 text-sm"
              value={form.customer_phone}
              onChange={(e) => setField("customer_phone", e.target.value)}
              placeholder="(555) 555-5555"
            />
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={starting}
              className="rounded bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {starting ? "Starting..." : "Continue"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}