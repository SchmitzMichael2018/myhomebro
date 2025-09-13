// src/components/MilestoneList.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../api";
import { toast } from "react-hot-toast";
import MilestoneModal from "./MilestoneModal";

console.log("MilestoneList.jsx v2025-09-13-05:20");

const VALID_FILTERS = new Set([
  "all",
  "incomplete",
  "completed",
  "invoiced",
  "pending_approval",
  "approved",
  "disputed",
]);

function Pill({ children, tone = "default" }) {
  const colors = {
    default: { bg: "#e5e7eb", fg: "#111827" },
    warn: { bg: "#fef3c7", fg: "#92400e" },
    good: { bg: "#dcfce7", fg: "#14532d" },
    info: { bg: "#dbeafe", fg: "#1e3a8a" },
    danger: { bg: "#fee2e2", fg: "#7f1d1d" },
  }[tone];
  return (
    <span
      style={{
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        background: colors.bg,
        color: colors.fg,
      }}
    >
      {children}
    </span>
  );
}

function toneFor(status) {
  switch ((status || "").toLowerCase()) {
    case "incomplete":
      return "info";
    case "completed":
    case "complete":
      return "good";
    case "pending_approval":
    case "awaiting_approval":
      return "warn";
    case "disputed":
      return "danger";
    case "approved":
      return "good";
    default:
      return "default";
  }
}

// $ even if backend sends "500.00" as a string
function formatUSD(val) {
  const n = Number(val);
  if (Number.isFinite(n)) {
    return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
  }
  return val || "—";
}

function fmtDate(raw) {
  if (!raw) return "";
  // "YYYY-MM-DD" or ISO → short date
  const d = new Date(raw);
  if (!isNaN(d.getTime())) {
    return d.toLocaleDateString();
  }
  return String(raw); // already a nice string
}

// Pick a date from common keys
function pickDate(m) {
  return (
    m?.due_date ||
    m?.date ||
    m?.scheduled_for ||
    m?.start_date ||
    m?.target_date ||
    m?.completion_date ||
    ""
  );
}

// Best-effort agreement number
function pickAgreementNumber(m) {
  const a = m?.agreement;
  return (
    m?.agreement_number ||
    (a && a.number) ||
    (a && a.agreement_number) ||
    (a && a.project_number) ||
    m?.agreement_id ||
    (typeof a === "number" ? a : "") ||
    (a && a.id) ||
    ""
  );
}

export default function MilestoneList() {
  const [loading, setLoading] = useState(true);
  const [milestones, setMilestones] = useState([]);
  const [active, setActive] = useState(null);

  const [searchParams, setSearchParams] = useSearchParams();
  const initialFilter = (() => {
    const f = (searchParams.get("filter") || "").toLowerCase();
    return VALID_FILTERS.has(f) ? f : "all";
  })();
  const [filter, setFilter] = useState(initialFilter);

  useEffect(() => {
    if (filter === "all") {
      const sp = new URLSearchParams(searchParams);
      sp.delete("filter");
      setSearchParams(sp, { replace: true });
    } else {
      const sp = new URLSearchParams(searchParams);
      sp.set("filter", filter);
      setSearchParams(sp, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        const { data } = await api.get("/projects/milestones/");
        if (!mounted) return;
        const rows = Array.isArray(data) ? data : data?.results || [];
        setMilestones(rows);
      } catch (err) {
        console.error("Failed to load milestones", err);
        toast.error("Failed to load milestones.");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => (mounted = false);
  }, []);

  const filtered = useMemo(() => {
    if (filter === "all") return milestones;
    return milestones.filter(
      (m) => (m.status || "incomplete").toLowerCase() === filter
    );
  }, [milestones, filter]);

  const tabs = [
    ["all", "All"],
    ["incomplete", "Incomplete"],
    ["completed", "Completed (Not Invoiced)"],
    ["invoiced", "Invoiced"],
    ["pending_approval", "Pending Approval"],
    ["approved", "Approved"],
    ["disputed", "Disputed"],
  ];

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>Milestones</h1>

      <div
        style={{
          marginTop: 14,
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        {tabs.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid #e5e7eb",
              background: filter === key ? "#111827" : "white",
              color: filter === key ? "white" : "#111827",
              cursor: "pointer",
              fontWeight: 600,
            }}
            aria-pressed={filter === key}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        style={{
          marginTop: 16,
          background: "white",
          borderRadius: 12,
          border: "1px solid #e5e7eb",
        }}
      >
        {loading ? (
          <div style={{ padding: 24 }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 24 }}>No milestones to show.</div>
        ) : (
          <table
            style={{
              width: "100%",
              borderCollapse: "separate",
              borderSpacing: 0,
              fontSize: 14,
            }}
          >
            <thead>
              <tr style={{ background: "#f9fafb" }}>
                <th style={{ textAlign: "left", padding: 12 }}>Title</th>
                <th style={{ textAlign: "left", padding: 12 }}>Agreement #</th>
                <th style={{ textAlign: "left", padding: 12 }}>Due / Date</th>
                <th style={{ textAlign: "left", padding: 12 }}>Amount</th>
                <th style={{ textAlign: "left", padding: 12 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => {
                const due = pickDate(m);
                const agNum = pickAgreementNumber(m);
                const stat = (m.status || "incomplete").replaceAll("_", " ");
                return (
                  <tr
                    key={m.id}
                    onClick={() => setActive(m)}
                    onKeyDown={(e) => e.key === "Enter" && setActive(m)}
                    tabIndex={0}
                    style={{
                      borderTop: "1px solid #f3f4f6",
                      cursor: "pointer",
                    }}
                    title="View milestone details"
                  >
                    <td style={{ padding: 12, fontWeight: 600 }}>{m.title}</td>
                    <td style={{ padding: 12 }}>{agNum || "—"}</td>
                    <td style={{ padding: 12 }}>{due ? fmtDate(due) : "—"}</td>
                    <td style={{ padding: 12 }}>{formatUSD(m.amount)}</td>
                    <td style={{ padding: 12 }}>
                      <Pill tone={toneFor(m.status)}>{stat}</Pill>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <MilestoneModal
        visible={!!active}
        onClose={() => setActive(null)}
        milestone={active}
      />
    </div>
  );
}
