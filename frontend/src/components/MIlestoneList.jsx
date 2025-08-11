import React, { useState } from 'react';
import toast from 'react-hot-toast';
import api from '../api';
import ReviewInvoiceModal from './ReviewInvoiceModal';

export default function MilestoneList({ milestones, agreement, onUpdate }) {
  const [selectedMilestoneId, setSelectedMilestoneId] = useState(null);

  const canStartWork = agreement?.is_fully_signed && agreement?.escrow_funded;

  const handleMarkComplete = async (milestoneId) => {
    if (!window.confirm("Are you sure you want to mark this milestone as complete?")) return;

    try {
      await api.post(`/milestones/${milestoneId}/mark_complete/`);
      toast.success("Milestone marked as complete!");
      onUpdate?.();
    } catch (err) {
      const errorMsg = err.response?.data?.detail || "Failed to update milestone.";
      toast.error(errorMsg);
    }
  };

  if (!milestones || milestones.length === 0) {
    return (
      <div className="bg-white p-4 rounded-lg shadow-sm text-center text-gray-500">
        <p className="font-semibold">No Milestones</p>
        <p className="text-sm">Milestones for this agreement will appear here.</p>
      </div>
    );
  }

  return (
    <>
      <div className="bg-gray-50 p-4 rounded-lg">
        <h3 className="text-xl font-bold text-gray-800 mb-4">Milestones</h3>
        <ul className="space-y-3">
          {milestones.map((m) => {
            const canFinalize = m.completed && !m.is_invoiced && canStartWork;
            return (
              <li key={m.id} className="bg-white p-4 rounded-lg shadow-sm border">
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-semibold text-gray-900">{m.title}</h4>
                    <p className="text-sm text-gray-600 mt-1">{m.description || "No description."}</p>
                  </div>
                  <span
                    className={`px-2 py-1 text-xs font-medium rounded-full self-start
                    ${m.completed ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}
                  >
                    {m.completed ? 'Completed' : 'Incomplete'}
                  </span>
                </div>
                <div className="mt-3 pt-3 border-t flex justify-between items-center text-sm">
                  <div className="text-gray-700">
                    <span className="font-semibold">${parseFloat(m.amount).toLocaleString()}</span>
                  </div>
                  <div className="flex gap-2">
                    {canStartWork && !m.completed && (
                      <button
                        onClick={() => handleMarkComplete(m.id)}
                        className="px-3 py-1 bg-blue-600 text-white text-xs font-semibold rounded-md hover:bg-blue-700"
                      >
                        Mark Complete
                      </button>
                    )}
                    {canFinalize && (
                      <button
                        onClick={() => setSelectedMilestoneId(m.id)}
                        className="px-3 py-1 bg-green-600 text-white text-xs font-semibold rounded-md hover:bg-green-700"
                      >
                        Finalize & Invoice
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <ReviewInvoiceModal
        visible={!!selectedMilestoneId}
        milestoneId={selectedMilestoneId}
        onClose={() => {
          setSelectedMilestoneId(null);
          onUpdate?.();
        }}
      />
    </>
  );
}
