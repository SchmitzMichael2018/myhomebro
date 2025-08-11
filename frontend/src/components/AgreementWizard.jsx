// src/components/AgreementWizard.jsx (with Draft Delete & Auto-Save)

import React, { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../api";

import AgreementStep1 from "./AgreementStep1.jsx";
import AgreementMilestoneStep from "./AgreementMilestoneStep";
import AgreementReviewStep from "./AgreementReviewStep";

export default function AgreementWizard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const draftId = searchParams.get("id");

  const [step, setStep] = useState(1);
  const [agreementId, setAgreementId] = useState(null);
  const [agreementData, setAgreementData] = useState({ milestones: [] });
  const [allHomeowners, setAllHomeowners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const fetchAllHomeowners = useCallback(async () => {
    try {
      const { data } = await api.get('/homeowners/');
      setAllHomeowners(Array.isArray(data) ? data : data.results || []);
    } catch {
      toast.error("Failed to load initial customer data.");
    }
  }, []);

  const loadDraft = useCallback(async () => {
    if (!draftId) return;
    try {
      const { data } = await api.get(`/agreements/${draftId}/`);
      setAgreementId(draftId);
      setAgreementData({
        projectName: data.project?.title,
        projectAddress: `${data.project?.project_street_address || ''}`,
        homeownerName: data.project?.homeowner?.full_name,
        homeownerEmail: data.project?.homeowner?.email,
        milestones: data.milestones || [],
        milestoneTotalCost: data.total_cost,
        milestoneTotalDuration: data.total_time_estimate,
      });
    } catch (err) {
      toast.error("Failed to load saved draft.");
    }
  }, [draftId]);

  const autoSaveDraft = useCallback(async (stepData) => {
    const payload = {
      ...stepData,
      milestones: agreementData.milestones,
    };
    try {
      if (agreementId) {
        await api.patch(`/agreements/${agreementId}/`, payload);
      } else {
        const res = await api.post("/agreements/", payload);
        setAgreementId(res.data.id);
        toast.success("Draft saved");
      }
    } catch {
      console.warn("Auto-save failed.");
    }
  }, [agreementId, agreementData.milestones]);

  useEffect(() => {
    fetchAllHomeowners();
    loadDraft();
    setLoading(false);
  }, [fetchAllHomeowners, loadDraft]);

  const handleStep1Next = async (data) => {
    setAgreementData(prev => ({ ...prev, ...data }));
    await autoSaveDraft(data);
    setStep(2);
  };

  const handleStep2Next = async (data) => {
    setAgreementData(prev => ({ ...prev, ...data }));
    await autoSaveDraft(data);
    setStep(3);
  };

  const handleFinalSubmit = async () => {
    setSubmitting(true);
    const payload = {
      project_title: agreementData.projectName,
      homeowner_id: agreementData.homeownerId,
      description: agreementData.description,
      project_type: agreementData.projectType,
      project_subtype: agreementData.projectSubtype,
      total_cost: agreementData.total_cost || agreementData.milestoneTotalCost,
      project_street_address: agreementData.project_street_address,
      project_address_line_2: agreementData.project_address_line_2,
      project_city: agreementData.project_city,
      project_state: agreementData.project_state,
      project_zip_code: agreementData.project_zip_code,
      milestones: agreementData.milestones.map(m => ({
        order: m.order,
        title: m.title,
        description: m.description,
        amount: m.amount,
        start_date: m.start_date,
        completion_date: m.completion_date,
        days: m.days,
        hours: m.hours,
        minutes: m.minutes,
      })),
    };

    try {
      const res = agreementId
        ? await api.patch(`/agreements/${agreementId}/`, payload)
        : await api.post("/agreements/", payload);

      toast.success("Agreement submitted successfully!");
      navigate(`/agreements/${res.data.id}`);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to submit agreement.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDiscardDraft = async () => {
    if (!agreementId) return navigate("/agreements");
    if (!window.confirm("Are you sure you want to discard this draft?")) return;
    try {
      await api.delete(`/agreements/${agreementId}/`);
      toast.success("Draft deleted.");
      navigate("/agreements");
    } catch {
      toast.error("Failed to discard draft.");
    }
  };

  const renderStep = () => {
    if (loading) return <div className="text-center p-8">Loading...</div>;
    switch (step) {
      case 1:
        return <AgreementStep1 onNext={handleStep1Next} initialData={agreementData} allHomeowners={allHomeowners} />;
      case 2:
        return <AgreementMilestoneStep onBack={() => setStep(1)} onSubmit={handleStep2Next} initialData={agreementData} />;
      case 3:
        return <AgreementReviewStep data={agreementData} onBack={() => setStep(2)} onSubmit={handleFinalSubmit} />;
      default:
        return null;
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-3xl font-bold text-gray-800">New Agreement</h2>
        <div className="flex items-center gap-3">
          <p className="text-sm font-medium text-gray-500">Step {step} of 3</p>
          <button
            onClick={handleDiscardDraft}
            className="text-red-500 text-sm hover:underline"
          >
            Discard Draft
          </button>
        </div>
      </div>
      {renderStep()}
    </div>
  );
}
