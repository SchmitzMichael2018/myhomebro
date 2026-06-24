// src/pages/TeamPage.jsx
// Team management page with work visibility and quick links into assignments/schedule.

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import { useWhoAmI } from "../hooks/useWhoAmI";
import ContractorPageSurface from "../components/dashboard/ContractorPageSurface.jsx";
import HubTabs from "../components/dashboard/HubTabs.jsx";
import { teamHubTabs } from "../components/dashboard/hubTabsConfig.js";

const ROLE_OPTIONS = [
  { value: "employee_readonly", label: "Read-only" },
  { value: "employee_milestones", label: "Milestones (can mark complete)" },
  { value: "employee_supervisor", label: "Supervisor (manage assigned agreements/teams)" },
];

function normalizeListResponse(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.results)) return data.results;
  return [];
}

function formatDateTime(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return String(value);
  }
}

function CountPill({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
        {label}
      </div>
      <div className="mt-2 text-2xl font-bold text-slate-900">
        {Number(value || 0).toLocaleString()}
      </div>
    </div>
  );
}

function WorkBadge({ count, tone = "neutral", label }) {
  const toneClass =
    tone === "good"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : tone === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : tone === "danger"
          ? "border-rose-200 bg-rose-50 text-rose-800"
          : "border-slate-200 bg-slate-50 text-slate-700";
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${toneClass}`}>
      {label}
      {typeof count === "number" ? <span className="ml-1">{count}</span> : null}
    </span>
  );
}

export default function TeamPage() {
  const navigate = useNavigate();
  const { data: identity, loading: whoLoading, error: whoError } = useWhoAmI();

  const isContractor = useMemo(
    () => String(identity?.type || "").toLowerCase() === "contractor",
    [identity?.type]
  );

  const attentionCounts = identity?.attention_counts || {};

  const [subaccounts, setSubaccounts] = useState([]);
  const [loadingSubs, setLoadingSubs] = useState(true);
  const [subsError, setSubsError] = useState("");

  const [form, setForm] = useState({
    display_name: "",
    email: "",
    role: "employee_readonly",
    password: "",
    notes: "",
  });
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const fetchSubaccounts = async () => {
    try {
      setLoadingSubs(true);
      setSubsError("");
      const res = await api.get("/projects/subaccounts/", {
        params: { page_size: 250, _ts: Date.now() },
        headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
      });
      setSubaccounts(normalizeListResponse(res.data));
    } catch (err) {
      console.error("fetchSubaccounts error", err?.response || err);
      const msg =
        err?.response?.data?.detail ||
        err?.response?.statusText ||
        "Unable to load employees.";
      setSubsError(String(msg));
      setSubaccounts([]);
    } finally {
      setLoadingSubs(false);
    }
  };

  useEffect(() => {
    if (whoLoading) return;
    if (whoError) return;
    if (!isContractor) return;
    fetchSubaccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whoLoading, whoError, isContractor]);

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.display_name || !form.email || !form.password) {
      alert("Display name, email, and password are required.");
      return;
    }

    try {
      setCreating(true);
      const payload = {
        display_name: form.display_name.trim(),
        email: form.email.trim(),
        role: form.role,
        password: form.password,
        is_active: true,
        notes: form.notes || "",
      };

      const res = await api.post("/projects/subaccounts/", payload);
      setSubaccounts((prev) => [res.data, ...prev]);
      setForm({
        display_name: "",
        email: "",
        role: "employee_readonly",
        password: "",
        notes: "",
      });
      alert("Employee created. Share the login email and temporary password.");
    } catch (err) {
      console.error("Error creating subaccount", err?.response || err);
      const msg =
        err.response?.data?.detail ||
        err.response?.data?.email ||
        (Array.isArray(err.response?.data?.password)
          ? err.response.data.password[0]
          : null) ||
        "Unable to create employee. Check email uniqueness and try again.";
      alert(msg);
    } finally {
      setCreating(false);
    }
  }

  async function handleToggleActive(sub) {
    try {
      const res = await api.patch(`/projects/subaccounts/${sub.id}/`, {
        is_active: !sub.is_active,
      });
      setSubaccounts((prev) => prev.map((row) => (row.id === sub.id ? res.data : row)));
    } catch (err) {
      console.error("Error toggling active state", err?.response || err);
      alert("Unable to update employee status.");
    }
  }

  async function handleChangeRole(sub, newRole) {
    try {
      const res = await api.patch(`/projects/subaccounts/${sub.id}/`, { role: newRole });
      setSubaccounts((prev) => prev.map((row) => (row.id === sub.id ? res.data : row)));
    } catch (err) {
      console.error("Error changing role", err?.response || err);
      alert("Unable to change role.");
    }
  }

  async function handleDelete(sub) {
    const confirmed = window.confirm(
      `Permanently delete ${sub.display_name || "this employee"}?\n\n` +
        "This cannot be undone. If deletion is blocked, deactivate instead."
    );
    if (!confirmed) return;

    try {
      setDeletingId(sub.id);
      await api.delete(`/projects/subaccounts/${sub.id}/`);
      setSubaccounts((prev) => prev.filter((row) => row.id !== sub.id));
    } catch (err) {
      console.error("Error deleting subaccount", err?.response || err);
      const msg =
        err.response?.data?.detail ||
        "Unable to delete employee. They may have assignment history.";
      alert(msg);
    } finally {
      setDeletingId(null);
    }
  }

  const teamSummary = useMemo(() => {
    const activeMembers = subaccounts.filter((row) => row.is_active).length;
    const activeWork = subaccounts.reduce((sum, row) => sum + Number(row.active_assignment_count || 0), 0);
    const pendingReviews = subaccounts.reduce((sum, row) => sum + Number(row.pending_review_count || 0), 0);
    const overdue = subaccounts.reduce((sum, row) => sum + Number(row.overdue_milestone_count || 0), 0);
    return { activeMembers, activeWork, pendingReviews, overdue };
  }, [subaccounts]);

  if (whoLoading) {
    return (
      <div className="p-6">
        <p className="text-gray-500">Loading your profile...</p>
      </div>
    );
  }

  if (whoError || !isContractor) {
    return (
      <div className="p-6">
        <h1 className="mb-2 text-xl font-semibold">Team Management</h1>
        <p className="text-sm text-red-500">Only contractors can manage team members.</p>
      </div>
    );
  }

  const contractorName = identity?.email || "Contractor";

  return (
    <ContractorPageSurface
      eyebrow="Team"
      title="Employees"
      subtitle="Create employee logins, review workload, and keep the team connected to current jobs."
      className="max-w-[1440px]"
      variant="operational"
    >
    <div className="space-y-6">
      <HubTabs tabs={teamHubTabs} />

      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="mt-1 text-xs text-gray-400">
            Signed in as <span className="font-medium">{contractorName}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => navigate("/app/team")}
            className="inline-flex items-center rounded-md border bg-white px-3 py-2 text-sm font-semibold hover:bg-gray-50"
            type="button"
          >
            Overview
          </button>
          <button
            onClick={fetchSubaccounts}
            className="inline-flex items-center rounded-md border bg-white px-3 py-2 text-sm font-semibold hover:bg-gray-50"
            type="button"
          >
            Refresh employees
          </button>
          <button
            onClick={() => navigate("/app/dashboard")}
            className="inline-flex items-center rounded-md bg-slate-800 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-900"
            type="button"
          >
            Back to Dashboard
          </button>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <CountPill label="Active Team" value={teamSummary.activeMembers || attentionCounts.active_subcontractor_count || 0} />
        <CountPill label="Active Work" value={teamSummary.activeWork || attentionCounts.assigned_work_count || 0} />
        <CountPill label="Awaiting Review" value={teamSummary.pendingReviews || attentionCounts.awaiting_review_count || 0} />
        <CountPill label="Overdue" value={teamSummary.overdue || attentionCounts.overdue_milestone_count || 0} />
      </section>

      <section className="bg-white border rounded-xl shadow-sm p-4 md:p-5">
        <h2 className="mb-3 text-sm font-semibold text-gray-800">Add Employee</h2>

        <form onSubmit={handleCreate} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <input
            name="display_name"
            value={form.display_name}
            onChange={handleChange}
            placeholder="Display name"
            className="rounded-md border px-3 py-2 text-sm"
          />
          <input
            name="email"
            type="email"
            value={form.email}
            onChange={handleChange}
            placeholder="Email"
            className="rounded-md border px-3 py-2 text-sm"
          />
          <select
            name="role"
            value={form.role}
            onChange={handleChange}
            className="rounded-md border px-3 py-2 text-sm"
          >
            {ROLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <input
            name="password"
            type="password"
            value={form.password}
            onChange={handleChange}
            placeholder="Temporary password"
            className="rounded-md border px-3 py-2 text-sm"
          />
          <textarea
            name="notes"
            value={form.notes}
            onChange={handleChange}
            rows={2}
            placeholder="Optional notes"
            className="md:col-span-2 rounded-md border px-3 py-2 text-sm"
          />
          <div className="md:col-span-2 flex justify-end">
            <button
              disabled={creating}
              className="rounded-md bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-50"
              type="submit"
            >
              {creating ? "Creating…" : "Create Employee"}
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-xl border bg-white shadow-sm">
        <div className="border-b px-4 py-3 font-semibold">
          Team Members ({subaccounts.length})
        </div>

        {subsError ? <div className="px-4 py-3 text-sm text-red-700">{subsError}</div> : null}

        {loadingSubs ? (
          <div className="px-4 py-4 text-sm text-gray-500">Loading…</div>
        ) : subaccounts.length === 0 ? (
          <div className="px-4 py-4 text-sm text-gray-500">
            No employees yet. Add one above to assign work and keep the team moving.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-2 text-left">Name</th>
                  <th className="px-4 py-2 text-left">Role</th>
                  <th className="px-4 py-2 text-left">Work</th>
                  <th className="px-4 py-2 text-left">Last Activity</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {subaccounts.map((sub) => {
                  const workCount = Number(sub.active_assignment_count || 0);
                  const pendingReviewCount = Number(sub.pending_review_count || 0);
                  const overdueCount = Number(sub.overdue_milestone_count || 0);
                  const statusTone = sub.is_active ? "good" : "neutral";

                  return (
                    <tr key={sub.id} data-testid={`team-member-row-${sub.id}`} className="border-t">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-gray-900">{sub.display_name || "—"}</div>
                        <div className="mt-1 text-xs text-gray-500">{sub.email || "—"}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm text-gray-800">{sub.role_label || sub.role || "—"}</div>
                        <div className="mt-1 text-xs text-gray-500">
                          Assignments: {Number(sub.assignment_count || 0)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <WorkBadge count={workCount} label="Active" tone={workCount > 0 ? "good" : "neutral"} />
                          <WorkBadge
                            count={pendingReviewCount}
                            label="Awaiting Review"
                            tone={pendingReviewCount > 0 ? "warn" : "neutral"}
                          />
                          <WorkBadge count={overdueCount} label="Overdue" tone={overdueCount > 0 ? "danger" : "neutral"} />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        <div>{formatDateTime(sub.last_activity_at || sub.last_login)}</div>
                        {sub.last_login ? (
                          <div className="mt-1 text-xs text-gray-500">Last login {formatDate(sub.last_login)}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${
                            statusTone === "good"
                              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                              : "border-slate-200 bg-slate-50 text-slate-700"
                          }`}
                        >
                          {sub.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex flex-wrap justify-end gap-2">
                          <button
                            onClick={() => navigate(`/app/team/assignments?subaccount=${sub.id}`)}
                            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            type="button"
                          >
                            View Work
                          </button>
                          <button
                            onClick={() => navigate(`/app/team/schedule?subaccount=${sub.id}`)}
                            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            type="button"
                          >
                            Schedule
                          </button>
                          <button
                            onClick={() => handleToggleActive(sub)}
                            className="rounded-md border px-3 py-1.5 text-xs font-semibold"
                            type="button"
                          >
                            {sub.is_active ? "Deactivate" : "Activate"}
                          </button>
                          <button
                            onClick={() => handleDelete(sub)}
                            disabled={deletingId === sub.id}
                            className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                            type="button"
                          >
                            {deletingId === sub.id ? "Deleting…" : "Delete"}
                          </button>
                        </div>
                        <div className="mt-2 text-xs text-gray-500">
                          Role can be changed inline after creation.
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
    </ContractorPageSurface>
  );
}
