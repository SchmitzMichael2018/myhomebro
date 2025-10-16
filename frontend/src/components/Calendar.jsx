// frontend/src/components/Calendar.jsx
// v2025-10-15 calendar label/tooltip cleanup (no address) + meta passed to modal
console.log("Calendar.jsx v2025-10-15-noAddress (components/Calendar.jsx)");

import React, { useEffect, useState, useCallback, useMemo } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import api from "../api";
import toast from "react-hot-toast";
import MilestoneEditModal from "./MilestoneEditModal";

/* Ensure FullCalendar CSS is bundled */
import "../styles/fullcalendar-core.css";
import "../styles/fullcalendar-daygrid.css";
import "../styles/fullcalendar-timegrid.css";

/* Status colors (match legend) */
const STATUS_COLORS = {
  draft: "#9AA0A6",
  scheduled: "#1A73E8",
  complete: "#34A853",
  overdue: "#EA4335",
  pending_approval: "#F9AB00",
};

function getLastName(name) {
  if (!name) return "";
  const parts = String(name).trim().split(/\s+/);
  return parts.length ? parts[parts.length - 1] : "";
}

function formatCurrency(n) {
  if (n === null || n === undefined || n === "") return "$0.00";
  const num = typeof n === "number" ? n : parseFloat(n);
  if (Number.isNaN(num)) return "$0.00";
  return num.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function dayDiffInclusive(startISO, endISO) {
  try {
    const s = new Date(startISO);
    const e = new Date(endISO || startISO);
    const days = Math.max(1, Math.round((e - s) / (24 * 3600 * 1000)) + 1);
    return days;
  } catch {
    return "N/A";
  }
}

export default function Calendar() {
  const [events, setEvents] = useState([]);
  const [activeMilestone, setActiveMilestone] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  const loadEvents = useCallback(async () => {
    try {
      const { data } = await api.get("/projects/milestones/", {
        params: { page_size: 500 },
      });
      const list = Array.isArray(data?.results)
        ? data.results
        : Array.isArray(data)
        ? data
        : [];

      const evts = list.map((m) => {
        const start =
          m.start_date || m.scheduled_for || m.date || m.due_date || m.completion_date;
        const end = m.completion_date || m.due_date || start;

        const statusKey = (String(m.status || "").toLowerCase() || "scheduled").replace(
          /\s+/g,
          "_"
        );
        const color = STATUS_COLORS[statusKey] || STATUS_COLORS.scheduled;

        const homeownerName =
          m.homeowner_name || m.homeowner?.name || m.customer_name || m.customer?.name || "";
        const homeownerLast = getLastName(homeownerName);

        // agreement id/number across possible shapes
        const agreementNumber =
          m.agreement_number ||
          m.agreement_no ||
          m.agreement?.number ||
          m.agreement_id ||
          m.agreement?.id ||
          m.agreement ||
          "";

        const milestoneTitle = (m.title || "Milestone").trim();
        const amount = Number(m.amount || m.price || m.total || 0);
        const description = (m.description || "").trim();
        const projectAddress = m.project_address || m.address || m.project?.address || "";

        // Escrow + agreement totals from multiple possible shapes
        const escrowFunded =
          !!(m.escrow_funded ?? m.escrowFunded ?? m.agreement?.escrow_funded);
        const agreementTotalRaw =
          m.agreement_total ??
          m.agreement?.total_cost ??
          m.agreement?.amount ??
          m.agreement?.total ??
          m.total_agreement ??
          null;

        // Visible label inside the day cell (short)
        const cellTitle = `Agreement #${agreementNumber || "—"} – ${milestoneTitle}`;

        // Hover tooltip (concise — no address here)
        const tooltipLines = [
          `Homeowner: ${homeownerName || "N/A"}`,
          `Milestone: ${milestoneTitle || "N/A"}`,
          `Amount: ${formatCurrency(amount)}`,
          `Duration: ${dayDiffInclusive(start, end)} day(s)`,
          `Status: ${(statusKey || "scheduled").replace(/_/g, " ")}`,
          `Escrow: ${escrowFunded ? "Funded" : "Not Funded"}`,
        ];
        if (agreementTotalRaw !== null && agreementTotalRaw !== undefined) {
          tooltipLines.push(`Agreement Total: ${formatCurrency(agreementTotalRaw)}`);
        }
        const tooltip = tooltipLines.join("\n");

        // helpful links for the modal (best-effort)
        const agreementDetailUrl =
          agreementNumber ? `/agreements/${agreementNumber}` : null;
        const previewLink =
          m.preview_link || m.agreement?.preview_link || m.agreement?.preview_signed_link || null;

        return {
          id: String(m.id),
          title: cellTitle,
          start,
          end,
          allDay: true,
          backgroundColor: color,
          borderColor: color,
          textColor: "#fff",
          extendedProps: {
            milestone: m,
            statusKey,
            color,
            homeownerName,
            homeownerLast,
            agreementNumber,
            milestoneTitle,
            description,
            amount,
            projectAddress,
            escrowFunded,
            agreementTotal: agreementTotalRaw,
            tooltip,
            links: {
              agreementDetailUrl,
              previewSignedUrl: previewLink, // only if backend provides it
            },
          },
        };
      });

      setEvents(evts);
    } catch (e) {
      console.error(e);
      toast.error("Failed to load calendar.");
    }
  }, []);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const handleEventClick = (info) => {
    const xp = info?.event?.extendedProps || {};
    const m = xp?.milestone;
    if (!m) return;

    // enrich + pass through extra meta for the modal header
    const enriched = {
      ...m,
      agreement_state:
        m.agreement_state ?? m.agreement_status ?? m.agreement?.state ?? m.agreement?.status,
      agreement_status:
        m.agreement_status ?? m.agreement_state ?? m.agreement?.status ?? m.agreement?.state,
      agreement_number: m.agreement_number || m.agreement_no || m.agreement_id || m.agreement,
      escrow_funded: !!(m.escrow_funded ?? m.escrowFunded ?? m.agreement?.escrow_funded),
      escrowFunded: !!(m.escrow_funded ?? m.escrowFunded ?? m.agreement?.escrow_funded),

      // meta for header
      _meta: {
        homeownerName: xp.homeownerName,
        projectAddress: xp.projectAddress,
        agreementNumber: xp.agreementNumber,
        agreementTotal: xp.agreementTotal,
        links: xp.links || {},
      },
    };

    setActiveMilestone(enriched);
    setModalOpen(true);
  };

  const eventDidMount = (arg) => {
    try {
      arg.el.style.cursor = "pointer";
      arg.el.style.color = "#fff";
    } catch {}
    const xp = arg.event.extendedProps || {};
    arg.el.title = xp.tooltip || "";
  };

  const renderEventContent = useCallback((arg) => {
    const bg = arg.event.backgroundColor || "rgba(0,0,0,.4)";
    const html = `
      <div style="
        display:inline-block;
        max-width:100%;
        background:${bg};
        color:#fff;
        border-radius:6px;
        padding:2px 6px;
        line-height:1.15;
        font-size:.82rem;
        white-space:normal;
        word-break:break-word;
      ">
        ${arg.event.title}
      </div>
    `;
    return { html };
  }, []);

  const closeAndRefresh = async () => {
    setModalOpen(false);
    setActiveMilestone(null);
    await loadEvents();
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
    <div className="p-4 md:p-6">
      {/* Prevent cut-offs */}
      <style>{`
        .fc-daygrid-event {
          white-space: normal !important;
          overflow: visible !important;
          height: auto !important;
          padding: 0 !important;
          border: none !important;
          background: transparent !important;
        }
        .fc-daygrid-day-frame,
        .fc-daygrid-day-events,
        .fc-scroller-harness,
        .fc-scroller {
          overflow: visible !important;
        }
        .fc .fc-daygrid-day-number { z-index: 1; }
      `}</style>

      <div className="flex items-center justify-between mb-3">
        <h1 className="text-xl font-semibold">Calendar</h1>
        <Legend />
      </div>

      <FullCalendar
        plugins={[dayGridPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        headerToolbar={headerToolbar}
        events={events}
        eventContent={renderEventContent}
        eventClick={handleEventClick}
        eventDidMount={eventDidMount}
        eventDisplay="block"
        dayMaxEventRows={3}
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
          <span
            style={{
              background: v,
              width: 12,
              height: 12,
              display: "inline-block",
              borderRadius: 2,
            }}
          />
          <span className="capitalize">{k.replace("_", " ")}</span>
        </div>
      ))}
    </div>
  );
}
