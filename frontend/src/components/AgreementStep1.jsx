// src/components/AgreementStep1.jsx

import React, { useState } from 'react';
import toast from 'react-hot-toast';

const projectTypes = [
  'Remodel', 'Repair', 'Installation', 'Painting', 'Outdoor', 'Inspection', 'Custom', 'DIY Help'
];

export default function AgreementStep1({ onNext, initialData, allHomeowners }) {
  const [formData, setFormData] = useState({
    projectName: initialData.projectName || '',
    homeownerId: initialData.homeownerId || '',
    projectType: initialData.projectType || '',
    projectSubtype: initialData.projectSubtype || '',
    description: initialData.description || '',
    useCustomerAddress: initialData.useCustomerAddress === false ? false : true,
    project_street_address: initialData.project_street_address || '',
    project_address_line_2: initialData.project_address_line_2 || '',
    project_city: initialData.project_city || '',
    project_state: initialData.project_state || '',
    project_zip_code: initialData.project_zip_code || '',
  });

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleNext = () => {
    if (!formData.homeownerId || !formData.projectName || !formData.projectType) {
      toast.error("Please select a customer, enter a project name, and select a project type.");
      return;
    }
    onNext(formData);
  };

  return (
    <div className="bg-white p-6 sm:p-8 rounded-xl shadow-lg max-w-3xl mx-auto">
      <div className="mb-8">
        <h2 className="text-xl font-bold text-gray-900">Step 1: Project Details</h2>
        <p className="text-sm text-gray-500 mt-1">Define the project scope and link it to a customer.</p>
      </div>

      <div className="space-y-6">
        {/* Project Name */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-center">
          <label htmlFor="projectName" className="sm:text-right text-sm font-medium text-gray-700">Project Name</label>
          <div className="sm:col-span-2">
            <input id="projectName" name="projectName" type="text" value={formData.projectName} onChange={handleChange} className="form-input" placeholder="e.g., Kitchen Remodel" />
          </div>
        </div>

        {/* Description */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <label htmlFor="description" className="sm:text-right text-sm font-medium text-gray-700 self-start pt-2">Description</label>
          <div className="sm:col-span-2">
            <textarea id="description" name="description" value={formData.description} onChange={handleChange} className="form-input" placeholder="Provide a brief description of the project..." rows={3}></textarea>
          </div>
        </div>

        {/* Project Type + Subtype */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <label htmlFor="projectType" className="sm:text-right text-sm font-medium text-gray-700 self-start pt-2">Project Type</label>
          <div className="sm:col-span-2 grid grid-cols-2 gap-4">
            <select id="projectType" name="projectType" value={formData.projectType} onChange={handleChange} className="form-input">
              <option value="">-- Select a Type --</option>
              {projectTypes.map(type => <option key={type} value={type}>{type}</option>)}
            </select>
            <input name="projectSubtype" type="text" value={formData.projectSubtype} onChange={handleChange} className="form-input" placeholder="Sub-Type (Optional)" />
          </div>
        </div>

        <hr/>

        {/* Customer Select */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-center">
          <label htmlFor="homeownerId" className="sm:text-right text-sm font-medium text-gray-700">Select a Customer</label>
          <div className="sm:col-span-2">
            <select id="homeownerId" name="homeownerId" value={formData.homeownerId} onChange={handleChange} className="form-input" disabled={!allHomeowners}>
              <option value="">{!allHomeowners ? 'Loading...' : '-- Choose a customer --'}</option>
              {allHomeowners && allHomeowners.map((h) => <option key={h.id} value={h.id}>{h.full_name} ({h.email})</option>)}
            </select>
          </div>
        </div>

        {/* Address Fields */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="sm:col-start-2 sm:col-span-2">
            <div className="flex items-center">
              <input id="useCustomerAddress" name="useCustomerAddress" type="checkbox" checked={formData.useCustomerAddress} onChange={handleChange} className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500" />
              <label htmlFor="useCustomerAddress" className="ml-3 block text-sm font-medium text-gray-800">Project address is the same as customer's home address</label>
            </div>
          </div>
        </div>

        {!formData.useCustomerAddress && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t">
            <label className="sm:text-right text-sm font-medium text-gray-700 self-start pt-2">Project Address</label>
            <div className="sm:col-span-2 space-y-4">
              <input name="project_street_address" placeholder="Street Address" value={formData.project_street_address} onChange={handleChange} className="form-input" />
              <input name="project_address_line_2" placeholder="Address Line 2 (Optional)" value={formData.project_address_line_2} onChange={handleChange} className="form-input" />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <input name="project_city" placeholder="City" value={formData.project_city} onChange={handleChange} className="form-input" />
                <input name="project_state" placeholder="State" value={formData.project_state} onChange={handleChange} className="form-input" />
                <input name="project_zip_code" placeholder="ZIP Code" value={formData.project_zip_code} onChange={handleChange} className="form-input" />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="mt-8 pt-5 border-t border-gray-200 flex justify-end">
        <button onClick={handleNext} className="bg-blue-600 text-white font-semibold px-6 py-2 rounded-lg hover:bg-blue-700">
          Next: Define Milestones →
        </button>
      </div>
    </div>
  );
}
