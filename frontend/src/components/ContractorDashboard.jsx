import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import { ArrowRight } from "lucide-react";
import api from "../api";
import PageShell from "./PageShell.jsx";
import DashboardCard from "./dashboard/DashboardCard.jsx";
import DashboardSection from "./dashboard/DashboardSection.jsx";
import { getDashboardNextSteps } from "../lib/workflowHints.js";

const currency = (n) => Number(n || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
const norm = (v) => (v || "").toString().toLowerCase();
const parseDate = (v) => (v ? new Date(v) : null);
const validDate = (v) => v && !Number.isNaN(v.getTime());
const startOfYear = (d) => new Date(d.getFullYear(), 0, 1);
const inRange = (d, from, to) => validDate(d) && (!from || d >= from) && (!to || d <= to);
const sum = (items, key = "amount") => (items || []).reduce((a, x) => a + Number(x?.[key] || 0), 0);
const agreementAmount = (a) => Number(a?.contract_amount || a?.total_amount || a?.total_price || a?.amount || 0);
const agreementStatus = (a) =>
  String(a?.status || a?.state || "draft").replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase());
const milestoneState = (m) => norm(m?.status || m?.milestone_status || m?.state || "");
const milestoneComplete = (m) =>
  !!(
    m?.completed ||
    m?.is_completed ||
    m?.completed_at ||
    m?.completed_on ||
    m?.completed_date ||
    m?.submitted_at ||
    ["completed", "complete", "done", "finished", "review", "in_review", "pending_review", "submitted", "pending_approval", "awaiting_approval", "approval_pending"].includes(milestoneState(m))
  );
const invoiceBucket = (inv) => {
  const status = norm(inv?.status);
  const display = norm(inv?.display_status);
  const dispute = norm(inv?.dispute_status || inv?.dispute_state || inv?.latest_dispute_status || "");
  const disputed =
    (status.includes("dispute") || display.includes("dispute")) &&
    !dispute.includes("resolved") &&
    !dispute.includes("closed") &&
    !dispute.includes("dismiss");
  if (disputed) return "disputed";
  if (inv?.escrow_released || display === "paid" || ["paid", "earned", "released"].includes(status)) return "earned";
  if (["approved", "ready_to_pay"].includes(status)) return "approved";
  return "pending";
};

export default function ContractorDashboard() {
  const navigate = useNavigate();
  const reminderStorageKey = "mhb:dashboard-dismissed-reminders";
  const [who, setWho] = useState(null);
  const [contractorProfile, setContractorProfile] = useState(null);
  const [dismissedReminderKeys, setDismissedReminderKeys] = useState([]);
  const [nextBestAction, setNextBestAction] = useState(null);
  const [agreements, setAgreements] = useState([]);
  const [publicLeads, setPublicLeads] = useState([]);
  const [milestones, setMilestones] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [earnedExpenses, setEarnedExpenses] = useState([]);

  const isEmployee = String(who?.role || "").startsWith("employee_");

  useEffect(() => {
    let mounted = true;
    api.get("/projects/whoami/").then(({ data }) => mounted && setWho(data || null)).catch((e) => {
      console.error(e);
      if (mounted) setWho(null);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(reminderStorageKey) || "[]");
      setDismissedReminderKeys(Array.isArray(stored) ? stored : []);
    } catch {
      setDismissedReminderKeys([]);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!who) return;
      if (isEmployee) {
        try {
          const { data } = await api.get("/projects/employee/milestones/");
          if (mounted) setMilestones(Array.isArray(data?.milestones) ? data.milestones : []);
        } catch (e) {
          console.error(e);
        }
        return;
      }
      const [m, i, a, l, c, f, x] = await Promise.allSettled([
        api.get("/projects/milestones/"),
        api.get("/projects/invoices/"),
        api.get("/projects/agreements/"),
        api.get("/projects/contractor/public-leads/"),
        api.get("/projects/contractors/me/"),
        api.get("/projects/activity-feed/", { params: { limit: 5 } }),
        api.get("/projects/expense-requests/", { params: { include_archived: 1 } }),
      ]);
      if (!mounted) return;
      const list = (r) => (r.status === "fulfilled" ? (Array.isArray(r.value.data) ? r.value.data : r.value.data?.results || []) : []);
      setMilestones(list(m));
      setInvoices(list(i));
      setAgreements(list(a));
      setPublicLeads(list(l));
      setContractorProfile(c.status === "fulfilled" ? c.value.data || null : null);
      setNextBestAction(f.status === "fulfilled" ? f.value.data?.next_best_action || null : null);
      setEarnedExpenses(list(x).filter((item) => norm(item?.status) === "paid" || !!item?.paid_at));
      if (m.status !== "fulfilled" || i.status !== "fulfilled") toast.error("Failed to load dashboard data.");
    })().catch((e) => {
      console.error(e);
      toast.error("Failed to load dashboard data.");
    });
    return () => {
      mounted = false;
    };
  }, [isEmployee, who]);

  const headerSubtitle = isEmployee
    ? "Here are the milestones currently assigned to you."
    : "Track milestones, invoices, leads, and next actions in one place.";
  const dashboardNextSteps = useMemo(() => getDashboardNextSteps({ leads: publicLeads, agreements, milestones }), [agreements, milestones, publicLeads]);
  const onboarding = contractorProfile?.onboarding || {};
  const reminders = useMemo(() => {
    if (isEmployee) return [];
    const items = [];
    if (onboarding?.status !== "complete" && !onboarding?.first_value_reached) items.push({ key: "finish-first-agreement", title: "Complete your first agreement", message: "Finish your first project setup so MyHomeBro can tailor templates, milestones, and next steps.", cta: "Resume onboarding", action: () => navigate("/app/onboarding") });
    if (onboarding?.show_soft_stripe_prompt) items.push({ key: "connect-stripe", title: "Connect Stripe to get paid", message: "You can keep exploring, but payment collection and payouts require a connected Stripe account.", cta: "Resume Stripe setup", action: () => navigate("/app/onboarding") });
    if (agreements.length > 0 && milestones.length === 0) items.push({ key: "add-first-milestone", title: "Add your first milestone", message: "Milestones are the fastest way to turn a draft agreement into real project progress.", cta: "Open milestones", action: () => navigate("/app/milestones?new=1") });
    return items.filter((item) => !dismissedReminderKeys.includes(item.key));
  }, [agreements.length, dismissedReminderKeys, isEmployee, milestones.length, navigate, onboarding]);

  const dismissReminder = (key) => setDismissedReminderKeys((prev) => {
    const next = Array.from(new Set([...prev, key]));
    try { window.localStorage.setItem(reminderStorageKey, JSON.stringify(next)); } catch {}
    return next;
  });

  const iStats = useMemo(() => {
    const buckets = { pending: [], approved: [], earned: [], disputed: [] };
    invoices.forEach((inv) => buckets[invoiceBucket(inv)].push(inv));
    return { pendingAmount: sum(buckets.pending), approvedAmount: sum(buckets.approved), disputedAmount: sum(buckets.disputed) };
  }, [invoices]);

  const earnedYtdAmount = useMemo(() => {
    const from = startOfYear(new Date());
    const to = new Date();
    const escrow = invoices.filter((inv) => inv?.escrow_released).filter((inv) => inRange(parseDate(inv?.escrow_released_at || inv?.updated_at || inv?.created_at), from, to));
    const direct = invoices.filter((inv) => (!!inv?.direct_pay_paid_at || !!inv?.direct_pay_payment_intent_id || !!inv?.direct_pay_checkout_url) && (norm(inv?.status).includes("paid") || norm(inv?.display_status) === "paid")).filter((inv) => inRange(parseDate(inv?.direct_pay_paid_at || inv?.updated_at || inv?.created_at), from, to));
    const expenses = earnedExpenses.filter((ex) => inRange(parseDate(ex?.paid_at || ex?.updated_at || ex?.created_at), from, to));
    return sum(escrow) + sum(direct) + sum(expenses);
  }, [earnedExpenses, invoices]);

  const overdueItems = useMemo(() => milestones.filter((m) => validDate(parseDate(m?.completion_date)) && parseDate(m?.completion_date) < new Date() && !milestoneComplete(m)).slice(0, 4).map((m) => ({ id: `overdue-${m.id}`, title: m.title || "Overdue milestone", meta: m.agreement_title || m.project_title || "Agreement work", actionLabel: "Open milestone", onClick: () => navigate(`/app/milestones/${m.id}`) })), [milestones, navigate]);
  const waitingApprovalItems = useMemo(() => milestones.filter((m) => ["submitted", "pending_approval", "awaiting_approval", "review"].includes(milestoneState(m))).slice(0, 4).map((m) => ({ id: `approval-${m.id}`, title: m.title || "Waiting approval", meta: m.agreement_title || m.project_title || "Milestone review", actionLabel: "Review", onClick: () => navigate(`/app/milestones/${m.id}`) })), [milestones, navigate]);
  const prioritizedActions = useMemo(() => {
    const actions = [];
    if (nextBestAction) actions.push({ id: nextBestAction.action_type || "primary-next-best-action", title: nextBestAction.title, message: nextBestAction.message, cta: nextBestAction.cta_label || "Open", onClick: () => navigate(nextBestAction.navigation_target || "/app/dashboard") });
    dashboardNextSteps.slice(0, 2).forEach((step, i) => actions.push({ id: `workflow-${i}`, title: step, message: "Keep momentum on the next open workflow step.", cta: "Open agreements", onClick: () => navigate("/app/agreements") }));
    return actions.slice(0, 3);
  }, [dashboardNextSteps, navigate, nextBestAction]);

  const activeAgreementRows = useMemo(() => {
    const byAgreement = milestones.reduce((acc, m) => {
      const id = m?.agreement || m?.agreement_id;
      if (!id) return acc;
      acc[id] = acc[id] || [];
      acc[id].push(m);
      return acc;
    }, {});
    return agreements.filter((a) => !["completed", "cancelled", "archived"].includes(norm(a?.status))).slice(0, 8).map((agreement) => {
      const related = byAgreement[agreement.id] || [];
      const overdue = related.find((m) => validDate(parseDate(m?.completion_date)) && parseDate(m?.completion_date) < new Date() && !milestoneComplete(m));
      const review = related.find((m) => ["submitted", "pending_approval", "awaiting_approval", "review"].includes(milestoneState(m)));
      let nextStep = "Review agreement";
      let actionLabel = "Open agreement";
      let actionTarget = `/app/agreements/${agreement.id}`;
      if (norm(agreement?.status) === "draft") {
        nextStep = "Finish and send";
        actionTarget = `/app/agreements/${agreement.id}/wizard?step=1`;
      } else if (review) {
        nextStep = "Review submitted milestone";
        actionLabel = "Open milestone";
        actionTarget = `/app/milestones/${review.id}`;
      } else if (overdue) {
        nextStep = "Resolve overdue work";
        actionLabel = "Open milestone";
        actionTarget = `/app/milestones/${overdue.id}`;
      } else if (norm(agreement?.status) === "signed" && agreement?.escrow_funded === false) {
        nextStep = "Collect funding";
      }
      return { id: agreement.id, title: agreement.project_title || agreement.title || `Agreement #${agreement.id}`, status: agreementStatus(agreement), amount: currency(agreementAmount(agreement)), nextStep, actionLabel, actionTarget };
    });
  }, [agreements, milestones]);

  if (isEmployee) {
    return (
      <PageShell title="Dashboard" subtitle={headerSubtitle} showLogo>
        <DashboardSection title="Assigned Work" subtitle="Your current milestone workload at a glance.">
          <DashboardCard className="rounded-[28px] border-slate-300/80 bg-white shadow-[0_22px_56px_-38px_rgba(15,23,42,0.4)]">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4"><div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Assigned</div><div className="mt-2 text-3xl font-black text-slate-950">{milestones.length}</div></div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4"><div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Incomplete</div><div className="mt-2 text-3xl font-black text-slate-950">{mStats.incompleteCount}</div></div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4"><div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Rework</div><div className="mt-2 text-3xl font-black text-slate-950">{mStats.reworkCount}</div></div>
            </div>
          </DashboardCard>
        </DashboardSection>
      </PageShell>
    );
  }

  return (
    <PageShell title="Dashboard" subtitle={headerSubtitle} showLogo>
      <div className="space-y-6">
        {reminders.length ? <div className="space-y-3" data-testid="dashboard-onboarding-reminder">{reminders.map((item) => <div key={item.key} className="rounded-[28px] border border-amber-200/80 bg-gradient-to-r from-amber-50 via-white to-white px-5 py-4 shadow-[0_18px_45px_-32px_rgba(180,83,9,0.45)]"><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div><div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-700">Keep Moving</div><div className="mt-1 text-base font-semibold text-slate-950">{item.title}</div><div className="mt-1 text-sm text-slate-600">{item.message}</div></div><div className="flex items-center gap-3"><button type="button" onClick={() => dismissReminder(item.key)} className="text-sm font-semibold text-slate-500 underline-offset-4 hover:text-slate-900 hover:underline">Dismiss</button><button type="button" onClick={item.action} className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_14px_28px_-16px_rgba(15,23,42,0.8)] transition hover:bg-slate-800">{item.cta}</button></div></div></div>)}</div> : null}
        <div className="rounded-[32px] border border-white/65 bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.98),_rgba(248,250,252,0.97)_54%,_rgba(244,247,251,0.94))] p-5 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.32)] ring-1 ring-slate-200/60 sm:p-7">
          <DashboardSection eyebrow="Overview" subtitle="Money first, urgent work second, and clear next actions." className="space-y-7">
            <div data-testid="dashboard-summary-bar" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[{ label: "Earned (YTD)", value: currency(earnedYtdAmount) }, { label: "Pending Approval", value: currency(iStats.pendingAmount) }, { label: "Ready for Payout", value: currency(iStats.approvedAmount) }, { label: "Disputed", value: currency(iStats.disputedAmount) }].map((stat) => <div key={stat.label} className="rounded-[24px] border border-slate-200/70 bg-white/95 px-5 py-5 shadow-[0_14px_28px_-24px_rgba(15,23,42,0.22)] backdrop-blur"><div className="text-[9px] font-semibold uppercase tracking-[0.24em] text-slate-400">{stat.label}</div><div className="mt-3 text-[2.15rem] font-black leading-none tracking-[-0.04em] text-slate-950">{stat.value}</div></div>)}</div>
            <div className="grid items-start gap-5 xl:grid-cols-[1.48fr_0.92fr]">
              <DashboardCard testId="dashboard-needs-attention" className="overflow-hidden rounded-[28px] border-rose-100/80 bg-white p-0 shadow-[0_24px_56px_-38px_rgba(15,23,42,0.28)] ring-1 ring-rose-50/80">
                <div className="border-b border-slate-200/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.99),rgba(255,250,250,0.98),rgba(255,247,237,0.9))] px-6 py-6"><div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-rose-500">Needs Attention</div><div className="mt-2 text-[2.05rem] font-black tracking-[-0.04em] text-slate-950">Urgent work and approvals</div><div className="mt-1.5 text-sm text-slate-600">Focus here first when you open the dashboard.</div></div>
                <div className="grid gap-5 px-6 py-6 lg:grid-cols-2">
                  <div><div className="flex items-center justify-between"><div className="text-sm font-bold uppercase tracking-[0.14em] text-rose-700">Overdue Work</div><div className="rounded-full bg-rose-100 px-2.5 py-1 text-[11px] font-semibold text-rose-700">{overdueItems.length}</div></div>{overdueItems.length ? <div className="mt-3 space-y-3">{overdueItems.map((item) => <div key={item.id} className="rounded-2xl border border-rose-200/85 bg-rose-50/90 px-4 py-4 shadow-[0_14px_30px_-24px_rgba(225,29,72,0.28)]"><div className="text-sm font-semibold text-slate-950">{item.title}</div><div className="mt-1 text-sm text-slate-600">{item.meta}</div><button type="button" onClick={item.onClick} className="mt-4 inline-flex min-w-[132px] items-center justify-center rounded-2xl bg-slate-950 px-3.5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800">{item.actionLabel}</button></div>)}</div> : <div className="mt-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50/90 px-4 py-5 text-sm text-slate-600">No overdue items.</div>}</div>
                  <div><div className="flex items-center justify-between"><div className="text-sm font-bold uppercase tracking-[0.14em] text-amber-700">Waiting Approval</div><div className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-700">{waitingApprovalItems.length}</div></div>{waitingApprovalItems.length ? <div className="mt-3 space-y-3">{waitingApprovalItems.map((item) => <div key={item.id} className="rounded-2xl border border-amber-200/85 bg-amber-50/75 px-4 py-4 shadow-[0_14px_30px_-24px_rgba(217,119,6,0.18)]"><div className="text-sm font-semibold text-slate-950">{item.title}</div><div className="mt-1 text-sm text-slate-600">{item.meta}</div><button type="button" onClick={item.onClick} className="mt-4 inline-flex min-w-[132px] items-center justify-center rounded-2xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">{item.actionLabel}</button></div>)}</div> : <div className="mt-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50/90 px-4 py-5 text-sm text-slate-600">Nothing waiting for approval.</div>}</div>
                </div>
              </DashboardCard>
              <DashboardCard testId="dashboard-next-best-action" className="rounded-[28px] border-slate-300/70 bg-[linear-gradient(180deg,rgba(250,251,253,0.98),rgba(255,255,255,0.98))] p-0 shadow-[0_20px_48px_-38px_rgba(15,23,42,0.24)]">
                <div className="border-b border-slate-200/80 px-5 py-5"><div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Next Best Action</div><div className="mt-2 text-[1.9rem] font-black tracking-[-0.03em] text-slate-950">Guided next steps</div><div className="mt-1 text-sm text-slate-600">Follow the highest-value move, then the next one if needed.</div></div>
                {prioritizedActions.length ? <div className="space-y-3 px-5 py-5">{prioritizedActions.map((action, index) => <div key={action.id} className={`rounded-[24px] border px-4 py-4 ${index === 0 ? "border-slate-950 bg-slate-950 text-white shadow-[0_18px_36px_-24px_rgba(15,23,42,0.78)]" : "border-slate-200/80 bg-white/88 shadow-[0_10px_24px_-22px_rgba(15,23,42,0.16)]"}`}><div className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${index === 0 ? "text-slate-300" : "text-slate-400"}`}>{index === 0 ? "Primary" : `Then ${index + 1}`}</div><div className="mt-2 text-lg font-bold tracking-[-0.02em]">{action.title}</div><div className={`mt-2 text-sm ${index === 0 ? "text-slate-200" : "text-slate-600"}`}>{action.message}</div><div className="mt-4 flex justify-start"><button type="button" onClick={action.onClick} className={`inline-flex min-w-[132px] items-center justify-center gap-2 rounded-2xl px-3.5 py-2.5 text-sm font-semibold transition ${index === 0 ? "bg-white text-slate-950 hover:bg-slate-100" : "border border-slate-200 bg-slate-50/80 text-slate-700 hover:bg-white"}`}>{action.cta}<ArrowRight className="h-4 w-4" /></button></div></div>)}</div> : <div className="px-5 py-5"><div className="rounded-[24px] border border-dashed border-slate-200 bg-white px-4 py-5 text-sm text-slate-600">Start by creating your first agreement or opening the AI assistant.</div></div>}
              </DashboardCard>
            </div>
          </DashboardSection>
        </div>
        <DashboardSection title="Active Work" subtitle="Open agreements and the next operational move for each project." className="space-y-4">
          <DashboardCard testId="dashboard-active-work" className="rounded-[28px] border-slate-300/70 bg-white shadow-[0_20px_48px_-38px_rgba(15,23,42,0.24)]">
            {activeAgreementRows.length ? <div className="overflow-x-auto"><table className="min-w-full border-separate border-spacing-y-3 text-sm"><thead><tr className="text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500"><th className="px-3 pb-1">Project</th><th className="px-3 pb-1">Status</th><th className="px-3 pb-1">Amount</th><th className="px-3 pb-1">Next Step</th><th className="px-3 pb-1 text-right">Action</th></tr></thead><tbody>{activeAgreementRows.map((row) => <tr key={row.id} data-testid={`dashboard-active-work-row-${row.id}`}><td className="rounded-l-[20px] border-y border-l border-slate-200/80 bg-slate-50/80 px-4 py-4"><div className="font-semibold text-slate-950">{row.title}</div></td><td className="border-y border-slate-200/80 bg-slate-50/80 px-4 py-4"><span className="inline-flex rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">{row.status}</span></td><td className="border-y border-slate-200/80 bg-slate-50/80 px-4 py-4 font-semibold text-slate-950">{row.amount}</td><td className="border-y border-slate-200/80 bg-slate-50/80 px-4 py-4 text-slate-700">{row.nextStep}</td><td className="rounded-r-[20px] border-y border-r border-slate-200/80 bg-slate-50/80 px-4 py-4 text-right"><button type="button" onClick={() => navigate(row.actionTarget)} className="inline-flex min-w-[138px] items-center justify-center rounded-2xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-700 shadow-[0_10px_20px_-18px_rgba(15,23,42,0.25)] transition hover:bg-slate-100">{row.actionLabel}</button></td></tr>)}</tbody></table></div> : <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50/80 px-5 py-8 text-center"><div className="text-base font-semibold text-slate-900">No active agreements yet.</div><div className="mt-1 text-sm text-slate-600">Start a project or draft an agreement to see work appear here.</div></div>}
          </DashboardCard>
        </DashboardSection>
      </div>
    </PageShell>
  );
}
