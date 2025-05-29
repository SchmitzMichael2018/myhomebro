import React, { useState, useRef, useEffect } from 'react';
import api from '../api';

export default function AgreementForm() {
  const initialForm = {
    project_title: '',
    project_description: '',
    homeowner_name: '',
    homeowner_email: '',
    homeowner_phone: '',
  };

  const daysOptions = Array.from({ length: 31 }, (_, i) => i);
  const hoursOptions = Array.from({ length: 24 }, (_, i) => i);
  const minutesOptions = [0, 15, 30, 45];

  const [formData, setFormData] = useState(initialForm);
  const [milestones, setMilestones] = useState([
    { order: 1, title: '', description: '', amount: '', start_date: '', completion_date: '', days: 0, hours: 0, minutes: 0 },
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const titleRef = useRef(null);

  useEffect(() => { titleRef.current?.focus(); }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((f) => ({ ...f, [name]: value }));
  };

  const handleMilestoneChange = (i, field, value) => {
    setMilestones((ms) =>
      ms.map((m, idx) => (idx === i ? { ...m, [field]: value } : m))
    );
  };

  const addMilestone = () =>
    setMilestones((ms) => [
      ...ms,
      { order: ms.length + 1, title: '', description: '', amount: '', start_date: '', completion_date: '', days: 0, hours: 0, minutes: 0 },
    ]);

  const removeMilestone = (i) =>
    milestones.length > 1 && setMilestones((ms) =>
      ms.filter((_, idx) => idx !== i).map((m, idx) => ({ ...m, order: idx + 1 }))
    );

  // Helpers for time/cost
  const durationToSeconds = (d, h, m) => d * 86400 + h * 3600 + m * 60;
  const secondsToDurationStr = (seconds) => {
    const days = Math.floor(seconds / 86400);
    seconds = seconds % 86400;
    const hours = Math.floor(seconds / 3600);
    seconds = seconds % 3600;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return days > 0 ? `${days} ${pad(hours)}:${pad(minutes)}:${pad(secs)}` : `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
  };

  const totalSeconds = milestones.reduce(
    (acc, m) => acc + durationToSeconds(Number(m.days), Number(m.hours), Number(m.minutes)),
    0
  );
  const totalDurationStr = secondsToDurationStr(totalSeconds);

  const totalCost = milestones.reduce(
    (acc, m) => acc + (parseFloat(m.amount) || 0),
    0
  );

  const validate = () => {
    if (!formData.project_title.trim()) return 'Project title is required.';
    if (!formData.homeowner_email.includes('@')) return 'Valid homeowner email is required.';
    if (!formData.homeowner_phone.trim()) return 'Homeowner phone is required.';
    if (totalCost <= 0) return 'Total cost must be > 0.';
    let hasTime = false;
    for (let m of milestones) {
      if (!m.title.trim()) return 'Milestone title is required.';
      if (parseFloat(m.amount) <= 0) return 'Milestone amount must be > 0.';
      if (!m.start_date || !m.completion_date) return 'Both dates required for each milestone.';
      if (new Date(m.completion_date) < new Date(m.start_date)) return 'Completion date must be >= start date.';
      if (Number(m.days) + Number(m.hours) + Number(m.minutes) > 0) hasTime = true;
    }
    if (!hasTime) return 'At least one milestone must have a time estimate.';
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const err = validate();
    if (err) return setError(err);

    setLoading(true);
    try {
      const payload = {
        project_title: formData.project_title,
        project_description: formData.project_description,
        total_cost: totalCost,
        total_time_estimate: totalDurationStr,
        homeowner_name: formData.homeowner_name,
        homeowner_email: formData.homeowner_email,
        homeowner_phone: formData.homeowner_phone,
        milestones_input: milestones.map((m) => ({
          order: m.order,
          title: m.title,
          description: m.description,
          amount: parseFloat(m.amount),
          start_date: m.start_date,
          completion_date: m.completion_date,
          days: Number(m.days),
          hours: Number(m.hours),
          minutes: Number(m.minutes),
        })),
      };

      const res = await api.post(`/projects/agreements/`, payload);

      if (res.status === 201 || res.status === 200) {
        alert('✅ Agreement & Project both created!');
        setFormData(initialForm);
        setMilestones([{ order: 1, title: '', description: '', amount: '', start_date: '', completion_date: '', days: 0, hours: 0, minutes: 0 }]);
      } else {
        setError('Failed to create agreement. Try again.');
      }
    } catch (e) {
      setError(e.response?.data?.detail || e.message || 'Failed to create agreement.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-xl mx-auto p-4 space-y-4">
      <h2 className="text-2xl font-bold mb-2">New Agreement & Project</h2>

      <input
        ref={titleRef}
        name="project_title"
        value={formData.project_title}
        onChange={handleChange}
        placeholder="Project Title"
        className="w-full p-2 border rounded"
        required
        aria-label="Project Title"
      />

      <textarea
        name="project_description"
        value={formData.project_description}
        onChange={handleChange}
        placeholder="Project Description (optional)"
        className="w-full p-2 border rounded"
        aria-label="Project Description"
      />

      <input
        name="homeowner_name"
        value={formData.homeowner_name}
        onChange={handleChange}
        placeholder="Homeowner Name"
        className="w-full p-2 border rounded"
        required
        aria-label="Homeowner Name"
      />
      <input
        name="homeowner_email"
        type="email"
        value={formData.homeowner_email}
        onChange={handleChange}
        placeholder="Homeowner Email"
        className="w-full p-2 border rounded"
        required
        aria-label="Homeowner Email"
      />
      <input
        name="homeowner_phone"
        type="tel"
        value={formData.homeowner_phone}
        onChange={handleChange}
        placeholder="Homeowner Phone"
        className="w-full p-2 border rounded"
        required
        aria-label="Homeowner Phone"
      />

      {/* Calculated summary */}
      <div className="flex space-x-4 items-end">
        <div>
          <span className="block text-sm text-gray-500">Total Cost</span>
          <span className="font-bold text-blue-700">${totalCost.toFixed(2)}</span>
        </div>
        <div>
          <span className="block text-sm text-gray-500">Total Duration</span>
          <span className="font-bold text-blue-700">{totalDurationStr}</span>
        </div>
      </div>

      <h3 className="font-semibold">Milestones</h3>
      {milestones.map((m, idx) => (
        <div key={idx} className="border p-3 rounded space-y-2">
          <div className="flex justify-between">
            <span>#{m.order}</span>
            {milestones.length > 1 && (
              <button
                type="button"
                onClick={() => removeMilestone(idx)}
                className="text-red-600"
                aria-label={`Remove milestone #${m.order}`}
              >
                Remove
              </button>
            )}
          </div>
          <input
            value={m.title}
            onChange={e => handleMilestoneChange(idx, 'title', e.target.value)}
            placeholder="Milestone Title"
            className="w-full p-2 border rounded"
            required
            aria-label="Milestone Title"
          />
          <input
            value={m.description}
            onChange={e => handleMilestoneChange(idx, 'description', e.target.value)}
            placeholder="Milestone Description"
            className="w-full p-2 border rounded"
            aria-label="Milestone Description"
          />
          <div className="flex space-x-2">
            <input
              type="number"
              step="0.01"
              value={m.amount}
              onChange={e => handleMilestoneChange(idx, 'amount', e.target.value)}
              placeholder="Amount"
              className="flex-1 p-2 border rounded"
              required
              aria-label="Milestone Amount"
            />
            <input
              type="date"
              value={m.start_date}
              onChange={e => handleMilestoneChange(idx, 'start_date', e.target.value)}
              className="flex-1 p-2 border rounded"
              required
              aria-label="Milestone Start Date"
            />
            <input
              type="date"
              value={m.completion_date}
              onChange={e => handleMilestoneChange(idx, 'completion_date', e.target.value)}
              className="flex-1 p-2 border rounded"
              required
              aria-label="Milestone Completion Date"
            />
          </div>
          {/* Milestone duration dropdowns */}
          <div className="flex space-x-2 items-end">
            <div>
              <label className="block text-sm font-semibold">Days</label>
              <select
                value={m.days}
                onChange={e => handleMilestoneChange(idx, 'days', e.target.value)}
                className="p-2 border rounded"
              >
                {daysOptions.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold">Hours</label>
              <select
                value={m.hours}
                onChange={e => handleMilestoneChange(idx, 'hours', e.target.value)}
                className="p-2 border rounded"
              >
                {hoursOptions.map(h => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold">Minutes</label>
              <select
                value={m.minutes}
                onChange={e => handleMilestoneChange(idx, 'minutes', e.target.value)}
                className="p-2 border rounded"
              >
                {minutesOptions.map(mm => (
                  <option key={mm} value={mm}>{mm.toString().padStart(2, '0')}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={addMilestone}
        className="bg-green-500 text-white px-4 py-2 rounded"
        aria-label="Add Milestone"
      >
        + Add Milestone
      </button>

      {error && <p className="text-red-500">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-blue-600 text-white py-2 rounded"
        aria-busy={loading ? "true" : undefined}
        aria-label="Submit Agreement"
      >
        {loading ? 'Submitting…' : 'Create Agreement & Project'}
      </button>
    </form>
  );
}










