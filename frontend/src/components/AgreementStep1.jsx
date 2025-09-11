import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';

const projectTypes = [
  'Remodel', 'Repair', 'Installation', 'Painting', 'Outdoor', 'Inspection', 'Custom', 'DIY Help'
];

const DRAFT_KEY = 'agreement:step1';

function initFrom(initialData = {}) {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {
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
  };
}

export default function AgreementStep1({ onNext, initialData = {}, allHomeowners = [] }) {
  const [formData, setFormData] = useState(() => initFrom(initialData));
  const [errors, setErrors] = useState({});

  const homeownerMap = useMemo(() => {
    const m = new Map();
    (allHomeowners || []).forEach(h => m.set(String(h.id), h));
    return m;
  }, [allHomeowners]);

  // autosave draft (debounced)
  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(formData)); } catch {}
    }, 800);
    return () => clearTimeout(t);
  }, [formData]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    let v = type === 'checkbox' ? checked : value;
    if (name === 'project_state') v = (v || '').toUpperCase().slice(0, 2);
    if (name === 'project_zip_code') v = (v || '').replace(/\D/g, '').slice(0, 9);
    setFormData(prev => ({ ...prev, [name]: v }));
    setErrors(prev => ({ ...prev, [name]: '' }));
  };

  const validate = useCallback(() => {
    const next = {};
    if (!formData.homeownerId) next.homeownerId = 'Select a customer';
    if (!formData.projectName.trim()) next.projectName = 'Project name is required';
    if (!formData.projectType) next.projectType = 'Project type is required';
    if (!formData.useCustomerAddress) {
      if (!formData.project_street_address.trim()) next.project_street_address = 'Street required';
      if (!formData.project_city.trim()) next.project_city = 'City required';
      if (!formData.project_state || formData.project_state.length !== 2) next.project_state = '2-letter state';
      if (!formData.project_zip_code || !/^\d{5}(\d{4})?$/.test(formData.project_zip_code)) next.project_zip_code = 'ZIP 5–9 digits';
    }
    return next;
  }, [formData]);

  const handleNext = () => {
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      toast.error('Please complete the highlighted fields.');
      return;
    }

    const selected = homeownerMap.get(String(formData.homeownerId));
    const extra = {
      homeownerName: selected?.full_name || selected?.name || '',
      homeownerEmail: selected?.email || '',
    };

    // If using customer address, keep Step 1 consistent for later steps
    if (formData.useCustomerAddress && selected) {
      const street = selected.street_address || selected.address_line1 || selected.address || '';
      const line2 = selected.address_line_2 || '';
      const city = selected.city || '';
      const state = (selected.state || '').toString().toUpperCase().slice(0, 2);
      const zip = selected.zip_code || selected.postal_code || selected.zip || '';
      onNext({ ...formData, ...extra, project_street_address: street, project_address_line_2: line2, project_city: city, project_state: state, project_zip_code: zip });
      return;
    }

    onNext({ ...formData, ...extra });
  };

  const discardDraft = () => {
    try { localStorage.removeItem(DRAFT_KEY); } catch {}
    setFormData(initFrom(initialData));
    setErrors({});
    toast('Draft cleared.');
  };

  const invalid = !!Object.keys(validate()).length;

  return (
    <div className="bg-white p-6 sm:p-8 rounded-xl shadow-lg max-w-3xl mx-auto">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Step 1: Project Details</h2>
          <p className="text-sm text-gray-500 mt-1">Define the project scope and link it to a customer.</p>
        </div>
        <button type="button" onClick={discardDraft} className="text-sm text-red-600 hover:underline">Discard Draft</button>
      </div>

      {/* --- fields unchanged except for inline errors --- */}
      {/* Project Name */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-center">
        <label htmlFor="projectName" className="sm:text-right text-sm font-medium text-gray-700">Project Name</label>
        <div className="sm:col-span-2">
          <input id="projectName" name="projectName" type="text" value={formData.projectName} onChange={handleChange} className={`form-input ${errors.projectName ? 'ring-1 ring-red-500' : ''}`} placeholder="e.g., Kitchen Remodel" />
          {errors.projectName && <p className="text-xs text-red-600 mt-1">{errors.projectName}</p>}
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
          <select id="projectType" name="projectType" value={formData.projectType} onChange={handleChange} className={`form-input ${errors.projectType ? 'ring-1 ring-red-500' : ''}`}>
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
          <select id="homeownerId" name="homeownerId" value={formData.homeownerId} onChange={handleChange} className={`form-input ${errors.homeownerId ? 'ring-1 ring-red-500' : ''}`} disabled={!allHomeowners}>
            <option value="">{!allHomeowners ? 'Loading...' : '-- Choose a customer --'}</option>
            {allHomeowners && allHomeowners.map((h) => (
              <option key={h.id} value={h.id}>
                {(h.full_name || h.name)} ({h.email})
              </option>
            ))}
          </select>
          {errors.homeownerId && <p className="text-xs text-red-600 mt-1">{errors.homeownerId}</p>}
        </div>
      </div>

      {/* Address toggle + fields (unchanged UI, with errors) */}
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
            <div>
              <input name="project_street_address" placeholder="Street Address" value={formData.project_street_address} onChange={handleChange} className={`form-input ${errors.project_street_address ? 'ring-1 ring-red-500' : ''}`} />
              {errors.project_street_address && <p className="text-xs text-red-600 mt-1">{errors.project_street_address}</p>}
            </div>
            <input name="project_address_line_2" placeholder="Address Line 2 (Optional)" value={formData.project_address_line_2} onChange={handleChange} className="form-input" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <input name="project_city" placeholder="City" value={formData.project_city} onChange={handleChange} className={`form-input ${errors.project_city ? 'ring-1 ring-red-500' : ''}`} />
                {errors.project_city && <p className="text-xs text-red-600 mt-1">{errors.project_city}</p>}
              </div>
              <div>
                <input name="project_state" placeholder="State (e.g., TX)" value={formData.project_state} onChange={handleChange} className={`form-input ${errors.project_state ? 'ring-1 ring-red-500' : ''}`} />
                {errors.project_state && <p className="text-xs text-red-600 mt-1">{errors.project_state}</p>}
              </div>
              <div>
                <input name="project_zip_code" placeholder="ZIP Code" value={formData.project_zip_code} onChange={handleChange} className={`form-input ${errors.project_zip_code ? 'ring-1 ring-red-500' : ''}`} />
                {errors.project_zip_code && <p className="text-xs text-red-600 mt-1">{errors.project_zip_code}</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mt-8 pt-5 border-t border-gray-200 flex justify-end gap-3">
        <button
          type="button"
          onClick={handleNext}
          disabled={invalid}
          className={`px-6 py-2 rounded-lg font-semibold text-white ${invalid ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}
          title={invalid ? 'Complete required fields first' : 'Continue to Milestones'}
        >
          Next: Define Milestones →
        </button>
      </div>
    </div>
  );
}
