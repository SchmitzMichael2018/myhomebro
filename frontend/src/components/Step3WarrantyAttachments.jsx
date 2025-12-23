// frontend/src/components/Step3WarrantyAttachments.jsx
// Extracted from AgreementWizard.jsx (Option A: logic unchanged)

import React, { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import api from "../api";

/* ───────── Step 3: Warranty & Attachments ───────── */
export default function Step3WarrantyAttachments({
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
  }, []);

  const tryPostAttachment = async (form) => {
    const urls = [
      agreementId
        ? `/projects/agreements/${agreementId}/attachments/`
        : null,
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
      if (
        res2?.status === 200 ||
        res2?.status === 204 ||
        res2?.status === 404
      ) {
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

  return (
    <div className="rounded-lg border bg-white p-4 space-y-6">
      {/* Warranty */}
      <div>
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={useDefaultWarranty}
            onChange={(e) => setUseDefaultWarranty(e.target.checked)}
          />
          <span className="text-sm">
            Use default 12-month workmanship warranty
          </span>
        </label>

        {useDefaultWarranty ? (
          <div className="mt-3 rounded border p-3 bg-gray-50 text-sm whitespace-pre-wrap">
            {DEFAULT_WARRANTY}
          </div>
        ) : (
          <div className="mt-3">
            <label className="block text-sm font-medium mb-1">
              Custom Warranty
            </label>
            <textarea
              className="w-full rounded border px-3 py-2 text-sm min-h-[120px]"
              placeholder="Enter your custom warranty text…"
              value={customWarranty}
              onChange={(e) => setCustomWarranty(e.target.value)}
            />
          </div>
        )}

        <div className="mt-3">
          <button
            onClick={saveWarranty}
            className="rounded bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700"
          >
            Save Warranty
          </button>
        </div>
      </div>

      {/* Attachments */}
      <div className="rounded-2xl border">
        <div className="p-4 border-b">
          <h3 className="text-base font-semibold">
            Attachments &amp; Addenda
          </h3>
        </div>

        <div className="p-4 space-y-3">
          {/* Drop zone */}
          <div
            ref={dropRef}
            className="border-2 border-dashed rounded-md p-4 text-sm text-gray-600 flex flex-col gap-2 items-start"
          >
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                id="wizard-step3-file"
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="hidden"
              />
            </div>
            <label
              htmlFor="wizard-step3-file"
              className="inline-flex items-center px-3 py-1.5 rounded-md border bg-white hover:bg-gray-50 cursor-pointer"
            >
              Choose Files
            </label>
            <span className="text-gray-500">
              {file ? file.name : "No file chosen"}
            </span>
            <p className="text-xs text-gray-500">
              Drag &amp; drop files here, or click.
            </p>
          </div>

          {/* Meta */}
          <div className="grid grid-cols-12 gap-3">
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
                <option value="WARRANTY">WARRANTY</option>
                <option value="SPEC">SPEC / SCOPE</option>
                <option value="PERMIT">PERMIT / LICENSE</option>
                <option value="PHOTO">PHOTO / IMAGE</option>
                <option value="OTHER">OTHER</option>
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
            </div>
          </div>

          <div>
            <button
              type="button"
              onClick={addAttachment}
              disabled={uploading}
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
                  <th className="py-2 pr-3 font-semibold text-gray-700">
                    Category
                  </th>
                  <th className="py-2 pr-3 font-semibold text-gray-700">
                    Title
                  </th>
                  <th className="py-2 pr-3 font-semibold text-gray-700">
                    Visible
                  </th>
                  <th className="py-2 pr-3 font-semibold text-gray-700">
                    File
                  </th>
                  <th className="py-2 pr-3 font-semibold text-gray-700">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {attachments?.length ? (
                  attachments.map((a) => {
                    const v =
                      (a.visible_to_homeowner ?? a.visible) ? true : false;
                    const name =
                      a.file_name ||
                      a.filename ||
                      a.name ||
                      a.title ||
                      "File";
                    const url =
                      a.file_url ||
                      a.url ||
                      a.download_url ||
                      a.file ||
                      null;
                    return (
                      <tr
                        key={a.id || a.name || a.url}
                        className="border-b last:border-b-0"
                      >
                        <td className="py-2 pr-3">
                          {a.category || "-"}
                        </td>
                        <td className="py-2 pr-3">
                          {a.title || name}
                        </td>
                        <td className="py-2 pr-3">
                          {v ? "Yes" : "No"}
                        </td>
                        <td className="py-2 pr-3">
                          {url ? (
                            <a
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-indigo-600 hover:underline"
                            >
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
                                className="px-2 py-1 rounded border text-xs text-red-600 hover:bg-red-50"
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
                    <td
                      colSpan={5}
                      className="py-6 text-center text-gray-500"
                    >
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
          <button onClick={onBack} className="rounded border px-3 py-2 text-sm">
            Back
          </button>
          <button
            onClick={onNext}
            className="rounded bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700"
          >
            Save &amp; Next
          </button>
        </div>
      </div>
    </div>
  );
}
