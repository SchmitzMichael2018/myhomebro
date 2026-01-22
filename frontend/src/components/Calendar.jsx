// frontend/src/components/Calendar.jsx
// v2026-01-07 — Calendar
// ✅ Click milestone assignments (gray) to open milestone modal
console.log("Calendar.jsx v2026-01-07 (click assignment milestone_override)");

import React, { useEffect, useState, useCallback, useMemo } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import api from "../api";
import toast from "react-hot-toast";
import MilestoneEditModal from "./MilestoneEditModal";

import "../styles/fullcalendar-core.css";
import "../styles/fullcalendar-daygrid.css";
import "../styles/fullcalendar-timegrid.css";

const STATUS_COLORS = {
  scheduled: "#1A73E8",
  overdue: "#EA4335",
  invoiced: "#F9AB00",
  pending_approval: "#F9AB00",
  complete: "#34A853",
  paid: "#188038",
  disputed: "#F59E0B",
};

const ASSIGNMENT_ROLE_COLORS = {
  employee_supervisor: "#F59E0B",
  employee_milestones: "#6B7280",
  employee_readonly: "#9CA3AF",
  default: "#6B7280",
};

function formatCurrency(n) {
  const num = typeof n === "number" ? n : parseFloat(n);
  return Number.isNaN(num)
    ? "$0.00"
    : num.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function roleLabel(role) {
  const r = String(role || "").toLowerCase();
  if (r === "employee_supervisor") return "Supervisor";
  if (r === "employee_milestones") return "Worker";
  if (r === "employee_readonly") return "Read-only";
  return role || "Assignment";
}

function assignmentColorForRole(role) {
  const r = String(role || "").toLowerCase();
  return ASSIGNMENT_ROLE_COLORS[r] || ASSIGNMENT_ROLE_COLORS.default;
}

function escrowLabel(m) {
  if (m.escrow_released) return "Released";
  if (m.escrow_funded) return "Funded";
  return "Not Funded";
}

function stripAgreementPrefix(text, agreementNo) {
  const t = String(text || "").trim();
  if (!t) return "";
  const no = String(agreementNo || "").trim();
  const patterns = [
    /^agreement\s*#?\s*\d+\s*[-–:]\s*/i,
    /^agreement\s*#?\s*[a-z0-9-]+\s*[-–:]\s*/i,
  ];
  if (no) patterns.unshift(new RegExp(`^agreement\\s*#?\\s*${no}\\s*[-–:]\\s*`, "i"));
  for (const re of patterns) {
    if (re.test(t)) return t.replace(re, "").trim();
  }
  return t;
}

function isLateFromDates(statusKey, startISO, endISO) {
  const s = String(statusKey || "").toLowerCase();
  if (s === "paid" || s === "complete") return false;
  if (s === "overdue") return true;

  try {
    const today = new Date();
    const end = endISO ? new Date(endISO) : startISO ? new Date(startISO) : null;
    if (!end) return false;
    const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    const nowDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return endDay < nowDay;
  } catch {
    return false;
  }
}

function buildMilestoneChipLines({ viewType, agreementNo, milestoneNo, title, assignedTo, late }) {
  const cleanTitle = String(title || "Milestone").trim();
  const showAssignee = assignedTo && assignedTo !== "Unassigned";

  if (viewType === "dayGridMonth") {
    return [
      `A#${agreementNo} • M${milestoneNo}`,
      cleanTitle,
      late ? "LATE" : showAssignee ? assignedTo : "",
    ].filter(Boolean);
  }

  return [
    `Agreement #${agreementNo} • Milestone ${milestoneNo}`,
    cleanTitle,
    showAssignee ? assignedTo : "",
  ].filter(Boolean);
}

function buildAssignmentChipLines({ viewType, xp, fallbackTitle }) {
  const type = xp?.type || "assignment";
  const role = xp?.employee_role || "";
  const emp = xp?.employee_name ? `${xp.employee_name} (${roleLabel(role)})` : "";

  if (type === "milestone_override") {
    const agreementNo = xp?.agreement_number || xp?.agreement_id || "—";
    const mNo =
      xp?.milestone_order != null && xp.milestone_order !== ""
        ? String(xp.milestone_order)
        : "?";

    const mTitle = xp?.milestone_title || fallbackTitle || "Milestone";

    if (viewType === "dayGridMonth") {
      return [`A#${agreementNo} • M${mNo}`, String(mTitle), emp || null].filter(Boolean);
    }

    return [
      `Agreement #${agreementNo} • Milestone ${mNo}`,
      String(mTitle),
      emp || null,
    ].filter(Boolean);
  }

  // agreement_assignment
  const agreementNo = xp?.agreement_number || xp?.agreement_id || "—";
  const proj = xp?.project_title || fallbackTitle || "Assignment";
  if (viewType === "dayGridMonth") {
    return [`A#${agreementNo}`, String(proj), emp || null].filter(Boolean);
  }
  return [`Agreement #${agreementNo}`, String(proj), emp || null].filter(Boolean);
}

export default function Calendar() {
  const [events, setEvents] = useState([]);
  const [activeMilestone, setActiveMilestone] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  const [employeeOptions, setEmployeeOptions] = useState([]);
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [activeViewType, setActiveViewType] = useState("dayGridMonth");

  const loadEmployees = useCallback(async () => {
    try {
      const res = await api.get("/projects/subaccounts/");
      const list = Array.isArray(res.data) ? res.data : res.data?.results || [];
      setEmployeeOptions(list);
    } catch {
      setEmployeeOptions([]);
    }
  }, []);

  useEffect(() => {
    loadEmployees();
  }, [loadEmployees]);

  const loadEvents = useCallback(async () => {
    try {
      const res = await api.get("/projects/milestones/calendar/");
      const milestones = Array.isArray(res.data) ? res.data : res.data?.results || [];

      // Assignment feed
      let assignmentEvents = [];
      let assigneeByMilestoneId = {};
      try {
        const params = employeeFilter ? { subaccount_id: employeeFilter } : {};
        const aRes = await api.get("/projects/assignments/calendar/", { params });
        const evs = aRes.data?.events || [];

        assignmentEvents = evs.map((e) => {
          const role = e.extendedProps?.employee_role || "";
          const color = assignmentColorForRole(role);
          return { ...e, backgroundColor: color, borderColor: color, textColor: "#fff" };
        });

        const map = {};
        for (const ev of evs) {
          const xp = ev.extendedProps || {};
          if (xp.type === "milestone_override" && xp.milestone_id) {
            const label = xp.employee_name
              ? `${xp.employee_name} (${roleLabel(xp.employee_role)})`
              : "Assigned";
            map[String(xp.milestone_id)] = label;
          }
        }
        assigneeByMilestoneId = map;
      } catch {}

      const milestoneEvents = milestones.map((m) => {
        const statusKey = String(m.calendar_status || "scheduled").toLowerCase();
        const color = STATUS_COLORS[statusKey] || STATUS_COLORS.scheduled;

        const assignedTo = assigneeByMilestoneId[String(m.id)] || "Unassigned";
        const late = isLateFromDates(statusKey, m.start, m.end);

        const agreementNo = m.agreement_number || m.agreement_id || "—";
        const milestoneNoNum = m.order != null ? m.order : "";
        const milestoneNo = milestoneNoNum !== "" ? String(milestoneNoNum) : "?";

        const cleanMilestoneTitle = stripAgreementPrefix(m.title || "Milestone", agreementNo);

        const tooltipLines = [
          `Homeowner: ${m.homeowner_name || "N/A"}`,
          `Milestone: ${cleanMilestoneTitle || "N/A"}`,
          `Amount: ${formatCurrency(m.amount)}`,
          `Status: ${statusKey.replaceAll("_", " ")}`,
          `Assigned: ${assignedTo}`,
          `Escrow: ${escrowLabel(m)}`,
          m.invoice_status ? `Invoice: ${m.invoice_status}` : null,
        ].filter(Boolean);

        return {
          id: `M-${m.id}`,
          title: cleanMilestoneTitle,
          start: m.start,
          end: m.end,
          allDay: true,
          backgroundColor: color,
          borderColor: color,
          textColor: "#fff",
          extendedProps: {
            type: "milestone",
            milestone: m,
            statusKey,
            agreementNo,
            milestoneNo,
            cleanMilestoneTitle,
            assignedTo,
            late,
            tooltip: tooltipLines.join("\n"),
          },
        };
      });

      setEvents([...milestoneEvents, ...assignmentEvents]);
    } catch (err) {
      console.error(err);
      toast.error("Failed to load calendar.");
    }
  }, [employeeFilter]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  // ✅ UPDATED: allow clicking milestone_override assignment to open the milestone modal
  const handleEventClick = async (info) => {
    const xp = info?.event?.extendedProps || {};

    // Green milestone event
    if (xp.type === "milestone" && xp.milestone?.id) {
      try {
        const res = await api.get(`/projects/milestones/${xp.milestone.id}/`);
        setActiveMilestone(res.data);
        setModalOpen(true);
      } catch {
        toast.error("Could not load milestone details.");
      }
      return;
    }

    // Gray assignment event that points to a milestone
    if (xp.type === "milestone_override" && xp.milestone_id) {
      try {
        const res = await api.get(`/projects/milestones/${xp.milestone_id}/`);
        setActiveMilestone(res.data);
        setModalOpen(true);
      } catch {
        toast.error("Could not load milestone details.");
      }
      return;
    }

    // agreement_assignment: optional future behavior (open agreement detail)
    // if (xp.type === "agreement_assignment" && xp.agreement_id) { ... }
  };

  const renderEventContent = useCallback(
    (arg) => {
      const bg = arg.event.backgroundColor || "#1A73E8";
      const xp = arg.event.extendedProps || {};
      const isMilestone = xp.type === "milestone";
      const late = !!xp.late;

      const lines = isMilestone
        ? buildMilestoneChipLines({
            viewType: activeViewType,
            agreementNo: xp.agreementNo || "—",
            milestoneNo: xp.milestoneNo || "?",
            title: xp.cleanMilestoneTitle || arg.event.title,
            assignedTo: xp.assignedTo || "Unassigned",
            late,
          })
        : buildAssignmentChipLines({
            viewType: activeViewType,
            xp,
            fallbackTitle: arg.event.title,
          });

      const html = `
        <div style="
          display:inline-block;
          max-width:100%;
          background:${bg};
          color:#fff;
          border-radius:8px;
          padding:4px 7px;
          line-height:1.15;
          font-size:.82rem;
          font-weight:700;
          white-space:normal;
          word-break:break-word;
          box-shadow:0 1px 2px rgba(0,0,0,.18);
          border:1px solid rgba(255,255,255,.18);
        ">
          ${lines.map((l) => `<div>${l}</div>`).join("")}
        </div>
      `;
      return { html };
    },
    [activeViewType]
  );

  const headerToolbar = useMemo(
    () => ({
      left: "prev,next today",
      center: "title",
      right: "dayGridMonth,timeGridWeek,timeGridDay",
    }),
    []
  );

  return (
    <div className="p-4 md:p-6">
      <FullCalendar
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        headerToolbar={headerToolbar}
        events={events}
        eventContent={renderEventContent}
        eventClick={handleEventClick}
        eventDidMount={(arg) => {
          arg.el.title = arg.event.extendedProps?.tooltip || "";
          try {
            arg.el.style.cursor = "pointer";
          } catch {}
        }}
        datesSet={(arg) => setActiveViewType(arg.view.type)}
        eventDisplay="block"
        dayMaxEventRows={3}
        height="auto"
      />

      {modalOpen && activeMilestone && (
        <MilestoneEditModal
          open={modalOpen}
          milestone={activeMilestone}
          onClose={() => setModalOpen(false)}
          onSaved={loadEvents}
        />
      )}
    </div>
  );
}
