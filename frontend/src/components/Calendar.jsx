import React, { useMemo, useState, useEffect } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import api from "../api";
import MilestoneModal from "./MilestoneModal";

export default function Calendar() {
  const [events, setEvents] = useState([]);
  const [active, setActive] = useState(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data } = await api.get("/projects/milestones/");
        if (!mounted) return;

        const rows = Array.isArray(data) ? data : data?.results || [];
        const mapped = rows.map((m) => ({
          id: String(m.id),
          title: m.title ?? "Milestone",
          start: m.due_date || m.date || m.start_date || m.completion_date,
          extendedProps: m,
        }));
        setEvents(mapped);
      } catch (e) {
        console.error("Failed to load milestones for calendar.", e);
      }
    })();
    return () => (mounted = false);
  }, []);

  const handleEventClick = (info) => {
    info.jsEvent.preventDefault();
    info.jsEvent.stopPropagation();
    setActive(info.event.extendedProps);
  };

  const headerToolbar = useMemo(
    () => ({
      left: "prev,next today",
      center: "title",
      right: "dayGridMonth,dayGridWeek,dayGridDay",
    }),
    []
  );

  return (
    <div style={{ padding: 24 }}>
      <div
        style={{
          background: "white",
          borderRadius: 12,
          border: "1px solid #e5e7eb",
          padding: 16,
          position: "relative",
          zIndex: 0,
        }}
      >
        <FullCalendar
          plugins={[dayGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          headerToolbar={headerToolbar}
          height="auto"
          events={events}
          eventClick={handleEventClick}
        />
      </div>

      <MilestoneModal
        visible={!!active}
        onClose={() => setActive(null)}
        milestone={active}
      />
    </div>
  );
}
