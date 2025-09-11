// src/components/CustomerForm.jsx
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";

/** Two-letter state codes (displayed nicely; submitted as code). */
const US_STATES = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"],
  ["CA", "California"], ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"],
  ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"],
  ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"],
  ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"], ["MD", "Maryland"],
  ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"],
  ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"],
  ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"],
  ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"],
  ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"],
  ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"],
  ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"],
  ["WI", "Wisconsin"], ["WY", "Wyoming"],
];

/** ZIP: keep up to 9 digits; format as 12345 or 12345-6789 while typing. */
function formatZip(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 9);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}
/** ZIP validation: allow empty, or 5, or 9 with hyphen. */
function isValidZip(zip) {
  if (!zip) return true;
  return /^\d{5}(-\d{4})?$/.test(zip);
}

/** Phone: normalize to US and format as (XXX) XXX-XXXX while typing. */
function formatPhoneUS(value) {
  let digits = String(value || "").replace(/\D/g, "");
  // If user pasted "+1..." or "1...", drop country code for formatting
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}

export default function CustomerForm() {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    full_name: "",
    email: "",
    phone_number: "",
    street_address: "",
    address_line_2: "",
    city: "",
    state: "",        // 2-letter code
    zip_code: "",     // masked as user types
    status: "active",
  });
  const [isSaving, setIsSaving] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;

    if (name === "zip_code") {
      return setForm((prev) => ({ ...prev, zip_code: formatZip(value) }));
    }
    if (name === "phone_number") {
      return setForm((prev) => ({ ...prev, phone_number: formatPhoneUS(value) }));
    }

    setForm((prev) => ({ ...prev, [name]: value }));
  };

  function buildPayload(src) {
    const out = {};
    Object.entries(src).forEach(([k, v]) => {
      if (k === "phone_number") {
        // send digits-only to backend
        out[k] = String(v || "").replace(/\D/g, "");
      } else {
        out[k] = typeof v === "string" ? v.trim() : v;
      }
    });
    return out;
  }

  function parseError(err) {
    const data = err?.response?.data;
    if (!data) return "Failed to create customer.";
    if (typeof data === "string") return data;
    if (Array.isArray(data)) return data[0] || "Failed to create customer.";
    if (data.detail) return String(data.detail);
    const firstKey = Object.keys(data)[0];
    const val = data[firstKey];
    if (Array.isArray(val)) return `${firstKey}: ${val[0]}`;
    return `${firstKey}: ${String(val)}`;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!isValidZip(form.zip_code)) {
      toast.error("ZIP code must be 5 digits or 9 digits (ZIP+4).");
      return;
    }
    if (!form.state) {
      toast.error("Please select a state.");
      return;
    }

    setIsSaving(true);
    try {
      const payload = buildPayload(form);
      // axios baseURL is /api, so this hits /api/homeowners/
      await api.post("/homeowners/", payload);
      toast.success("Customer created successfully!");
      navigate("/customers");
    } catch (err) {
      toast.error(parseError(err));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold mb-6 text-gray-800">Create New Customer</h2>

      <form onSubmit={handleSubmit} className="p-6 bg-white rounded-xl shadow-md space-y-8">
        {/* Contact */}
        <div className="space-y-6">
          <h3 className="text-lg font-medium text-gray-900">Contact Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700">Full Name</label>
              <input
                name="full_name"
                value={form.full_name}
                onChange={handleChange}
                required
                autoComplete="name"
                className="w-full px-3 py-2 border rounded shadow-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Email</label>
              <input
                name="email"
                type="email"
                value={form.email}
                onChange={handleChange}
                required
                autoComplete="email"
                className="w-full px-3 py-2 border rounded shadow-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Phone Number</label>
              <input
                name="phone_number"
                type="tel"
                value={form.phone_number}
                onChange={handleChange}
                placeholder="(555) 555-5555"
                autoComplete="tel"
                inputMode="tel"
                // allow: (123) 456-7890, 123-456-7890, 1234567890, +1 123 456 7890
                pattern="^(\+?1[-.\s]?)?(\(\d{3}\)|\d{3})[-.\s]?\d{3}[-.\s]?\d{4}$"
                maxLength={14} // (###) ###-####
                className="w-full px-3 py-2 border rounded shadow-sm"
              />
              <p className="mt-1 text-xs text-gray-500">
                We’ll format as you type. Country code “1” is accepted but not required.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Status</label>
              <select
                name="status"
                value={form.status}
                onChange={handleChange}
                className="w-full px-3 py-2 border rounded shadow-sm"
              >
                <option value="active">Active</option>
                <option value="prospect">Prospect</option>
                <option value="archived">Archived</option>
              </select>
            </div>
          </div>
        </div>

        {/* Address */}
        <div className="border-t border-gray-200 pt-8 space-y-6">
          <h3 className="text-lg font-medium text-gray-900">Address</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700">Street Address</label>
              <input
                name="street_address"
                value={form.street_address}
                onChange={handleChange}
                autoComplete="address-line1"
                className="w-full px-3 py-2 border rounded shadow-sm"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700">Address Line 2</label>
              <input
                name="address_line_2"
                value={form.address_line_2}
                onChange={handleChange}
                autoComplete="address-line2"
                className="w-full px-3 py-2 border rounded shadow-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">City</label>
              <input
                name="city"
                value={form.city}
                onChange={handleChange}
                autoComplete="address-level2"
                className="w-full px-3 py-2 border rounded shadow-sm"
              />
            </div>

            {/* State dropdown */}
            <div>
              <label className="block text-sm font-medium text-gray-700">State</label>
              <select
                name="state"
                value={form.state}
                onChange={handleChange}
                required
                autoComplete="address-level1"
                className="w-full px-3 py-2 border rounded shadow-sm"
              >
                <option value="" disabled>
                  Select state…
                </option>
                {US_STATES.map(([code, name]) => (
                  <option key={code} value={code}>
                    {name} ({code})
                  </option>
                ))}
              </select>
            </div>

            {/* ZIP with masking */}
            <div>
              <label className="block text-sm font-medium text-gray-700">ZIP Code</label>
              <input
                name="zip_code"
                value={form.zip_code}
                onChange={handleChange}
                autoComplete="postal-code"
                inputMode="numeric"
                maxLength={10} // 12345-6789
                placeholder="12345 or 12345-6789"
                pattern="^\d{5}(-\d{4})?$"
                className="w-full px-3 py-2 border rounded shadow-sm"
              />
              <p className="mt-1 text-xs text-gray-500">
                We’ll auto-format as you type; 5 or 9 digits (ZIP+4) accepted.
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="pt-5 border-t border-gray-200 flex justify-end">
          <button
            type="button"
            onClick={() => navigate("/customers")}
            disabled={isSaving}
            className="bg-white py-2 px-4 border border-gray-300 rounded text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="ml-3 py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm shadow disabled:bg-gray-400"
          >
            {isSaving ? "Creating..." : "Create Customer"}
          </button>
        </div>
      </form>
    </div>
  );
}
