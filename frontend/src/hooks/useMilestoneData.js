// src/hooks/useMilestoneData.js
import { useState, useEffect, useCallback } from "react";
import api from "../api";
import { toast } from "react-hot-toast";

/**
 * Resilient Milestone data hook
 * - Tries /projects/* endpoints first, then falls back to flat routes
 * - Surfaces agreementSigned / escrowFunded / canComplete flags
 * - Provides markComplete(), sendInvoice(), uploadFile(), deleteFile(), addComment(), refetch()
 */
export const useMilestoneData = (milestoneId) => {
  const [milestone, setMilestone] = useState(null);
  const [files, setFiles] = useState([]);
  const [comments, setComments] = useState([]);
  const [invoice, setInvoice] = useState(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  /* ------------------------- helpers ------------------------- */

  const deriveFlags = (d) => {
    // Prefer server-provided flags; otherwise derive
    const aSigned =
      typeof d?.agreement_signed === "boolean"
        ? d.agreement_signed
        : !!(
            d?.agreement?.is_fully_signed ||
            (d?.agreement?.signed_by_contractor && d?.agreement?.signed_by_homeowner)
          );

    const eFunded =
      typeof d?.escrow_funded === "boolean"
        ? d.escrow_funded
        : !!(d?.agreement?.escrow_funded);

    const can =
      typeof d?.can_complete === "boolean" ? d.can_complete : aSigned && eFunded;

    return { agreementSigned: aSigned, escrowFunded: eFunded, canComplete: can };
  };

  const getDetail = useCallback(
    async (id) => {
      try {
        const { data } = await api.get(`/projects/milestones/${id}/`);
        return data || null;
      } catch {
        const { data } = await api.get(`/milestones/${id}/`);
        return data || null;
      }
    },
    []
  );

  const listFiles = useCallback(async (id) => {
    try {
      const { data } = await api.get(`/milestone-files/?milestone=${id}`);
      return Array.isArray(data) ? data : [];
    } catch {
      // Alternate route namespace (if you created a /projects list)
      try {
        const { data } = await api.get(`/projects/milestone-files/?milestone=${id}`);
        return Array.isArray(data) ? data : [];
      } catch {
        return [];
      }
    }
  }, []);

  const listComments = useCallback(async (id) => {
    try {
      const { data } = await api.get(`/milestones/${id}/comments/`);
      return Array.isArray(data) ? data : [];
    } catch {
      try {
        const { data } = await api.get(`/projects/milestones/${id}/comments/`);
        return Array.isArray(data) ? data : [];
      } catch {
        return [];
      }
    }
  }, []);

  const findInvoiceForMilestone = useCallback(async (d) => {
    // If backend exposes invoice_id or invoice object directly:
    if (d?.invoice_id) return { id: d.invoice_id, status: "pending" };
    if (d?.invoice) return d.invoice;

    // Heuristic fallback: query invoices for the agreement and match amount
    const agreementId = d?.agreement_id || d?.agreement || d?.agreement?.id;
    if (!agreementId) return null;

    try {
      const { data } = await api.get(`/invoices/?agreement=${agreementId}`);
      const list = Array.isArray(data) ? data : [];
      const byAmount = list.find(
        (inv) => Number(inv.amount) === Number(d?.amount)
      );
      return byAmount || null;
    } catch {
      return null;
    }
  }, []);

  /* ------------------------- fetch ------------------------- */

  const refetch = useCallback(async () => {
    if (!milestoneId) return;
    setLoading(true);
    setError("");

    try {
      // 1) Detail (needed to derive flags and agreement)
      const detail = await getDetail(milestoneId);
      setMilestone(detail);

      // 2) Files & comments in parallel
      const [fList, cList] = await Promise.all([
        listFiles(milestoneId),
        listComments(milestoneId),
      ]);
      setFiles(fList);
      setComments(cList);

      // 3) Invoice (if any)
      const inv = await findInvoiceForMilestone(detail || {});
      setInvoice(inv || null);
    } catch (e) {
      console.error(e);
      setError("Failed to load milestone data.");
      toast.error("Failed to load milestone data.");
    } finally {
      setLoading(false);
    }
  }, [milestoneId, getDetail, listFiles, listComments, findInvoiceForMilestone]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  /* ------------------------- actions ------------------------- */

  const uploadFile = async (file) => {
    if (!milestoneId || !file) return;
    const form = new FormData();
    form.append("file", file);
    form.append("milestone", milestoneId);
    try {
      let resp;
      try {
        resp = await api.post("/projects/milestone-files/", form);
      } catch {
        resp = await api.post("/milestone-files/", form);
      }
      const saved = resp?.data;
      if (saved) setFiles((prev) => [saved, ...prev]);
      toast.success("File uploaded.");
      return saved;
    } catch (e) {
      toast.error("Upload failed.");
      throw e;
    }
  };

  const deleteFile = async (fileId) => {
    if (!fileId) return;
    try {
      try {
        await api.delete(`/projects/milestone-files/${fileId}/`);
      } catch {
        await api.delete(`/milestone-files/${fileId}/`);
      }
      setFiles((prev) => prev.filter((f) => String(f.id) !== String(fileId)));
      toast.success("File deleted.");
    } catch (e) {
      toast.error("Failed to delete file.");
      throw e;
    }
  };

  const addComment = async (content) => {
    if (!milestoneId || !String(content || "").trim()) return;
    try {
      let resp;
      try {
        resp = await api.post(`/projects/milestones/${milestoneId}/comments/`, {
          content: String(content).trim(),
        });
      } catch {
        resp = await api.post(`/milestones/${milestoneId}/comments/`, {
          content: String(content).trim(),
        });
      }
      const saved = resp?.data;
      if (saved) setComments((prev) => [saved, ...prev]);
      return saved;
    } catch (e) {
      toast.error("Could not post comment.");
      throw e;
    }
  };

  const markComplete = async () => {
    if (!milestoneId) return;
    // Use the dedicated backend action that enforces signatures + escrow
    try {
      let resp;
      try {
        resp = await api.post(`/projects/milestones/${milestoneId}/mark_complete/`);
      } catch {
        // alt route name (underscore) or flat namespace
        try {
          resp = await api.post(`/projects/milestones/${milestoneId}/mark_complete/`);
        } catch {
          resp = await api.post(`/milestones/${milestoneId}/mark_complete/`);
        }
      }
      toast.success("Milestone marked complete.");
      await refetch();
      return resp?.data || null;
    } catch (e) {
      const msg =
        e?.response?.data?.detail ||
        e?.response?.data?.message ||
        "Cannot complete this milestone.";
      toast.error(String(msg));
      throw e;
    }
  };

  const sendInvoice = async () => {
    if (!milestoneId) return;
    try {
      let resp;
      // hyphenated action preferred; fallbacks included
      try {
        resp = await api.post(`/projects/milestones/${milestoneId}/send-invoice/`);
      } catch {
        try {
          resp = await api.post(`/milestones/${milestoneId}/send-invoice/`);
        } catch {
          resp = await api.post(`/milestones/${milestoneId}/send_invoice/`);
        }
      }
      const inv = resp?.data?.invoice || resp?.data || null;
      setInvoice(inv);
      toast.success("Invoice sent.");
      return inv;
    } catch (e) {
      const msg =
        e?.response?.data?.detail ||
        e?.response?.data?.message ||
        "Could not send invoice.";
      toast.error(String(msg));
      throw e;
    }
  };

  /* ------------------------- exposed API ------------------------- */

  const flags = deriveFlags(milestone || {});

  return {
    milestone,
    files,
    comments,
    invoice,
    loading,
    error,
    // derived flags
    agreementSigned: flags.agreementSigned,
    escrowFunded: flags.escrowFunded,
    canComplete: flags.canComplete,
    // actions
    refetch,
    uploadFile,
    deleteFile,
    addComment,
    markComplete,
    sendInvoice,
  };
};
