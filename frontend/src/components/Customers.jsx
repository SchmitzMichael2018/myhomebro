// src/components/Customers.jsx

import React, { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Edit, Trash2, Home, Phone } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';

const StatusBadge = ({ status }) => {
    const statusStyles = {
        active: 'bg-green-100 text-green-800',
        prospect: 'bg-blue-100 text-blue-800',
        archived: 'bg-gray-100 text-gray-800',
    };
    return (
        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full capitalize ${statusStyles[status] || 'bg-gray-100'}`}>
            {status}
        </span>
    );
};

const formatPhoneNumber = (phoneStr) => {
    if (!phoneStr) return null;
    const cleaned = ('' + phoneStr).replace(/\D/g, '');
    const match = cleaned.match(/^(\d{3})(\d{3})(\d{4})$/);
    if (match) {
        return `(${match[1]}) ${match[2]}-${match[3]}`;
    }
    return phoneStr;
};

// --- NEW: Helper function to format the structured address for display ---
const formatAddress = (customer) => {
    if (!customer.street_address) {
        return "No address on file";
    }
    // Combines City, State ZIP
    const cityStateZip = [customer.city, customer.state].filter(Boolean).join(', ') + ' ' + (customer.zip_code || '');
    // Joins Street, optional Line 2, and the rest, filtering out any empty parts.
    const fullAddress = [customer.street_address, customer.address_line_2, cityStateZip.trim()].filter(Boolean).join(', ');
    return fullAddress;
};


export default function Customers() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/homeowners/');
      const customerData = Array.isArray(data) ? data : data.results || [];
      setCustomers(customerData);
    } catch (err) {
      const errorMsg = "Failed to load customers. Please try again.";
      setError(errorMsg);
      toast.error(errorMsg);
      console.error("Fetch customers error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this customer? This may also affect related projects and agreements.')) return;
    
    try {
      await api.delete(`/homeowners/${id}/`);
      setCustomers(prevCustomers => prevCustomers.filter(c => c.id !== id));
      toast.success('Customer deleted successfully.');
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to delete customer.');
      console.error("Delete customer error:", err);
    }
  };

  const renderContent = () => {
    if (loading) {
      return <p className="text-center text-gray-500 py-10">Loading customers...</p>;
    }
  
    if (error) {
      return <p className="text-center text-red-500 py-10">{error}</p>;
    }

    if (customers.length === 0) {
      return (
        <div className="text-center py-10 bg-white rounded-lg shadow-md">
            <h3 className="text-lg font-semibold text-gray-700">No Customers Yet</h3>
            <p className="text-gray-500 mt-2 mb-4">Add your first customer to get started.</p>
            <Link to="/customers/new" className="mt-4 inline-block bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-lg">
                + Add Your First Customer
            </Link>
        </div>
      );
    }

    return (
      <div className="overflow-x-auto bg-white shadow-md rounded-lg">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Customer</th>
              <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              <th className="py-3 px-6 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Active Projects</th>
              <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date Added</th>
              <th className="py-3 px-6 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {customers.map(customer => (
              <tr key={customer.id} className="hover:bg-gray-50 transition-colors">
                <td className="py-4 px-6 whitespace-nowrap">
                    <div className="font-medium text-gray-900">{customer.full_name || 'N/A'}</div>
                    <div className="text-sm text-gray-500">{customer.email}</div>
                    <div className="text-sm text-gray-500 flex items-center mt-1">
                        <Phone size={12} className="mr-1.5"/> {formatPhoneNumber(customer.phone_number) || 'N/A'}
                    </div>
                     <div className="text-sm text-gray-500 flex items-center mt-1">
                        {/* --- THIS IS THE FIX --- */}
                        <Home size={12} className="mr-1.5"/> {formatAddress(customer)}
                    </div>
                </td>
                <td className="py-4 px-6 whitespace-nowrap">
                    <StatusBadge status={customer.status} />
                </td>
                <td className="py-4 px-6 whitespace-nowrap text-center text-sm font-medium">
                    {customer.active_projects_count}
                </td>
                <td className="py-4 px-6 whitespace-nowrap text-sm text-gray-500">
                    {new Date(customer.created_at).toLocaleDateString()}
                </td>
                <td className="py-4 px-6 whitespace-nowrap text-right text-sm font-medium space-x-4">
                  <button
                    onClick={() => navigate(`/customers/${customer.id}/edit`)}
                    className="text-blue-600 hover:text-blue-800 transition-colors"
                    title="Edit Customer"
                  >
                    <Edit size={18} />
                  </button>
                  <button
                    onClick={() => handleDelete(customer.id)}
                    className="text-red-600 hover:text-red-800 transition-colors"
                    title="Delete Customer"
                  >
                    <Trash2 size={18} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-800">My Customers</h1>
        <Link
          to="/customers/new"
          className="inline-flex items-center bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-lg shadow-sm transition-transform hover:scale-105"
        >
          + Add New Customer
        </Link>
      </div>
      {renderContent()}
    </div>
  );
}