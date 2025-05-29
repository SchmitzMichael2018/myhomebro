import React, { useState } from "react";

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

  // Handle form field changes
  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMsg(null);

    try {
      const token = localStorage.getItem("access");
      const res = await fetch("http://localhost:8080/api/projects/contractors/onboard/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify(form),
      });

      const data = await res.json();

      if (res.ok && data.onboarding_url) {
        window.location.href = data.onboarding_url; // Redirect to Stripe onboarding
      } else if (data.detail) {
        setMsg(data.detail);
      } else {
        setMsg("Unable to start onboarding. Please check your information.");
      }
    } catch (err) {
      setMsg("Server error. Please try again.");
    }
    setLoading(false);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="max-w-lg mx-auto mt-16 p-8 bg-white rounded-2xl shadow-lg"
    >
      <h2 className="text-2xl font-bold mb-6 text-center">Contractor Stripe Onboarding</h2>
      {msg && <div className="mb-4 text-red-600">{msg}</div>}

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
        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition duration-150"
      >
        {loading ? "Starting Onboarding..." : "Start Stripe Onboarding"}
      </button>
    </form>
  );
}
