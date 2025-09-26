// src/components/Calendar.jsx
// v2025-09-25 hand-cursor on events + opens MilestoneDetailModal; no layout changes

import React, { useMemo, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import api from "../api";
import toast from "react-hot-toast";
import MilestoneDetailModal from "./MilestoneDetailModal";

export default function Calendar() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  const [activeMilestone, setActiveMilestone] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  React.useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data } = await api.get("/projects/milestones/", { params: { page_size: 500 } });
        const list = Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : [];
        const evts = list.map(m => {
          const start = m.start_date || m.scheduled_for || m.date;
          const end = m.completion_date || m.end_date || start;
          return {
            id: String(m.id),
            title: m.title || "Milestone",
            start,
            end,
            extendedProps: { milestone: m },
          };
        });
        setEvents(evts);
      } catch (e) {
        console.error(e);
        toast.error("Failed to load calendar.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleEventClick = (info) => {
    const m = info?.event?.extendedProps?.milestone;
    if (!m) return;
    setActiveMilestone(m);
    setModalOpen(true);
  };

  // Ensure a hand cursor for clickable events
  const eventDidMount = (arg) => {
    try {
      arg.el.style.cursor = "pointer";
    } catch {}
  };

  return (
    <div className="p-4 md:p-6">
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
        <MilestoneDetailModal
          visible={modalOpen}
          milestone={activeMilestone}
          onClose={() => {
            setModalOpen(false);
            setActiveMilestone(null);
          }}
        />
      )}
    </div>
  );
}
