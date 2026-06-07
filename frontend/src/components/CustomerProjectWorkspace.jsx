import React, { useMemo, useState } from "react";
import { CheckCircle2, ExternalLink, FileText, MessageSquare } from "lucide-react";
import toast from "react-hot-toast";

import api from "../api";

function money(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString("en-US", { style: "currency", currency: "USD" }) : "$0.00";
}

function formatDate(value) {
  if (!value) return "Date pending";
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return String(value);
  }
}

function statusTone(status = "") {
  const value = String(status).toLowerCase();
  if (value.includes("complete") || value.includes("paid") || value.includes("signed") || value.includes("released")) return "emerald";
  if (value.includes("review") || value.includes("draft") || value.includes("pending") || value.includes("submitted")) return "amber";
  if (value.includes("dispute") || value.includes("change")) return "rose";
  return "slate";
}

function Badge({ children, tone = "slate" }) {
  const tones = {
    emerald: "border-emerald-300/40 bg-emerald-400/10 text-emerald-100",
    amber: "border-amber-300/40 bg-amber-400/10 text-amber-100",
    rose: "border-rose-300/40 bg-rose-400/10 text-rose-100",
    gold: "border-amber-300/50 bg-amber-300/15 text-amber-100",
    slate: "border-slate-500/40 bg-slate-800/80 text-slate-200",
  };
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${tones[tone] || tones.slate}`}>
      {children}
    </span>
  );
}

function Section({ title, eyebrow, children, testId }) {
  return (
    <section data-testid={testId} className="rounded-2xl border border-slate-700/80 bg-slate-950/55 p-5 shadow-xl shadow-slate-950/20">
      {eyebrow ? <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-200/80">{eyebrow}</div> : null}
      <h3 className="mt-1 text-lg font-semibold text-white">{title}</h3>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function extractMagicDrawToken(actionTarget = "") {
  const match = String(actionTarget || "").match(/\/draws\/magic\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

function isInvoicePayment(payment) {
  const type = String(payment?.record_type || payment?.record_type_label || "").toLowerCase();
  return type.includes("invoice");
}

function isPaidPayment(payment) {
  const status = String(payment?.status || payment?.status_label || "").toLowerCase();
  return status.includes("paid") || status.includes("released");
}

function normalizeInvoiceMagicUrl(actionTarget = "") {
  const value = String(actionTarget || "");
  const invoiceMatch = value.match(/\/invoice\/([^/?#]+)/);
  if (invoiceMatch) return `/invoices/magic/${encodeURIComponent(decodeURIComponent(invoiceMatch[1]))}`;
  const magicMatch = value.match(/\/invoices\/magic\/([^/?#]+)/);
  if (magicMatch) return `/invoices/magic/${encodeURIComponent(decodeURIComponent(magicMatch[1]))}`;
  return value;
}

function isReviewablePayment(payment) {
  const status = String(payment?.status || payment?.status_label || "").toLowerCase();
  const type = String(payment?.record_type || payment?.record_type_label || "").toLowerCase();
  return type.includes("draw") && (status.includes("submitted") || status.includes("review") || status.includes("pending"));
}

function hasOpenDispute(payment) {
  const value = String(payment?.dispute_status || payment?.dispute_status_label || "").toLowerCase();
  return value && !value.includes("no dispute") && value !== "none";
}

function ProjectReviewCard({ payment, token, onPortalUpdate }) {
  const [acting, setActing] = useState("");
  const [showChanges, setShowChanges] = useState(false);
  const [showDispute, setShowDispute] = useState(false);
  const [note, setNote] = useState("");
  const [disputeReason, setDisputeReason] = useState("Work needs correction");
  const [disputeNote, setDisputeNote] = useState("");
  const drawToken = extractMagicDrawToken(payment?.action_target);
  const drawId = payment?.record_id || String(payment?.id || "").replace(/^draw-/, "");
  const canOpenPortalDispute = Boolean(token && drawId);
  const disputeIsOpen = hasOpenDispute(payment);

  const approve = async () => {
    if (!drawToken) {
      window.open(payment?.action_target || "#", "_blank", "noopener,noreferrer");
      return;
    }
    setActing("approve");
    try {
      await api.patch(`/projects/draws/magic/${encodeURIComponent(drawToken)}/approve/`, {});
      toast.success("Milestone review approved.");
      onPortalUpdate?.();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not approve that review.");
    } finally {
      setActing("");
    }
  };

  const requestChanges = async () => {
    if (!drawToken) {
      window.open(payment?.action_target || "#", "_blank", "noopener,noreferrer");
      return;
    }
    setActing("changes");
    try {
      await api.patch(`/projects/draws/magic/${encodeURIComponent(drawToken)}/request_changes/`, { note });
      toast.success("Change request sent.");
      setShowChanges(false);
      setNote("");
      onPortalUpdate?.();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not send that change request.");
    } finally {
      setActing("");
    }
  };

  const openDispute = async () => {
    if (!canOpenPortalDispute) {
      window.open(
        `${payment?.action_target || "#"}${String(payment?.action_target || "").includes("?") ? "&" : "?"}action=dispute`,
        "_blank",
        "noopener,noreferrer"
      );
      return;
    }
    setActing("dispute");
    try {
      const { data } = await api.post(
        `/projects/customer-portal/${encodeURIComponent(token)}/draws/${encodeURIComponent(drawId)}/dispute/`,
        {
          reason: disputeReason,
          description: disputeNote,
        }
      );
      if (data?.portal) {
        onPortalUpdate?.(data.portal);
      } else {
        onPortalUpdate?.();
      }
      toast.success("Dispute opened.");
      setShowDispute(false);
      setDisputeNote("");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not open that dispute.");
    } finally {
      setActing("");
    }
  };

  return (
    <article data-testid={`customer-project-review-${payment.id}`} className="rounded-2xl border border-amber-300/45 bg-amber-300/10 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="gold">Needs review</Badge>
            <Badge>{payment.record_type_label || "Milestone release"}</Badge>
          </div>
          <h4 className="mt-3 text-base font-semibold text-white">{payment.project_title || "Milestone review"}</h4>
          <p className="mt-1 text-sm leading-6 text-slate-300">
            Review the completed work and requested amount before funds move forward.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            <Badge tone="amber">{payment.amount_label || money(payment.amount)}</Badge>
            <Badge tone={statusTone(payment.status_label)}>{payment.status_label || "Pending review"}</Badge>
            {disputeIsOpen ? <Badge tone="rose">{payment.dispute_status_label || payment.dispute_status}</Badge> : null}
            {payment.reference ? <Badge>{payment.reference}</Badge> : null}
          </div>
          {disputeIsOpen ? (
            <p className="mt-3 text-sm leading-6 text-rose-100">
              A dispute is open for this review. Track the issue status before approving any release.
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
          <button
            type="button"
            onClick={approve}
            disabled={Boolean(acting)}
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-emerald-400 px-4 py-2 text-sm font-bold text-emerald-950 hover:bg-emerald-300 disabled:opacity-60"
          >
            {acting === "approve" ? "Approving..." : "Approve"}
          </button>
          <button
            type="button"
            onClick={() => setShowChanges((value) => !value)}
            disabled={Boolean(acting)}
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-amber-200/50 bg-slate-950/70 px-4 py-2 text-sm font-semibold text-amber-100 hover:bg-slate-900 disabled:opacity-60"
          >
            Request Changes
          </button>
          {payment.action_target ? (
            <a
              href={payment.action_target}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-sky-300/35 bg-sky-400/10 px-4 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-400/20"
            >
              Open Details
              <ExternalLink size={14} />
            </a>
          ) : null}
          {disputeIsOpen && payment.dispute_url ? (
            <a
              data-testid={`customer-project-review-dispute-${payment.id}`}
              href={payment.dispute_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-300/40 bg-rose-400/10 px-4 py-2 text-sm font-semibold text-rose-100 hover:bg-rose-400/20"
            >
              Track Issue Status
              <ExternalLink size={14} />
            </a>
          ) : payment.action_target ? (
            <button
              data-testid={`customer-project-review-dispute-${payment.id}`}
              type="button"
              onClick={() => setShowDispute((value) => !value)}
              disabled={Boolean(acting)}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-300/40 bg-rose-400/10 px-4 py-2 text-sm font-semibold text-rose-100 hover:bg-rose-400/20 disabled:opacity-60"
            >
              Open Dispute
            </button>
          ) : null}
        </div>
      </div>
      {showChanges ? (
        <div className="mt-4 rounded-xl border border-amber-200/35 bg-slate-950/70 p-3">
          <label className="block text-sm font-semibold text-amber-100">
            Note for your contractor
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-amber-300"
              placeholder="Describe what needs clarification or correction."
            />
          </label>
          <button
            type="button"
            onClick={requestChanges}
            disabled={Boolean(acting)}
            className="mt-3 rounded-xl bg-amber-300 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-amber-200 disabled:opacity-60"
          >
            {acting === "changes" ? "Sending..." : "Send Change Request"}
          </button>
        </div>
      ) : null}
      {showDispute ? (
        <div data-testid={`customer-project-review-dispute-form-${payment.id}`} className="mt-4 rounded-xl border border-rose-200/35 bg-rose-950/30 p-3">
          <div className="text-sm font-semibold text-rose-100">Tell us what is wrong</div>
          <p className="mt-1 text-sm leading-6 text-rose-100/85">
            This opens an issue tied to this milestone review. Your contractor can respond through the existing dispute workflow.
          </p>
          <label className="mt-3 block text-sm font-semibold text-rose-100">
            Reason
            <select
              value={disputeReason}
              onChange={(event) => setDisputeReason(event.target.value)}
              className="mt-2 w-full rounded-xl border border-rose-200/25 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-rose-200"
            >
              <option>Work needs correction</option>
              <option>Amount looks incorrect</option>
              <option>Work is incomplete</option>
              <option>Materials or scope concern</option>
              <option>Other issue</option>
            </select>
          </label>
          <label className="mt-3 block text-sm font-semibold text-rose-100">
            Homeowner note
            <textarea
              value={disputeNote}
              onChange={(event) => setDisputeNote(event.target.value)}
              rows={3}
              className="mt-2 w-full rounded-xl border border-rose-200/25 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-rose-200"
              placeholder="Describe what needs to be reviewed before this payment release."
            />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={openDispute}
              disabled={Boolean(acting)}
              className="rounded-xl bg-rose-300 px-4 py-2 text-sm font-bold text-rose-950 hover:bg-rose-200 disabled:opacity-60"
            >
              {acting === "dispute" ? "Opening..." : "Open Dispute"}
            </button>
            <button
              type="button"
              onClick={() => setShowDispute(false)}
              disabled={Boolean(acting)}
              className="rounded-xl border border-slate-600 bg-slate-950 px-4 py-2 text-sm font-semibold text-slate-200 hover:border-slate-500 disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

export default function CustomerProjectWorkspace({
  projects = [],
  agreements = [],
  payments = [],
  documents = [],
  notifications = [],
  token = "",
  onRefresh,
}) {
  const [selectedId, setSelectedId] = useState(projects[0]?.id || null);
  const selected = projects.find((project) => String(project.id) === String(selectedId)) || projects[0] || null;

  const selectedAgreement = useMemo(() => {
    if (!selected) return null;
    return (
      agreements.find((agreement) => String(agreement.id) === String(selected.agreement_id)) ||
      agreements.find((agreement) => String(agreement.agreement_token || "") === String(selected.agreement_token || "")) ||
      agreements.find((agreement) => agreement.project_title === selected.title) ||
      null
    );
  }, [agreements, selected]);

  const projectPayments = useMemo(() => {
    if (!selected) return [];
    return payments.filter((payment) => {
      if (selected.agreement_id && String(payment.agreement_id || "") === String(selected.agreement_id)) return true;
      return payment.project_title === selected.title;
    });
  }, [payments, selected]);

  const projectDocuments = useMemo(() => {
    if (!selected) return [];
    return documents.filter((document) => {
      if (selected.agreement_id && String(document.agreement_id || "") === String(selected.agreement_id)) return true;
      return document.project_title === selected.title;
    });
  }, [documents, selected]);

  const projectNotifications = useMemo(() => {
    if (!selected) return [];
    const title = String(selected.title || "").toLowerCase();
    return notifications.filter((notification) => {
      const haystack = `${notification.title || ""} ${notification.message || ""} ${notification.action_url || ""}`.toLowerCase();
      return title && haystack.includes(title.toLowerCase());
    });
  }, [notifications, selected]);

  const projectUpdates = useMemo(() => {
    const rows = [];
    for (const update of selected?.updates || []) {
      rows.push({
        id: `update-${update.id}`,
        title: update.milestone_title || update.title || "Project update",
        message: update.body || update.message || "A project update is available.",
        author: update.author || "Project team",
        created_at: update.created_at,
        action_url: "",
      });
    }
    for (const notification of projectNotifications) {
      rows.push({
        ...notification,
        id: `notification-${notification.id}`,
        author: "MyHomeBro",
      });
    }
    return rows.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  }, [projectNotifications, selected]);

  const reviewPayments = projectPayments.filter(isReviewablePayment);
  const paidTotal = projectPayments
    .filter(isPaidPayment)
    .reduce((sum, payment) => sum + Number(payment.amount || String(payment.amount_label || "").replace(/[^0-9.-]/g, "") || 0), 0);

  if (!projects.length && !agreements.length) {
    return (
      <div data-testid="customer-project-workspace-empty" className="rounded-2xl border border-dashed border-slate-600 bg-slate-900/60 p-6 text-sm text-slate-300">
        <div className="font-semibold text-white">No projects connected yet</div>
        <p className="mt-1 leading-6 text-slate-400">
          Active projects will appear here after an agreement, accepted bid, or contractor project record is connected to your secure customer email.
        </p>
      </div>
    );
  }

  return (
    <div data-testid="customer-project-workspace" className="grid gap-4 xl:grid-cols-[330px_minmax(0,1fr)]">
      <div className="space-y-2">
        {projects.map((project) => (
          <button
            key={project.id}
            type="button"
            data-testid={`customer-project-card-${project.id}`}
            onClick={() => setSelectedId(project.id)}
            className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
              String(selected?.id) === String(project.id)
                ? "border-amber-300/60 bg-amber-300/10 shadow-[inset_4px_0_0_rgba(251,191,36,0.65)]"
                : "border-slate-700 bg-slate-950/50 hover:border-slate-500 hover:bg-slate-900"
            }`}
          >
            <div className="text-sm font-semibold text-white">{project.title || "Project"}</div>
            <div className="mt-1 text-xs leading-5 text-slate-400">{project.project_number || project.address || "Project workspace"}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge tone={statusTone(project.status_label)}>{project.status_label || "Project"}</Badge>
              {(project.milestones || []).length ? <Badge>{project.milestones.length} milestones</Badge> : null}
            </div>
          </button>
        ))}
      </div>

      <div data-testid="customer-rich-project-workspace" className="space-y-4">
        {selected ? (
          <>
            <section className="overflow-hidden rounded-3xl border border-slate-700 bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.18),transparent_32%),linear-gradient(135deg,rgba(15,23,42,0.98),rgba(12,74,110,0.45))] p-5 shadow-2xl shadow-slate-950/30 sm:p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-200">Project workspace</div>
                  <h2 className="mt-2 text-2xl font-bold tracking-tight text-white">{selected.title}</h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-200">
                    {selected.description || selectedAgreement?.description || "Track your project from agreement to completion."}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Badge tone="gold">Track your project from agreement to completion.</Badge>
                    <Badge tone={statusTone(selected.status_label)}>{selected.status_label || "Active"}</Badge>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selected.agreement_url ? (
                    <a
                      href={selected.agreement_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-amber-200/45 bg-amber-300/15 px-4 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-300/25"
                    >
                      Open Agreement
                      <ExternalLink size={14} />
                    </a>
                  ) : null}
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-400">Contractor</div>
                  <div className="mt-1 text-sm font-semibold text-white">{selected.contractor_name || "Your contractor"}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-400">Project Value</div>
                  <div className="mt-1 text-sm font-semibold text-white">{selected.total_cost ? money(selected.total_cost) : "Pending"}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-400">Released / Paid</div>
                  <div className="mt-1 text-sm font-semibold text-white">{money(paidTotal)}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-400">Address</div>
                  <div className="mt-1 text-sm font-semibold text-white">{selected.address || "Not set"}</div>
                </div>
              </div>
            </section>

            {reviewPayments.length ? (
              <Section title="Needs Attention" eyebrow="Review before funds move" testId="customer-project-needs-attention">
                <div className="space-y-3">
                  {reviewPayments.map((payment) => (
                    <ProjectReviewCard key={payment.id} payment={payment} token={token} onPortalUpdate={onRefresh} />
                  ))}
                </div>
              </Section>
            ) : (
              <Section title="Next Action" eyebrow="Nothing waiting right now" testId="customer-project-next-action">
                <div className="rounded-2xl border border-emerald-300/35 bg-emerald-400/10 p-4 text-sm leading-6 text-emerald-100">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 shrink-0" size={18} />
                    <p>No milestone reviews or payment releases need your attention right now. New actions will appear here when your contractor submits work for review.</p>
                  </div>
                </div>
              </Section>
            )}

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.85fr)]">
              <div className="space-y-4">
                <Section title="Milestones" eyebrow="Project plan" testId="customer-project-milestones">
                  <div className="space-y-2">
                    {(selected.milestones || []).length ? (
                      selected.milestones.map((milestone, index) => (
                        <div key={milestone.id || index} className="flex flex-col gap-3 rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-slate-100">{milestone.title}</div>
                            <div className="mt-1 text-xs text-slate-500">{milestone.due_date ? `Due ${formatDate(milestone.due_date)}` : "Date pending"}</div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {milestone.amount ? <Badge>{money(milestone.amount)}</Badge> : null}
                            <Badge tone={statusTone(milestone.status)}>{milestone.status || "active"}</Badge>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-4 text-sm text-slate-400">
                        Milestones will appear once project planning is ready.
                      </div>
                    )}
                  </div>
                </Section>

                <Section title="Project Updates" eyebrow="Recent activity" testId="customer-project-updates">
                  {projectUpdates.length ? (
                    <div className="space-y-3">
                      {projectUpdates.slice(0, 5).map((notification) => (
                        <a
                          key={notification.id}
                          href={notification.action_url || "#"}
                          className="flex items-start gap-3 rounded-xl border border-slate-700 bg-slate-900/60 p-3 hover:border-amber-300/45"
                        >
                          <MessageSquare size={16} className="mt-1 shrink-0 text-amber-200" />
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-white">{notification.title || "Project update"}</div>
                            <p className="mt-1 text-sm leading-5 text-slate-300">{notification.message || "A project update is available."}</p>
                            <div className="mt-1 text-xs text-slate-500">
                              {notification.author ? `${notification.author} - ` : ""}
                              {notification.created_at ? new Date(notification.created_at).toLocaleString() : "No date"}
                            </div>
                          </div>
                        </a>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-4 text-sm leading-6 text-slate-300">
                      <p>Project updates will appear here as work is submitted, payments are reviewed, documents are added, or action is needed.</p>
                      <a
                        href={`mailto:?subject=${encodeURIComponent(`Question about ${selected.title || "my project"}`)}`}
                        className="mt-3 inline-flex min-h-11 items-center justify-center rounded-xl border border-amber-200/45 bg-amber-300/15 px-4 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-300/25"
                      >
                        Ask a question
                      </a>
                    </div>
                  )}
                </Section>
              </div>

              <div className="space-y-4">
                <Section title="Payments" eyebrow="Escrow and releases" testId="customer-project-payments">
                  <p className="text-sm leading-6 text-slate-300">Review payments before funds are released.</p>
                  <div className="mt-3 space-y-2">
                    {projectPayments.length ? (
                      projectPayments.slice(0, 5).map((payment) => {
                        const invoiceUrl = isInvoicePayment(payment) ? normalizeInvoiceMagicUrl(payment.action_target) : payment.action_target;
                        const primaryUrl = payment.receipt_url || invoiceUrl || "#";
                        const paid = isPaidPayment(payment);
                        return (
                        <div key={payment.id} data-testid={`customer-project-payment-${payment.id}`} className="rounded-xl border border-slate-700 bg-slate-900/60 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold text-white">
                                {payment.record_type_label || "Payment"} {payment.invoice_number || payment.reference ? `- ${payment.invoice_number || payment.reference}` : ""}
                              </div>
                              <div className="mt-1 text-xs text-slate-500">{formatDate(payment.date)}</div>
                              <div className="mt-2 grid gap-1 text-xs text-slate-400">
                                <span>{payment.contractor_name ? `Contractor: ${payment.contractor_name}` : `Contractor: ${selected.contractor_name || "Your contractor"}`}</span>
                                <span>{payment.payment_mode_label ? `Method: ${payment.payment_mode_label}` : "Method: Secure payment"}</span>
                                {payment.due_date ? <span>Due: {formatDate(payment.due_date)}</span> : null}
                                {hasOpenDispute(payment) ? <span className="text-rose-100">Issue: {payment.dispute_status_label || payment.dispute_status}</span> : null}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-sm font-bold text-white">{payment.amount_label || money(payment.amount)}</div>
                              <Badge tone={statusTone(payment.status_label)}>{payment.status_label || "Pending"}</Badge>
                            </div>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {primaryUrl && primaryUrl !== "#" ? (
                              <a
                                data-testid={`customer-project-payment-primary-${payment.id}`}
                                href={primaryUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-amber-200/45 bg-amber-300/15 px-3 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-300/25"
                              >
                                {isInvoicePayment(payment) ? (paid ? "View Receipt" : "Pay Invoice") : isReviewablePayment(payment) ? "Review Release" : "View Record"}
                                <ExternalLink size={14} />
                              </a>
                            ) : null}
                            {isInvoicePayment(payment) && invoiceUrl ? (
                              <a
                                data-testid={`customer-project-payment-view-invoice-${payment.id}`}
                                href={invoiceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-sky-300/35 bg-sky-400/10 px-3 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-400/20"
                              >
                                View Invoice
                                <ExternalLink size={14} />
                              </a>
                            ) : null}
                            {isInvoicePayment(payment) && invoiceUrl && !paid ? (
                              <a
                                data-testid={`customer-project-payment-dispute-${payment.id}`}
                                href={`${invoiceUrl}?action=dispute`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-300/40 bg-rose-400/10 px-3 py-2 text-sm font-semibold text-rose-100 hover:bg-rose-400/20"
                              >
                                Open Dispute
                                <ExternalLink size={14} />
                              </a>
                            ) : null}
                            {hasOpenDispute(payment) && payment.dispute_url ? (
                              <a
                                data-testid={`customer-project-payment-track-dispute-${payment.id}`}
                                href={payment.dispute_url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-300/40 bg-rose-400/10 px-3 py-2 text-sm font-semibold text-rose-100 hover:bg-rose-400/20"
                              >
                                Track Issue Status
                                <ExternalLink size={14} />
                              </a>
                            ) : null}
                          </div>
                        </div>
                      );
                      })
                    ) : (
                      <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-4 text-sm text-slate-400">
                        Payment records will appear when invoices, draws, or receipts are connected.
                      </div>
                    )}
                  </div>
                </Section>

                <Section title="Documents" eyebrow="Project files" testId="customer-project-documents">
                  <p className="text-sm leading-6 text-slate-300">Keep your project documents and home records in one place.</p>
                  <div className="mt-3 space-y-2">
                    {projectDocuments.length ? (
                      projectDocuments.slice(0, 5).map((document) => (
                        <a key={document.id} href={document.url || "#"} target="_blank" rel="noreferrer" className="flex items-start gap-3 rounded-xl border border-slate-700 bg-slate-900/60 p-3 hover:border-sky-300/40">
                          <FileText size={16} className="mt-1 shrink-0 text-sky-200" />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-white">{document.title}</div>
                            <div className="mt-1 truncate text-xs text-slate-500">{document.type_label || "Document"} - {document.filename || "File"}</div>
                          </div>
                        </a>
                      ))
                    ) : (
                      <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-4 text-sm text-slate-400">
                        Agreement PDFs, receipts, shared attachments, and property records will appear here.
                      </div>
                    )}
                  </div>
                </Section>

                <Section title="Agreement Summary" eyebrow="Scope and warranty" testId="customer-project-agreement-summary">
                  <div className="space-y-3 text-sm leading-6 text-slate-300">
                    <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Status</div>
                      <div className="mt-1 font-semibold text-white">{selectedAgreement?.status_label || selected.status_label || "Project"}</div>
                    </div>
                    <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Payment Mode</div>
                      <div className="mt-1 font-semibold text-white">{selectedAgreement?.payment_mode || "Not set"}</div>
                    </div>
                    <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Warranty</div>
                      <div className="mt-1 whitespace-pre-wrap text-slate-300">
                        {selectedAgreement?.warranty_text || "Warranty details will appear here when added to your project."}
                      </div>
                    </div>
                  </div>
                </Section>
              </div>
            </div>
          </>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 p-6 text-sm text-slate-300">
            Select a project to review milestones, payments, documents, and updates.
          </div>
        )}
      </div>
    </div>
  );
}
