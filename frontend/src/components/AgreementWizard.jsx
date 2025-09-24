// frontend/src/components/AgreementWizard.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import api, { getAccessToken } from "../api";

/**
 * AgreementWizard.jsx — 3-step flow
 * Address inputs are shown ONLY when the checkbox is checked.
 * Project create is resilient: if the backend 400s asking for address/contractor,
 * we retry once by auto-filling from homeowner (address) and/or resolving contractor.
 *
 * Flow:
 *  0) ensure auth (token present)
 *  1) POST /api/projects/projects/                 -> { id }  (retry once on specific 400s)
 *  2) POST /api/projects/agreements/               -> { id }
 *  3) POST /api/projects/milestones/ (per item)    -> attach to agreement
 *  4) navigate(`/agreements/:id/edit`)
 */

const toISO = (v) => {
  if (!v) return "";
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const mdy = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return mdy ? `${mdy[3]}-${mdy[1]}-${mdy[2]}` : s.slice(0, 10);
};

const mkMilestone = (order) => ({
  title: "",
  description: "",
  amount: "",
  start_date: "",
  end_date: "",
  days: 0,
  hours: 0,
  minutes: 0,
  status: "incomplete",
  order,
});

export default function AgreementWizard() {
  const navigate = useNavigate();

  // Step control
  const [step, setStep] = useState(1);

  // Step 1 — project details
  const [projectName, setProjectName] = useState("");
  const [projectDesc, setProjectDesc] = useState("");
  const [projectType, setProjectType] = useState("Remodel");
  const [projectSubtype, setProjectSubtype] = useState("");

  // Homeowners dropdown
  const [homeowners, setHomeowners] = useState([]);
  const [homeownerId, setHomeownerId] = useState("");

  // Selected homeowner details (for retry-copy)
  const [homeownerDetail, setHomeownerDetail] = useState(null);

  // Address toggle + fields (RENDER ONLY when useDifferentAddress === true)
  const [useDifferentAddress, setUseDifferentAddress] = useState(false);
  const [addrStreet, setAddrStreet] = useState("");
  const [addrLine2, setAddrLine2] = useState("");
  const [addrCity, setAddrCity] = useState("");
  const [addrState, setAddrState] = useState("");
  const [addrZip, setAddrZip] = useState("");

  // Step 2 — milestones
  const [rows, setRows] = useState([mkMilestone(1)]);

  // Step 3 — review checks
  const [tosAccepted, setTosAccepted] = useState(false);
  const [ppAccepted, setPpAccepted] = useState(false);

  // Load homeowner list
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/projects/homeowners/");
        const list = Array.isArray(res.data) ? res.data : res.data?.results || [];
        setHomeowners(list);
      } catch {
        setHomeowners([]);
      }
    })();
  }, []);

  // Load homeowner detail if selected (for address copy on retry)
  useEffect(() => {
    if (!homeownerId) {
      setHomeownerDetail(null);
      return;
    }
    (async () => {
      try {
        const res = await api.get(`/projects/homeowners/${homeownerId}/`);
        setHomeownerDetail(res.data || null);
      } catch {
        setHomeownerDetail(null);
      }
    })();
  }, [homeownerId]);

  const totalCost = useMemo(
    () => rows.reduce((s, r) => s + (parseFloat(r.amount || 0) || 0), 0),
    [rows]
  );

  const totalDuration = useMemo(() => {
    // Sum explicit days/hours/minutes; if zero, fall back to end-start in days
    let days = 0, hours = 0, minutes = 0;
    rows.forEach(r => {
      const d = parseInt(r.days || 0, 10) || 0;
      const h = parseInt(r.hours || 0, 10) || 0;
      const m = parseInt(r.minutes || 0, 10) || 0;
      days += d; hours += h; minutes += m;

      if (!d && !h && !m && r.start_date && r.end_date) {
        try {
          const s = new Date(toISO(r.start_date));
          const e = new Date(toISO(r.end_date));
          if (!isNaN(s) && !isNaN(e) && e >= s) {
            const diffDays = Math.round((e - s) / (24 * 3600 * 1000));
            days += diffDays;
          }
        } catch {}
      }
    });
    hours += Math.floor(minutes / 60);
    minutes = minutes % 60;
    days += Math.floor(hours / 24);
    hours = hours % 24;
    return { days, hours, minutes };
  }, [rows]);

  const addRow = () => setRows(prev => [...prev, mkMilestone(prev.length + 1)]);
  const removeRow = (idx) =>
    setRows(prev => prev.filter((_, i) => i !== idx).map((r, i) => ({ ...r, order: i + 1 })));
  const onRowChange = (idx, key, val) => {
    setRows(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [key]: key.includes("date") ? toISO(val) : val };
      return next;
    });
  };

  async function ensureAuth() {
    const tok = getAccessToken();
    if (!tok) throw new Error("You’re not signed in. Please log in again and retry.");
  }

  // Build clean project payload (ONLY include address if checkbox is ON)
  function buildProjectPayload({ forceAddressFromHomeowner = false, contractorId = null } = {}) {
    const payload = {
      title: (projectName || "").trim(),
      description: projectDesc || "",
      ...(homeownerId ? { homeowner: Number(homeownerId) } : {}),
    };

    if (forceAddressFromHomeowner && homeownerDetail) {
      payload.project_street_address = homeownerDetail.street_address || "";
      payload.project_address_line_2 = homeownerDetail.address_line_2 || "";
      payload.project_city = homeownerDetail.city || "";
      payload.project_state = homeownerDetail.state || "";
      payload.project_zip_code = homeownerDetail.zip_code || "";
    } else if (useDifferentAddress) {
      payload.project_street_address = addrStreet || "";
      payload.project_address_line_2 = addrLine2 || "";
      payload.project_city = addrCity || "";
      payload.project_state = addrState || "";
      payload.project_zip_code = addrZip || "";
    }
    // NEVER send contractor unless we explicitly resolved it on retry
    if (contractorId) payload.contractor = contractorId;

    return payload;
  }

  // Best-effort contractor resolve (used only on retry if API demands it)
  async function resolveContractorIdOptional() {
    try {
      const me = await api.get("/projects/contractors/me/");
      if (me?.data?.id) return me.data.id;
    } catch {}
    try {
      const mine = await api.get("/projects/contractors/", { params: { mine: 1 } });
      const list = Array.isArray(mine.data) ? mine.data : mine.data?.results || [];
      if (list?.length === 1) return list[0].id;
    } catch {}
    try {
      const all = await api.get("/projects/contractors/");
      const list = Array.isArray(all.data) ? all.data : all.data?.results || [];
      if (list?.length === 1) return list[0].id;
    } catch {}
    return null; // give up silently; backend should infer, or we’ll show server error
  }

  // Inspect a 400 payload and decide whether to retry with copied address / contractor
  function needsRetryWithAddressOrContractor(errData) {
    if (!errData || typeof errData !== "object") return { address: false, contractor: false };
    const keys = Object.keys(errData);
    const address = keys.some(k =>
      ["project_street_address", "project_city", "project_state", "project_zip_code"].includes(k)
    );
    const contractor = !!errData.contractor;
    return { address, contractor };
  }

  async function handleSubmit() {
    try {
      await ensureAuth();

      if (!tosAccepted || !ppAccepted) {
        toast.error("Please accept the Terms of Service and Privacy Policy.");
        return;
      }
      if (!projectName.trim()) {
        toast.error("Please enter a Project Name.");
        setStep(1);
        return;
      }

      const cleanRows = rows
        .map(r => ({
          ...r,
          amount: Number(r.amount || 0),
          start_date: toISO(r.start_date) || null,
          end_date: toISO(r.end_date) || (toISO(r.start_date) || null), // send concrete end date
        }))
        .filter(r => r.title || r.amount || r.start_date || r.end_date);

      if (cleanRows.length === 0) {
        toast.error("Add at least one milestone.");
        setStep(2);
        return;
      }

      // 1) Create Project (first attempt: exactly as selected in UI)
      let projectId = null;
      let payload = buildProjectPayload();
      try {
        const projectResp = await api.post(
          "/projects/projects/",
          payload,
          { headers: { "Content-Type": "application/json", "Accept": "application/json" } }
        );
        projectId = projectResp?.data?.id || null;
      } catch (err) {
        // 400: inspect errors and retry once if we can repair payload
        if (err?.response?.status === 400) {
          const errData = err.response.data;
          const { address, contractor } = needsRetryWithAddressOrContractor(errData);
          // Try to repair payload: copy homeowner address, and/or resolve contractor
          let resolvedContractor = null;
          if (contractor) {
            resolvedContractor = await resolveContractorIdOptional();
          }
          if (address || contractor) {
            try {
              const repaired = buildProjectPayload({
                forceAddressFromHomeowner: address && !!homeownerDetail,
                contractorId: resolvedContractor,
              });
              const projectResp2 = await api.post(
                "/projects/projects/",
                repaired,
                { headers: { "Content-Type": "application/json", "Accept": "application/json" } }
              );
              projectId = projectResp2?.data?.id || null;
            } catch (err2) {
              // surface server details
              const d = err2?.response?.data;
              let message = "Project create failed.";
              if (typeof d === "string") message = d;
              else if (d?.detail) message = d.detail;
              else try { message = JSON.stringify(d); } catch {}
              throw new Error(message);
            }
          } else {
            // no actionable hints — surface details
            let message = "Project create failed.";
            if (typeof errData === "string") message = errData;
            else if (errData?.detail) message = errData.detail;
            else try { message = JSON.stringify(errData); } catch {}
            throw new Error(message);
          }
        } else {
          // Not a 400 — surface
          throw err;
        }
      }

      if (!projectId) throw new Error("Project creation failed (no id).");

      // overall agreement dates
      const sorted = [...cleanRows].sort((a, b) =>
        String(a.start_date || "").localeCompare(String(b.start_date || ""))
      );
      const agStart = sorted[0]?.start_date || null;
      const agEnd = sorted[sorted.length - 1]?.end_date || agStart;

      // 2) Create Agreement
      const agreementResp = await api.post(
        "/projects/agreements/",
        {
          project: projectId,
          project_type: projectType || "",
          project_subtype: projectSubtype || "",
          description: projectDesc || "",
          start: agStart,
          end: agEnd,
          milestone_count: cleanRows.length,
        },
        { headers: { "Content-Type": "application/json", "Accept": "application/json" } }
      );
      const agreementId = agreementResp?.data?.id;
      if (!agreementId) throw new Error("Agreement creation failed (no id).");

      // 3) Create milestones
      for (const r of cleanRows) {
        await api.post(
          "/projects/milestones/",
          {
            agreement: agreementId,
            title: r.title || "",
            description: r.description || "",
            start_date: r.start_date,
            end_date: r.end_date,
            amount: r.amount || 0,
            status: r.status || "incomplete",
            order: r.order || null,
            days: parseInt(r.days || 0, 10) || 0,
            hours: parseInt(r.hours || 0, 10) || 0,
            minutes: parseInt(r.minutes || 0, 10) || 0,
          },
          { headers: { "Content-Type": "application/json", "Accept": "application/json" } }
        );
      }

      toast.success("Agreement created.");
      navigate(`/agreements/${agreementId}/edit`, { replace: true });

    } catch (err) {
      console.error("Create failed:", err);
      const data = err?.response?.data;
      let message = err?.message || "Create failed.";
      if (data) {
        if (typeof data === "string") message = data;
        else if (data.detail) message = data.detail;
        else {
          try { message = JSON.stringify(data); } catch {}
        }
      }
      toast.error(message);
    }
  }

  return (
    <div className="px-6 py-8 max-w-4xl mx-auto">
      {/* Header + top Back */}
      <div className="flex items-center justify-between mb-4">
        <div className="text-2xl font-semibold">New Agreement</div>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="px-3 py-1.5 text-xs rounded-md border border-slate-300 hover:bg-slate-50"
        >
          ← Back
        </button>
      </div>

      {/* Step 1 — Project Details */}
      {step === 1 && (
        <div className="bg-white rounded-xl border p-4">
          <div className="text-lg font-semibold mb-4">Step 1: Project Details</div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Project Name</label>
              <input
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={projectName}
                onChange={e => setProjectName(e.target.value)}
                placeholder="Kitchen Remodel"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Project Type</label>
              <select
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={projectType}
                onChange={e => setProjectType(e.target.value)}
              >
                <option>Remodel</option>
                <option>Repair</option>
                <option>Installation</option>
                <option>Painting</option>
                <option>Outdoor</option>
                <option>Inspection</option>
                <option>Custom</option>
                <option>DIY Help</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Project Subtype (optional)</label>
              <input
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={projectSubtype}
                onChange={e => setProjectSubtype(e.target.value)}
                placeholder="e.g., Bathroom"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Homeowner</label>
              <select
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={homeownerId}
                onChange={e => setHomeownerId(e.target.value)}
              >
                <option value="">Select a homeowner…</option>
                {homeowners.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.full_name} {h.email ? `— ${h.email}` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1">Project Description</label>
              <textarea
                rows={3}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={projectDesc}
                onChange={e => setProjectDesc(e.target.value)}
                placeholder="Scope, materials, exclusions…"
              />
            </div>
          </div>

          {/* Address toggle */}
          <div className="mt-4">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={useDifferentAddress}
                onChange={(e) => setUseDifferentAddress(e.target.checked)}
              />
              <span>Project is at a different address than the homeowner</span>
            </label>
          </div>

          {/* Project address fields (ONLY when the checkbox is checked) */}
          {useDifferentAddress && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Street Address</label>
                <input
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  value={addrStreet}
                  onChange={e => setAddrStreet(e.target.value)}
                  placeholder="123 Main St"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Address Line 2</label>
                <input
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  value={addrLine2}
                  onChange={e => setAddrLine2(e.target.value)}
                  placeholder="Apt / Suite / Building (optional)"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">City</label>
                <input
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  value={addrCity}
                  onChange={e => setAddrCity(e.target.value)}
                  placeholder="City"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">State</label>
                <input
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  value={addrState}
                  onChange={e => setAddrState(e.target.value)}
                  placeholder="State"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">ZIP Code</label>
                <input
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  value={addrZip}
                  onChange={e => setAddrZip(e.target.value)}
                  placeholder="ZIP"
                />
              </div>
            </div>
          )}

          <div className="mt-4 flex items-center justify-between">
            <span />
            <button
              type="button"
              onClick={() => setStep(2)}
              className="px-4 py-2 text-xs rounded-md bg-blue-600 text-white"
            >
              Save & Next
            </button>
          </div>
        </div>
      )}

      {/* Step 2 — Milestones */}
      {step === 2 && (
        <div className="bg-white rounded-xl border p-4">
          <div className="text-lg font-semibold mb-4">Step 2: Milestones</div>

          {/* Context echo */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Project Name</label>
              <input className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={projectName} onChange={e=>setProjectName(e.target.value)} placeholder="Kitchen Remodel" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Project Type</label>
              <select className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={projectType} onChange={e=>setProjectType(e.target.value)}>
                <option>Remodel</option><option>Repair</option><option>Installation</option><option>Painting</option>
                <option>Outdoor</option><option>Inspection</option><option>Custom</option><option>DIY Help</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1">Project Description</label>
              <textarea rows={3} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={projectDesc} onChange={e=>setProjectDesc(e.target.value)} placeholder="Scope, materials, exclusions…" />
            </div>
          </div>

          {rows.map((r, idx) => (
            <div key={idx} className="rounded-lg border p-3 mb-3">
              <div className="text-xs font-semibold mb-2">Milestone #{idx + 1}</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="md:col-span-2">
                  <input className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    placeholder="Milestone Title" value={r.title}
                    onChange={e=>onRowChange(idx, "title", e.target.value)} />
                </div>
                <div className="md:col-span-2">
                  <input className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    placeholder="Milestone Description" value={r.description}
                    onChange={e=>onRowChange(idx, "description", e.target.value)} />
                </div>

                <div>
                  <label className="block text-xs text-slate-600 mb-1">Amount</label>
                  <input className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    placeholder="Amount" value={r.amount}
                    onChange={e=>onRowChange(idx, "amount", e.target.value)} />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-slate-600 mb-1">Start</label>
                    <input type="date" className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                      value={r.start_date} onChange={e=>onRowChange(idx,"start_date",e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-600 mb-1">End</label>
                    <input type="date" className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                      value={r.end_date} onChange={e=>onRowChange(idx,"end_date",e.target.value)} />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-xs text-slate-600 mb-1">Days</label>
                    <input type="number" min="0" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      value={r.days} onChange={e=>onRowChange(idx,"days",e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-600 mb-1">Hours</label>
                    <input type="number" min="0" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      value={r.hours} onChange={e=>onRowChange(idx,"hours",e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-600 mb-1">Minutes</label>
                    <input type="number" min="0" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      value={r.minutes} onChange={e=>onRowChange(idx,"minutes",e.target.value)} />
                  </div>
                </div>

                <div className="md:col-span-2 flex justify-between">
                  <button type="button" onClick={()=>removeRow(idx)}
                    className="px-3 py-1 text-xs rounded-md border border-rose-200 text-rose-600">
                    Remove
                  </button>
                </div>
              </div>
            </div>
          ))}

          <div className="flex items-center justify-between">
            <button type="button" onClick={() => setStep(1)}
              className="px-3 py-2 text-xs rounded-md border border-slate-300 hover:bg-slate-50">
              ← Back
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={addRow}
                className="px-3 py-2 text-xs rounded-md bg-emerald-600 text-white">
                + Add Milestone
              </button>
              <button type="button" onClick={()=>setStep(3)}
                className="px-4 py-2 text-xs rounded-md bg-blue-600 text-white">
                Save & Next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 3 — Review & Submit */}
      {step === 3 && (
        <div className="bg-white rounded-xl border p-4">
          <div className="text-lg font-semibold mb-4">Step 3: Review & Submit</div>

          <div className="mb-4">
            <div className="text-sm font-semibold mb-1">Project Details</div>
            <div className="text-sm">Project Name: <span className="font-medium">{projectName || "(Untitled)"}</span></div>
            <div className="text-sm">Type/Subtype: <span className="font-medium">{projectType}{projectSubtype ? ` – ${projectSubtype}` : ""}</span></div>
            <div className="text-sm">
              Address:{" "}
              <span className="font-medium">
                {useDifferentAddress
                  ? [addrStreet, addrLine2, addrCity, addrState, addrZip].filter(Boolean).join(", ") || "(Provided below)"
                  : "Homeowner address"}
              </span>
            </div>
          </div>

          <div className="mb-4">
            <div className="text-sm font-semibold mb-2">Milestones</div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-slate-500 border-b">
                    <th className="py-2 pr-3">#</th>
                    <th className="py-2 pr-3">Title</th>
                    <th className="py-2 pr-3">Amount</th>
                    <th className="py-2 pr-3">Start</th>
                    <th className="py-2 pr-3">End</th>
                    <th className="py-2 pr-3">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const d = Number(r.days || 0), h = Number(r.hours || 0), m = Number(r.minutes || 0);
                    const duration = (d || h || m)
                      ? `${d}d ${h}h ${m}m`
                      : (r.start_date && r.end_date)
                        ? `${Math.max(0, Math.round((new Date(toISO(r.end_date)) - new Date(toISO(r.start_date))) / (24*3600*1000)))}d 0h 0m`
                        : "0d 0h 0m";
                    return (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-2 pr-3">{i + 1}</td>
                        <td className="py-2 pr-3">{r.title || "—"}</td>
                        <td className="py-2 pr-3">${Number(r.amount || 0).toLocaleString()}</td>
                        <td className="py-2 pr-3">{r.start_date || "—"}</td>
                        <td className="py-2 pr-3">{r.end_date || (r.start_date || "—")}</td>
                        <td className="py-2 pr-3">{duration}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mb-4">
            <div className="text-sm">Total Cost: <span className="font-medium">${totalCost.toLocaleString()}</span></div>
            <div className="text-sm">Total Duration: <span className="font-medium">
              {`${totalDuration.days}d ${totalDuration.hours}h ${totalDuration.minutes}m`}
            </span></div>
            <div className="text-sm">Milestone Count: <span className="font-medium">{rows.length}</span></div>
          </div>

          <div className="mb-4 space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={tosAccepted} onChange={e=>setTosAccepted(e.target.checked)} />
              <span>I have reviewed and agree to the&nbsp;
                <a href="/static/legal/terms_of_service.txt" target="_blank" rel="noopener noreferrer" className="underline">
                  Terms of Service
                </a>.
              </span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={ppAccepted} onChange={e=>setPpAccepted(e.target.checked)} />
              <span>I have reviewed and agree to the&nbsp;
                <a href="/static/legal/privacy_policy.txt" target="_blank" rel="noopener noreferrer" className="underline">
                  Privacy Policy
                </a>.
              </span>
            </label>
            <p className="text-[11px] text-slate-500">
              You'll have a final chance to review and sign on the next screen.
            </p>
          </div>

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={()=>setStep(2)}
              className="px-3 py-2 text-xs rounded-md border border-slate-300"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              className="px-4 py-2 text-xs rounded-md bg-blue-600 text-white"
            >
              Submit & Continue to Sign
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
