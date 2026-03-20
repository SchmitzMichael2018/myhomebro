// frontend/src/components/intake/ProjectIntakeForm.jsx

import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../../api";
import IntakeAiRecommendationPanel from "./IntakeAiRecommendationPanel.jsx";

const blankForm = {
  initiated_by: "contractor",

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

function normalizeList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

function homeownerLabel(h) {
  const name = h?.full_name || h?.name || "Customer";
  const email = h?.email || "";
  const phone = h?.phone_number || h?.phone || "";
  const city = h?.city || "";
  const state = h?.state || "";
  const bits = [email, phone, [city, state].filter(Boolean).join(", ")].filter(Boolean);
  return bits.length ? `${name} — ${bits.join(" • ")}` : name;
}

export default function ProjectIntakeForm() {
  const navigate = useNavigate();

  const [form, setForm] = useState(blankForm);
  const [intakeId, setIntakeId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [converting, setConverting] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  const [intakeMode, setIntakeMode] = useState("complete_now"); // complete_now | send_to_homeowner

  const [homeowners, setHomeowners] = useState([]);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedHomeownerId, setSelectedHomeownerId] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadHomeowners() {
      try {
        setCustomersLoading(true);
        const { data } = await api.get("/projects/homeowners/");
        if (!mounted) return;
        setHomeowners(normalizeList(data));
      } catch (e) {
        console.error(e);
        if (!mounted) return;
        setHomeowners([]);
      } finally {
        if (mounted) setCustomersLoading(false);
      }
    }

    loadHomeowners();
    return () => {
      mounted = false;
    };
  }, []);

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

  const filteredHomeowners = useMemo(() => {
    const q = String(customerSearch || "").trim().toLowerCase();
    if (!q) return homeowners;

    return homeowners.filter((h) => {
      const hay = [
        h?.full_name,
        h?.name,
        h?.email,
        h?.phone_number,
        h?.phone,
        h?.street_address,
        h?.city,
        h?.state,
        h?.zip_code,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return hay.includes(q);
    });
  }, [homeowners, customerSearch]);

  const canAnalyze = useMemo(() => {
    return (
      !!String(form.customer_name || "").trim() &&
      !!String(form.project_address_line1 || "").trim() &&
      !!String(form.project_city || "").trim() &&
      !!String(form.project_state || "").trim() &&
      !!String(form.project_postal_code || "").trim() &&
      !!String(form.accomplishment_text || "").trim()
    );
  }, [form]);

  const canConvert = useMemo(() => {
    return !!intakeId && !!result;
  }, [intakeId, result]);

  function setField(name, value) {
    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  }

  function applyHomeownerToForm(homeowner) {
    if (!homeowner) return;

    const next = {
      ...form,
      customer_name: homeowner?.full_name || homeowner?.name || "",
      customer_email: homeowner?.email || "",
      customer_phone: homeowner?.phone_number || homeowner?.phone || "",
      customer_address_line1: homeowner?.street_address || "",
      customer_address_line2: homeowner?.address_line2 || "",
      customer_city: homeowner?.city || "",
      customer_state: homeowner?.state || "",
      customer_postal_code: homeowner?.zip_code || homeowner?.postal_code || "",
    };

    const finalNext = next.same_as_customer_address ? copyCustomerAddressToProject(next) : next;
    setForm(finalNext);
  }

  function clearCustomerSelection() {
    setSelectedHomeownerId("");
    setCustomerSearch("");
  }

  async function saveIntake(showToast = true) {
    setSaving(true);
    try {
      const payload = {
        ...form,
        homeowner: selectedHomeownerId || null,
      };

      if (intakeId) {
        const { data } = await api.patch(`/projects/intakes/${intakeId}/`, payload);
        if (showToast) toast.success("Intake saved.");
        return data;
      }

      const { data } = await api.post("/projects/intakes/", payload);
      setIntakeId(data.id);
      if (showToast) toast.success("Intake created.");
      return data;
    } catch (e) {
      toast.error(
        e?.response?.data?.detail ||
          e?.response?.data?.error ||
          "Could not save intake."
      );
      throw e;
    } finally {
      setSaving(false);
    }
  }

  async function handleAnalyze() {
    if (!canAnalyze) {
      toast.error("Please complete customer, project address, and accomplishment details first.");
      return;
    }

    try {
      const saved = await saveIntake(false);
      const id = saved?.id || intakeId;
      if (!id) {
        toast.error("Intake could not be saved.");
        return;
      }

      setAnalyzing(true);
      const { data } = await api.post(`/projects/intakes/${id}/analyze/`);
      setIntakeId(data?.intake?.id || id);
      setResult(data?.result || null);
      toast.success("Project analyzed.");
    } catch {
      // toast already handled
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleConvert() {
    if (!intakeId) {
      toast.error("Please save and analyze the intake first.");
      return;
    }

    try {
      setConverting(true);
      const { data } = await api.post(`/projects/intakes/${intakeId}/convert-to-agreement/`);
      toast.success("Agreement created.");
      if (data?.agreement_id) {
        navigate(`/app/agreements/${data.agreement_id}/wizard?step=1`);
      }
    } catch (e) {
      toast.error(
        e?.response?.data?.detail ||
          e?.response?.data?.error ||
          "Could not convert intake to agreement."
      );
    } finally {
      setConverting(false);
    }
  }

  async function handleSendToHomeowner() {
    if (!String(form.customer_email || "").trim()) {
      toast.error("Customer email is required to send intake.");
      return;
    }

    if (!String(form.customer_name || "").trim()) {
      toast.error("Customer name is required.");
      return;
    }

    try {
      setSending(true);

      const saved = await saveIntake(false);
      const id = saved?.id || intakeId;

      if (!id) {
        toast.error("Intake could not be saved.");
        return;
      }

      const { data } = await api.post(`/projects/intakes/${id}/send-to-homeowner/`);
      setIntakeId(id);

      toast.success(
        data?.email
          ? `Intake email sent to ${data.email}.`
          : "Intake email sent to customer."
      );
    } catch (e) {
      toast.error(
        e?.response?.data?.detail ||
          e?.response?.data?.error ||
          "Could not send intake."
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Project Intake</h1>
        <p className="mt-1 text-sm text-gray-600">
          Capture what the customer wants to accomplish, analyze the project, and generate a draft agreement.
        </p>
      </div>

      <div className="mb-6 rounded-xl border bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Intake Mode</h2>
        <p className="mt-1 text-sm text-gray-600">
          Complete the intake now, or save it and send it to the customer to finish.
        </p>

        <div className="mt-4 flex flex-wrap gap-3">
          <label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
            <input
              type="radio"
              name="intake_mode"
              checked={intakeMode === "complete_now"}
              onChange={() => setIntakeMode("complete_now")}
            />
            Complete intake now
          </label>

          <label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
            <input
              type="radio"
              name="intake_mode"
              checked={intakeMode === "send_to_homeowner"}
              onChange={() => setIntakeMode("send_to_homeowner")}
            />
            Send to customer to complete
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">Customer Information</h2>
            <p className="mt-1 text-sm text-gray-600">
              Search an existing customer or enter new customer details.
            </p>

            <div className="mt-4 rounded-lg border bg-slate-50 p-3">
              <div className="mb-1 block text-sm font-medium text-gray-900">Search Existing Customer</div>
              <input
                className="w-full rounded border px-3 py-2 text-sm"
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                placeholder={customersLoading ? "Loading customers..." : "Search by name, email, phone, or city"}
              />

              <div className="mt-3">
                <select
                  className="w-full rounded border px-3 py-2 text-sm"
                  value={selectedHomeownerId}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSelectedHomeownerId(val);
                    if (!val) return;
                    const found = homeowners.find((h) => String(h.id) === String(val));
                    applyHomeownerToForm(found);
                  }}
                >
                  <option value="">— Select Existing Customer —</option>
                  {filteredHomeowners.map((h) => (
                    <option key={h.id} value={h.id}>
                      {homeownerLabel(h)}
                    </option>
                  ))}
                </select>
              </div>

              {selectedHomeownerId ? (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={clearCustomerSelection}
                    className="text-xs font-medium text-indigo-700 hover:underline"
                  >
                    Clear customer selection
                  </button>
                </div>
              ) : null}
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium">Customer Name</label>
                <input
                  className="w-full rounded border px-3 py-2 text-sm"
                  value={form.customer_name}
                  onChange={(e) => setField("customer_name", e.target.value)}
                  placeholder="e.g., Jane Smith"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">Customer Email</label>
                <input
                  className="w-full rounded border px-3 py-2 text-sm"
                  value={form.customer_email}
                  onChange={(e) => setField("customer_email", e.target.value)}
                  placeholder="jane@example.com"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">Customer Phone</label>
                <input
                  className="w-full rounded border px-3 py-2 text-sm"
                  value={form.customer_phone}
                  onChange={(e) => setField("customer_phone", e.target.value)}
                  placeholder="(555) 555-5555"
                />
              </div>

              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium">Customer Address Line 1</label>
                <input
                  className="w-full rounded border px-3 py-2 text-sm"
                  value={form.customer_address_line1}
                  onChange={(e) => setField("customer_address_line1", e.target.value)}
                  placeholder="123 Main St"
                />
              </div>

              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium">Customer Address Line 2</label>
                <input
                  className="w-full rounded border px-3 py-2 text-sm"
                  value={form.customer_address_line2}
                  onChange={(e) => setField("customer_address_line2", e.target.value)}
                  placeholder="Apt, Suite, etc."
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">City</label>
                <input
                  className="w-full rounded border px-3 py-2 text-sm"
                  value={form.customer_city}
                  onChange={(e) => setField("customer_city", e.target.value)}
                  placeholder="San Antonio"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">State</label>
                <input
                  className="w-full rounded border px-3 py-2 text-sm"
                  value={form.customer_state}
                  onChange={(e) => setField("customer_state", e.target.value)}
                  placeholder="TX"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">ZIP / Postal Code</label>
                <input
                  className="w-full rounded border px-3 py-2 text-sm"
                  value={form.customer_postal_code}
                  onChange={(e) => setField("customer_postal_code", e.target.value)}
                  placeholder="78249"
                />
              </div>
            </div>
          </div>

          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">Project Address</h2>
            <p className="mt-1 text-sm text-gray-600">
              The job site can match the customer address or be different.
            </p>

            <label className="mt-4 flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={form.same_as_customer_address}
                onChange={(e) => setField("same_as_customer_address", e.target.checked)}
              />
              Same as customer address
            </label>

            {!form.same_as_customer_address ? (
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="mb-1 block text-sm font-medium">Project Address Line 1</label>
                  <input
                    className="w-full rounded border px-3 py-2 text-sm"
                    value={form.project_address_line1}
                    onChange={(e) => setField("project_address_line1", e.target.value)}
                    placeholder="Project address"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="mb-1 block text-sm font-medium">Project Address Line 2</label>
                  <input
                    className="w-full rounded border px-3 py-2 text-sm"
                    value={form.project_address_line2}
                    onChange={(e) => setField("project_address_line2", e.target.value)}
                    placeholder="Apt, Suite, etc."
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium">City</label>
                  <input
                    className="w-full rounded border px-3 py-2 text-sm"
                    value={form.project_city}
                    onChange={(e) => setField("project_city", e.target.value)}
                    placeholder="City"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium">State</label>
                  <input
                    className="w-full rounded border px-3 py-2 text-sm"
                    value={form.project_state}
                    onChange={(e) => setField("project_state", e.target.value)}
                    placeholder="State"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium">ZIP / Postal Code</label>
                  <input
                    className="w-full rounded border px-3 py-2 text-sm"
                    value={form.project_postal_code}
                    onChange={(e) => setField("project_postal_code", e.target.value)}
                    placeholder="ZIP"
                  />
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-lg border bg-slate-50 p-3 text-sm text-gray-700">
                <div className="font-medium text-gray-900">Project address will use the customer address</div>
                <div className="mt-2 whitespace-pre-line">
                  {[
                    form.project_address_line1,
                    form.project_address_line2,
                    [form.project_city, form.project_state, form.project_postal_code]
                      .filter(Boolean)
                      .join(", "),
                  ]
                    .filter(Boolean)
                    .join("\n") || "No customer address entered yet."}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">
              What does the customer want to accomplish?
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              Describe the goal in plain language. AI will recommend a template or generate a project structure.
            </p>

            <div className="mt-4">
              <textarea
                className="w-full rounded border px-3 py-2 text-sm"
                rows={6}
                value={form.accomplishment_text}
                onChange={(e) => setField("accomplishment_text", e.target.value)}
                placeholder="e.g., Replace leaking roof over garage and inspect flashing."
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => saveIntake(true)}
              disabled={saving}
              className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              {saving ? "Saving..." : intakeId ? "Update Intake" : "Save Intake"}
            </button>

            {intakeMode === "send_to_homeowner" ? (
              <button
                type="button"
                onClick={handleSendToHomeowner}
                disabled={sending || saving}
                className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                {sending ? "Sending..." : "Send to Customer"}
              </button>
            ) : null}

            {intakeId ? (
              <div className="flex items-center text-xs text-gray-500">
                Intake ID: {intakeId}
              </div>
            ) : null}
          </div>
        </div>

        <div>
          <IntakeAiRecommendationPanel
            result={result}
            analyzing={analyzing}
            converting={converting}
            onAnalyze={handleAnalyze}
            onConvert={handleConvert}
            canAnalyze={canAnalyze}
            canConvert={canConvert}
          />
        </div>
      </div>
    </div>
  );
}
