// frontend/src/components/WarrantyAttachmentsStep.jsx
// v2025-10-16 — Restored rich "Warranty & Attachments" UI (classic layout)
// - Default warranty toggle + editable textarea
// - Drop zone / file chooser
// - Title, Category, Visible, Require Acknowledgement
// - Add Attachment (multipart upload) + table listing with Download/Delete
// - "Back" and "Save & Next" actions provided by parent via props
//
// Props:
//   agreementId: number (required)
//   agreement:   object (at least { id, use_default_warranty, warranty_text })
//   onUpdate:    function(patchObj) -> void   (called after warranty save)
//   onBack:      function() -> void
//   onNext:      function() -> void
//
// Dependencies: `react-hot-toast`, local `api` helper (axios wrapper)

import React, { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import api from "../api";

const CATEGORIES = [
  { value: "WARRANTY", label: "WARRANTY" },
  { value: "SPEC", label: "SPEC / SCOPE" },
  { value: "PERMIT", label: "PERMIT / LICENSE" },
  { value: "PHOTO", label: "PHOTO / IMAGE" },
  { value: "OTHER", label: "OTHER" },
];

export default function WarrantyAttachmentsStep({
  agreementId,
  agreement,
  onUpdate,
  onBack,
  onNext,
}) {
  const [useDefaultWarranty, setUseDefaultWarranty] = useState(
    !!agreement?.use_default_warranty
  );
  const [warrantyText, setWarrantyText] = useState(
    agreement?.warranty_text ||
      "Standard workmanship warranty: Contractor warrants all labor performed under this Agreement for one (1) year from substantial completion. Materials are covered by the manufacturer’s warranties. This warranty excludes damage caused by misuse, neglect, alteration, improper maintenance, or acts of God."
  );

  // Attachments state
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("WARRANTY");
  const [visible, setVisible] = useState(true);
  const [requireAck, setRequireAck] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isSavingWarranty, setIsSavingWarranty] = useState(false);

  const [attachments, setAttachments] = useState([]);
  const inputRef = useRef(null);
  const dropRef = useRef(null);

  // --- Load attachments list ---
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const url = `/api/projects/agreements/${agreementId}/attachments/`;
        const { data } = await api.get(url);
        if (mounted) setAttachments(Array.isArray(data) ? data : data?.results || []);
      } catch (err) {
        // If endpoint differs in your API, no hard failure; just log
        // eslint-disable-next-line no-console
        console.warn("Load attachments failed:", err?.response?.data || err?.message);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [agreementId]);

  // --- Drag & Drop handlers (progressive enhancement) ---
  useEffect(() => {
    const el = dropRef.current;
    if (!el) return;

    const onDragOver = (e) => {
      e.preventDefault();
      el.classList.add("ring-2", "ring-indigo-400");
    };
    const onDragLeave = (e) => {
      e.preventDefault();
      el.classList.remove("ring-2", "ring-indigo-400");
    };
    const onDrop = (e) => {
      e.preventDefault();
      el.classList.remove("ring-2", "ring-indigo-400");
      if (e.dataTransfer?.files?.[0]) {
        setFile(e.dataTransfer.files[0]);
      }
    };

    el.addEventListener("dragover", onDragOver);
    el.addEventListener("dragleave", onDragLeave);
    el.addEventListener("drop", onDrop);
    return () => {
      el.removeEventListener("dragover", onDragOver);
      el.removeEventListener("dragleave", onDragLeave);
      el.removeEventListener("drop", onDrop);
    };
  }, []);

  // --- Warranty save ---
  const saveWarranty = async () => {
    try {
      setIsSavingWarranty(true);
      const payload = {
        use_default_warranty: !!useDefaultWarranty,
        warranty_text: warrantyText || "",
      };
      const { data } = await api.patch(
        `/api/projects/agreements/${agreementId}/`,
        payload
      );
      onUpdate?.(data || payload);
      toast.success("Warranty saved.");
    } catch (err) {
      toast.error("Could not save warranty.");
      // eslint-disable-next-line no-console
      console.error("saveWarranty:", err?.response?.data || err?.message);
    } finally {
      setIsSavingWarranty(false);
    }
  };

  // --- Upload / add attachment ---
  const addAttachment = async () => {
    if (!file) {
      toast.error("Choose a file to upload.");
      return;
    }
    try {
      setIsUploading(true);
      const form = new FormData();
      form.set("title", title || file.name);
      form.set("category", category);
      form.set("visible_to_homeowner", String(!!visible));
      form.set("requires_acknowledgement", String(!!requireAck));
      form.set("file", file);

      // Most APIs accept POST to list endpoint. Adjust if yours differs.
      const url = `/api/projects/agreements/${agreementId}/attachments/`;
      const { data } = await api.post(url, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      const created =
        data && !Array.isArray(data)
          ? data
          : { id: Date.now(), title, category, visible_to_homeowner: visible, requires_acknowledgement: requireAck, file_name: file.name };

      setAttachments((prev) => [created, ...prev]);
      // Reset inputs
      setTitle("");
      setCategory("WARRANTY");
      setVisible(true);
      setRequireAck(false);
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";

      toast.success("Attachment uploaded.");
    } catch (err) {
      toast.error("Upload failed.");
      // eslint-disable-next-line no-console
      console.error("addAttachment:", err?.response?.data || err?.message);
    } finally {
      setIsUploading(false);
    }
  };

  // --- Delete attachment ---
  const deleteAttachment = async (attId) => {
    if (!attId) return;
    try {
      await api.delete(
        `/api/projects/agreements/${agreementId}/attachments/${attId}/`
      );
      setAttachments((prev) => prev.filter((a) => a.id !== attId));
      toast.success("Attachment deleted.");
    } catch (err) {
      toast.error("Could not delete attachment.");
      // eslint-disable-next-line no-console
      console.error("deleteAttachment:", err?.response?.data || err?.message);
    }
  };

  // Render helpers
  const fileLabel = useMemo(() => (file ? file.name : "No file chosen"), [file]);

  return (
    <div className="space-y-6">
      {/* Warranty box */}
      <div className="bg-white rounded-xl shadow p-4 border">
        <h3 className="text-base font-semibold mb-3">Warranty</h3>

        <label className="inline-flex items-center gap-2 mb-3">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={useDefaultWarranty}
            onChange={(e) => setUseDefaultWarranty(e.target.checked)}
          />
          <span>Use default 12-month workmanship warranty</span>
        </label>

        <textarea
          className="w-full min-h-[120px] border rounded-md p-3 text-sm"
          value={warrantyText}
          onChange={(e) => setWarrantyText(e.target.value)}
          placeholder="Enter warranty terms..."
        />

        <div className="mt-3">
          <button
            type="button"
            onClick={saveWarranty}
            disabled={isSavingWarranty}
            className="px-3 py-2 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {isSavingWarranty ? "Saving..." : "Save Warranty"}
          </button>
        </div>
      </div>

      {/* Attachments & Addenda */}
      <div className="bg-white rounded-xl shadow border">
        <div className="p-4 border-b">
          <h3 className="text-base font-semibold">Attachments &amp; Addenda</h3>
        </div>

        <div className="p-4">
          {/* Drop zone + chooser */}
          <div
            ref={dropRef}
            className="border-2 border-dashed rounded-md p-4 text-sm text-gray-600 flex flex-col gap-2 items-start"
          >
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                id="file"
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="hidden"
              />
              <label
                htmlFor="file"
                className="inline-flex items-center px-3 py-1.5 rounded-md border bg-white hover:bg-gray-50 cursor-pointer"
              >
                Choose Files
              </label>
              <span className="text-gray-500">{fileLabel}</span>
            </div>
            <p className="text-xs text-gray-500">
              Drag &amp; drop files here, or click “Choose Files”.
            </p>
          </div>

          {/* Meta row */}
          <div className="mt-3 grid grid-cols-12 gap-3">
            <div className="col-span-6">
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full border rounded-md p-2 text-sm"
                placeholder="Title (e.g., Spec Sheet)"
              />
            </div>
            <div className="col-span-3">
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full border rounded-md p-2 text-sm"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-3 flex items-center gap-4">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={visible}
                  onChange={(e) => setVisible(e.target.checked)}
                />
                <span className="text-sm">Visible to homeowner</span>
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={requireAck}
                  onChange={(e) => setRequireAck(e.target.checked)}
                />
                <span className="text-sm">Require acknowledgement</span>
              </label>
            </div>
          </div>

          <div className="mt-3">
            <button
              type="button"
              onClick={addAttachment}
              disabled={isUploading}
              className="px-3 py-2 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {isUploading ? "Uploading..." : "Add Attachment"}
            </button>
          </div>

          {/* Table */}
          <div className="mt-6 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2 pr-3 font-semibold text-gray-700">Category</th>
                  <th className="py-2 pr-3 font-semibold text-gray-700">Title</th>
                  <th className="py-2 pr-3 font-semibold text-gray-700">Visible</th>
                  <th className="py-2 pr-3 font-semibold text-gray-700">
                    Ack Required
                  </th>
                  <th className="py-2 pr-3 font-semibold text-gray-700">File</th>
                  <th className="py-2 pr-3 font-semibold text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody>
                {attachments.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-gray-500">
                      No attachments yet.
                    </td>
                  </tr>
                ) : (
                  attachments.map((a) => {
                    const fileName =
                      a?.file_name || a?.filename || a?.name || a?.title || "File";
                    const url =
                      a?.file_url || a?.url || a?.download_url || a?.file || null;

                    const v =
                      typeof a?.visible_to_homeowner !== "undefined"
                        ? a.visible_to_homeowner
                        : a?.visible;

                    const ack =
                      typeof a?.requires_acknowledgement !== "undefined"
                        ? a.requires_acknowledgement
                        : a?.ack_required;

                    return (
                      <tr key={a.id} className="border-b last:border-b-0">
                        <td className="py-2 pr-3">{a.category || "-"}</td>
                        <td className="py-2 pr-3">{a.title || "-"}</td>
                        <td className="py-2 pr-3">{v ? "Yes" : "No"}</td>
                        <td className="py-2 pr-3">{ack ? "Yes" : "No"}</td>
                        <td className="py-2 pr-3">
                          {url ? (
                            <a
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-indigo-600 hover:underline"
                            >
                              {fileName}
                            </a>
                          ) : (
                            fileName
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          <div className="flex gap-2">
                            {url && (
                              <a
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                className="px-2 py-1 rounded border text-xs hover:bg-gray-50"
                              >
                                Download
                              </a>
                            )}
                            <button
                              type="button"
                              onClick={() => deleteAttachment(a.id)}
                              className="px-2 py-1 rounded border text-xs text-red-600 hover:bg-red-50"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* footer actions */}
        <div className="px-4 py-3 border-t flex items-center justify-between">
          <button
            type="button"
            onClick={onBack}
            className="px-3 py-2 text-sm rounded-md border hover:bg-gray-50"
          >
            Back
          </button>
          <button
            type="button"
            onClick={onNext}
            className="px-3 py-2 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
          >
            Save &amp; Next
          </button>
        </div>
      </div>
    </div>
  );
}
