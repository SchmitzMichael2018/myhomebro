// frontend/src/components/Calendar.jsx
// v2025-10-06 — status colors + legend + pointer cursor

import React, { useEffect, useState, useCallback } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import api from "../api";
import toast from "react-hot-toast";
import MilestoneEditModal from "./MilestoneEditModal";

const STATUS_COLORS = {
  draft: "#9AA0A6",            // gray
  scheduled: "#1A73E8",        // blue
  complete: "#34A853",         // green
  overdue: "#EA4335",          // red
  pending_approval: "#F9AB00", // amber
};

export default function Calendar() {
  const [events, setEvents] = useState([]);
  const [activeMilestone, setActiveMilestone] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  const loadEvents = useCallback(async () => {
    try {
      const { data } = await api.get("/projects/milestones/", { params: { page_size: 500 } });
      const list = Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : [];
      const evts = list.map((m) => {
        const start = m.start_date || m.scheduled_for || m.date || m.due_date || m.completion_date;
        const end = m.completion_date || m.due_date || start;
        const statusKey = String(m.status || "").toLowerCase() || "scheduled";
        const color = STATUS_COLORS[statusKey] || STATUS_COLORS.scheduled;
        return {
          id: String(m.id),
          title: m.title || "Milestone",
          start,
          end,
          allDay: true,
          backgroundColor: color,
          borderColor: color,
          textColor: "#fff",
          extendedProps: { milestone: m },
        };
      });
      setEvents(evts);
    } catch (e) {
      console.error(e);
      toast.error("Failed to load calendar.");
    }
  }, []);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  const handleEventClick = (info) => {
    const m = info?.event?.extendedProps?.milestone;
    if (!m) return;
    const enriched = {
      ...m,
      agreement_state: m.agreement_state ?? m.agreement_status ?? m.agreement?.state ?? m.agreement?.status,
      agreement_status: m.agreement_status ?? m.agreement_state ?? m.agreement?.status ?? m.agreement?.state,
      agreement_number: m.agreement_number || m.agreement_no || m.agreement_id || m.agreement,
      escrow_funded: !!(m.escrow_funded ?? m.escrowFunded ?? m.agreement?.escrow_funded),
      escrowFunded:  !!(m.escrow_funded ?? m.escrowFunded ?? m.agreement?.escrow_funded),
    };
    setActiveMilestone(enriched);
    setModalOpen(true);
  };

  const eventDidMount = (arg) => {
    try { arg.el.style.cursor = "pointer"; } catch {}
    const m = arg.event.extendedProps.milestone;
    if (m && arg.el) {
      arg.el.title = `${m.title || "Milestone"} — $${Number(m.amount || 0).toFixed(2)}`;
    }
  };

  const closeAndRefresh = async () => {
    setModalOpen(false);
    setActiveMilestone(null);
    await loadEvents();
  };

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-xl font-semibold">Calendar</h1>
        <Legend />
      </div>

      <FullCalendar
        plugins={[dayGridPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        headerToolbar={{
          left: "prev,next today",
          center: "title",
          right: "dayGridMonth,dayGridWeek,dayGridDay",
        }}
        events={events}
        eventClick={handleEventClick}
        eventDidMount={eventDidMount}
        height="auto"
      />

      {modalOpen && activeMilestone && (
        <MilestoneEditModal
          open={modalOpen}
          milestone={activeMilestone}
          onClose={closeAndRefresh}
          onSaved={closeAndRefresh}
        />
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex gap-3 text-sm">
      {Object.entries(STATUS_COLORS).map(([k, v]) => (
        <div key={k} className="flex items-center gap-1">
          <span style={{ background: v, width: 12, height: 12, display: "inline-block", borderRadius: 2 }} />
          <span className="capitalize">{k.replace("_", " ")}</span>
        </div>
      ))}
    </div>
  );
}
