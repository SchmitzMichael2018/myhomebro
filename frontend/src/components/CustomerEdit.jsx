import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Save } from "lucide-react";
import toast from "react-hot-toast";

import api from "../api";
import AddressAutocomplete from "./AddressAutocomplete.jsx";
import ContractorPageSurface from "./dashboard/ContractorPageSurface.jsx";

function formatZip(value) {
  const d = String(value || "").replace(/\D/g, "").slice(0, 9);
  return d.length <= 5 ? d : `${d.slice(0, 5)}-${d.slice(5)}`;
}

function formatPhoneUS(value) {
  let d = String(value || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 10)}`;
}

function isValidZip(zip) {
  if (!zip) return true;
  return /^\d{5}(-\d{4})?$/.test(zip);
}

function isValidUSPhone(input) {
  const d = String(input || "").replace(/\D/g, "");
  return d.length === 10 || (d.length === 11 && d.startsWith("1"));
}

const inputClass =
  "w-full rounded-xl border border-white/12 bg-slate-950/45 px-3 py-2.5 text-sm text-white shadow-sm outline-none placeholder:text-sky-100/35 focus:border-sky-300/45 focus:ring-2 focus:ring-sky-300/20 disabled:cursor-not-allowed disabled:opacity-60";
const labelClass = "block text-sm font-semibold text-sky-100/80";
const helpClass = "mt-1 text-xs leading-5 text-sky-100/50";
const sectionClass = "rounded-2xl border border-white/12 bg-slate-950/45 p-5 shadow-sm";

export default function CustomerEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const LIST_ROUTE = "/app/customers";
  const WORKSPACE_ROUTE = `/app/customers/${id}`;

  const [form, setForm] = useState({
    company_name: "",
    full_name: "",
    email: "",
    phone_number: "",
    street_address: "",
    address_line_2: "",
    city: "",
    state: "",
    zip_code: "",
    status: "active",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchCustomer = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/projects/homeowners/${id}/`);
      setForm({
        company_name: data.company_name || "",
        full_name: data.full_name || "",
        email: data.email || "",
        phone_number: formatPhoneUS(data.phone_number || data.phone || ""),
        street_address: data.street_address || "",
        address_line_2: data.address_line_2 || "",
        city: data.city || "",
        state: data.state || "",
        zip_code: formatZip(data.zip_code || ""),
        status: data.status || "active",
      });
    } catch (error) {
      console.error("Failed to load customer:", error);
      toast.error("Failed to load customer data.");
      navigate(LIST_ROUTE, { replace: true });
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => {
    if (!id) {
      toast.error("Missing customer ID.");
      navigate(LIST_ROUTE, { replace: true });
      return;
    }
    fetchCustomer();
  }, [fetchCustomer, id, navigate]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === "zip_code") return setForm((prev) => ({ ...prev, zip_code: formatZip(value) }));
    if (name === "phone_number") return setForm((prev) => ({ ...prev, phone_number: formatPhoneUS(value) }));
    setForm((prevForm) => ({ ...prevForm, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!(form.street_address || "").trim()) return toast.error("Street address is required.");
    if (!(form.city || "").trim()) return toast.error("City is required.");
    if (!isValidUSPhone(form.phone_number)) {
      return toast.error("Enter a valid US phone (10 digits, or +1 then 10 digits).");
    }
    if (!isValidZip(form.zip_code)) {
      return toast.error("ZIP code must be 5 digits or 9 digits (ZIP+4).");
    }

    setSaving(true);
    try {
      const payload = {
        ...form,
        phone_number: String(form.phone_number || "").replace(/\D/g, ""),
      };
      await api.patch(`/projects/homeowners/${id}/`, payload);
      toast.success("Customer updated successfully!");
      navigate(LIST_ROUTE);
    } catch (err) {
      console.error("Customer update failed:", err);
      toast.error(err.response?.data?.detail || "Failed to update customer.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ContractorPageSurface
      eyebrow="Customers"
      title="Edit Customer"
      subtitle="Update customer contact and billing details without leaving the contractor CRM workspace."
      variant="operational"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Link to={WORKSPACE_ROUTE} className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-white/20 bg-slate-950/40 px-3 py-2 text-sm font-semibold text-sky-100 hover:border-sky-300/40 hover:bg-sky-500/15">
            <ArrowLeft size={16} /> Back to Workspace
          </Link>
          <Link to={LIST_ROUTE} className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-white/12 bg-slate-950/35 px-3 py-2 text-sm font-semibold text-sky-100/70 hover:border-sky-300/35 hover:text-white">
            Back to Customers
          </Link>
        </div>
      }
    >
      {loading ? (
        <div className="rounded-2xl border border-white/12 bg-slate-950/45 p-6 text-sky-100/70" data-testid="customer-edit-loading">
          Loading customer details...
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5" noValidate data-testid="customer-edit-form">
          <section className={sectionClass}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">Contact Information</h2>
                <p className="mt-1 text-sm leading-6 text-sky-100/60">Keep relationship details clean for agreements, invoices, and customer follow-up.</p>
              </div>
              <span className="rounded-full border border-sky-300/30 bg-sky-400/10 px-2.5 py-1 text-xs font-semibold capitalize text-sky-100">
                {form.status || "active"}
              </span>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
              <div className="md:col-span-2">
                <label htmlFor="company_name" className={labelClass}>
                  Company Name <span className="text-sky-100/45">(optional)</span>
                </label>
                <input
                  id="company_name"
                  name="company_name"
                  type="text"
                  value={form.company_name}
                  onChange={handleChange}
                  autoComplete="organization"
                  placeholder="e.g., ABC Drywall LLC"
                  className={inputClass}
                />
                <p className={helpClass}>If provided, this appears first in customer lists and workspaces.</p>
              </div>

              <div>
                <label htmlFor="full_name" className={labelClass}>Full Name</label>
                <input id="full_name" name="full_name" type="text" value={form.full_name} onChange={handleChange} required className={inputClass} />
              </div>

              <div>
                <label htmlFor="email" className={labelClass}>Email Address</label>
                <input id="email" name="email" type="email" value={form.email} onChange={handleChange} required className={inputClass} />
              </div>

              <div>
                <label htmlFor="phone_number" className={labelClass}>Phone Number</label>
                <input id="phone_number" name="phone_number" type="tel" value={form.phone_number} onChange={handleChange} className={inputClass} placeholder="(555) 555-5555" inputMode="tel" />
              </div>

              <div>
                <label htmlFor="status" className={labelClass}>Status</label>
                <select id="status" name="status" value={form.status} onChange={handleChange} className={inputClass}>
                  <option value="active">Active</option>
                  <option value="prospect">Prospect</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
            </div>
          </section>

          <section className={sectionClass}>
            <h2 className="text-lg font-semibold text-white">Address</h2>
            <p className="mt-1 text-sm leading-6 text-sky-100/60">Used for customer context, work location defaults, and CRM search.</p>

            <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
              <div className="md:col-span-2">
                <label htmlFor="street_address" className={labelClass}>Street Address</label>
                <AddressAutocomplete
                  value={form.street_address}
                  onChangeText={(text) => setForm((p) => ({ ...p, street_address: text }))}
                  onSelect={(a) => {
                    setForm((p) => ({
                      ...p,
                      street_address: a.line1 || p.street_address || "",
                      city: a.city || p.city || "",
                      state: a.state || p.state || "",
                      zip_code: a.postal_code ? formatZip(a.postal_code) : p.zip_code,
                    }));

                    try {
                      sessionStorage.setItem(
                        `mhb_customer_geo_${String(id || "")}`,
                        JSON.stringify({
                          place_id: a.place_id || "",
                          formatted_address: a.formatted_address || "",
                          lat: a.lat ?? null,
                          lng: a.lng ?? null,
                        })
                      );
                    } catch {
                      // Storage is optional.
                    }
                  }}
                  placeholder="Start typing the street address"
                  inputClassName={`${inputClass} pr-10`}
                  suggestionsClassName="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-white/12 bg-slate-950 text-sm text-white shadow-xl"
                  suggestionButtonClassName="block w-full px-3 py-2 text-left text-sky-50 hover:bg-sky-500/15 focus:bg-sky-500/20 focus:outline-none"
                  helperClassName="mt-1 text-xs text-sky-100/50"
                />
              </div>

              <div className="md:col-span-2">
                <label htmlFor="address_line_2" className={labelClass}>Address Line 2 (Apt, Suite, etc.)</label>
                <input id="address_line_2" name="address_line_2" type="text" value={form.address_line_2} onChange={handleChange} className={inputClass} />
              </div>

              <div>
                <label htmlFor="city" className={labelClass}>City</label>
                <input id="city" name="city" type="text" value={form.city} onChange={handleChange} className={inputClass} />
              </div>

              <div>
                <label htmlFor="state" className={labelClass}>State / Province</label>
                <input id="state" name="state" type="text" value={form.state} onChange={handleChange} className={inputClass} />
              </div>

              <div>
                <label htmlFor="zip_code" className={labelClass}>ZIP / Postal Code</label>
                <input id="zip_code" name="zip_code" type="text" value={form.zip_code} onChange={handleChange} className={inputClass} placeholder="12345 or 12345-6789" inputMode="numeric" />
              </div>
            </div>
          </section>

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => navigate(LIST_ROUTE)}
              className="inline-flex min-h-[42px] items-center justify-center rounded-xl border border-white/15 bg-slate-950/35 px-4 py-2 text-sm font-semibold text-sky-100 hover:border-sky-300/35 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
              disabled={saving}
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={saving}
              className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl border border-white/70 bg-white px-4 py-2 text-sm font-bold text-slate-950 shadow-sm hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Save size={16} />
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      )}
    </ContractorPageSurface>
  );
}
