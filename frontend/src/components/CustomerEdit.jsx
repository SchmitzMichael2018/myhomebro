// src/components/CustomerEdit.jsx — v2025-11-11 use canonical /projects/homeowners/{id}/
import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api';
import toast from 'react-hot-toast';

function formatZip(value){const d=String(value||"").replace(/\D/g,"").slice(0,9);return d.length<=5?d:`${d.slice(0,5)}-${d.slice(5)}`;}
function formatPhoneUS(value){let d=String(value||"").replace(/\D/g,"");if(d.length===11&&d.startsWith("1"))d=d.slice(1);if(d.length<=3)return d;if(d.length<=6)return`(${d.slice(0,3)}) ${d.slice(3)}`;return`(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6,10)}`;}
function isValidZip(zip){if(!zip)return true;return /^\d{5}(-\d{4})?$/.test(zip);}
function isValidUSPhone(input){const d=String(input||"").replace(/\D/g,"");return d.length===10||(d.length===11&&d.startsWith("1"));}

export default function CustomerEdit(){
  const { id } = useParams();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    full_name: '', email: '', phone_number: '', street_address: '', address_line_2: '',
    city: '', state: '', zip_code: '', status: 'active',
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchCustomer = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/projects/homeowners/${id}/`); // canonical (no alias)
      const phoneDisplay = formatPhoneUS(data.phone_number || '');
      const zipDisplay = formatZip(data.zip_code || '');
      setForm({
        full_name: data.full_name || '', email: data.email || '',
        phone_number: phoneDisplay, street_address: data.street_address || '', address_line_2: data.address_line_2 || '',
        city: data.city || '', state: data.state || '', zip_code: zipDisplay, status: data.status || 'active',
      });
    } catch (error) {
      console.error('Failed to load customer:', error);
      toast.error('Failed to load customer data.');
      navigate('/customers');
    } finally { setLoading(false); }
  }, [id, navigate]);

  useEffect(() => {
    if (!id) { toast.error("Missing customer ID."); navigate("/customers"); return; }
    fetchCustomer();
  }, [fetchCustomer, id, navigate]);

  const handleChange = e => {
    const { name, value } = e.target;
    if (name === "zip_code") return setForm(prev => ({ ...prev, zip_code: formatZip(value) }));
    if (name === "phone_number") return setForm(prev => ({ ...prev, phone_number: formatPhoneUS(value) }));
    setForm(prevForm => ({ ...prevForm, [name]: value }));
  };

  const handleSubmit = async e => {
    e.preventDefault();

    if (!isValidUSPhone(form.phone_number)) return toast.error("Enter a valid US phone (10 digits, or +1 then 10 digits).");
    if (!isValidZip(form.zip_code)) return toast.error("ZIP code must be 5 digits or 9 digits (ZIP+4).");

    setSaving(true);
    try {
      const payload = { ...form, phone_number: String(form.phone_number || "").replace(/\D/g, "") };
      await api.patch(`/projects/homeowners/${id}/`, payload); // canonical (no alias)
      toast.success('Customer updated successfully!');
      navigate('/customers');
    } catch (err) {
      console.error("Customer update failed:", err);
      toast.error(err.response?.data?.detail || 'Failed to update customer.');
    } finally { setSaving(false); }
  };

  if (loading) {
    return <div className="p-6 text-center">Loading customer details...</div>;
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold mb-6 text-gray-800">Edit Customer</h2>
      <form onSubmit={handleSubmit} className="p-6 bg-white rounded-xl shadow-md space-y-8" noValidate>
        <div className="space-y-6">
          <h3 className="text-lg font-medium leading-6 text-gray-900">Contact Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div><label htmlFor="full_name" className="block text-sm font-medium text-gray-700">Full Name</label>
              <input id="full_name" name="full_name" type="text" value={form.full_name} onChange={handleChange} required className="w-full px-3 py-2 border rounded shadow-sm" /></div>
            <div><label htmlFor="email" className="block text-sm font-medium text-gray-700">Email Address</label>
              <input id="email" name="email" type="email" value={form.email} onChange={handleChange} required className="w-full px-3 py-2 border rounded shadow-sm" /></div>
            <div><label htmlFor="phone_number" className="block text-sm font-medium text-gray-700">Phone Number</label>
              <input id="phone_number" name="phone_number" type="tel" value={form.phone_number} onChange={handleChange} className="w-full px-3 py-2 border rounded shadow-sm" placeholder="(555) 555-5555" inputMode="tel" /></div>
            <div><label htmlFor="status" className="block text-sm font-medium text-gray-700">Status</label>
              <select id="status" name="status" value={form.status} onChange={handleChange} className="w-full px-3 py-2 border rounded shadow-sm">
                <option value="active">Active</option><option value="prospect">Prospect</option><option value="archived">Archived</option>
              </select></div>
          </div>
        </div>

        <div className="border-t border-gray-200 pt-8 space-y-6">
          <h3 className="text-lg font-medium leading-6 text-gray-900">Address</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="md:col-span-2"><label htmlFor="street_address" className="block text-sm font-medium text-gray-700">Street Address</label>
              <input id="street_address" name="street_address" type="text" value={form.street_address} onChange={handleChange} className="w-full px-3 py-2 border rounded shadow-sm" /></div>
            <div className="md:col-span-2"><label htmlFor="address_line_2" className="block text-sm font-medium text-gray-700">Address Line 2 (Apt, Suite, etc.)</label>
              <input id="address_line_2" name="address_line_2" type="text" value={form.address_line_2} onChange={handleChange} className="w-full px-3 py-2 border rounded shadow-sm" /></div>
            <div><label htmlFor="city" className="block text-sm font-medium text-gray-700">City</label>
              <input id="city" name="city" type="text" value={form.city} onChange={handleChange} className="w-full px-3 py-2 border rounded shadow-sm" /></div>
            <div><label htmlFor="state" className="block text-sm font-medium text-gray-700">State / Province</label>
              <input id="state" name="state" type="text" value={form.state} onChange={handleChange} className="w-full px-3 py-2 border rounded shadow-sm" /></div>
            <div><label htmlFor="zip_code" className="block text-sm font-medium text-gray-700">ZIP / Postal Code</label>
              <input id="zip_code" name="zip_code" type="text" value={form.zip_code} onChange={handleChange} className="w-full px-3 py-2 border rounded shadow-sm" placeholder="12345 or 12345-6789" inputMode="numeric" /></div>
          </div>
        </div>

        <div className="pt-5 border-t border-gray-200">
          <div className="flex justify-end">
            <button type="button" onClick={() => navigate('/customers')} className="bg-white py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="ml-3 inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400">
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
