// frontend/src/pages/PublicIntake.jsx

import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../api";

function copyCustomerAddressToProject(form) {
  return {
    ...form,
    project_address_line1: form.customer_address_line1 || "",
    project_address_line2: form.customer_address_line2 || "",
    project_city: form.customer_city || "",
    project_state: form.customer_state || "",
    project_postal_code: form.customer_postal_code || "",
  };
}

const blankForm = {
  customer_name: "",
  customer_email: "",
  customer_phone: "",

  customer_address_line1: "",
  customer_address_line2: "",
  customer_city: "",
  customer_state: "",
  customer_postal_code: "",

  same_as_customer_address: true,

  project_address_line1: "",
  project_address_line2: "",
  project_city: "",
  project_state: "",
  project_postal_code: "",

  accomplishment_text: "",
};

export default function PublicIntake() {
  const { token = "" } = useParams();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [contractorName, setContractorName] = useState("Your contractor");
  const [statusText, setStatusText] = useState("");
  const [form, setForm] = useState(blankForm);

  useEffect(() => {
    let mounted = true;

    async function loadIntake() {
      if (!token) {
        toast.error("Missing intake token.");
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const { data } = await api.get("/projects/public-intake/", {
          params: { token },
        });

        if (!mounted) return;

        setContractorName(data?.contractor_name || "Your contractor");
        setStatusText(data?.status || "");

        setForm({
          customer_name: data?.customer_name || "",
          customer_email: data?.customer_email || "",
          customer_phone: data?.customer_phone || "",

          customer_address_line1: data?.customer_address_line1 || "",
          customer_address_line2: data?.customer_address_line2 || "",
          customer_city: data?.customer_city || "",
          customer_state: data?.customer_state || "",
          customer_postal_code: data?.customer_postal_code || "",

          same_as_customer_address:
            data?.same_as_customer_address !== undefined
              ? !!data.same_as_customer_address
              : true,

          project_address_line1: data?.project_address_line1 || "",
          project_address_line2: data?.project_address_line2 || "",
          project_city: data?.project_city || "",
          project_state: data?.project_state || "",
          project_postal_code: data?.project_postal_code || "",

          accomplishment_text: data?.accomplishment_text || "",
        });

        setLoaded(true);
      } catch (e) {
        toast.error(
          e?.response?.data?.detail || "Could not load intake form."
        );
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadIntake();
    return () => {
      mounted = false;
    };
  }, [token]);

  useEffect(() => {
    if (!form.same_as_customer_address) return;
    setForm((prev) => ({
      ...prev,
      project_address_line1: prev.customer_address_line1 || "",
      project_address_line2: prev.customer_address_line2 || "",
      project_city: prev.customer_city || "",
      project_state: prev.customer_state || "",
      project_postal_code: prev.customer_postal_code || "",
    }));
  }, [
    form.same_as_customer_address,
    form.customer_address_line1,
    form.customer_address_line2,
    form.customer_city,
    form.customer_state,
    form.customer_postal_code,
  ]);

  const canSubmit = useMemo(() => {
    return (
      !!String(form.customer_name || "").trim() &&
      !!String(form.customer_email || "").trim() &&
      !!String(form.project_address_line1 || "").trim() &&
      !!String(form.project_city || "").trim() &&
      !!String(form.project_state || "").trim() &&
      !!String(form.project_postal_code || "").trim() &&
      !!String(form.accomplishment_text || "").trim()
    );
  }, [form]);

  function setField(name, value) {
    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  }

  async function handleSave() {
    if (!token) {
      toast.error("Missing intake token.");
      return;
    }

    if (!canSubmit) {
      toast.error("Please complete the required intake details.");
      return;
    }

    try {
      setSaving(true);

      const payload = {
        token,
        ...form,
      };

      const { data } = await api.patch("/projects/public-intake/", payload);
      setStatusText(data?.status || "submitted");
      toast.success("Your intake has been submitted.");
    } catch (e) {
      toast.error(
        e?.response?.data?.detail || "Could not save intake."
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto max-w-3xl rounded-xl border bg-white p-6 shadow-sm">
          <div className="text-lg font-semibold text-gray-900">Loading intake…</div>
        </div>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto max-w-3xl rounded-xl border bg-white p-6 shadow-sm">
          <div className="text-lg font-semibold text-gray-900">Intake unavailable</div>
          <div className="mt-2 text-sm text-gray-600">
            This intake link may be invalid or no longer available.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="rounded-xl border bg-white p-6 shadow-sm">
          <div className="text-2xl font-bold text-gray-900">Project Intake</div>
          <div className="mt-2 text-sm text-gray-600">
            {contractorName} has asked you to complete a project intake so they can prepare your agreement.
          </div>
          {statusText ? (
            <div className="mt-3 inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
              Status: {statusText}
            </div>
          ) : null}
        </div>

        <div className="rounded-xl border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Customer Information</h2>
          <p className="mt-1 text-sm text-gray-600">
            Please confirm your contact and home address details.
          </p>

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="mb-1 block text-sm font-medium">Full Name</label>
              <input
                className="w-full rounded border px-3 py-2 text-sm"
                value={form.customer_name}
                onChange={(e) => setField("customer_name", e.target.value)}
                placeholder="Your full name"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">Email</label>
              <input
                className="w-full rounded border px-3 py-2 text-sm"
                value={form.customer_email}
                onChange={(e) => setField("customer_email", e.target.value)}
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">Phone</label>
              <input
                className="w-full rounded border px-3 py-2 text-sm"
                value={form.customer_phone}
                onChange={(e) => setField("customer_phone", e.target.value)}
                placeholder="(555) 555-5555"
              />
            </div>

            <div className="md:col-span-2">
              <label className="mb-1 block text-sm font-medium">Address Line 1</label>
              <input
                data-testid="public-intake-customer-address-line1"
                className="w-full rounded border px-3 py-2 text-sm"
                value={form.customer_address_line1}
                onChange={(e) => setField("customer_address_line1", e.target.value)}
                placeholder="Street address"
              />
            </div>

            <div className="md:col-span-2">
              <label className="mb-1 block text-sm font-medium">Address Line 2</label>
              <input
                className="w-full rounded border px-3 py-2 text-sm"
                value={form.customer_address_line2}
                onChange={(e) => setField("customer_address_line2", e.target.value)}
                placeholder="Apartment, suite, unit, etc."
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">City</label>
              <input
                data-testid="public-intake-customer-city"
                className="w-full rounded border px-3 py-2 text-sm"
                value={form.customer_city}
                onChange={(e) => setField("customer_city", e.target.value)}
                placeholder="City"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">State</label>
              <input
                data-testid="public-intake-customer-state"
                className="w-full rounded border px-3 py-2 text-sm"
                value={form.customer_state}
                onChange={(e) => setField("customer_state", e.target.value)}
                placeholder="State"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">ZIP / Postal Code</label>
              <input
                data-testid="public-intake-customer-postal-code"
                className="w-full rounded border px-3 py-2 text-sm"
                value={form.customer_postal_code}
                onChange={(e) => setField("customer_postal_code", e.target.value)}
                placeholder="ZIP / Postal code"
              />
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Project Address</h2>
          <p className="mt-1 text-sm text-gray-600">
            Tell us where the project will take place.
          </p>

          <label className="mt-4 flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.same_as_customer_address}
              onChange={(e) => {
                const checked = e.target.checked;
                setForm((prev) =>
                  checked
                    ? copyCustomerAddressToProject({
                        ...prev,
                        same_as_customer_address: true,
                      })
                    : { ...prev, same_as_customer_address: false }
                );
              }}
            />
            Project address is the same as my home/customer address
          </label>

          {!form.same_as_customer_address ? (
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium">Project Address Line 1</label>
              <input
                data-testid="public-intake-project-address-line1"
                className="w-full rounded border px-3 py-2 text-sm"
                value={form.project_address_line1}
                onChange={(e) => setField("project_address_line1", e.target.value)}
                placeholder="Project street address"
                />
              </div>

              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium">Project Address Line 2</label>
                <input
                  className="w-full rounded border px-3 py-2 text-sm"
                  value={form.project_address_line2}
                  onChange={(e) => setField("project_address_line2", e.target.value)}
                  placeholder="Apartment, suite, unit, etc."
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">City</label>
              <input
                data-testid="public-intake-project-city"
                className="w-full rounded border px-3 py-2 text-sm"
                value={form.project_city}
                onChange={(e) => setField("project_city", e.target.value)}
                placeholder="City"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">State</label>
              <input
                data-testid="public-intake-project-state"
                className="w-full rounded border px-3 py-2 text-sm"
                value={form.project_state}
                onChange={(e) => setField("project_state", e.target.value)}
                placeholder="State"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">ZIP / Postal Code</label>
              <input
                data-testid="public-intake-project-postal-code"
                className="w-full rounded border px-3 py-2 text-sm"
                value={form.project_postal_code}
                onChange={(e) => setField("project_postal_code", e.target.value)}
                placeholder="ZIP / Postal code"
                />
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-lg border bg-slate-50 p-3 text-sm text-gray-700">
              <div className="font-medium text-gray-900">Project address will use your customer/home address</div>
              <div className="mt-2 whitespace-pre-line">
                {[
                  form.project_address_line1,
                  form.project_address_line2,
                  [form.project_city, form.project_state, form.project_postal_code]
                    .filter(Boolean)
                    .join(", "),
                ]
                  .filter(Boolean)
                  .join("\n") || "No address entered yet."}
              </div>
            </div>
          )}
        </div>

        <div className="rounded-xl border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">
            What would you like to accomplish?
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            Describe the job in plain language. The contractor will use this to prepare the project details.
          </p>

          <div className="mt-4">
            <textarea
              data-testid="public-intake-accomplishment-text"
              className="w-full rounded border px-3 py-2 text-sm"
              rows={7}
              value={form.accomplishment_text}
              onChange={(e) => setField("accomplishment_text", e.target.value)}
              placeholder="Example: We have a roof leak over the garage and want the damaged area repaired and flashing inspected."
            />
          </div>
        </div>

        <div className="rounded-xl border bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-gray-600">
              Once you submit this intake, your contractor can review it and prepare the agreement.
            </div>

            <button
              data-testid="public-intake-submit-button"
              type="button"
              onClick={handleSave}
              disabled={saving || !canSubmit}
              className="rounded bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {saving ? "Submitting..." : "Submit Intake"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
