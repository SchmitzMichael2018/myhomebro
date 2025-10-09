// frontend/src/components/Step4Review.jsx
// v2025-10-09 — Switches preview to use signed link (no 401),
// keeps mandatory preview gate + typed/image signature flow.

import React, { useEffect, useMemo, useState, useCallback } from "react";
import toast from "react-hot-toast";
import api from "../api";
import PreviewAgreementPdfButton from "./PreviewAgreementPdfButton";

function toDateOnly(v) {
  if (!v) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${yyyy}-${mm}-${dd}`;
}
function pickApiDate(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v) return v;
  }
  return "";
}

export default function Step4Review({ agreementId, onBack, onFinished }) {
  const [loading, setLoading] = useState(true);
  const [agreement, setAgreement] = useState(null);
  const [milestones, setMilestones] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [signName, setSignName] = useState("");
  const [sigFile, setSigFile] = useState(null);
  const [acceptESign, setAcceptESign] = useState(false);
  const [acceptTOS, setAcceptTOS] = useState(false);
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [hasPreviewed, setHasPreviewed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const currency = useCallback((n) => {
    if (typeof n !== "number") return "$0.00";
    return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
  }, []);

  const totalAmount = useMemo(
    () => milestones.reduce((s, m) => s + (Number(m.amount) || 0), 0),
    [milestones]
  );

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        const a = await api.get(`/projects/agreements/${agreementId}/`);
        const m = await api.get(`/projects/agreements/${agreementId}/milestones/`);

        const normalizedMilestones = (Array.isArray(m.data) ? m.data : []).map((row) => {
          const due = toDateOnly(
            pickApiDate(row, ["due_date","target_date","end","end_date","completion_date","finish","finish_date"])
          );
          const amtNum = Number(row.amount || 0);
          return { ...row, due_date_preview: due || "—", amount: isNaN(amtNum) ? row.amount : amtNum };
        });

        let atts = [];
        try {
          const ax = await api.get(`/projects/agreements/${agreementId}/attachments/`);
          atts = Array.isArray(ax.data) ? ax.data : [];
        } catch {
          atts = [];
        }

        if (!mounted) return;
        setAgreement(a.data);
        setMilestones(normalizedMilestones);
        setAttachments(atts);

        const contractorName =
          a?.data?.contractor_name ||
          a?.data?.contractor?.name ||
          a?.data?.contractor?.business_name ||
          "";
        setSignName(contractorName);
      } catch (err) {
        console.error(err);
        toast.error("Failed to load agreement for review.");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => (mounted = false);
  }, [agreementId]);

  // — Sign & Send (typed + optional image) —
  const handleSignAndSend = async () => {
    if (!hasPreviewed) {
      toast.error("Please preview the agreement PDF before signing.");
      return;
    }
    if (!acceptESign || !acceptTOS || !acceptPrivacy) {
      toast.error("Please accept e-sign, Terms of Service, and Privacy Policy.");
      return;
    }
    if (!signName || signName.trim().length < 2) {
      toast.error("Please type your full name to sign.");
      return;
    }

    try {
      setSubmitting(true);

      if (sigFile) {
        const form = new FormData();
        form.append("typed_name", signName.trim());
        form.append("signature", sigFile);
        await api.post(`/projects/agreements/${agreementId}/contractor_sign/`, form, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      } else {
        await api.post(`/projects/agreements/${agreementId}/contractor_sign/`, {
          typed_name: signName.trim(),
        });
      }

      await api.post(`/projects/agreements/${agreementId}/send_for_signature/`);
      toast.success("Signed and sent to homeowner!");
      onFinished?.();
    } catch (err) {
      console.error(err);
      toast.error("Unable to sign & send. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const warrantyType = (agreement?.warranty_type || "").toString().trim().toLowerCase();
  const hasDefaultWarranty = ["default","standard","std"].includes(warrantyType);
  const hasCustomWarranty = warrantyType === "custom";

  if (loading) {
    return <div style={{ padding: 20 }}><p>Loading review…</p></div>;
  }

  return (
    <div style={{ padding: 16, display: "grid", gap: 16 }}>
      {/* Header: Contractor Branding */}
      <div className="mhb-card" style={{ background: "#fff", borderRadius: 18, padding: 16, display: "flex", alignItems: "center", gap: 14 }}>
        {agreement?.contractor_logo_url ? (
          <img src={agreement.contractor_logo_url} alt="Contractor Logo" style={{ width: 60, height: 60, borderRadius: 12, objectFit: "cover" }} />
        ) : (
          <div style={{ width: 60, height: 60, borderRadius: 12, background: "#e2e8f0", display: "grid", placeItems: "center", color: "#64748b", fontWeight: 700 }}>LOGO</div>
        )}
        <div style={{ lineHeight: 1.25 }}>
          <div style={{ fontSize: 18, fontWeight: 800 }}>{agreement?.contractor_business_name || agreement?.contractor_name || "Contractor"}</div>
          <div style={{ color: "#475569" }}>
            {agreement?.contractor_email ? <span>{agreement.contractor_email}</span> : null}
            {agreement?.contractor_phone ? <span> • {agreement.contractor_phone}</span> : null}
          </div>
          {agreement?.contractor_license ? (<div style={{ color: "#64748b" }}>License #{agreement.contractor_license}</div>) : null}
        </div>
      </div>

      {/* Parties + Project */}
      <div className="mhb-card" style={{ background: "#fff", borderRadius: 18, padding: 16, display: "grid", gap: 8 }}>
        <h3 style={{ margin: 0 }}>Agreement Summary</h3>
        <div style={{ display: "grid", gap: 8 }}>
          <Row label="Agreement #">{agreement?.id}</Row>
          <Row label="Project Title">{agreement?.project_title || agreement?.title}</Row>
          <Row label="Project Type">
            {agreement?.project_type || "—"}
            {agreement?.project_subtype ? ` — ${agreement.project_subtype}` : ""}
          </Row>
          <Row label="Homeowner">
            {agreement?.homeowner_name || agreement?.homeowner?.name || "—"}
            {agreement?.homeowner_email ? ` • ${agreement.homeowner_email}` : ""}
          </Row>
          <Row label="Schedule">{(agreement?.start || "TBD")} → {(agreement?.end || "TBD")}</Row>
          <Row label="Total">{currency(totalAmount)}</Row>
          {agreement?.status ? <Row label="Status">{agreement.status}</Row> : null}
        </div>
      </div>

      {/* Milestones */}
      <div className="mhb-card" style={{ background: "#fff", borderRadius: 18, padding: 16, display: "grid", gap: 12 }}>
        <h3 style={{ margin: 0 }}>Milestones</h3>
        <div className="mhb-table-wrap">
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, minWidth: 720 }}>
            <thead>
              <tr style={{ background: "#f8fafc", color: "#475569" }}>
                <Th>#</Th><Th>Description</Th><Th>Due Date</Th><Th>Amount</Th><Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {milestones.map((m, i) => (
                <tr key={m.id || i} style={{ borderBottom: "1px solid #eef2f7" }}>
                  <Td>{i + 1}</Td>
                  <Td>{m.title || m.description || "—"}</Td>
                  <Td>{m.due_date_preview || "—"}</Td>
                  <Td>{currency(Number(m.amount) || 0)}</Td>
                  <Td>{m.status || "Pending"}</Td>
                </tr>
              ))}
              <tr>
                <Td colSpan={3} style={{ textAlign: "right", fontWeight: 700 }}>Total</Td>
                <Td style={{ fontWeight: 800 }}>{currency(totalAmount)}</Td>
                <Td />
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Warranty */}
      <div className="mhb-card" style={{ background: "#fff", borderRadius: 18, padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Warranty</h3>
        {hasDefaultWarranty ? (
          <p style={{ margin: 0 }}>Default workmanship warranty clause applies. Details will be embedded in the final PDF.</p>
        ) : hasCustomWarranty ? (
          <>
            <p style={{ marginTop: 0 }}>Custom warranty uploaded by contractor:</p>
            {attachments.length > 0 ? (
              <ul style={{ marginTop: 6 }}>
                {attachments.filter((f) => (f.category || "").toUpperCase() === "WARRANTY").map((f) => (
                  <li key={f.id}>
                    <a className="mhb-link" href={f.file_url} target="_blank" rel="noreferrer">
                      {f.title || f.filename || "Warranty Attachment"}
                    </a>
                  </li>
                ))}
              </ul>
            ) : <p>No warranty attachment found.</p>}
          </>
        ) : <p style={{ margin: 0 }}>No warranty specified.</p>}
      </div>

      {/* Attachments */}
      <div className="mhb-card" style={{ background: "#fff", borderRadius: 18, padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Attachments & Addenda</h3>
        {attachments.length ? (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {attachments.map((f) => (
              <li key={f.id}>
                <strong>{(f.category || "OTHER").toUpperCase()}</strong> —{" "}
                <a className="mhb-link" href={f.file_url} target="_blank" rel="noreferrer">
                  {f.title || f.filename || "Attachment"}
                </a>{" "}
                {f.require_acknowledgement ? <em>(Acknowledgement Required)</em> : null}
              </li>
            ))}
          </ul>
        ) : <p style={{ margin: 0 }}>No additional attachments.</p>}
      </div>

      {/* e-Sign + Policy Acknowledgments */}
      <div className="mhb-card" style={{ background: "#fff", borderRadius: 18, padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Sign & Send</h3>

        {/* Signed-link Preview button prevents 401s */}
        <div style={{ marginBottom: 10 }}>
          <PreviewAgreementPdfButton
            agreementId={agreementId}
            onPreviewed={() => setHasPreviewed(true)}
          />
          {!hasPreviewed && (
            <p style={{ margin: "6px 0 0", color: "#b45309", fontSize: 13 }}>
              You must preview the agreement PDF at least once before signing.
            </p>
          )}
        </div>

        {/* Signature image upload (optional) */}
        <div style={{ marginBottom: 10 }}>
          <label className="block text-sm font-medium mb-1">Upload Signature (optional, PNG/JPG):</label>
          <input
            type="file"
            accept="image/png,image/jpeg"
            onChange={(e) => setSigFile(e.target.files?.[0] || null)}
          />
          {sigFile ? <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>{sigFile.name}</div> : null}
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Type your full name (electronic signature):</span>
            <input
              value={signName}
              onChange={(e) => setSignName(e.target.value)}
              placeholder="e.g., John Contractor"
              style={{ height: 44, borderRadius: 10, border: "1px solid #d1d5db", padding: "0 12px", fontSize: 16 }}
            />
          </label>

          <CheckboxRow checked={acceptESign} onChange={setAcceptESign}
            label="I agree that my electronic signature has the same legal effect as a handwritten signature." />
          <CheckboxRow checked={acceptTOS} onChange={setAcceptTOS}
            label={<>
              I have read and agree to the{" "}
              <a className="mhb-link" href="/static/legal/terms_of_service.txt" target="_blank" rel="noreferrer">
                Terms of Service
              </a>.
            </>} />
          <CheckboxRow checked={acceptPrivacy} onChange={setAcceptPrivacy}
            label={<>
              I have read and agree to the{" "}
              <a className="mhb-link" href="/static/legal/privacy_policy.txt" target="_blank" rel="noreferrer">
                Privacy Policy
              </a>.
            </>} />

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
            <button onClick={onBack} disabled={submitting} style={btn("ghost")} type="button">Back</button>
            <button
              onClick={handleSignAndSend}
              disabled={submitting || !hasPreviewed || !acceptESign || !acceptTOS || !acceptPrivacy}
              style={btn("primary")}
              type="button"
              title={!hasPreviewed ? "Please preview the PDF before signing" : ""}
            >
              {submitting ? "Signing & Sending…" : "Sign & Send to Homeowner"}
            </button>
          </div>

          <p style={{ margin: "6px 0 0", color: "#64748b", fontSize: 13 }}>
            By proceeding you acknowledge MyHomeBro acts as a neutral platform (not a party to the Agreement) and will
            store a versioned PDF with signature metadata.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ---------- tiny helpers ---------- */
function Row({ label, children }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 12 }}>
      <div style={{ color: "#64748b" }}>{label}</div>
      <div>{children ?? "—"}</div>
    </div>
  );
}
function Th({ children }) {
  return <th style={{ textAlign: "left", fontSize: 13, letterSpacing: 0.2, padding: "10px 12px" }}>{children}</th>;
}
function Td({ children, colSpan }) {
  return <td style={{ padding: "12px 12px", fontSize: 14, verticalAlign: "top" }} colSpan={colSpan}>{children}</td>;
}
function CheckboxRow({ checked, onChange, label }) {
  return (
    <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 4 }} />
      <span>{label}</span>
    </label>
  );
}
function btn(variant) {
  const base = { padding: "10px 14px", borderRadius: 12, border: "1px solid transparent", fontWeight: 700, cursor: "pointer", minHeight: 44 };
  if (variant === "primary") return { ...base, background: "linear-gradient(135deg, #0d47ff 0%, #6b86ff 50%)", color: "#fff", boxShadow: "0 6px 16px rgba(13,71,255,0.25)" };
  return { ...base, background: "#ffffff", border: "1px solid #e5e7eb", color: "#111827" };
}
