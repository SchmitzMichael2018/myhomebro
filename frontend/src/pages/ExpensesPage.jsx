// src/pages/ExpensesPage.jsx

import React, { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import api from '../api';

// A sub-component for the form to keep the main component cleaner
const AddExpenseForm = ({ agreements, onAdd, loading }) => {
    const [form, setForm] = useState({
        agreement: '',
        description: '',
        amount: '',
        incurred_date: new Date().toISOString().split('T')[0], // Default to today
    });

    const handleChange = e => {
        const { name, value } = e.target;
        setForm(f => ({ ...f, [name]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.agreement) {
            toast.error("Please select an agreement.");
            return;
        }
        await onAdd(form);
        // Reset form after successful submission
        setForm({ agreement: '', description: '', amount: '', incurred_date: new Date().toISOString().split('T')[0] });
    };

    return (
        <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4 mb-8 p-4 bg-gray-50 rounded-lg">
            <select name="agreement" value={form.agreement} onChange={handleChange} className="form-input md:col-span-2" required>
                <option value="">-- Select an Agreement --</option>
                {agreements.map(agr => (
                    <option key={agr.id} value={agr.id}>
                        #{agr.id} - {agr.project.title}
                    </option>
                ))}
            </select>
            <input name="description" placeholder="Expense Description" value={form.description} onChange={handleChange} className="form-input" required />
            <input name="amount" type="number" step="0.01" placeholder="Amount" value={form.amount} onChange={handleChange} className="form-input" required />
            <input name="incurred_date" type="date" value={form.incurred_date} onChange={handleChange} className="form-input" required />
            <button type="submit" disabled={loading} className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 md:col-span-5">
                {loading ? 'Adding...' : '+ Add Expense'}
            </button>
        </form>
    );
};

// --- Main Page Component ---
export default function ExpensesPage() {
    const [expenses, setExpenses] = useState([]);
    const [agreements, setAgreements] = useState([]); // Need to fetch agreements for the form dropdown
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            // Fetch both expenses and agreements in parallel
            const [expensesRes, agreementsRes] = await Promise.all([
                api.get('/expenses/'), // This should be a valid endpoint that lists all expenses for the user
                api.get('/agreements/')
            ]);
            setExpenses(expensesRes.data);
            setAgreements(agreementsRes.data);
        } catch (err) {
            const errorMsg = 'Failed to load page data.';
            setError(errorMsg);
            toast.error(errorMsg);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleAddExpense = async (formData) => {
        setIsSubmitting(true);
        try {
            // Use the correct NESTED endpoint for creating an expense
            const endpoint = `/agreements/${formData.agreement}/expenses/`;
            await api.post(endpoint, formData);
            toast.success('Expense added successfully!');
            fetchData(); // Refresh the list
        } catch (err) {
            toast.error(err.response?.data?.detail || 'Failed to add expense.');
        } finally {
            setIsSubmitting(false);
        }
    };

    if (loading) {
        return <p className="p-6 text-center">Loading expenses...</p>;
    }
    if (error) {
        return <p className="p-6 text-center text-red-500">{error}</p>;
    }

    return (
        <div className="max-w-4xl mx-auto p-6">
            <h1 className="text-3xl font-bold mb-6 text-gray-800">Track Expenses</h1>
            <AddExpenseForm agreements={agreements} onAdd={handleAddExpense} loading={isSubmitting} />
            <div className="bg-white rounded-lg shadow-md overflow-hidden">
                <table className="min-w-full text-sm">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="p-3 text-left font-semibold text-gray-600">Project</th>
                            <th className="p-3 text-left font-semibold text-gray-600">Description</th>
                            <th className="p-3 text-right font-semibold text-gray-600">Amount</th>
                            <th className="p-3 text-center font-semibold text-gray-600">Date Incurred</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                        {expenses.length === 0 ? (
                            <tr><td colSpan="4" className="text-center py-8 text-gray-500">No expenses logged yet.</td></tr>
                        ) : (
                            expenses.map(e => (
                                <tr key={e.id}>
                                    <td className="p-3">{e.project_title || 'N/A'}</td>
                                    <td className="p-3">{e.description}</td>
                                    <td className="p-3 text-right font-semibold">
                                        {parseFloat(e.amount).toLocaleString("en-US", { style: "currency", currency: "USD" })}
                                    </td>
                                    <td className="p-3 text-center">{e.incurred_date}</td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}