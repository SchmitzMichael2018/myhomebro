import { useState } from "react";
import AgreementMilestoneStep from "./AgreementMilestoneStep";
import AgreementReviewStep from "./AgreementReviewStep";

export default function AgreementWizard() {
  const [step, setStep] = useState(1);
  const [step1Data, setStep1Data] = useState(null);
  const [step2Data, setStep2Data] = useState(null);

  const handleStep1Next = (data) => {
    setStep1Data(data);
    setStep(2);
  };

  const handleStep2Next = (data) => {
    setStep2Data(data);
    setStep(3);
  };

  const handleFinalSubmit = async (finalData) => {
    const payload = {
      homeowner_name: finalData.homeownerName,
      homeowner_email: finalData.homeownerEmail,
      project_name: finalData.projectName,
      project_uid: `proj-${Date.now()}`,
      description: finalData.projectAddress || "",
      start_date: finalData.startDate,
      end_date: finalData.endDate,
      milestone_count: finalData.milestoneCount,
      total_price: finalData.totalPrice,
    };

    console.log("📤 Submitting agreement payload:", payload);

    try {
      const res = await fetch("http://127.0.0.1:8080/api/projects/agreements/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("access")}`,
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const result = await res.json();
        alert("✅ Agreement created successfully!");
        console.log("✅ Created agreement:", result);
      } else {
        const error = await res.json();
        console.error("❌ Backend Error Response:", error);  // log full error
        alert("❌ Submission error: " + JSON.stringify(error));
      }
    } catch (err) {
      console.error("❌ Server error while submitting:", err);
      alert("❌ Failed to submit agreement.");
    }
  };

  return (
    <div>
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
        const res = await fetch(
          `http://127.0.0.1:8080/api/projects/homeowners/lookup/?email=${value}`
        );
        const data = await res.json();

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
          <label className="block font-medium text-gray-700">Homeowner Email *</label>
          <input
            type="email"
            name="homeownerEmail"
            value={formData.homeownerEmail}
            onChange={handleChange}
            className="w-full mt-1 px-4 py-2 border rounded"
          />
          {lookupStatus && <p className="text-sm text-blue-600 mt-1">{lookupStatus}</p>}
          {errors.homeownerEmail && <p className="text-red-500 text-sm">{errors.homeownerEmail}</p>}
        </div>

        <div>
          <label className="block font-medium text-gray-700">Homeowner Name *</label>
          <input
            type="text"
            name="homeownerName"
            value={formData.homeownerName}
            onChange={handleChange}
            className="w-full mt-1 px-4 py-2 border rounded"
          />
          {errors.homeownerName && <p className="text-red-500 text-sm">{errors.homeownerName}</p>}
        </div>

        <div>
          <label className="block font-medium text-gray-700">Project Address</label>
          <input
            type="text"
            name="projectAddress"
            value={formData.projectAddress}
            onChange={handleChange}
            className="w-full mt-1 px-4 py-2 border rounded"
          />
        </div>

        <div>
          <label className="block font-medium text-gray-700">Project Name *</label>
          <input
            type="text"
            name="projectName"
            value={formData.projectName}
            onChange={handleChange}
            className="w-full mt-1 px-4 py-2 border rounded"
          />
          {errors.projectName && <p className="text-red-500 text-sm">{errors.projectName}</p>}
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



