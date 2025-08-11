import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../api';

export default function AgreementEdit() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    project_title: '',
    total_cost: '',
    milestones: [],
  });
  const [loading, setLoading] = useState(true);

  const loadAgreement = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/agreements/${id}/`);
      setFormData({
        project_title: data.project.title || '',
        total_cost: data.total_cost || '',
        milestones: data.milestones.map(m => ({
          order: m.order,
          title: m.title,
          description: m.description || '',
          amount: m.amount,
          start_date: m.start_date,
          completion_date: m.completion_date,
        })),
      });
    } catch (err) {
      toast.error('Failed to load agreement data.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadAgreement();
  }, [loadAgreement]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleMilestoneChange = (i, field, value) => {
    setFormData(prev => ({
      ...prev,
      milestones: prev.milestones.map((m, idx) =>
        idx === i ? { ...m, [field]: value } : m
      ),
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.patch(`/agreements/${id}/`, formData);
      toast.success('Agreement updated successfully!');
      navigate(`/agreements/${id}`);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to update agreement.');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-3xl mx-auto p-6 space-y-6">
      <h2 className="text-2xl font-bold mb-4">Edit Agreement</h2>
      <input
        type="text"
        name="project_title"
        value={formData.project_title}
        onChange={handleChange}
        className="w-full p-2 border rounded"
        placeholder="Project Title"
      />
      <input
        type="number"
        name="total_cost"
        value={formData.total_cost}
        onChange={handleChange}
        className="w-full p-2 border rounded"
        placeholder="Total Cost"
      />
      <div className="space-y-4">
        {formData.milestones.map((m, idx) => (
          <div key={idx} className="border p-3 rounded space-y-2">
            <input
              value={m.title}
              onChange={e => handleMilestoneChange(idx, 'title', e.target.value)}
              placeholder="Milestone Title"
              className="w-full p-2 border rounded"
              required
            />
            <input
              value={m.description}
              onChange={e => handleMilestoneChange(idx, 'description', e.target.value)}
              placeholder="Milestone Description"
              className="w-full p-2 border rounded"
            />
            <input
              type="number"
              value={m.amount}
              onChange={e => handleMilestoneChange(idx, 'amount', e.target.value)}
              placeholder="Amount"
              className="w-full p-2 border rounded"
              required
            />
            <div className="flex space-x-2">
              <input
                type="date"
                value={m.start_date}
                onChange={e => handleMilestoneChange(idx, 'start_date', e.target.value)}
                className="flex-1 p-2 border rounded"
                required
              />
              <input
                type="date"
                value={m.completion_date}
                onChange={e => handleMilestoneChange(idx, 'completion_date', e.target.value)}
                className="flex-1 p-2 border rounded"
                required
              />
            </div>
          </div>
        ))}
      </div>
      <button type="submit" className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700">
        Save Changes
      </button>
    </form>
  );
}
