// src/components/MilestoneDetailModal.jsx

import React, { useState, useRef } from "react";
import { Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import api from "../api";
import { useMilestoneData } from "../hooks/useMilestoneData";
import Modal from "./Modal";

const formatDuration = (isoDuration) => {
  if (!isoDuration) return "N/A";
  const matches = isoDuration.match(/P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?/);
  if (!matches) return isoDuration;
  return `${matches[1] || 0}d ${matches[2] || 0}h ${matches[3] || 0}m`;
};

export default function MilestoneDetailModal({ visible, milestone, onClose }) {
  const {
    files, comments, invoice, loading, error,
    addFile, removeFile, addComment, sendInvoice, refetch
  } = useMilestoneData(milestone?.id);

  const [commentText, setCommentText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [actionLoading, setActionLoading] = useState(null);
  const scrollRef = useRef(null);

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file || !milestone?.id) return;
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("milestone", milestone.id);
    try {
      const { data } = await api.post("/milestone-files/", formData);
      addFile(data);
      toast.success("File uploaded successfully.");
    } catch {
      toast.error("Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const handleFileDelete = async (fileId) => {
    if (!window.confirm("Are you sure you want to delete this file?")) return;
    try {
      await api.delete(`/milestone-files/${fileId}/`);
      removeFile(fileId);
      toast.success("File deleted.");
    } catch {
      toast.error("Failed to delete file.");
    }
  };

  const handleCommentSubmit = async (e) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    setActionLoading('comment');
    try {
      const { data } = await api.post(`/milestones/${milestone.id}/comments/`, { content: commentText.trim() });
      addComment(data);
      setCommentText("");
    } catch {
      toast.error("Could not post comment.");
    } finally {
      setActionLoading(null);
    }
  };

  const handleSendInvoice = async () => {
    if (!window.confirm("Send this milestone as an invoice to the homeowner?")) return;
    setActionLoading('invoice');
    try {
      await sendInvoice();
      refetch();
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <Modal visible={visible} onClose={onClose} title={`Milestone: ${milestone?.title || "Untitled"}`}>
      <div className="space-y-4">
        <p className="text-sm text-gray-600">Duration: {formatDuration(milestone?.duration)}</p>

        <div className="border-t pt-4">
          <h4 className="font-semibold mb-2">Upload Files</h4>
          <input type="file" onChange={handleFileChange} disabled={uploading} />
          <ul className="mt-2 space-y-1 text-sm">
            {files.map(file => (
              <li key={file.id} className="flex justify-between items-center">
                <a href={file.file} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">{file.file.split('/').pop()}</a>
                <button
                  onClick={() => handleFileDelete(file.id)}
                  className="text-red-600 hover:underline"
                  title="Delete file"
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="border-t pt-4">
          <h4 className="font-semibold mb-2">Comments</h4>
          <form onSubmit={handleCommentSubmit} className="flex gap-2">
            <input
              type="text"
              placeholder="Add a comment..."
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              className="flex-1 border p-2 rounded"
            />
            <button type="submit" disabled={actionLoading === 'comment'} className="bg-blue-600 text-white px-4 py-2 rounded">
              {actionLoading === 'comment' ? '...' : 'Send'}
            </button>
          </form>
          <ul className="mt-2 text-sm space-y-1">
            {comments.map(c => (
              <li key={c.id}>
                <strong>{c.author_name}</strong>: {c.content}
              </li>
            ))}
          </ul>
        </div>

        {invoice ? (
          <div className="text-green-700 font-bold">Invoice sent ✅</div>
        ) : (
          <button
            onClick={handleSendInvoice}
            disabled={actionLoading === 'invoice'}
            className="bg-green-600 text-white px-4 py-2 rounded mt-4"
          >
            {actionLoading === 'invoice' ? 'Sending...' : 'Send Invoice'}
          </button>
        )}
      </div>
    </Modal>
  );
}
