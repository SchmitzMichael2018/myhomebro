// src/components/Calendar.jsx
import React, { useEffect, useMemo, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import Modal from "react-modal";
import api from "../api";

// ✅ Use LOCAL vendored CSS (no package or CDN imports)
import "../styles/fullcalendar-core.css";
import "../styles/fullcalendar-daygrid.css";
import "../styles/fullcalendar-timegrid.css";

Modal.setAppElement("#root");

export default function Calendar({ onViewMilestone }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [isOpen, setIsOpen] = useState(false);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        setErr(null);

        // Auth-required endpoint (aliases are exposed at /api/…)
        const { data } = await api.get("/milestones/calendar/");

        if (!mounted) return;
        const fcEvents = (data || []).map((e) => ({
          id: String(e.id),
          title: e.title || `Milestone #${e.id}`,
          start: e.start ?? null,
          end: e.end ?? null,
          extendedProps: { customer_name: e.customer_name || null },
          // ⚠️ Do NOT set event.url — it would trigger a full navigation.
        }));
        setEvents(fcEvents);
      } catch (ex) {
        console.error("Calendar fetch error:", ex);
        if (mounted) setErr(ex);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const handleEventClick = (info) => {
    // Key fix: keep SPA, don’t navigate
    info.jsEvent.preventDefault();

    const ev = info.event;
    setSelected({
      id: ev.id,
      title: ev.title,
      start: ev.start,
      end: ev.end,
      customer_name: ev.extendedProps?.customer_name ?? null,
    });
    setIsOpen(true);
  };

  const closeModal = () => {
    setIsOpen(false);
    setSelected(null);
  };

  const headerToolbar = useMemo(() => ({
    left: "prev,next today",
    center: "title",
    right: "dayGridMonth,timeGridWeek,timeGridDay",
  }), []);

  return (
    <div className="w-full">
      {loading && <div className="text-sm opacity-70">Loading calendar…</div>}
      {err && (
        <div className="text-sm text-red-600">
          Couldn’t load calendar: {err?.message || "Unknown error"}
        </div>
      )}

      <FullCalendar
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        headerToolbar={headerToolbar}
        events={events}
        eventClick={handleEventClick}
        navLinks={false}
        selectable={false}
        editable={false}
        height="auto"
      />

      <Modal
        isOpen={isOpen}
        onRequestClose={closeModal}
        contentLabel="Milestone"
        style={{
          content: { inset: "10% 20%", borderRadius: 12, border: "1px solid #e5e7eb", padding: 24 },
          overlay: { backgroundColor: "rgba(0,0,0,0.35)" },
        }}
      >
        {selected ? (
          <div>
            <h2 className="text-xl font-semibold mb-2">
              {selected.title || `Milestone #${selected.id}`}
            </h2>
            <div className="text-sm mb-1">
              <strong>Customer:</strong> {selected.customer_name || "—"}
            </div>
            <div className="text-sm mb-1">
              <strong>Start:</strong>{" "}
              {selected.start ? new Date(selected.start).toLocaleString() : "—"}
            </div>
            <div className="text-sm mb-4">
              <strong>End:</strong>{" "}
              {selected.end ? new Date(selected.end).toLocaleString() : "—"}
            </div>

            <div className="flex gap-2">
              <button
                className="px-3 py-2 rounded bg-blue-600 text-white"
                onClick={() => {
                  if (typeof onViewMilestone === "function") onViewMilestone(selected.id);
                }}
              >
                View details
              </button>
              <button className="px-3 py-2 rounded bg-gray-200" onClick={closeModal}>
                Close
              </button>
            </div>
          </div>
        ) : (
          <div>Loading…</div>
        )}
      </Modal>
    </div>
  );
}
