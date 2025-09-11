// src/components/AgreementWizard.jsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { getHomeownersOnce } from "@/lib/homeowners";
import { createAgreementFromWizardState } from "@/lib/agreements";

import AgreementStep1 from "./AgreementStep1.jsx";
import AgreementMilestoneStep from "./AgreementMilestoneStep.jsx";
import AgreementReviewStep from "./AgreementReviewStep.jsx";

const LS_KEY = "agreement:wizard";
const STEP2_DRAFT_KEY = "agreement:wizard:step2";

export default function AgreementWizard() {
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [state, setState] = useState({ milestones: [], useCustomerAddress: true });
  const [allHomeowners, setAllHomeowners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const currentRef = useRef(state);
  useEffect(() => { currentRef.current = state; }, [state]);

  // ---- LS helpers ----
  const persistLS = useCallback((data) => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch {}
  }, []);
  const hydrateLS = useCallback(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const obj = JSON.parse(raw);
        if (obj && typeof obj === "object") setState((p) => ({ ...p, ...obj }));
      }
    } catch {}
  }, []);

  // ---- homeowners ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      hydrateLS();
      try {
        const list = await getHomeownersOnce();
        if (!cancelled) setAllHomeowners(Array.isArray(list) ? list : []);
      } catch (e) {
        console.warn("Homeowners load failed:", e?.message || e);
        if (!cancelled) setAllHomeowners([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [hydrateLS]);

  const homeownerMap = useMemo(() => {
    const m = new Map();
    (allHomeowners || []).forEach((h) => m.set(String(h.id), h));
    return m;
  }, [allHomeowners]);

  // ---- Step handlers ----
  const handleStep1Next = async (data) => {
    const h = homeownerMap.get(String(data.homeownerId));
    const extras = {
      homeownerName: h?.full_name || h?.name || "",
      homeownerEmail: h?.email || "",
    };

    let projectAddress = "— (Using customer’s address)";
    if (!data.useCustomerAddress) {
      const cityState = [data.project_city, data.project_state].filter(Boolean).join(", ");
      projectAddress = [
        data.project_street_address,
        data.project_address_line_2,
        cityState,
        data.project_zip_code,
      ].filter(Boolean).join(", ") || "—";
    }

    const merged = { ...currentRef.current, ...data, ...extras, projectAddress };
    setState(merged);
    persistLS(merged);
    setStep(2);
  };

  const handleStep2Next = async (data) => {
    const merged = { ...currentRef.current, ...data };
    setState(merged);
    try { localStorage.setItem(STEP2_DRAFT_KEY, JSON.stringify(data)); } catch {}
    persistLS(merged);
    setStep(3);
  };

  const handleFinalSubmit = async () => {
    setSubmitting(true);
    try {
      const created = await createAgreementFromWizardState(currentRef.current);
      toast.success("Agreement created!");
      try { localStorage.removeItem(LS_KEY); } catch {}
      try { localStorage.removeItem(STEP2_DRAFT_KEY); } catch {}
      navigate(created?.id ? `/agreements/${created.id}` : "/agreements");
    } catch (e) {
      console.error("Create failed:", e, e.details);
      toast.error(e.message || "Failed to create agreement.");
    } finally {
      setSubmitting(false);
    }
  };

  // ---- Render ----
  if (loading) return <div className="text-center p-8">Loading customers…</div>;

  return (
    <div className="max-w-4xl mx-auto p-4">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-3xl font-bold text-gray-800">New Agreement</h2>
        <p className="text-sm font-medium text-gray-500">Step {step} of 3</p>
      </div>

      {step === 1 && (
        <AgreementStep1
          onNext={handleStep1Next}
          initialData={state}
          allHomeowners={allHomeowners}
        />
      )}

      {step === 2 && (
        <AgreementMilestoneStep
          step1Data={state}
          onBack={() => setStep(1)}
          onSubmit={handleStep2Next}
          draftKey={STEP2_DRAFT_KEY}
        />
      )}

      {step === 3 && (
        <AgreementReviewStep
          data={state}
          onBack={() => setStep(2)}
          onSubmit={handleFinalSubmit}  // Step 3 calls this; it does the POST via lib
        />
      )}

      {submitting && <div className="text-center text-sm text-gray-500 mt-3">Submitting…</div>}
    </div>
  );
}
