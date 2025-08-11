// src/hooks/useMilestoneData.js

import { useState, useEffect, useCallback } from 'react';
import api from '../api';
import toast from 'react-hot-toast';

export const useMilestoneData = (milestoneId) => {
  const [files, setFiles] = useState([]);
  const [comments, setComments] = useState([]);
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchData = useCallback(async () => {
    if (!milestoneId) return;
    setLoading(true);
    setError('');
    try {
      // Fetch all related data in parallel
      const [filesRes, commentsRes] = await Promise.all([
        api.get(`/milestone-files/?milestone=${milestoneId}`),
        api.get(`/milestones/${milestoneId}/comments/`),
      ]);
      setFiles(filesRes.data);
      setComments(commentsRes.data);

      // Invoice fetching logic needs to be based on agreement, not milestone
      const milestoneRes = await api.get(`/milestones/${milestoneId}/`);
      if (milestoneRes.data.is_invoiced) {
        const invoiceRes = await api.get(`/invoices/?agreement=${milestoneRes.data.agreement}`);
        // Find the specific invoice for this milestone (e.g., by amount)
        const relatedInvoice = invoiceRes.data.find(inv => parseFloat(inv.amount) === parseFloat(milestoneRes.data.amount));
        setInvoice(relatedInvoice || null);
      } else {
        setInvoice(null);
      }

    } catch (err) {
      setError('Failed to load milestone data.');
      toast.error('Failed to load milestone data.');
    } finally {
      setLoading(false);
    }
  }, [milestoneId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // --- Action Handlers ---

  const addFile = (file) => setFiles(prev => [...prev, file]);
  const removeFile = (fileId) => setFiles(prev => prev.filter(f => f.id !== fileId));
  const addComment = (comment) => setComments(prev => [comment, ...prev]);

  const sendInvoice = async () => {
    try {
      const { data } = await api.post(`/milestones/${milestoneId}/send_invoice/`);
      setInvoice(data); // The API returns the newly created invoice object
      toast.success("Invoice sent successfully!");
      return data;
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not send invoice.");
      throw err;
    }
  };

  return {
    files, comments, invoice, loading, error,
    addFile, removeFile, addComment, sendInvoice,
    refetch: fetchData, // Expose a refetch function
  };
};