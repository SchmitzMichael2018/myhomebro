'use client';

import React, { createContext, useContext, useMemo, useCallback } from "react";
import usePersistentState from "@/hooks/usePersistentState";

const DEFAULT_DRAFT = {
  customer: { id: null, full_name: "", email: "", phone: "" },
  project: { title: "", start_date: null, end_date: null },
  milestones: [], // [{id, title, due_date: null, amount: 0, description}]
  termsAccepted: false,
  lastSavedAt: null,
};

const AgreementDraftContext = createContext(null);

export function AgreementDraftProvider({ storageKey = "agreementDraft", children }) {
  const [draft, setDraft, clearDraft] = usePersistentState(storageKey, DEFAULT_DRAFT);

  const saveDraft = useCallback((partial = {}) => {
    let next;
    setDraft(prev => {
      next = { ...prev, ...partial, lastSavedAt: new Date().toISOString() };
      return next;
    });
    return next;
  }, [setDraft]);

  const setMilestones = useCallback((milestones) => {
    setDraft(d => ({ ...d, milestones }));
  }, [setDraft]);

  const addMilestone = useCallback(() => {
    const id =
      globalThis.crypto?.randomUUID?.() ??
      `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    setDraft(d => ({
      ...d,
      milestones: [
        ...d.milestones,
        { id, title: "", due_date: null, amount: 0, description: "" },
      ],
    }));
  }, [setDraft]);

  const updateMilestone = useCallback((id, patch) => {
    setDraft(d => ({
      ...d,
      milestones: d.milestones.map(m => (m.id === id ? { ...m, ...patch } : m)),
    }));
  }, [setDraft]);

  const removeMilestone = useCallback((id) => {
    setDraft(d => ({
      ...d,
      milestones: d.milestones.filter(m => m.id !== id),
    }));
  }, [setDraft]);

  const value = useMemo(() => ({
    draft,
    saveDraft,
    clearDraft,
    setDraft,
    setMilestones,
    addMilestone,
    updateMilestone,
    removeMilestone,
  }), [draft, saveDraft, clearDraft, setDraft, setMilestones, addMilestone, updateMilestone, removeMilestone]);

  return (
    <AgreementDraftContext.Provider value={value}>
      {children}
    </AgreementDraftContext.Provider>
  );
}

export function useAgreementDraft() {
  const ctx = useContext(AgreementDraftContext);
  if (!ctx) throw new Error("useAgreementDraft must be used within AgreementDraftProvider");
  return ctx;
}

export default AgreementDraftProvider;
