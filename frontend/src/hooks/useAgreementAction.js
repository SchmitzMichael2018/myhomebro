// src/hooks/useAgreementActions.js

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../api';

export const useAgreementActions = (agreement, setAgreement) => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [actionError, setActionError] = useState('');

  const performAction = async (apiCall, successMessage) => {
    setIsLoading(true);
    setActionError('');
    try {
      const response = await apiCall();
      // Update the local state with the data returned from the API
      setAgreement(response.data);
      toast.success(successMessage);
      return response.data; // Return data for further processing if needed
    } catch (err) {
      const errorMsg = err.response?.data?.detail || 'An error occurred.';
      setActionError(errorMsg);
      toast.error(errorMsg);
      throw err; // Re-throw error if the calling component needs to know about it
    } finally {
      setIsLoading(false);
    }
  };

  const handleSign = (typedName) => {
    return performAction(
      () => api.patch(`/agreements/${agreement.id}/sign/`, { signature_name: typedName }),
      "Agreement signed successfully!"
    );
  };

  const handleFundEscrow = () => {
    return performAction(
      () => api.post(`/agreements/${agreement.id}/fund-escrow/`),
      "Stripe payment session created."
    );
  };

  const handleToggleArchive = () => {
    const endpoint = agreement.is_archived ? 'unarchive' : 'archive';
    return performAction(
      () => api.patch(`/agreements/${agreement.id}/${endpoint}/`),
      `Agreement ${agreement.is_archived ? 'unarchived' : 'archived'}.`
    );
  };

  const handleDelete = async () => {
    if (!window.confirm("Are you sure you want to delete this agreement? This action cannot be undone.")) return;
    
    setIsLoading(true);
    try {
      await api.delete(`/agreements/${agreement.id}/`);
      toast.success("Agreement deleted.");
      navigate("/agreements");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to delete agreement.");
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleSendInvite = () => {
    return performAction(
        () => api.post(`/agreements/${agreement.id}/email-invite/`),
        "Invite sent to homeowner."
    );
  };

  return {
    isLoading,
    actionError,
    handleSign,
    handleFundEscrow,
    handleToggleArchive,
    handleDelete,
    handleSendInvite,
  };
};