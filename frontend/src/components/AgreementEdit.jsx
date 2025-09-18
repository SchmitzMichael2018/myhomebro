// src/components/AgreementEdit.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../api";
import AttachmentManager from "./AttachmentManager.jsx";
import {
  agreementPreviewHref,
  agreementPdfHref,
  postAgreementMarkReviewed,
} from "../api/signing";

/**
 * AgreementEdit
 * - Edits warranty (default/custom text).
 * - Lets contractor upload Warranty/Addendum/Exhibit (via AttachmentManager).
 * - “Generate Preview PDF” opens GET preview link in a new tab.
 * - “Mark as Reviewed” calls a no-op compatible shim if backend action absent.
 * - Milestones are fetched from a dedicated endpoint with a safe fallback.
 */

export default function AgreementEdit() {
  const { id: routeId } = useParams();
  const agreementId = routeId;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [agreement, setAgreement] = useState(null);

  // Warranty UI state
  const [useDefaultWarranty, setUseDefaultWarranty] = useState(true);
  const [warrantyText, setWarrantyText] = useState(
    "Contractor warrants workmanship for one (1) year from substantial completion. Materials are covered by manufacturer warranties where applicable. Warranty excludes damage caused by misuse, neglect, unauthorized modifications, or normal wear. Remedy is limited to repair or replacement at Contractor’s discretion."
  );

  // Milestones (read-only here)
  const [mLoading, setMLoading] = useState(true);
  const [milestones, setMilestones] = useState([]);

  const previewHref = useMemo(
    () => (agreementId ? agreementPreviewHref(agreementId) : "#"),
    [agreementId]
  );
  const pdfHref = useMemo(
    () => (agreementId ? agreementPdfHref(agreementId) : "#"),
    [agreementId]
  );

  const fetchAgreement = async () => {
    try {
      setLoading(true);
      const { data } = await api.get(`/projects/agreements/${agreementId}/`);
      setAgreement(data || null);

      // Hydrate warranty UI if backend already stores it
      const hasCustom =
        data?.use_default_warranty === false ||
        (!!data?.warranty_text && data?.warranty_text.trim().length > 0);
      setUseDefaultWarranty(!hasCustom);
      if (hasCustom && data?.warranty_text) setWarrantyText(data.warranty_text);
    } catch (e) {
      console.error(e);
      toast.error("Failed to load agreement.");
    } finally {
      setLoading(false);
    }
  };

  const fetchMilestones = async () => {
    if (!agreementId) return;
    try {
      setMLoading(true);
      // Preferred nested endpoint
      try {
        const { data } = await api.get(
          `/projects/agreements/${agreementId}/milestones/`
        );
        if (Array.isArray(data)) {
          setMilestones(data);
        } else {
          // Fallback to list filtered by agreement
          const r2 = await api.get("/projects/milestones/", {
            params: { agreement: agreementId },
          });
          const list = Array.isArray(r2.data?.results)
            ? r2.data.results
            : Array.isArray(r2.data)
            ? r2.data
            : [];
          setMilestones(list);
        }
      } catch {
        const r2 = await api.get("/projects/milestones/", {
          params: { agreement: agreementId },
        });
        const list = Array.isArray(r2.data?.results)
          ? r2.data.results
          : Array.isArray(r2.data)
          ? r2.data
          : [];
        setMilestones(list);
      }
    } catch (e) {
      console.error(e);
      toast.error("Failed to load milestones.");
      setMilestones([]);
    } finally {
      setMLoading(false);
    }
  };

  useEffect(() => {
    if (agreementId) {
      fetchAgreement();
      fetchMilestones();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agreementId]);

  const saveChanges = async () => {
    if (!agreementId) return;
    try {
      setSaving(true);
      const payload = {
        use_default_warranty: useDefaultWarranty,
        warranty_text: useDefaultWarranty ? "" : warrantyText,
      };
      await api.patch(`/projects/agreements/${agreementId}/`, payload);
      toast.success("Saved.");
      fetchAgreement();
    } catch (e) {
      console.error(e);
      toast.error("Could not save changes.");
    } finally {
      setSaving(false);
    }
  };

  const generatePreview = () => {
    if (!agreementId) return;
    window.open(previewHref, "_blank", "noopener,noreferrer");
  };

  const openPdf = () => {
    if (!agreementId) return;
    window.open(pdfHref, "_blank", "noopener,noreferrer");
  };

  const markReviewed = async () => {
    if (!agreementId) return;
    const res = await postAgreementMarkReviewed(agreementId);
    if (res.ok) {
      toast.success("Marked as reviewed.");
    } else {
      toast.error(res.error || "Could not mark as reviewed.");
    }
  };

  const headerTitle =
    (agreement?.title /* serializer may provide this */) ||
    agreement?.project_title ||
    `Agreement #${agreement?.id || agreementId}`;

  if (loading) {
    return <div className="p-6 text-gray-700">Loading agreement editor…</div>;
  }

  if (!agreement) {
    return <div className="p-6 text-red-700">Agreement not found.</div>;
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="bg-blue-50 rounded-xl border border-blue-200 p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold text-blue-900">Edit Agreement</h2>
            <div className="text-sm text-gray-600">{headerTitle}</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={saveChanges}
              disabled={saving}
              className={`px-4 py-2 rounded-lg font-semibold text-white ${
                saving ? "bg-gray-500 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"
              }`}
            >
              {saving ? "Saving…" : "Save Changes"}
            </button>
            <button
              onClick={openPdf}
              className="px-4 py-2 rounded-lg border border-blue-300 text-blue-800 hover:bg-blue-50 font-semibold"
            >
              Open Current PDF
            </button>
          </div>
        </div>
      </div>

      {/* Warranty */}
      <div className="rounded-xl border border-gray-200 shadow-sm bg-white">
        <div className="px-5 py-4 border-b bg-gradient-to-r from-blue-50 to-white rounded-t-xl">
          <h3 className="text-lg font-semibold">Warranty</h3>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center gap-6">
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="warranty_mode"
                checked={useDefaultWarranty}
                onChange={() => setUseDefaultWarranty(true)}
              />
              <span>Use default warranty</span>
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="warranty_mode"
                checked={!useDefaultWarranty}
                onChange={() => setUseDefaultWarranty(false)}
              />
              <span>Provide custom warranty</span>
            </label>
          </div>

          {!useDefaultWarranty && (
            <div>
              <textarea
                className="w-full border rounded-lg px-3 py-2 min-h-[140px]"
                value={warrantyText}
                onChange={(e) => setWarrantyText(e.target.value)}
                placeholder="Type or paste your custom warranty terms here…"
              />
              <div className="text-xs text-gray-500 mt-1">
                The warranty text is included in both the preview and the final signed PDF.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Review & Preview */}
      <div className="rounded-xl border border-gray-200 shadow-sm bg-white">
        <div className="px-5 py-4 border-b bg-gradient-to-r from-blue-50 to-white rounded-t-xl">
          <h3 className="text-lg font-semibold">Review &amp; Preview</h3>
        </div>

        <div className="p-5">
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={generatePreview}
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold"
            >
              Generate Preview PDF
            </button>
            <button
              onClick={markReviewed}
              className="px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-50 font-semibold"
            >
              Mark as Reviewed
            </button>
            <a
              href={previewHref}
              target="_blank"
              rel="noreferrer"
              className="px-4 py-2 rounded-lg border border-blue-300 text-blue-800 hover:bg-blue-50 font-semibold"
            >
              Open Preview
            </a>
            <a
              href={pdfHref}
              target="_blank"
              rel="noreferrer"
              className="px-4 py-2 rounded-lg border border-blue-300 text-blue-800 hover:bg-blue-50 font-semibold"
            >
              Download PDF
            </a>
          </div>
          <div className="text-xs text-gray-500 mt-2">
            You must generate and review the preview PDF before signing.
          </div>
        </div>
      </div>

      {/* Attachments & Addenda */}
      <div className="rounded-xl border border-gray-200 shadow-sm bg-white">
        <div className="px-5 py-4 border-b bg-gradient-to-r from-blue-50 to-white rounded-t-xl">
          <h3 className="text-lg font-semibold">Attachments &amp; Addenda</h3>
          <p className="text-sm text-gray-600 mt-1">
            Upload your warranty, addenda, or exhibits here. Homeowners can review these before signing.
          </p>
        </div>
        <div className="p-5">
          <AttachmentManager agreementId={agreementId} canEdit={true} />
        </div>
      </div>

      {/* Milestones (read-only summary) */}
      <div className="rounded-xl border border-gray-200 shadow-sm bg-white">
        <div className="px-5 py-4 border-b bg-gradient-to-r from-blue-50 to-white rounded-t-xl">
          <h3 className="text-lg font-semibold">Milestones</h3>
        </div>
        <div className="p-5">
          {mLoading ? (
            <div className="text-gray-600">Loading…</div>
          ) : milestones.length === 0 ? (
            <div className="text-gray-500 text-sm">No milestones found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm border rounded">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="p-2 text-left border">#</th>
                    <th className="p-2 text-left border">Title</th>
                    <th className="p-2 text-left border">Scheduled</th>
                    <th className="p-2 text-right border">Amount</th>
                    <th className="p-2 text-left border">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {milestones.map((m, i) => (
                    <tr key={m.id || i} className="odd:bg-white even:bg-gray-50">
                      <td className="p-2 border">{m.order ?? i + 1}</td>
                      <td className="p-2 border">{m.title || "—"}</td>
                      <td className="p-2 border">
                        {m.start_date || m.start || m.scheduled || "—"}
                      </td>
                      <td className="p-2 border text-right">
                        {typeof m.amount === "number"
                          ? `$${m.amount.toFixed(2)}`
                          : m.amount || "—"}
                      </td>
                      <td className="p-2 border">
                        {m.completed ? "complete" : "incomplete"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Save */}
      <div className="flex justify-end">
        <button
          onClick={saveChanges}
          disabled={saving}
          className={`px-5 py-2.5 rounded-lg font-semibold text-white ${
            saving ? "bg-gray-500 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"
          }`}
        >
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </div>
    </div>
  );
}
