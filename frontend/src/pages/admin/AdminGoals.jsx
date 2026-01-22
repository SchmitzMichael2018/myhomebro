import React, { useEffect, useMemo, useState } from "react";

function getAuthHeader() {
  // Try common token keys across your builds
  const token =
    localStorage.getItem("access") ||
    localStorage.getItem("access_token") ||
    localStorage.getItem("token") ||
    localStorage.getItem("jwt") ||
    "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function pct(n) {
  if (typeof n !== "number" || Number.isNaN(n)) return "0%";
  return `${Math.round(n * 100)}%`;
}

function moneyStr(v) {
  if (v === null || v === undefined) return "0.00";
  if (typeof v === "string") return v;
  return String(v);
}

export default function AdminGoals() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [data, setData] = useState(null);

  async function load() {
    setLoading(true);
    setErr("");

    try {
      const res = await fetch("/api/admin/goals/", {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeader(),
        },
        credentials: "include",
      });

      if (!res.ok) {
        const t = await res.text();
        throw new Error(`Goals API failed (${res.status}): ${t}`);
      }

      const json = await res.json();
      setData(json);
    } catch (e) {
      setErr(e?.message || "Failed to load goals.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const status = data?.salary_tracker?.status || "off_track";
  const statusLabel = useMemo(() => {
    if (status === "on_track") return "On Track";
    if (status === "at_risk") return "At Risk";
    return "Off Track";
  }, [status]);

  const statusColor = useMemo(() => {
    if (status === "on_track") return "#16a34a"; // green
    if (status === "at_risk") return "#f59e0b"; // amber
    return "#ef4444"; // red
  }, [status]);

  const target = data?.goal?.target || "0.00";
  const actual = data?.salary_tracker?.platform_fees_l12m || "0.00";
  const projection = data?.salary_tracker?.projection_annual || "0.00";
  const paceRatio = data?.salary_tracker?.pace_ratio ?? 0;

  const effectiveTakeRate = data?.derived?.effective_take_rate_l12m ?? 0;
  const impliedEscrow = data?.derived?.implied_escrow_needed_for_goal || "0.00";

  const escrow = data?.drivers?.escrow_funded_l12m || "0.00";
  const grossPaid = data?.drivers?.gross_paid_l12m || "0.00";

  const progressPct = useMemo(() => {
    const a = parseFloat(actual);
    const t = parseFloat(target);
    if (!t || Number.isNaN(a) || Number.isNaN(t)) return 0;
    return Math.max(0, Math.min(100, (a / t) * 100));
  }, [actual, target]);

  return (
    <div style={{ padding: 20, maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <h1 style={{ fontSize: 28, margin: 0 }}>Admin Goals</h1>
        <button
          onClick={load}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #ddd",
            background: "white",
            cursor: "pointer",
          }}
        >
          Refresh
        </button>
      </div>

      <div style={{ marginTop: 8, color: "#666" }}>
        Salary tracking is based on <b>actual platform fees collected</b> from receipts (rolling 12 months).
      </div>

      {loading && (
        <div style={{ marginTop: 18, padding: 14, border: "1px solid #eee", borderRadius: 12 }}>
          Loading…
        </div>
      )}

      {!loading && err && (
        <div style={{ marginTop: 18, padding: 14, border: "1px solid #fee2e2", background: "#fff1f2", borderRadius: 12 }}>
          <b>Error:</b> {err}
        </div>
      )}

      {!loading && !err && data && (
        <>
          {/* Salary Tracker */}
          <div
            style={{
              marginTop: 18,
              padding: 18,
              border: "1px solid #eee",
              borderRadius: 16,
              boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 14, color: "#666" }}>Owner Salary Progress (Rolling 12 Months)</div>
                <div style={{ fontSize: 34, fontWeight: 700, marginTop: 6 }}>
                  ${moneyStr(actual)} <span style={{ color: "#999", fontWeight: 500 }}>/ ${moneyStr(target)}</span>
                </div>
              </div>

              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 14, color: "#666" }}>Status</div>
                <div
                  style={{
                    marginTop: 6,
                    display: "inline-block",
                    padding: "6px 10px",
                    borderRadius: 999,
                    background: statusColor,
                    color: "white",
                    fontWeight: 700,
                    fontSize: 13,
                  }}
                >
                  {statusLabel} • Pace {pct(paceRatio)}
                </div>
                <div style={{ marginTop: 10, color: "#666", fontSize: 13 }}>
                  Projection (annualized from last 30 days): <b>${moneyStr(projection)}</b>
                </div>
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <div style={{ height: 10, background: "#f3f4f6", borderRadius: 999, overflow: "hidden" }}>
                <div
                  style={{
                    width: `${progressPct}%`,
                    height: "100%",
                    background: statusColor,
                    borderRadius: 999,
                    transition: "width 300ms ease",
                  }}
                />
              </div>
              <div style={{ marginTop: 8, fontSize: 13, color: "#666" }}>
                Progress: <b>{Math.round(progressPct)}%</b>
              </div>
            </div>
          </div>

          {/* Driver Metrics */}
          <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
            <div style={{ padding: 16, border: "1px solid #eee", borderRadius: 14 }}>
              <div style={{ fontSize: 13, color: "#666" }}>Effective Take Rate (L12M)</div>
              <div style={{ fontSize: 26, fontWeight: 800, marginTop: 8 }}>{pct(effectiveTakeRate)}</div>
              <div style={{ fontSize: 13, color: "#666", marginTop: 6 }}>
                Platform fees ÷ escrow funded (rolling 12 months)
              </div>
            </div>

            <div style={{ padding: 16, border: "1px solid #eee", borderRadius: 14 }}>
              <div style={{ fontSize: 13, color: "#666" }}>Escrow Funded (L12M)</div>
              <div style={{ fontSize: 26, fontWeight: 800, marginTop: 8 }}>${moneyStr(escrow)}</div>
              <div style={{ fontSize: 13, color: "#666", marginTop: 6 }}>
                Driver metric (work volume)
              </div>
            </div>

            <div style={{ padding: 16, border: "1px solid #eee", borderRadius: 14 }}>
              <div style={{ fontSize: 13, color: "#666" }}>Gross Paid Revenue (L12M)</div>
              <div style={{ fontSize: 26, fontWeight: 800, marginTop: 8 }}>${moneyStr(grossPaid)}</div>
              <div style={{ fontSize: 13, color: "#666", marginTop: 6 }}>
                From Receipt.amount_paid_cents
              </div>
            </div>

            <div style={{ padding: 16, border: "1px solid #eee", borderRadius: 14 }}>
              <div style={{ fontSize: 13, color: "#666" }}>Implied Escrow Needed</div>
              <div style={{ fontSize: 26, fontWeight: 800, marginTop: 8 }}>${moneyStr(impliedEscrow)}</div>
              <div style={{ fontSize: 13, color: "#666", marginTop: 6 }}>
                Based on your effective take rate + $300k goal
              </div>
            </div>
          </div>

          <div style={{ marginTop: 14, color: "#666", fontSize: 12 }}>
            Generated at: {data.generated_at}
          </div>
        </>
      )}
    </div>
  );
}
