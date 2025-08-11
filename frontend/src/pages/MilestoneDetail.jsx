// src/pages/MilestoneDetail.jsx

import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../api';
import toast from 'react-hot-toast';

// Helper to format currency
const formatCurrency = (amount) => {
  return parseFloat(amount || 0).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });
};

export default function MilestoneDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [milestone, setMilestone] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // The data fetching logic is now in a memoized useCallback hook.
  const fetchMilestone = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get(`/milestones/${id}/`);
      setMilestone(data);
    } catch (err) {
      toast.error('Could not load milestone details.');
      navigate('/agreements'); // Navigate to a more general page
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => {
    fetchMilestone();
  }, [fetchMilestone]);

  if (loading) {
    return <div className="p-6 text-center text-gray-500">Loading milestone...</div>;
  }

  if (error || !milestone) {
    // The redirect is now handled by the fetch logic.
    return null;
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
          <button onClick={() => navigate(-1)} className="text-sm text-blue-600 hover:underline">
              ← Back
          </button>
          <h1 className="text-3xl font-bold text-gray-800 mt-2">
            {milestone.title}
          </h1>
          <p className="text-gray-500">
            Part of Agreement:{" "}
            <Link to={`/agreements/${milestone.agreement}`} className="text-blue-600 font-semibold hover:underline">
                {milestone.agreement_title || `Agreement #${milestone.agreement}`}
            </Link>
          </p>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-md space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
                <h3 className="font-semibold text-gray-600 text-sm">Amount</h3>
                <p className="text-lg font-bold">{formatCurrency(milestone.amount)}</p>
            </div>
            <div className="text-right">
                <h3 className="font-semibold text-gray-600 text-sm">Status</h3>
                <p className={`font-bold ${milestone.completed ? 'text-green-600' : 'text-yellow-600'}`}>
                    {milestone.completed ? '✅ Completed' : '⌛ Incomplete'}
                </p>
            </div>
        </div>
        
        <div className="border-t pt-4">
            <h3 className="font-semibold text-gray-600 text-sm">Description</h3>
            <p className="text-gray-800">{milestone.description || "No description provided."}</p>
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t pt-4">
            <div>
                <h3 className="font-semibold text-gray-600 text-sm">Start Date</h3>
                <p>{new Date(milestone.start_date).toLocaleDateString()}</p>
            </div>
            <div className="text-right">
                <h3 className="font-semibold text-gray-600 text-sm">Completion Date</h3>
                <p>{new Date(milestone.completion_date).toLocaleDateString()}</p>
            </div>
        </div>
        
        {/* You could add sections here to display milestone files or comments */}
      </div>
    </div>
  );
}