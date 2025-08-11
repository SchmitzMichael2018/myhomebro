// src/components/CustomerForm.jsx

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import toast from 'react-hot-toast';

export default function CustomerForm() {
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    phone_number: '',
    street_address: '',
    address_line_2: '',
    city: '',
    state: '',
    zip_code: '',
    status: 'active',
  });

  const [isSaving, setIsSaving] = useState(false);
  const navigate = useNavigate();

  const handleChange = e => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async e => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await api.post('/homeowners/', form);
      toast.success('Customer created successfully!');
      navigate('/customers');
    } catch (err) {
      const errors = err.response?.data;
      let errorMsg = "Failed to create customer.";
      if (typeof errors === 'object' && errors !== null) {
        const firstKey = Object.keys(errors)[0];
        errorMsg = `${firstKey}: ${errors[firstKey][0]}`;
      }
      toast.error(errorMsg);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold mb-6 text-gray-800">Create New Customer</h2>
      <form onSubmit={handleSubmit} className="p-6 bg-white rounded-xl shadow-md space-y-8">
        <div className="space-y-6">
          <h3 className="text-lg font-medium text-gray-900">Contact Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700">Full Name</label>
              <input name="full_name" value={form.full_name} onChange={handleChange} required className="w-full px-3 py-2 border rounded shadow-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Email</label>
              <input name="email" type="email" value={form.email} onChange={handleChange} required className="w-full px-3 py-2 border rounded shadow-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Phone Number</label>
              <input name="phone_number" type="tel" value={form.phone_number} onChange={handleChange} placeholder="(555) 555-5555" className="w-full px-3 py-2 border rounded shadow-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Status</label>
              <select name="status" value={form.status} onChange={handleChange} className="w-full px-3 py-2 border rounded shadow-sm">
                <option value="active">Active</option>
                <option value="prospect">Prospect</option>
                <option value="archived">Archived</option>
              </select>
            </div>
          </div>
        </div>

        <div className="border-t border-gray-200 pt-8 space-y-6">
          <h3 className="text-lg font-medium text-gray-900">Address</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700">Street Address</label>
              <input name="street_address" value={form.street_address} onChange={handleChange} className="w-full px-3 py-2 border rounded shadow-sm" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700">Address Line 2</label>
              <input name="address_line_2" value={form.address_line_2} onChange={handleChange} className="w-full px-3 py-2 border rounded shadow-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">City</label>
              <input name="city" value={form.city} onChange={handleChange} className="w-full px-3 py-2 border rounded shadow-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">State</label>
              <input name="state" value={form.state} onChange={handleChange} className="w-full px-3 py-2 border rounded shadow-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">ZIP Code</label>
              <input name="zip_code" value={form.zip_code} onChange={handleChange} className="w-full px-3 py-2 border rounded shadow-sm" />
            </div>
          </div>
        </div>

        <div className="pt-5 border-t border-gray-200 flex justify-end">
          <button type="button" onClick={() => navigate('/customers')} className="bg-white py-2 px-4 border border-gray-300 rounded text-sm text-gray-700 hover:bg-gray-50">
            Cancel
          </button>
          <button type="submit" disabled={isSaving} className="ml-3 py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm shadow disabled:bg-gray-400">
            {isSaving ? 'Creating...' : 'Create Customer'}
          </button>
        </div>
      </form>
    </div>
  );
}
