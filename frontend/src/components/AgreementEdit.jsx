// frontend/src/components/AgreementEdit.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../api";

const money = (n) =>
  Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function DateInput({ label, value, onChange, name }) {
  const ref = useRef(null);
  return (
    <label className="block">
      <span className="text-sm text-gray-600">{label}</span>
      <div className="mt-1 relative">
        <input
          ref={ref}
          type="date"
          name={name}
          value={value ? String(value).slice(0, 10) : ""}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded border px-3 py-2 pr-10"
        />
        <button
          type="button"
          onClick={() => (ref.current?.showPicker ? ref.current.showPicker() : ref.current?.focus())}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
          title="Open date picker"
          aria-label="Open date picker"
        >
          📅
        </button>
      </div>
    </label>
  );
}

function StatusPill({ ok, label }) {
  return (
    <div className="flex items-center gap-2 rounded-full border px-3 py-1 text-sm">
      <span className={`text-lg leading-none ${ok ? "text-green-600" : "text-red-600"}`}>
        {ok ? "✅" : "❌"}
      </span>
      <span className={`${ok ? "text-green-700" : "text-red-700"} font-semibold`}>{label}</span>
    </div>
  );
}

export default function AgreementEdit() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [agreement, setAgreement] = useState(null);
  const [milestones, setMilestones] = useState([]);

  const [title, setTitle] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [total, setTotal] = useState(0);

  const [signName, setSignName] = useState("");

  async function fetchAgreement() {
    setLoading(true);
    try {
      const [aRes, mRes] = await Promise.all([
        api.get(`/projects/agreements/${id}/`),
        // IMPORTANT: keep this filter; backend file below enforces it server-side too
        api.get(`/projects/milestones/`, { params: { agreement: id } }),
      ]);
      const a = aRes.data;
      const ms = Array.isArray(mRes.data) ? mRes.data : mRes.data?.results ?? [];

      setAgreement(a);
      setMilestones(ms);

      setTitle(a.project_title || a.project?.title || "");
      setStart(a.start || a.start_date || "");
      setEnd(a.end || a.end_date || "");
      setTotal(Number(a.total_cost || 0));
    } catch (err) {
      console.error(err);
      toast.error("Could not load agreement.");
      navigate("/agreements");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAgreement();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const milestonesTotal = useMemo(
    () => milestones.reduce((acc, m) => acc + Number(m.amount || 0), 0),
    [milestones]
  );

  async function saveAgreement() {
    setSaving(true);
    try {
      await api.patch(`/projects/agreements/${id}/`, {
        project_title: title,
        start: start || null,
        end: end || null,
        total_cost: total,
      });
      await Promise.all(
        milestones.map((m) =>
          api.patch(`/projects/milestones/${m.id}/`, {
            title: m.title,
            amount: m.amount,
            scheduled_date: m.scheduled_date || m.start_date || null,
          })
        )
      );
      toast.success("Agreement updated.");
      fetchAgreement();
    } catch (err) {
      console.error(err);
      toast.error("Could not save agreement.");
    } finally {
      setSaving(false);
    }
  }

  async function signAsContractor() {
    if (!signName.trim()) return toast.error("Enter your full name to sign.");
    try {
      await api.post(`/projects/agreements/${id}/sign/`, {
        role: "contractor",
        signature_name: signName.trim(),
      });
      toast.success("Signed as contractor.");
      setSignName("");
      fetchAgreement();
    } catch (e) {
      console.error(e);
      toast.error(e?.response?.data?.detail || "Could not sign.");
    }
  }

  async function sendHomeownerInvite() {
    try {
      await api.post(`/projects/agreements/${id}/email-invite/`);
      toast.success("Invite sent to homeowner.");
    } catch (e) {
      console.error(e);
      toast.error("Failed to send invite.");
    }
  }

  function copyHomeownerLink() {
    const token = agreement?.homeowner_access_token;
    if (!token) return toast.error("Missing sign token.");
    const url = `${window.location.origin}/agreements/sign/${id}?token=${encodeURIComponent(token)}`;
    navigator.clipboard?.writeText(url);
    toast.success("Sign link copied.");
  }

  function downloadPDF() {
    window.open(`/api/projects/agreements/${id}/pdf/`, "_blank");
  }

  if (loading) return <div className="p-6">Loading…</div>;
  if (!agreement) return <div className="p-6 text-red-600">Agreement not found.</div>;

  const projectTitle = title;
  const homeownerName =
    agreement.homeowner_name ||
    agreement.project?.homeowner?.full_name ||
    agreement.project?.homeowner?.name ||
    "";

  return (
    <div className="max-w-5xl mx-auto p-6">
      <button onClick={() => navigate("/agreements")} className="text-blue-700 hover:underline">
        ← Back to Agreements
      </button>

      <h1 className="mt-2 text-3xl font-bold text-gray-800">Edit Agreement #{agreement.id}</h1>
      <p className="text-gray-500">
        Status:{" "}
        <span className="font-semibold capitalize">{(agreement.status || "draft").replace("_", " ")}</span>
      </p>

      {/* Escrow disclaimer banner */}
      <div className="mt-4 rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-900">
        <strong>Important:</strong> If the total project amount is not deposited into escrow as required,
        this agreement is <em>null and void</em>. Do not commence work until escrow is funded.
      </div>

      {/* Signature status with ✅ / ❌ */}
      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-lg bg-white p-4 shadow md:col-span-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="text-sm text-gray-500">Project</div>
              <div className="font-semibold">{projectTitle || "—"}</div>
            </div>
            <div>
              <div className="text-sm text-gray-500">Homeowner</div>
              <div className="font-semibold">{homeownerName || "—"}</div>
            </div>
          </div>
        </div>
        <div className="rounded-lg bg-white p-4 shadow flex flex-col items-start justify-center gap-2">
          <StatusPill ok={!!agreement.signed_by_contractor} label="Contractor" />
          <StatusPill ok={!!agreement.signed_by_homeowner} label="Homeowner" />
        </div>
      </div>

      {/* Summary */}
      <div className="mt-6 rounded-xl bg-white p-5 shadow">
        <h2 className="mb-3 text-lg font-semibold text-gray-800">Summary</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="block md:col-span-2">
            <span className="text-sm text-gray-600">Title</span>
            <input
              className="mt-1 w-full rounded border px-3 py-2"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Bathroom Remodel"
            />
          </label>

          <DateInput label="Start date" name="start" value={start} onChange={setStart} />
          <DateInput label="End date" name="end" value={end} onChange={setEnd} />

          <label className="block md:col-span-2">
            <span className="text-sm text-gray-600">Total cost</span>
            <input
              type="number"
              step="0.01"
              className="mt-1 w-full rounded border px-3 py-2"
              value={total}
              onChange={(e) => setTotal(e.target.value)}
            />
          </label>

          <div className="md:col-span-2 text-sm text-gray-600">
            Milestones total: <span className="font-semibold">${money(milestonesTotal)}</span>
          </div>
        </div>
      </div>

      {/* Milestones */}
      <div className="mt-6 rounded-xl bg-white p-5 shadow">
        <h2 className="mb-3 text-lg font-semibold text-gray-800">Milestones</h2>
        <div className="overflow-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-gray-600">Title</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-600">Scheduled</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-600">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {milestones.map((m, idx) => (
                <tr key={m.id || idx}>
                  <td className="px-3 py-2">
                    <input
                      className="w-full rounded border px-2 py-1"
                      value={m.title || ""}
                      onChange={(e) =>
                        setMilestones((arr) => arr.map((x) => (x.id === m.id ? { ...x, title: e.target.value } : x)))
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="date"
                      className="w-full rounded border px-2 py-1"
                      value={(m.scheduled_date || m.start_date || "").toString().slice(0, 10)}
                      onChange={(e) =>
                        setMilestones((arr) =>
                          arr.map((x) => (x.id === m.id ? { ...x, scheduled_date: e.target.value } : x))
                        )
                      }
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      step="0.01"
                      className="w-32 rounded border px-2 py-1 text-right"
                      value={Number(m.amount || 0)}
                      onChange={(e) =>
                        setMilestones((arr) =>
                          arr.map((x) => (x.id === m.id ? { ...x, amount: e.target.value } : x))
                        )
                      }
                    />
                  </td>
                </tr>
              ))}
              {milestones.length === 0 && (
                <tr>
                  <td className="px-3 py-6 text-center text-gray-500" colSpan={3}>
                    No milestones yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Signature actions */}
      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl bg-white p-5 shadow">
          <h3 className="font-semibold mb-2">Sign as Contractor</h3>
          <div className="flex gap-2">
            <input
              className="flex-1 rounded border px-3 py-2"
              placeholder="Type your full name"
              value={signName}
              onChange={(e) => setSignName(e.target.value)}
            />
            <button
              className="rounded bg-emerald-600 text-white px-4 py-2 hover:bg-emerald-700"
              onClick={signAsContractor}
            >
              Sign
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-500">Your IP and timestamp will be recorded upon signature.</p>
        </div>

        <div className="rounded-xl bg-white p-5 shadow">
          <h3 className="font-semibold mb-2">Homeowner Signature</h3>
          <div className="flex flex-wrap gap-2">
            <button className="rounded bg-blue-600 text-white px-4 py-2 hover:bg-blue-700" onClick={sendHomeownerInvite}>
              Send Invite Email
            </button>
            <button className="rounded border px-4 py-2 hover:bg-gray-50" onClick={copyHomeownerLink}>
              Copy Sign Link
            </button>
            <button className="rounded border px-4 py-2 hover:bg-gray-50" onClick={downloadPDF}>
              Download PDF
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-500">The homeowner can sign via the emailed link or the copied link.</p>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          className="rounded bg-blue-600 px-5 py-2 font-semibold text-white hover:bg-blue-700 disabled:bg-blue-300"
          onClick={saveAgreement}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save Changes"}
        </button>
        <button className="rounded border px-5 py-2 font-semibold hover:bg-gray-50" onClick={() => navigate("/agreements")}>
          Cancel
        </button>
      </div>
    </div>
  );
}
