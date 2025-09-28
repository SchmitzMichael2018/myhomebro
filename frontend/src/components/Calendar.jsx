// src/components/Calendar.jsx
// v2025-09-25-d — uses shared MilestoneEditModal; avoids "undefined" state strings

import React, { useEffect, useState, useCallback } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import api from "../api";
import toast from "react-hot-toast";
import MilestoneEditModal from "./MilestoneEditModal";

export default function Calendar() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  const [activeMilestone, setActiveMilestone] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  const loadEvents = useCallback(async () => {
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
  }, []);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  const handleEventClick = (info) => {
    const m = info?.event?.extendedProps?.milestone;
    if (!m) return;

    const enriched = {
      ...m,
      // DO NOT stringify undefined; let modal treat unknown as editable
      agreement_state: m.agreement_state ?? m.agreement_status ?? m.agreement?.state ?? m.agreement?.status,
      agreement_status: m.agreement_status ?? m.agreement_state ?? m.agreement?.status ?? m.agreement?.state,
      agreement_number: m.agreement_number || m.agreement_no || m.agreement_id || m.agreement,
      escrow_funded: !!(m.escrow_funded ?? m.escrowFunded ?? m.agreement?.escrow_funded),
      escrowFunded: !!(m.escrow_funded ?? m.escrowFunded ?? m.agreement?.escrow_funded),
    };

    setActiveMilestone(enriched);
    setModalOpen(true);
  };

  const eventDidMount = (arg) => {
    try { arg.el.style.cursor = "pointer"; } catch {}
  };

  const closeAndRefresh = async () => {
    setModalOpen(false);
    setActiveMilestone(null);
    await loadEvents();
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
        <MilestoneEditModal
          open={modalOpen}
          milestone={activeMilestone}
          onClose={closeAndRefresh}
          onSaved={closeAndRefresh}
          onMarkComplete={async () => {}}
        />
      )}
    </div>
  );
}
