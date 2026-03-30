// frontend/src/components/Step3WarrantyAttachments.jsx
// Extracted from AgreementWizard.jsx (Option A: logic unchanged)
// v2026-03-02-lock-executed — ✅ lock Step 3 after agreement executed (waiver-aware)

import React, { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import api from "../api";

/* lock helper (same rule as Step 1) */
function isAgreementLocked(agreement) {
  if (!agreement) return false;

  if (agreement.is_locked === true) return true;
  if (agreement.signature_is_satisfied === true) return true;
  if (agreement.is_fully_signed === true) return true;

  if (agreement.signed_by_contractor === true || agreement.signed_by_homeowner === true) return true;

  return false;
}

/* ───────── Step 3: Warranty & Attachments ───────── */
export default function Step3WarrantyAttachments({
  agreement, // ✅ NEW: passed from AgreementWizard
  agreementId,
  DEFAULT_WARRANTY,
  useDefaultWarranty,
  setUseDefaultWarranty,
  customWarranty,
  setCustomWarranty,
  saveWarranty,
  attachments,
  refreshAttachments,
  onBack,
  onNext,
}) {
  const locked = useMemo(() => isAgreementLocked(agreement), [agreement]);

  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("WARRANTY");
  const [visible, setVisible] = useState(true);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef(null);
  const dropRef = useRef(null);

  useEffect(() => {
    const el = dropRef.current;
    if (!el) return;

    const onDragOver = (e) => {
      if (locked) return;
      e.preventDefault();
      el.classList.add("ring-2", "ring-indigo-400");
    };
    const onDragLeave = (e) => {
      e.preventDefault();
      el.classList.remove("ring-2", "ring-indigo-400");
    };
    const onDrop = (e) => {
      if (locked) return;
      e.preventDefault();
      el.classList.remove("ring-2", "ring-indigo-400");
      if (e.dataTransfer?.files?.[0]) setFile(e.dataTransfer.files[0]);
    };

    el.addEventListener("dragover", onDragOver);
    el.addEventListener("dragleave", onDragLeave);
    el.addEventListener("drop", onDrop);

    return () => {
      el.removeEventListener("dragover", onDragOver);
      el.removeEventListener("dragleave", onDragLeave);
      el.removeEventListener("drop", onDrop);
    };
  }, [locked]);

  const tryPostAttachment = async (form) => {
    const urls = [
      agreementId ? `/projects/agreements/${agreementId}/attachments/` : null,
      `/projects/attachments/`,
    ].filter(Boolean);

    let lastErr;
    for (const url of urls) {
      try {
        const { data } = await api.post(url, form);
        return data;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  };

  const addAttachment = async () => {
    if (locked) {
      toast.error("This agreement is executed. Create an amendment to add attachments.");
      return;
    }
    if (!agreementId) return toast.error("Create and save Agreement first.");
    if (!file) return toast.error("Choose a file to upload.");

    try {
      setUploading(true);
      const form = new FormData();
      const resolvedTitle = title || file.name;

      form.set("agreement", String(agreementId));
      form.set("title", resolvedTitle);
      form.set("name", resolvedTitle);
      form.set("category", category);
      form.set("visible_to_homeowner", visible);
      form.set("visible", visible);
      form.set("file", file, file.name);
      form.set("document", file, file.name);

      await tryPostAttachment(form);

      setTitle("");
      setCategory("WARRANTY");
      setVisible(true);
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";

      await refreshAttachments?.();
      toast.success("Attachment uploaded.");
    } catch (e) {
      const msg =
        e?.response?.data?.detail ||
        e?.response?.statusText ||
        e?.message ||
        "Upload failed.";
      toast.error(msg);
    } finally {
      setUploading(false);
    }
  };

  const quietDelete = (url) =>
    api.delete(url, {
      validateStatus: (s) => (s >= 200 && s < 300) || s === 404,
    });

  const deleteAttachment = async (attId) => {
    if (locked) {
      toast.error("This agreement is executed. Create an amendment to delete attachments.");
      return;
    }
    if (!agreementId || !attId) return;

    const nestedUrl = `/projects/agreements/${agreementId}/attachments/${attId}/`;
    const genericUrl = `/projects/attachments/${attId}/`;

    try {
      const res1 = await quietDelete(nestedUrl);
      if (res1?.status === 200 || res1?.status === 204) {
        await refreshAttachments?.();
        toast.success("Attachment deleted.");
        return;
      }
      const res2 = await quietDelete(genericUrl);
      if (res2?.status === 200 || res2?.status === 204 || res2?.status === 404) {
        await refreshAttachments?.();
        toast.success("Attachment deleted.");
      } else {
        toast.error("Delete failed.");
      }
    } catch (e) {
      const msg =
        e?.response?.data?.detail ||
        e?.response?.statusText ||
        e?.message ||
        "Delete failed.";
      toast.error(msg);
    }
  };

  const onSaveWarranty = async () => {
    if (locked) {
      toast.error("This agreement is executed. Create an amendment to change warranty.");
      return;
    }
    await saveWarranty?.();
  };

  return (
    <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      {locked ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="font-semibold">Locked</div>
          <div className="mt-1 text-xs text-amber-900/90">
            This agreement is signed/executed. Step 1–3 are read-only. Create an amendment to modify warranty or attachments.
          </div>
        </div>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Warranty</h3>
            <p className="mt-1 text-sm text-slate-600">
              Choose the standard workmanship warranty or replace it with custom terms before final review.
            </p>
          </div>
          <button
            type="button"
            onClick={onSaveWarranty}
            disabled={locked}
            className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            Save Warranty
          </button>
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
          <label className={`inline-flex items-center gap-2 ${locked ? "opacity-70" : ""}`}>
            <input
              type="checkbox"
              checked={useDefaultWarranty}
              onChange={(e) => !locked && setUseDefaultWarranty(e.target.checked)}
              disabled={locked}
            />
            <span className="text-sm font-medium text-slate-900">
              Use default 12-month workmanship warranty
            </span>
          </label>

          {useDefaultWarranty ? (
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm whitespace-pre-wrap text-slate-700">
              {DEFAULT_WARRANTY}
            </div>
          ) : (
            <div className="mt-3">
              <label className="mb-1 block text-sm font-medium text-slate-800">Custom Warranty</label>
              <textarea
                className="min-h-[120px] w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                placeholder="Enter your custom warranty text…"
                value={customWarranty}
                onChange={(e) => !locked && setCustomWarranty(e.target.value)}
                disabled={locked}
              />
            </div>
          )}
        </div>
      </section>

      {/* Attachments */}
      <section className="rounded-2xl border border-slate-200 bg-white">
        <div className="p-4 border-b">
          <h3 className="text-base font-semibold text-slate-900">Attachments &amp; Addenda</h3>
          <p className="mt-1 text-sm text-slate-600">
            Add warranty PDFs, spec sheets, permits, or supporting files that should travel with the agreement.
          </p>
        </div>

        <div className="p-4 space-y-3">
          {/* Drop zone */}
          <div
            ref={dropRef}
            className={`border-2 border-dashed rounded-md p-4 text-sm text-gray-600 flex flex-col gap-2 items-start ${
              locked ? "opacity-60" : ""
            }`}
          >
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                id="wizard-step3-file"
                type="file"
                onChange={(e) => !locked && setFile(e.target.files?.[0] || null)}
                className="hidden"
                disabled={locked}
              />
            </div>
            <label
              htmlFor="wizard-step3-file"
              className={`inline-flex items-center px-3 py-1.5 rounded-md border bg-white ${
                locked ? "cursor-not-allowed" : "hover:bg-gray-50 cursor-pointer"
              }`}
              onClick={(e) => {
                if (locked) e.preventDefault();
              }}
            >
              Choose Files
            </label>
            <span className="text-gray-500">{file ? file.name : "No file chosen"}</span>
            <p className="text-xs text-gray-500">Drag &amp; drop files here, or click.</p>
          </div>

          {/* Meta */}
          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-6">
              <input
                type="text"
                value={title}
                onChange={(e) => !locked && setTitle(e.target.value)}
                className="w-full border rounded-md p-2 text-sm"
                placeholder="Title (e.g., Spec Sheet)"
                disabled={locked}
              />
            </div>
            <div className="col-span-3">
              <select
                value={category}
                onChange={(e) => !locked && setCategory(e.target.value)}
                className="w-full border rounded-md p-2 text-sm"
                disabled={locked}
              >
                <option value="WARRANTY">WARRANTY</option>
                <option value="SPEC">SPEC / SCOPE</option>
                <option value="PERMIT">PERMIT / LICENSE</option>
                <option value="PHOTO">PHOTO / IMAGE</option>
                <option value="OTHER">OTHER</option>
              </select>
            </div>
            <div className="col-span-3 flex items-center gap-4">
              <label className={`inline-flex items-center gap-2 ${locked ? "opacity-70" : ""}`}>
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={visible}
                  onChange={(e) => !locked && setVisible(e.target.checked)}
                  disabled={locked}
                />
                <span className="text-sm">Visible to customer</span>
              </label>
            </div>
          </div>

          <div>
            <button
              type="button"
              onClick={addAttachment}
              disabled={uploading || locked}
              className="px-3 py-2 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {uploading ? "Uploading..." : "Add Attachment"}
            </button>
          </div>

          {/* List */}
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2 pr-3 font-semibold text-gray-700">Category</th>
                  <th className="py-2 pr-3 font-semibold text-gray-700">Title</th>
                  <th className="py-2 pr-3 font-semibold text-gray-700">Visible</th>
                  <th className="py-2 pr-3 font-semibold text-gray-700">File</th>
                  <th className="py-2 pr-3 font-semibold text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody>
                {attachments?.length ? (
                  attachments.map((a) => {
                    const v = (a.visible_to_homeowner ?? a.visible) ? true : false;
                    const name = a.file_name || a.filename || a.name || a.title || "File";
                    const url = a.file_url || a.url || a.download_url || a.file || null;

                    return (
                      <tr key={a.id || a.name || a.url} className="border-b last:border-b-0">
                        <td className="py-2 pr-3">{a.category || "-"}</td>
                        <td className="py-2 pr-3">{a.title || name}</td>
                        <td className="py-2 pr-3">{v ? "Yes" : "No"}</td>
                        <td className="py-2 pr-3">
                          {url ? (
                            <a href={url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
                              {name}
                            </a>
                          ) : (
                            name
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
                            {a?.id && (
                              <button
                                type="button"
                                onClick={() => deleteAttachment(a.id)}
                                disabled={locked}
                                className="px-2 py-1 rounded border text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-gray-500">
                      No attachments uploaded.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer nav */}
        <div className="px-4 py-3 border-t flex items-center justify-between">
          <button type="button" onClick={onBack} className="rounded border px-3 py-2 text-sm">
            Back
          </button>
          <button
            type="button"
            onClick={onNext}
            className="rounded bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700"
            title={locked ? "Next" : "Save & Next"}
          >
            {locked ? "Next" : "Save & Next"}
          </button>
        </div>
      </section>
    </div>
  );
}
