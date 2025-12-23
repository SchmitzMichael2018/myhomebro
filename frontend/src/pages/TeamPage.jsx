// src/pages/TeamPage.jsx
// v2025-11-16 — Contractor team management for employee sub-accounts
// "Back to Dashboard" now returns to /dashboard

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import { useWhoAmI } from "../hooks/useWhoAmI";

const ROLE_OPTIONS = [
  { value: "employee_readonly", label: "Read-only" },
  { value: "employee_milestones", label: "Milestones (can mark complete)" },
];

export default function TeamPage() {
  const navigate = useNavigate();
  const {
    data: identity,
    loading: whoLoading,
    error: whoError,
    isContractor,
  } = useWhoAmI();

  const [subaccounts, setSubaccounts] = useState([]);
  const [loadingSubs, setLoadingSubs] = useState(true);
  const [subsError, setSubsError] = useState(null);

  const [form, setForm] = useState({
    display_name: "",
    email: "",
    role: "employee_readonly",
    password: "",
    notes: "",
  });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!isContractor || whoLoading || whoError) return;

    async function fetchSubaccounts() {
      try {
        setLoadingSubs(true);
        setSubsError(null);

        const res = await api.get("/projects/subaccounts/", {
          params: { page_size: 100 },
        });

        const payload = Array.isArray(res.data)
          ? res.data
          : res.data.results || [];
        setSubaccounts(payload);
      } catch (err) {
        setSubsError(err);
      } finally {
        setLoadingSubs(false);
      }
    }

    fetchSubaccounts();
  }, [isContractor, whoLoading, whoError]);

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
      alert(
        "Employee created. Share the login email and temporary password with them. They can change it after logging in."
      );
    } catch (err) {
      console.error("Error creating subaccount", err);
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
      const updated = {
        is_active: !sub.is_active,
      };
      const res = await api.patch(`/projects/subaccounts/${sub.id}/`, updated);
      const saved = res.data;

      setSubaccounts((prev) =>
        prev.map((s) => (s.id === sub.id ? saved : s))
      );
    } catch (err) {
      console.error("Error toggling active state", err);
      alert("Unable to update employee status. Please try again.");
    }
  }

  async function handleChangeRole(sub, newRole) {
    try {
      const res = await api.patch(`/projects/subaccounts/${sub.id}/`, {
        role: newRole,
      });
      const saved = res.data;

      setSubaccounts((prev) =>
        prev.map((s) => (s.id === sub.id ? saved : s))
      );
    } catch (err) {
      console.error("Error changing role", err);
      alert("Unable to change role. Please try again.");
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
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-semibold">Team Management</h1>
          <button
            type="button"
            onClick={() => navigate("/dashboard")}
            className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-md bg-slate-800 text-white hover:bg-slate-900"
          >
            ← Back to Dashboard
          </button>
        </div>
        <p className="text-red-500 text-sm">
          Only contractors can manage team members.
        </p>
      </div>
    );
  }

  const contractorName =
    identity?.contractor_name || identity?.email || "Contractor";

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header with Back button */}
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Your Team</h1>
          <p className="text-gray-500 text-sm">
            Create employee logins for your crew. Control who can mark
            milestones complete and who can view only.
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Signed in as{" "}
            <span className="font-medium">{contractorName}</span>
          </p>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => navigate("/dashboard")}
            className="inline-flex items-center px-3 py-2 text-xs md:text-sm font-semibold rounded-md bg-slate-800 text-white hover:bg-slate-900"
          >
            ← Back to Dashboard
          </button>
        </div>
      </header>

      {/* Create new employee form */}
      <section className="bg-white border rounded-xl shadow-sm p-4 md:p-5">
        <h2 className="text-sm font-semibold text-gray-800 mb-3">Add Employee</h2>
        <form
          onSubmit={handleCreate}
          className="grid grid-cols-1 md:grid-cols-2 gap-4"
        >
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-700">
              Display Name
            </label>
            <input
              type="text"
              name="display_name"
              value={form.display_name}
              onChange={handleChange}
              className="border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring focus:ring-blue-200"
              placeholder="e.g., Alex"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-700">Email</label>
            <input
              type="email"
              name="email"
              value={form.email}
              onChange={handleChange}
              className="border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring focus:ring-blue-200"
              placeholder="employee@example.com"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-700">
              Role / Permissions
            </label>
            <select
              name="role"
              value={form.role}
              onChange={handleChange}
              className="border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring focus:ring-blue-200"
            >
              {ROLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-700">
              Temporary Password
            </label>
            <input
              type="password"
              name="password"
              value={form.password}
              onChange={handleChange}
              className="border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring focus:ring-blue-200"
              placeholder="Set a starter password"
            />
            <p className="text-[11px] text-gray-500">
              Share this with the employee. They can change it after logging in.
            </p>
          </div>

          <div className="md:col-span-2 flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-700">Notes</label>
            <textarea
              name="notes"
              value={form.notes}
              onChange={handleChange}
              rows={2}
              className="border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring focus:ring-blue-200"
              placeholder="Optional notes (e.g., crew lead, helper, specialty)"
            />
          </div>

          <div className="md:col-span-2 flex justify-end">
            <button
              type="submit"
              disabled={creating}
              className="inline-flex items-center px-4 py-2 text-sm font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {creating ? "Creating..." : "Create Employee"}
            </button>
          </div>
        </form>
      </section>

      {/* Employee list */}
      <section className="bg-white border rounded-xl shadow-sm">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-800">
            Team Members ({subaccounts.length})
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs uppercase text-gray-500">
                <th className="text-left px-4 py-2">Name</th>
                <th className="text-left px-4 py-2">Email</th>
                <th className="text-left px-4 py-2">Role</th>
                <th className="text-left px-4 py-2">Status</th>
                <th className="text-right px-4 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loadingSubs && (
                <tr>
                  <td colSpan={5} className="px-4 py-4 text-gray-500">
                    Loading team members...
                  </td>
                </tr>
              )}
              {subsError && (
                <tr>
                  <td colSpan={5} className="px-4 py-4 text-red-500">
                    Unable to load team members.
                  </td>
                </tr>
              )}
              {!loadingSubs && !subsError && subaccounts.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-4 text-gray-500">
                    No employees yet. Add your first team member above.
                  </td>
                </tr>
              )}
              {!loadingSubs &&
                !subsError &&
                subaccounts.map((sub) => (
                  <tr key={sub.id} className="border-t">
                    <td className="px-4 py-2">{sub.display_name}</td>
                    <td className="px-4 py-2">{sub.email}</td>
                    <td className="px-4 py-2">
                      <select
                        value={sub.role}
                        onChange={(e) =>
                          handleChangeRole(sub, e.target.value)
                        }
                        className="border rounded-md px-2 py-1 text-xs focus:outline-none focus:ring focus:ring-blue-200"
                      >
                        {ROLE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${
                          sub.is_active
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {sub.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => handleToggleActive(sub)}
                        className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
                      >
                        {sub.is_active ? "Deactivate" : "Activate"}
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
