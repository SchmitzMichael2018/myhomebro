import React, { useState } from "react";
import { useAgreementDraft } from "@/context/AgreementDraftContext";
import { createAgreement, validateAgreementDraft } from "@/lib/agreements";
// If you use React Router:
import { useNavigate } from "react-router-dom";

export default function NewAgreement() {
  const { draft, saveDraft, clearDraft } = useAgreementDraft();
  const [submitting, setSubmitting] = useState(false);
  const navigate = typeof useNavigate === "function" ? useNavigate() : null;

  async function handleSubmit(e) {
    e.preventDefault();

    const errs = validateAgreementDraft(draft);
    if (errs.length) {
      alert(errs.join("\n"));
      return;
    }

    setSubmitting(true);
    try {
      const created = await createAgreement(draft);
      clearDraft();
      // navigate to the new agreement
      if (navigate && created?.id) navigate(`/agreements/${created.id}`);
      else if (created?.id) window.location.href = `/agreements/${created.id}`;
    } catch (e) {
      console.error("Create failed:", e, e.details);
      alert(e.message || "Failed to create agreement");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {/* your inputs updating draft via saveDraft({...}) */}
      <input
        value={draft.project?.title || ""}
        onChange={(e) => saveDraft({ project: { ...draft.project, title: e.target.value } })}
        placeholder="Project title"
      />
      {/* ...more fields... */}
      <button type="submit" disabled={submitting}>
        {submitting ? "Creating…" : "Create Agreement"}
      </button>
    </form>
  );
}
