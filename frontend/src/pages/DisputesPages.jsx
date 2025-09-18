// src/pages/DisputesPages.jsx
import React, { useEffect, useState } from "react";
import api from "../api";
import { toast } from "react-hot-toast";
import PageShell from "../components/PageShell.jsx";
import DisputesCreateModal from "../components/DisputesCreateModal.jsx";

console.log("DisputesPages.jsx v2025-09-13");

const money = (n) =>
  Number(n || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });

const toneFor = (s) => {
  switch ((s || "").toLowerCase()) {
    case "initiated": return "info";
    case "open":
    case "under_review": return "warn";
    case "resolved_contractor":
    case "resolved_homeowner": return "good";
    case "canceled": return "default";
    default: return "default";
  }
};

const Badge = ({ tone = "default", children }) => {
  const t = {
    default: ["bg-slate-200", "text-slate-800"],
    warn: ["bg-amber-100", "text-amber-800"],
    good: ["bg-emerald-100", "text-emerald-800"],
    info: ["bg-blue-100", "text-blue-800"],
    danger: ["bg-rose-100", "text-rose-800"],
  }[tone];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${t[0]} ${t[1]}`}>
      {children}
    </span>
  );
};

export default function DisputesPages() {
  const [loading, setLoading] = useState(true);
  const [supportsDisputesApi, setSupportsDisputesApi] = useState(true);

  // New disputes API
  const [mine, setMine] = useState([]);
  const [customer, setCustomer] = useState([]);

  // Fallback: disputed invoices
  const [fallbackRows, setFallbackRows] = useState([]);

  const [showWizard, setShowWizard] = useState(false);

  const fetchNewApi = async () => {
    try {
      setLoading(true);
      const [mineRes, custRes] = await Promise.all([
        api.get("/projects/disputes/?mine=true"),
        api.get("/projects/disputes/?initiator=homeowner"),
      ]);
      const asList = (r) => (Array.isArray(r.data) ? r.data : r.data?.results || []);
      setMine(asList(mineRes));
      setCustomer(asList(custRes));
      setSupportsDisputesApi(true);
    } catch {
      setSupportsDisputesApi(false);
    } finally {
      setLoading(false);
    }
  };

  const fetchFallback = async () => {
    try {
      setLoading(true);
      const { data } = await api.get("/invoices/", { params: { status: "disputed" } });
      const rows = Array.isArray(data) ? data : data?.results || [];
      setFallbackRows(rows);
    } catch {
      toast.error("Failed to load disputed invoices.");
    } finally {
      setLoading(false);
    }
  };

  const refreshAll = async () => {
    await fetchNewApi();
    if (!supportsDisputesApi) await fetchFallback();
  };

  useEffect(() => {
    (async () => {
      await fetchNewApi();
      if (!supportsDisputesApi) await fetchFallback();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const Section = ({ title, items }) => (
    <div className="mhb-glass" style={{ padding: 16 }}>
      <div className="mb-2 font-extrabold text-slate-800">{title}</div>
      {loading ? (
        <div>Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-slate-500 text-sm">No disputes found.</div>
      ) : (
        <table className="w-full text-sm" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
          <thead>
            <tr className="bg-slate-50">
              <th className="text-left p-2">ID</th>
              <th className="text-left p-2">Agreement #</th>
              <th className="text-left p-2">Milestone</th>
              <th className="text-left p-2">Status</th>
              <th className="text-left p-2">Fee</th>
              <th className="text-left p-2">Created</th>
              <th className="text-left p-2">Attachments</th>
              <th className="text-left p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((d) => (
              <tr key={d.id} className="border-t">
                <td className="p-2 font-bold">#{d.id}</td>
                <td className="p-2">{d.agreement_number || d.agreement}</td>
                <td className="p-2">{d.milestone_title || "—"}</td>
                <td className="p-2">
                  <Badge tone={toneFor(d.status)}>{(d.status || "").replaceAll("_", " ")}</Badge>
                </td>
                <td className="p-2">
                  {d.fee_paid ? (
                    <span className="text-emerald-700 font-bold">Paid</span>
                  ) : (
                    <>
                      <span className="text-slate-700">{money(d.fee_amount || 0)}</span>{" "}
                      <button
                        className="mhb-btn"
                        onClick={async () => {
                          try {
                            await api.post(`/projects/disputes/${d.id}/pay_fee/`);
                            toast.success("Fee paid. Escrow frozen.");
                            refreshAll();
                          } catch (e) {
                            toast.error(e?.response?.data?.detail || "Payment failed.");
                          }
                        }}
                        title="Pay dispute fee"
                      >
                        Pay Fee
                      </button>
                    </>
                  )}
                </td>
                <td className="p-2">{new Date(d.created_at).toLocaleDateString()}</td>
                <td className="p-2">{(d.attachments || []).length}</td>
                <td className="p-2">
                  <label className="mhb-btn">
                    Upload
                    <input
                      type="file"
                      hidden
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const form = new FormData();
                        form.append("file", file);
                        form.append("kind", "photo");
                        try {
                          await api.post(`/projects/disputes/${d.id}/attachments/`, form);
                          toast.success("Uploaded.");
                          refreshAll();
                        } catch {
                          toast.error("Upload failed.");
                        } finally {
                          e.target.value = "";
                        }
                      }}
                    />
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  const Fallback = ({ rows }) => (
    <div className="mhb-glass" style={{ padding: 16 }}>
      <div className="mb-2 font-extrabold text-slate-800">Disputed Invoices</div>
      {rows.length === 0 ? (
        <div className="text-slate-500 text-sm">🎉 No disputed invoices found.</div>
      ) : (
        <table className="w-full text-sm" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
          <thead>
            <tr className="bg-slate-50">
              <th className="text-left p-2">Invoice #</th>
              <th className="text-left p-2">Project</th>
              <th className="text-left p-2">Homeowner</th>
              <th className="text-left p-2">Status</th>
              <th className="text-left p-2">Amount</th>
              <th className="text-left p-2">Disputed On</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((inv) => {
              const disputedAt = inv.disputed_at || inv.updated_at || inv.created_at || null;
              return (
                <tr key={inv.id} className="border-t">
                  <td className="p-2 font-mono">#{inv.invoice_number || inv.id}</td>
                  <td className="p-2">{inv.project_title || inv.agreement_title || "-"}</td>
                  <td className="p-2">{inv.homeowner_name || "-"}</td>
                  <td className="p-2">{String(inv.status || "-").replace("_", " ")}</td>
                  <td className="p-2">{money(inv.amount_due ?? inv.amount)}</td>
                  <td className="p-2">
                    {disputedAt ? new Date(disputedAt).toLocaleDateString() : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );

  return (
    <PageShell
      title="Dispute Center"
      subtitle="Initiate disputes, pay fee to freeze escrow, and manage evidence."
      showLogo
    >
      <div className="flex justify-between items-center mb-3">
        <div />
        <div className="flex gap-8">
          <button className="mhb-btn" onClick={refreshAll} disabled={loading}>Refresh</button>
          <button
            className="mhb-btn primary"
            onClick={() => setShowWizard(true)}
            disabled={!supportsDisputesApi}
            title={supportsDisputesApi ? "Start a dispute" : "Enable the Disputes API to use this"}
          >
            Start Dispute
          </button>
        </div>
      </div>

      {supportsDisputesApi ? (
        <div className="grid gap-12">
          <Section title="Disputes I Started" items={mine} />
          <Section title="Disputes Started by Customers" items={customer} />
        </div>
      ) : (
        <Fallback rows={fallbackRows} />
      )}

      <DisputesCreateModal
        open={showWizard}
        onClose={() => { setShowWizard(false); refreshAll(); }}
      />
    </PageShell>
  );
}
