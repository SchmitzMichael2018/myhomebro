import { useState } from "react";
import api from "../api";
import AgreementMilestoneStep from "./AgreementMilestoneStep";
import AgreementReviewStep from "./AgreementReviewStep";

export default function AgreementWizard() {
  const [step, setStep] = useState(1);
  const [step1Data, setStep1Data] = useState(null);
  const [step2Data, setStep2Data] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const handleStep1Next = (data) => {
    setStep1Data(data);
    setStep(2);
  };

  const handleStep2Next = (data) => {
    setStep2Data(data);
    setStep(3);
  };

  // Uses flat keys; no nested homeowner object!
  const handleFinalSubmit = async (finalData) => {
    setLoading(true);
    setErrorMessage("");

    const payload = {
      homeowner_email: finalData.homeownerEmail,
      homeowner_name: finalData.homeownerName,
      homeowner_address: finalData.projectAddress || "",
      project_title: finalData.projectName,
      project_description: finalData.projectAddress || "",
      milestones_input: finalData.milestones.map((m, idx) => ({
        order: idx + 1,
        title: m.title,
        description: m.description,
        amount: parseFloat(m.amount),
        start_date: m.start_date,
        completion_date: m.completion_date,
        days: Number(m.days),
        hours: Number(m.hours),
        minutes: Number(m.minutes),
      })),
      total_cost: finalData.milestoneTotalCost,
      total_time_estimate: finalData.milestoneTotalDuration,
    };

    try {
      const res = await api.post("/projects/agreements/", payload);
      if (res.status === 201 || res.status === 200) {
        alert("✅ Agreement created successfully!");
        setStep(1);
        setStep1Data(null);
        setStep2Data(null);
      } else {
        setErrorMessage("❌ Submission error: " + JSON.stringify(res.data));
      }
    } catch (err) {
      console.error("❌ Server error while submitting:", err);
      setErrorMessage(
        "❌ Network error. Please try again. " +
          (err.response?.data?.detail || "")
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold">Agreement Wizard</h2>
        <p className="text-sm text-gray-500">Step {step} of 3</p>
      </div>
      {errorMessage && <p className="text-red-500 mb-4">{errorMessage}</p>}

      {step === 1 && <Step1 onNext={handleStep1Next} />}
      {step === 2 && (
        <AgreementMilestoneStep
          step1Data={step1Data}
          onBack={() => setStep(1)}
          onSubmit={handleStep2Next}
        />
      )}
      {step === 3 && (
        <AgreementReviewStep
          data={{ ...step1Data, ...step2Data }}
          onBack={() => setStep(2)}
          onSubmit={handleFinalSubmit}
        />
      )}

      {loading && (
        <div className="absolute inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center">
          <div className="text-white text-xl">Submitting...</div>
        </div>
      )}
    </div>
  );
}

// Step 1: Homeowner Info
function Step1({ onNext }) {
  const [formData, setFormData] = useState({
    homeownerName: "",
    homeownerEmail: "",
    projectName: "",
    projectAddress: "",
  });

  const [errors, setErrors] = useState({});
  const [lookupStatus, setLookupStatus] = useState(null);

  const handleChange = async (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));

    if (name === "homeownerEmail" && value.includes("@")) {
      try {
        const res = await api.get(
          `/projects/homeowners/lookup/?email=${value}`
        );
        const data = res.data;
        if (data && data.name) {
          setFormData((prev) => ({
            ...prev,
            homeownerName: data.name,
            projectAddress: data.address || "",
          }));
          setLookupStatus("✅ Returning customer info loaded.");
        } else {
          setLookupStatus("🆕 New homeowner — please enter info.");
        }
      } catch (err) {
        console.error("Lookup failed:", err);
        setLookupStatus("⚠️ Error during lookup.");
      }
    }
  };

  const validateStep = () => {
    const newErrors = {};
    if (!formData.homeownerName.trim()) newErrors.homeownerName = "Required";
    if (!formData.homeownerEmail.trim()) newErrors.homeownerEmail = "Required";
    if (!formData.projectName.trim()) newErrors.projectName = "Required";
    return newErrors;
  };

  const handleNext = () => {
    const validationErrors = validateStep();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
    } else {
      setErrors({});
      onNext(formData);
    }
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-md max-w-2xl mx-auto mt-6">
      <h2 className="text-2xl font-bold mb-4 text-gray-800">Step 1: Homeowner Info</h2>

      <div className="space-y-4">
        <div>
          <label>Homeowner Email *</label>
          <input
            type="email"
            name="homeownerEmail"
            value={formData.homeownerEmail}
            onChange={handleChange}
            className="w-full px-4 py-2 border rounded"
          />
          {lookupStatus && (
            <p className="text-sm text-blue-600">{lookupStatus}</p>
          )}
          {errors.homeownerEmail && (
            <p className="text-red-500">{errors.homeownerEmail}</p>
          )}
        </div>

        <div>
          <label>Homeowner Name *</label>
          <input
            type="text"
            name="homeownerName"
            value={formData.homeownerName}
            onChange={handleChange}
            className="w-full px-4 py-2 border rounded"
          />
          {errors.homeownerName && (
            <p className="text-red-500">{errors.homeownerName}</p>
          )}
        </div>

        <div>
          <label>Project Name *</label>
          <input
            type="text"
            name="projectName"
            value={formData.projectName}
            onChange={handleChange}
            className="w-full px-4 py-2 border rounded"
          />
          {errors.projectName && (
            <p className="text-red-500">{errors.projectName}</p>
          )}
        </div>

        <div>
          <label>Project Address (optional)</label>
          <input
            type="text"
            name="projectAddress"
            value={formData.projectAddress}
            onChange={handleChange}
            className="w-full px-4 py-2 border rounded"
          />
        </div>
      </div>

      <div className="mt-6 flex justify-end">
        <button
          onClick={handleNext}
          className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700"
        >
          Next
        </button>
      </div>
    </div>
  );
}







