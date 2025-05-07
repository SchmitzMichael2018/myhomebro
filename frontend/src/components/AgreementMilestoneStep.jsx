// src/components/AgreementMilestoneStep.jsx
import { useState, useEffect } from "react";

export default function AgreementMilestoneStep({ step1Data, onBack, onSubmit }) {
  const [formData, setFormData] = useState({
    totalPrice: "",
    milestoneCount: 1,
    startDate: "",
    endDate: "",
  });

  const [errors, setErrors] = useState({});

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: name === "milestoneCount" ? parseInt(value) : value,
    }));
  };

  const validateStep = () => {
    const newErrors = {};
    if (!formData.totalPrice || parseFloat(formData.totalPrice) <= 0)
      newErrors.totalPrice = "Enter a valid amount";
    if (!formData.startDate) newErrors.startDate = "Start date required";
    if (!formData.endDate) newErrors.endDate = "End date required";
    if (formData.milestoneCount < 1 || formData.milestoneCount > 12)
      newErrors.milestoneCount = "Choose between 1–12 milestones";
    return newErrors;
  };

  const handleSubmit = () => {
    const validationErrors = validateStep();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
    } else {
      setErrors({});
      onSubmit({ ...step1Data, ...formData });
    }
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-md max-w-2xl mx-auto mt-6">
      <h2 className="text-2xl font-bold mb-4 text-gray-800">Step 2: Milestones & Pricing</h2>

      <div className="space-y-4">
        <div>
          <label className="block text-gray-700">Total Project Price ($) *</label>
          <input
            type="number"
            name="totalPrice"
            value={formData.totalPrice}
            onChange={handleChange}
            className="w-full px-4 py-2 border rounded"
          />
          {errors.totalPrice && (
            <p className="text-red-500 text-sm">{errors.totalPrice}</p>
          )}
        </div>

        <div>
          <label className="block text-gray-700">Milestone Count *</label>
          <input
            type="number"
            name="milestoneCount"
            value={formData.milestoneCount}
            onChange={handleChange}
            min="1"
            max="12"
            className="w-full px-4 py-2 border rounded"
          />
          {errors.milestoneCount && (
            <p className="text-red-500 text-sm">{errors.milestoneCount}</p>
          )}
        </div>

        <div className="flex gap-4">
          <div className="flex-1">
            <label className="block text-gray-700">Start Date *</label>
            <input
              type="date"
              name="startDate"
              value={formData.startDate}
              onChange={handleChange}
              className="w-full px-4 py-2 border rounded"
            />
            {errors.startDate && (
              <p className="text-red-500 text-sm">{errors.startDate}</p>
            )}
          </div>

          <div className="flex-1">
            <label className="block text-gray-700">End Date *</label>
            <input
              type="date"
              name="endDate"
              value={formData.endDate}
              onChange={handleChange}
              className="w-full px-4 py-2 border rounded"
            />
            {errors.endDate && (
              <p className="text-red-500 text-sm">{errors.endDate}</p>
            )}
          </div>
        </div>
      </div>

      <div className="mt-6 flex justify-between">
        <button onClick={onBack} className="px-6 py-2 bg-gray-300 rounded">
          Back
        </button>
        <button onClick={handleSubmit} className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
          Submit Agreement
        </button>
      </div>
    </div>
  );
}
