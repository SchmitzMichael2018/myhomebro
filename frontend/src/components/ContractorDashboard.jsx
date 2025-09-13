// src/components/ContractorDashboard.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import { toast } from "react-hot-toast";
import PageShell from "./PageShell.jsx";
import StatCard from "./StatCard.jsx";
import {
  Target,
  ListTodo,
  CheckCircle2,
  BadgeDollarSign,
  BadgeCheck,
  WalletMinimal,
  FilePlus2,
  CalendarPlus,
  ImagePlus,
  SendHorizonal,
} from "lucide-react";

console.log("ContractorDashboard.jsx v2025-09-13-07:20");

function currency(n) {
  const num = Number(n) || 0;
  return num.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function ActionButton({ icon: Icon, label, onClick, variant }) {
  const cls = `mhb-btn ${variant === "primary" ? "primary" : ""}`;
  return (
    <button className={cls} onClick={onClick} type="button">
      {Icon ? <Icon size={18} /> : null}
      <span>{label}</span>
    </button>
  );
}

export default function ContractorDashboard() {
  const [milestones, setMilestones] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data } = await api.get("/projects/milestones/");
        if (!mounted) return;
        const rows = Array.isArray(data) ? data : data?.results || [];
        setMilestones(rows);
      } catch (e) {
        console.error(e);
        toast.error("Failed to load dashboard data.");
      }
    })();
    return () => (mounted = false);
  }, []);

  const stats = useMemo(() => {
    const all = milestones;
    const sum = (list) => list.reduce((acc, m) => acc + (Number(m.amount) || 0), 0);
    const norm = (s) => (s || "").toLowerCase();

    const incomplete = all.filter((m) => norm(m.status) === "incomplete");
    const completed = all.filter((m) => ["completed", "complete"].includes(norm(m.status)));

    return {
      totalCount: all.length,
      totalAmount: sum(all),
      incompleteCount: incomplete.length,
      incompleteAmount: sum(incomplete),
      completedCount: completed.length,
      completedAmount: sum(completed),

      // placeholders for invoice buckets (wire later)
      pendingCount: 0, approvedCount: 0, earnedCount: 0,
      pendingAmt: 0, approvedAmt: 0, earnedAmt: 0,
    };
  }, [milestones]);

  return (
    <PageShell
      title="Contractor Dashboard"
      subtitle="At-a-glance progress and quick drill-downs."
      showLogo
    >
      {/* Quick actions */}
      <div className="mhb-actions" style={{ marginBottom: 16 }}>
        <ActionButton
          icon={FilePlus2}
          label="Create Agreement"
          variant="primary"
          onClick={() => navigate("/agreements")}
        />
        <ActionButton
          icon={CalendarPlus}
          label="Schedule Milestone"
          onClick={() => navigate("/milestones")}
        />
        <ActionButton
          icon={ImagePlus}
          label="Upload Photos"
          onClick={() => navigate("/milestones")}
        />
        <ActionButton
          icon={SendHorizonal}
          label="Send Invoice"
          onClick={() => navigate("/invoices")}
        />
      </div>

      {/* Milestones */}
      <div className="mhb-kicker">Milestones</div>
      <div className="mhb-grid">
        <StatCard
          icon={Target}
          title="Total"
          subtitle="All milestones across your active agreements."
          amount={currency(stats.totalAmount)}
          count={stats.totalCount}
          onClick={() => navigate("/milestones")}
        />
        <StatCard
          icon={ListTodo}
          title="Incomplete"
          subtitle="Milestones not yet completed."
          amount={currency(stats.incompleteAmount)}
          count={stats.incompleteCount}
          onClick={() => navigate("/milestones?filter=incomplete")}
        />
        <StatCard
          icon={CheckCircle2}
          title="Complete"
          subtitle="Completed milestones (may be awaiting invoicing)."
          amount={currency(stats.completedAmount)}
          count={stats.completedCount}
          onClick={() => navigate("/milestones?filter=completed")}
        />
      </div>

      {/* Invoices */}
      <div className="mhb-kicker" style={{ marginTop: 20 }}>Invoices</div>
      <div className="mhb-grid">
        <StatCard
          icon={BadgeDollarSign}
          title="Pending Approval"
          subtitle="Sent to homeowner — awaiting approval."
          amount={currency(stats.pendingAmt)}
          count={stats.pendingCount}
          onClick={() => navigate("/invoices")}
        />
        <StatCard
          icon={BadgeCheck}
          title="Approved"
          subtitle="Approved by homeowner — ready for payout."
          amount={currency(stats.approvedAmt)}
          count={stats.approvedCount}
          onClick={() => navigate("/invoices")}
        />
        <StatCard
          icon={WalletMinimal}
          title="Earned"
          subtitle="Paid/released to your account."
          amount={currency(stats.earnedAmt)}
          count={stats.earnedCount}
          onClick={() => navigate("/invoices")}
        />
      </div>

      {/* Helper note */}
      <div className="mhb-glass mhb-note" style={{ marginTop: 18 }}>
        Totals above reflect current milestones and invoices. Use the cards to
        drill down, review details, upload photos, approve, or take action.
      </div>
    </PageShell>
  );
}
