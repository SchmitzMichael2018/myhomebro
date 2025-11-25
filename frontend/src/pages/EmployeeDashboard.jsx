// frontend/src/pages/EmployeeDashboard.jsx
// v2025-11-16 — Employee-focused milestone dashboard

import { useEffect, useMemo, useState } from "react";
import api from "../api";
import { useWhoAmI } from "../hooks/useWhoAmI";

function groupMilestones(milestones) {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const sevenDaysAhead = new Date(today);
  sevenDaysAhead.setDate(today.getDate() + 7);
  const sevenDaysAheadStr = sevenDaysAhead.toISOString().slice(0, 10);

  const parsed = milestones.map((m) => ({
    ...m,
    start_date_obj: m.start_date ? new Date(m.start_date) : null,
    completion_date_obj: m.completion_date ? new Date(m.completion_date) : null,
  }));

  const todayList = [];
  const upcoming = [];
  const recentCompleted = [];

  parsed.forEach((m) => {
    const start = m.start_date_obj;
    const isCompleted = !!m.completed;

    if (isCompleted && m.completion_date_obj) {
      // Recently completed = last 7 days
      const diffMs = today - m.completion_date_obj;
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      if (diffDays >= 0 && diffDays <= 7) {
        recentCompleted.push(m);
      }
    }

    if (!isCompleted && start) {
      const startStr = m.start_date;
      if (startStr === todayStr) {
        todayList.push(m);
      } else if (startStr > todayStr && startStr <= sevenDaysAheadStr) {
        upcoming.push(m);
      }
    }
  });

  return { todayList, upcoming, recentCompleted };
}

export default function EmployeeDashboard() {
  const { data: identity, loading: whoLoading, error: whoError } = useWhoAmI();
  const [milestones, setMilestones] = useState([]);
  const [loadingMilestones, setLoadingMilestones] = useState(true);
  const [milestoneError, setMilestoneError] = useState(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeMilestone, setActiveMilestone] = useState(null);
  const [noteText, setNoteText] = useState("");
  const [saving, setSaving] = useState(false);

  const isMilestoneEmployee =
    identity && identity.type === "subaccount" && identity.role === "employee_milestones";

  useEffect(() => {
    if (!identity || whoLoading || whoError) return;

    async function fetchMilestones() {
      try {
        setLoadingMilestones(true);
        setMilestoneError(null);

        const res = await api.get("/projects/milestones/", {
          params: {
            page_size: 250,
            ordering: "start_date",
          },
        });

        const payload = Array.isArray(res.data) ? res.data : res.data.results || [];
        setMilestones(payload);
      } catch (err) {
        setMilestoneError(err);
      } finally {
        setLoadingMilestones(false);
      }
    }

    fetchMilestones();
  }, [identity, whoLoading, whoError]);

  const { todayList, upcoming, recentCompleted } = useMemo(
    () => groupMilestones(milestones),
    [milestones]
  );

  function openDrawer(milestone) {
    setActiveMilestone(milestone);
    setNoteText("");
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setActiveMilestone(null);
    setNoteText("");
  }

  async function handleMarkComplete() {
    if (!activeMilestone || !isMilestoneEmployee) return;

    try {
      setSaving(true);
      await api.patch(`/projects/milestones/${activeMilestone.id}/`, {
        completed: true,
      });

      // Refresh local state
      setMilestones((prev) =>
        prev.map((m) =>
          m.id === activeMilestone.id ? { ...m, completed: true } : m
        )
      );
      closeDrawer();
    } catch (err) {
      console.error("Error marking milestone complete", err);
      alert("Unable to mark complete. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddNote() {
    if (!activeMilestone || !noteText.trim()) return;

    try {
      setSaving(true);
      await api.post(`/projects/milestones/${activeMilestone.id}/comments/`, {
        content: noteText.trim(),
      });
      setNoteText("");
      alert("Note added.");
    } catch (err) {
      console.error("Error adding note", err);
      alert("Unable to add note. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (whoLoading) {
    return (
      <div className="p-6">
        <p className="text-gray-500">Loading your workspace...</p>
      </div>
    );
  }

  if (whoError || !identity || identity.type !== "subaccount") {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold mb-2">Employee Dashboard</h1>
        <p className="text-red-500">
          You must be logged in as an employee to view this dashboard.
        </p>
      </div>
    );
  }

  const greetingName = identity.display_name || "Team Member";

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">
            Good {getTimeOfDayGreeting()}, {greetingName}
          </h1>
          <p className="text-gray-500">
            Here are your milestones for today and the next few days.
          </p>
        </div>
      </header>

      {/* Stats row */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Today's milestones"
          count={todayList.length}
          accent="bg-blue-500/10 text-blue-700"
        />
        <StatCard
          label="Upcoming (7 days)"
          count={upcoming.length}
          accent="bg-amber-500/10 text-amber-700"
        />
        <StatCard
          label="Recently completed"
          count={recentCompleted.length}
          accent="bg-emerald-500/10 text-emerald-700"
        />
      </section>

      {/* Sections */}
      <section className="space-y-8">
        <MilestoneSection
          title="Today's Milestones"
          loading={loadingMilestones}
          error={milestoneError}
          milestones={todayList}
          onSelect={openDrawer}
          emptyMessage="No milestones scheduled for today."
        />

        <MilestoneSection
          title="Upcoming (Next 7 Days)"
          loading={loadingMilestones}
          error={milestoneError}
          milestones={upcoming}
          onSelect={openDrawer}
          emptyMessage="No milestones scheduled in the next 7 days."
        />

        <MilestoneSection
          title="Recently Completed"
          loading={loadingMilestones}
          error={milestoneError}
          milestones={recentCompleted}
          onSelect={openDrawer}
          emptyMessage="No milestones completed in the last 7 days."
        />
      </section>

      {/* Drawer */}
      {drawerOpen && activeMilestone && (
        <Drawer onClose={closeDrawer}>
          <h2 className="text-xl font-semibold mb-2">{activeMilestone.title}</h2>
          <p className="text-sm text-gray-500 mb-4">
            Project:{" "}
            {activeMilestone.agreement?.project?.title ||
              activeMilestone.agreement?.project_title ||
              "N/A"}
          </p>

          <div className="space-y-1 text-sm mb-4">
            <p>
              <span className="font-medium">Start:</span>{" "}
              {activeMilestone.start_date || "N/A"}
            </p>
            <p>
              <span className="font-medium">Target completion:</span>{" "}
              {activeMilestone.completion_date || "N/A"}
            </p>
            <p>
              <span className="font-medium">Amount:</span>{" "}
              {activeMilestone.amount != null ? `$${activeMilestone.amount}` : "N/A"}
            </p>
            <p>
              <span className="font-medium">Status:</span>{" "}
              {activeMilestone.completed ? "Completed" : "Not completed"}
            </p>
          </div>

          <div className="mb-4">
            <p className="text-sm text-gray-700 mb-1 font-medium">Description</p>
            <p className="text-sm text-gray-600 whitespace-pre-line">
              {activeMilestone.description || "No description provided."}
            </p>
          </div>

          <div className="space-y-2 mb-4">
            <label className="text-sm font-medium text-gray-700">
              Add Note
            </label>
            <textarea
              className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring focus:ring-blue-200"
              rows={3}
              placeholder="Describe what you completed, issues you noticed, etc."
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
            />
            <button
              type="button"
              onClick={handleAddNote}
              disabled={saving || !noteText.trim()}
              className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-md bg-gray-800 text-white disabled:opacity-50"
            >
              {saving ? "Saving..." : "Add Note"}
            </button>
          </div>

          {/* Placeholder for future photo upload */}
          <div className="mb-4">
            <p className="text-sm font-medium text-gray-700 mb-1">
              Photos (coming soon)
            </p>
            <p className="text-xs text-gray-500">
              In a future update, you’ll be able to attach job-site photos here.
            </p>
          </div>

          {isMilestoneEmployee && !activeMilestone.completed && (
            <button
              type="button"
              onClick={handleMarkComplete}
              disabled={saving}
              className="inline-flex w-full justify-center items-center px-4 py-2 text-sm font-semibold rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving ? "Marking complete..." : "Mark Milestone Complete"}
            </button>
          )}

          {!isMilestoneEmployee && (
            <p className="text-xs text-gray-500 mt-2">
              You have read-only access. Only milestone employees can mark milestones
              complete.
            </p>
          )}
        </Drawer>
      )}
    </div>
  );
}

function StatCard({ label, count, accent }) {
  return (
    <div className="border rounded-xl px-4 py-3 bg-white shadow-sm flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-gray-500">
        {label}
      </span>
      <span className="text-2xl font-semibold">{count}</span>
      <span
        className={`inline-flex mt-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${accent}`}
      >
        Active
      </span>
    </div>
  );
}

function MilestoneSection({
  title,
  milestones,
  loading,
  error,
  onSelect,
  emptyMessage,
}) {
  return (
    <div className="bg-white border rounded-xl shadow-sm">
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
      </div>
      <div className="divide-y">
        {loading && (
          <div className="px-4 py-4 text-sm text-gray-500">
            Loading milestones...
          </div>
        )}
        {error && (
          <div className="px-4 py-4 text-sm text-red-500">
            Unable to load milestones.
          </div>
        )}
        {!loading && !error && milestones.length === 0 && (
          <div className="px-4 py-4 text-sm text-gray-500">{emptyMessage}</div>
        )}
        {!loading &&
          !error &&
          milestones.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onSelect(m)}
              className="w-full text-left px-4 py-3 hover:bg-gray-50 flex items-center justify-between gap-2"
            >
              <div>
                <p className="text-sm font-medium text-gray-800 truncate">
                  {m.title}
                </p>
                <p className="text-xs text-gray-500">
                  {m.start_date || "No date"} •{" "}
                  {m.amount != null ? `$${m.amount}` : "No amount"}
                </p>
              </div>
              {m.completed && (
                <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700">
                  Completed
                </span>
              )}
            </button>
          ))}
      </div>
    </div>
  );
}

function Drawer({ children, onClose }) {
  return (
    <div className="fixed inset-0 z-40 flex">
      <div
        className="flex-1 bg-black/30"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="w-full max-w-md bg-white shadow-xl h-full overflow-y-auto p-4">
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-sm font-semibold text-gray-700">Milestone Details</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-sm"
          >
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function getTimeOfDayGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}
