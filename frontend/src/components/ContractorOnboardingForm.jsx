// src/components/ContractorOnboardingForm.jsx

import React, { useState } from "react";

const BASE_API = import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";

export default function ContractorOnboardingForm() {
  const [form, setForm] = useState({
    business_name: "",
    name: "",
    email: "",
    phone: "",
    skills: "",
  });
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMsg(null);

    try {
      const token = localStorage.getItem("access");
      if (!token) {
        setMsg("Login required. Please sign in to continue.");
        setLoading(false);
        return;
      }

      const res = await fetch(`${BASE_API}/api/projects/contractors/onboard/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify(form),
      });

      const data = await res.json();

      if (res.ok && data.onboarding_url) {
        window.location.href = data.onboarding_url;
      } else {
        setMsg(data.detail || data.message || "Unable to start onboarding.");
      }
    } catch (err) {
      setMsg("Server error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="max-w-lg mx-auto mt-16 p-8 bg-white rounded-2xl shadow-lg"
    >
      <h2 className="text-2xl font-bold mb-6 text-center text-blue-800">
        Contractor Stripe Onboarding
      </h2>

      {msg && <div className="mb-4 text-red-600 text-sm">{msg}</div>}

      <div className="mb-4">
        <label className="block font-semibold mb-1">Business Name</label>
        <input
          name="business_name"
          value={form.business_name}
          onChange={handleChange}
          className="w-full border rounded px-3 py-2"
          placeholder="Your business name"
        />
      </div>
      <div className="mb-4">
        <label className="block font-semibold mb-1">Your Name</label>
        <input
          name="name"
          value={form.name}
          onChange={handleChange}
          className="w-full border rounded px-3 py-2"
          placeholder="Full name"
          required
        />
      </div>
      <div className="mb-4">
        <label className="block font-semibold mb-1">Email</label>
        <input
          name="email"
          type="email"
          value={form.email}
          onChange={handleChange}
          className="w-full border rounded px-3 py-2"
          placeholder="Email"
          required
        />
      </div>
      <div className="mb-4">
        <label className="block font-semibold mb-1">Phone</label>
        <input
          name="phone"
          value={form.phone}
          onChange={handleChange}
          className="w-full border rounded px-3 py-2"
          placeholder="Phone number"
          required
        />
      </div>
      <div className="mb-6">
        <label className="block font-semibold mb-1">Skills</label>
        <input
          name="skills"
          value={form.skills}
          onChange={handleChange}
          className="w-full border rounded px-3 py-2"
          placeholder="e.g., Flooring, Plumbing, Painting"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className={`w-full py-3 rounded-xl font-bold transition duration-150 ${
          loading
            ? "bg-gray-400 cursor-not-allowed"
            : "bg-blue-600 hover:bg-blue-700 text-white"
        }`}
      >
        {loading ? "Starting Onboarding..." : "Start Stripe Onboarding"}
      </button>
    </form>
  );
}
