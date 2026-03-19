// src/pages/TeamPage.jsx
// v2026-01-09 — add Supervisor role option (employee_supervisor)
// (keeps the robust list parsing + /app/dashboard back button)

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import { useWhoAmI } from "../hooks/useWhoAmI";

const ROLE_OPTIONS = [
  { value: "employee_readonly", label: "Read-only" },
  { value: "employee_milestones", label: "Milestones (can mark complete)" },
  { value: "employee_supervisor", label: "Supervisor (manage assigned agreements/teams)" }, // ✅ NEW
];

function normalizeListResponse(data) {
  // Supports:
  // 1) plain array: [...]
  // 2) DRF pagination: { results: [...] }
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.results)) return data.results;
  return [];
}

export default function TeamPage() {
  const navigate = useNavigate();
  const { data: identity, loading: whoLoading, error: whoError } = useWhoAmI();

  const isContractor = useMemo(
    () => String(identity?.type || "").toLowerCase() === "contractor",
    [identity?.type]
  );

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

      const list = normalizeListResponse(res.data);
      setSubaccounts(list);
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
      const newSub = res.data;

      setSubaccounts((prev) => [newSub, ...prev]);
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
      const saved = res.data;
      setSubaccounts((prev) => prev.map((s) => (s.id === sub.id ? saved : s)));
    } catch (err) {
      console.error("Error toggling active state", err?.response || err);
      alert("Unable to update employee status.");
    }
  }

  async function handleChangeRole(sub, newRole) {
    try {
      const res = await api.patch(`/projects/subaccounts/${sub.id}/`, {
        role: newRole,
      });
      const saved = res.data;
      setSubaccounts((prev) => prev.map((s) => (s.id === sub.id ? saved : s)));
    } catch (err) {
      console.error("Error changing role", err?.response || err);
      alert("Unable to change role.");
    }
  }

  async function handleDelete(sub) {
    const confirmed = window.confirm(
      `Permanently delete ${sub.display_name || "this employee"}?\n\n` +
        `This cannot be undone. If deletion is blocked, deactivate instead.`
    );
    if (!confirmed) return;

    try {
      setDeletingId(sub.id);
      await api.delete(`/projects/subaccounts/${sub.id}/`);
      setSubaccounts((prev) => prev.filter((s) => s.id !== sub.id));
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
        <h1 className="text-xl font-semibold mb-2">Team Management</h1>
        <p className="text-red-500 text-sm">
          Only contractors can manage team members.
        </p>
      </div>
    );
  }

  const contractorName = identity?.email || "Contractor";

  return (
    <div className="p-4 md:p-6 space-y-6">
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Your Team</h1>
          <p className="mhb-helper-text mt-4">
            Create employee logins and manage access.
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Signed in as <span className="font-medium">{contractorName}</span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchSubaccounts}
            className="inline-flex items-center px-3 py-2 text-sm font-semibold rounded-md border bg-white hover:bg-gray-50"
            type="button"
          >
            Refresh employees
          </button>

          <button
            onClick={() => navigate("/app/dashboard")}
            className="inline-flex items-center px-3 py-2 text-sm font-semibold rounded-md bg-slate-800 text-white hover:bg-slate-900"
            type="button"
          >
            ← Back to Dashboard
          </button>
        </div>
      </header>

      {/* Add employee */}
      <section className="bg-white border rounded-xl shadow-sm p-4 md:p-5">
        <h2 className="text-sm font-semibold text-gray-800 mb-3">
          Add Employee
        </h2>

        <form
          onSubmit={handleCreate}
          className="grid grid-cols-1 md:grid-cols-2 gap-4"
        >
          <input
            name="display_name"
            value={form.display_name}
            onChange={handleChange}
            placeholder="Display name"
            className="border rounded-md px-3 py-2 text-sm"
          />
          <input
            name="email"
            type="email"
            value={form.email}
            onChange={handleChange}
            placeholder="Email"
            className="border rounded-md px-3 py-2 text-sm"
          />
          <select
            name="role"
            value={form.role}
            onChange={handleChange}
            className="border rounded-md px-3 py-2 text-sm"
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
            className="border rounded-md px-3 py-2 text-sm"
          />
          <textarea
            name="notes"
            value={form.notes}
            onChange={handleChange}
            rows={2}
            placeholder="Optional notes"
            className="border rounded-md px-3 py-2 text-sm md:col-span-2"
          />
          <div className="md:col-span-2 flex justify-end">
            <button
              disabled={creating}
              className="px-4 py-2 rounded-md bg-blue-600 text-white font-semibold disabled:opacity-50"
              type="submit"
            >
              {creating ? "Creating…" : "Create Employee"}
            </button>
          </div>
        </form>
      </section>

      {/* Team list */}
      <section className="bg-white border rounded-xl shadow-sm">
        <div className="px-4 py-3 border-b font-semibold">
          Team Members ({subaccounts.length})
        </div>

        {subsError ? (
          <div className="px-4 py-3 text-sm text-red-700">{subsError}</div>
        ) : null}

        {loadingSubs ? (
          <div className="px-4 py-4 text-sm text-gray-500">Loading…</div>
        ) : subaccounts.length === 0 ? (
          <div className="px-4 py-4 text-sm text-gray-500">
            No employees yet. Create one above.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-2 text-left">Name</th>
                  <th className="px-4 py-2 text-left">Email</th>
                  <th className="px-4 py-2 text-left">Role</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {subaccounts.map((sub) => (
                  <tr key={sub.id} className="border-t">
                    <td className="px-4 py-2">{sub.display_name || "—"}</td>
                    <td className="px-4 py-2">{sub.email || "—"}</td>
                    <td className="px-4 py-2">
                      <select
                        value={sub.role}
                        onChange={(e) => handleChangeRole(sub, e.target.value)}
                        className="border rounded-md px-2 py-1 text-xs"
                      >
                        {ROLE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2">
                      {sub.is_active ? "Active" : "Inactive"}
                    </td>
                    <td className="px-4 py-2 text-right space-x-2">
                      <button
                        onClick={() => handleToggleActive(sub)}
                        className="px-3 py-1.5 text-xs rounded-md border"
                        type="button"
                      >
                        {sub.is_active ? "Deactivate" : "Activate"}
                      </button>
                      <button
                        onClick={() => handleDelete(sub)}
                        disabled={deletingId === sub.id}
                        className="px-3 py-1.5 text-xs rounded-md border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50"
                        type="button"
                      >
                        {deletingId === sub.id ? "Deleting…" : "Delete"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
