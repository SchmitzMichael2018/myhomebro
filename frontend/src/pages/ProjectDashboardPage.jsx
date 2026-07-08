import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  Clock3,
  FileText,
  ImageIcon,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  Upload,
} from "lucide-react";
import toast from "react-hot-toast";

import api, { getCustomerProjectDashboard, uploadCustomerProjectPhotos } from "../api";
import Modal from "../components/Modal.jsx";

function money(value) {
  const number = Number(value || 0);
  return number.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
    });
  } catch {
    return String(value);
  }
}

function badgeTone(tone = "slate") {
  const map = {
    slate: "border-slate-200 bg-slate-50 text-slate-700",
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
    rose: "border-rose-200 bg-rose-50 text-rose-800",
    indigo: "border-indigo-200 bg-indigo-50 text-indigo-800",
  };
  return map[tone] || map.slate;
}

function Badge({ children, tone = "slate" }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${badgeTone(tone)}`}>
      {children}
    </span>
  );
}

function SectionCard({ title, eyebrow, children, testId, id, className = "" }) {
  return (
    <section
      id={id}
      data-testid={testId}
      className={`rounded-3xl border border-slate-200 bg-white p-5 shadow-sm ${className}`.trim()}
    >
      {eyebrow ? (
        <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">{eyebrow}</div>
      ) : null}
      {title ? <h2 className="mt-1 text-lg font-bold text-slate-900">{title}</h2> : null}
      <div className={title || eyebrow ? "mt-3" : ""}>{children}</div>
    </section>
  );
}

function ActionLink({ href, children, tone = "blue", secondary = false, onClick, className = "" }) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition";
  const tones = secondary
    ? "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
    : tone === "emerald"
    ? "bg-emerald-600 text-white hover:bg-emerald-500"
    : tone === "amber"
    ? "bg-amber-500 text-white hover:bg-amber-400"
    : tone === "rose"
    ? "bg-rose-600 text-white hover:bg-rose-500"
    : "bg-sky-600 text-white hover:bg-sky-500";

  if (href) {
    return (
      <a href={href} className={`${base} ${tones} ${className}`.trim()}>
        {children}
      </a>
    );
  }

  return (
    <button type="button" onClick={onClick} className={`${base} ${tones} ${className}`.trim()}>
      {children}
    </button>
  );
}

function ActivityIcon({ category }) {
  const tone = String(category || "").toLowerCase();
  if (tone.includes("agreement")) return <FileText size={16} />;
  if (tone.includes("payment") || tone.includes("invoice")) return <ShieldCheck size={16} />;
  if (tone.includes("milestone") || tone.includes("review")) return <Clock3 size={16} />;
  if (tone.includes("message")) return <MessageSquare size={16} />;
  return <Sparkles size={16} />;
}

function buildQuestionHref(contractorEmail, projectTitle) {
  if (!contractorEmail) return "#messages";
  return `mailto:${contractorEmail}?subject=${encodeURIComponent(`Question about ${projectTitle || "my project"}`)}`;
}

export default function ProjectDashboardPage() {
  const { project_id } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dashboard, setDashboard] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [warrantyModalOpen, setWarrantyModalOpen] = useState(false);
  const [warrantySubmitting, setWarrantySubmitting] = useState(false);
  const [warrantyForm, setWarrantyForm] = useState({
    title: "",
    description: "",
    date_noticed: "",
    area_affected: "",
    severity: "normal",
    urgency: "",
    other_contractor_worked: false,
    preferred_scheduling: "",
  });
  const [warrantyFiles, setWarrantyFiles] = useState([]);
  const fileInputRef = useRef(null);

  const loadDashboard = useCallback(async () => {
    if (!project_id) {
      setError("Missing project id.");
      setLoading(false);
      return;
    }
    if (!token) {
      setError("Open this dashboard from your agreement link or customer portal link.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await getCustomerProjectDashboard(project_id, token);
      setDashboard(data);
    } catch (err) {
      const detail = err?.response?.data?.detail || err?.message || "Unable to load your project dashboard.";
      setError(detail);
      toast.error(detail);
    } finally {
      setLoading(false);
    }
  }, [project_id, token]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const project = dashboard?.project || {};
  const hero = dashboard?.hero || {};
  const nextAction = dashboard?.next_action || {};
  const timeline = Array.isArray(dashboard?.timeline) ? dashboard.timeline : [];
  const payments = dashboard?.payments || {};
  const paymentSummary = payments?.summary || {};
  const invoiceRows = Array.isArray(payments?.invoice_rows) ? payments.invoice_rows : [];
  const drawRows = Array.isArray(payments?.draw_rows) ? payments.draw_rows : [];
  const messages = Array.isArray(dashboard?.messages?.latest) ? dashboard.messages.latest : [];
  const allMessages = Array.isArray(dashboard?.messages?.items) ? dashboard.messages.items : [];
  const photos = Array.isArray(dashboard?.photos) ? dashboard.photos : [];
  const agreement = dashboard?.agreement || {};
  const warrantyRows = Array.isArray(dashboard?.warranties)
    ? dashboard.warranties
    : Array.isArray(agreement?.warranties)
    ? agreement.warranties
    : [];
  const activity = Array.isArray(dashboard?.notifications) ? dashboard.notifications : [];
  const review = dashboard?.review || {};

  const projectTitle = hero.project_title || project.title || "Project";
  const contractorEmail = hero.contractor_email || "";
  const askQuestionHref = useMemo(
    () => buildQuestionHref(contractorEmail, projectTitle),
    [contractorEmail, projectTitle]
  );

  const milestoneStats = useMemo(() => {
    const completed = timeline.filter((item) => item.completed).length;
    const awaitingReview = timeline.filter((item) => item.status === "awaiting_review").length;
    const overdue = timeline.filter((item) => item.status === "overdue").length;
    return { completed, awaitingReview, overdue, total: timeline.length };
  }, [timeline]);

  const handleUpload = async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    if (!project_id || !token) {
      toast.error("This dashboard link is missing its access token.");
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      const updated = await uploadCustomerProjectPhotos(project_id, token, formData);
      setDashboard(updated);
      toast.success(files.length > 1 ? "Photos uploaded." : "Photo uploaded.");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      toast.error(err?.response?.data?.detail || err?.message || "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const statusTone =
    nextAction.tone === "emerald"
      ? "emerald"
      : nextAction.tone === "amber"
      ? "amber"
      : nextAction.tone === "rose"
      ? "rose"
      : nextAction.tone === "blue"
      ? "blue"
      : "slate";

  const primaryHref = nextAction.url || agreement.agreement_url || "";
  const secondaryHref = askQuestionHref;

  const activeWarranty = warrantyRows[0] || null;

  const updateWarrantyField = (field, value) => {
    setWarrantyForm((prev) => ({ ...prev, [field]: value }));
  };

  const submitWarrantyRequest = async (event) => {
    event.preventDefault();
    if (!agreement.agreement_token) {
      toast.error("This project link is missing warranty access.");
      return;
    }
    if (!warrantyForm.title.trim() || !warrantyForm.description.trim()) {
      toast.error("Please add an issue title and description.");
      return;
    }
    setWarrantySubmitting(true);
    try {
      const body = new FormData();
      if (activeWarranty?.id) body.append("warranty_id", activeWarranty.id);
      Object.entries(warrantyForm).forEach(([key, value]) => {
        body.append(key, typeof value === "boolean" ? String(value) : value || "");
      });
      warrantyFiles.forEach((file) => body.append("files", file));
      await api.post(`/projects/customer-portal/${agreement.agreement_token}/warranty-requests/`, body);
      toast.success("Warranty request submitted.");
      setWarrantyModalOpen(false);
      setWarrantyFiles([]);
      setWarrantyForm({
        title: "",
        description: "",
        date_noticed: "",
        area_affected: "",
        severity: "normal",
        urgency: "",
        other_contractor_worked: false,
        preferred_scheduling: "",
      });
      await loadDashboard();
    } catch (err) {
      const data = err?.response?.data || {};
      const detail = data.detail || data.title?.[0] || data.description?.[0] || err?.message || "Unable to submit warranty request.";
      toast.error(detail);
    } finally {
      setWarrantySubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-28">
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 lg:px-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-600 text-white shadow-sm">
            <Sparkles size={18} />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">MyHomeBro</div>
            <div className="truncate text-sm font-semibold text-slate-900">Project Dashboard</div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2 text-right text-xs text-slate-500">
            <Badge tone="indigo">{hero.contractor_name || "Your contractor"}</Badge>
            {hero.contractor_rating?.review_count > 0 ? (
              <Badge tone="amber">★ {Number(hero.contractor_rating.average_rating || 0).toFixed(2)}</Badge>
            ) : (
              <Badge tone="slate">New on MyHomeBro</Badge>
            )}
            <Badge tone="slate">{hero.status_label || project.status_label || "Project"}</Badge>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-4 lg:px-6">
        {error ? (
          <section className="rounded-3xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800">
            <div className="font-semibold">Project dashboard unavailable</div>
            <p className="mt-1 leading-6">{error}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <ActionLink href="/portal" secondary>
                Open Customer Portal
              </ActionLink>
              <ActionLink href={agreement.agreement_url || "/"} secondary>
                Open Agreement
              </ActionLink>
            </div>
          </section>
        ) : null}

        {loading && !dashboard ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
            Loading project dashboard…
          </section>
        ) : dashboard ? (
          <div className="space-y-4">
            <section
              data-testid="project-hero-status"
              className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                    {project.number || "Project"}
                  </div>
                  <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900 lg:text-3xl">
                    {projectTitle}
                  </h1>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                    {hero.summary ||
                      "Your project dashboard keeps the agreement, milestones, payments, messages, and next steps in one place."}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Badge tone="indigo">{hero.contractor_name || "Your contractor"}</Badge>
                    {hero.contractor_rating?.review_count > 0 ? (
                      <Badge tone="amber">
                        ★ {Number(hero.contractor_rating.average_rating || 0).toFixed(2)} •{" "}
                        {hero.contractor_rating.review_count} verified reviews
                      </Badge>
                    ) : (
                      <Badge tone="slate">New on MyHomeBro</Badge>
                    )}
                    <Badge tone={paymentSummary.payment_mode === "escrow" ? "blue" : "slate"}>
                      {hero.payment_mode_label || paymentSummary.payment_mode_label || "Escrow"}
                    </Badge>
                    <Badge tone="slate">{project.status_label || "Project"}</Badge>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {primaryHref ? (
                    <ActionLink href={primaryHref} tone={statusTone}>
                      {nextAction.label || "Open Agreement"}
                      <ArrowRight size={16} />
                    </ActionLink>
                  ) : (
                    <ActionLink
                      onClick={() => document.getElementById("timeline")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                      tone={statusTone}
                    >
                      {nextAction.label || "View Timeline"}
                      <ArrowRight size={16} />
                    </ActionLink>
                  )}
                  <ActionLink href={secondaryHref} secondary>
                    Ask Question
                  </ActionLink>
                  {hero.public_profile_url ? (
                    <ActionLink href={`${hero.public_profile_url}${review.eligible ? "?review=1" : ""}`} secondary>
                      View Contractor Profile
                    </ActionLink>
                  ) : null}
                </div>
              </div>
            </section>

            <section
              data-testid="project-next-action"
              className={`rounded-[2rem] border p-5 shadow-sm ${badgeTone(statusTone)}`}
            >
              <div className="text-xs font-semibold uppercase tracking-[0.22em] opacity-70">Next Action</div>
              <div className="mt-1 text-2xl font-extrabold text-slate-900">{nextAction.title || "Track progress"}</div>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-700">{nextAction.body || "Your next step will appear here."}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {primaryHref ? (
                  <ActionLink href={primaryHref} tone={statusTone}>
                    {nextAction.label || "Open"}
                    <ArrowRight size={16} />
                  </ActionLink>
                ) : null}
                <ActionLink href="#timeline" secondary>
                  See Timeline
                </ActionLink>
                <ActionLink href={secondaryHref} secondary>
                  Ask Question
                </ActionLink>
              </div>
            </section>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.95fr)]">
              <div className="space-y-4">
                <SectionCard
                  title="Project Timeline"
                  eyebrow="Milestones"
                  testId="project-timeline"
                >
                  <div id="timeline" className="space-y-3">
                    {timeline.length ? (
                      timeline.map((milestone) => {
                        const tone =
                          milestone.status === "completed"
                            ? "emerald"
                            : milestone.status === "awaiting_review"
                            ? "amber"
                            : milestone.status === "overdue"
                            ? "rose"
                            : milestone.status === "invoiced"
                            ? "blue"
                            : "slate";
                        return (
                          <div
                            key={milestone.id}
                            className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="text-sm font-semibold text-slate-900">
                                  {milestone.order}. {milestone.title}
                                </div>
                                <Badge tone={tone}>{milestone.status_label}</Badge>
                              </div>
                              <div className="mt-1 text-sm text-slate-600">
                                {milestone.description || "Milestone details are ready to review."}
                              </div>
                            </div>
                            <div className="shrink-0 text-right">
                              <div className="text-base font-bold text-slate-900">
                                {milestone.amount_label || money(milestone.amount)}
                              </div>
                              <div className="text-xs text-slate-500">
                                {milestone.completed ? "Completed" : milestone.completion_date ? `Due ${formatDate(milestone.completion_date)}` : "In progress"}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-500">
                        Your contractor will add milestones as the project plan is finalized.
                      </div>
                    )}
                  </div>
                </SectionCard>

                <SectionCard
                  title="Messages Preview"
                  eyebrow={allMessages.length ? `Latest thread (${allMessages.length})` : "Latest thread"}
                  testId="project-messages"
                  id="messages"
                >
                  {messages.length ? (
                    <div className="space-y-3">
                      {messages.map((message) => (
                        <div key={message.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge tone="slate">{message.milestone_title || "Project update"}</Badge>
                            <span className="text-xs text-slate-500">{formatDate(message.created_at)}</span>
                          </div>
                          <div className="mt-2 text-sm font-semibold text-slate-900">{message.author}</div>
                          <p className="mt-1 text-sm leading-6 text-slate-700">{message.body}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-600">
                      No messages yet. You can ask a question any time, and your contractor can keep project notes here as the work moves forward.
                    </div>
                  )}
                </SectionCard>

                <SectionCard
                  title="Photos"
                  eyebrow="Upload and review"
                  testId="project-photos"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-sm leading-6 text-slate-600">
                      Add project photos so your contractor can see site conditions. Final measurements and field conditions may still need verification.
                    </div>
                    <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
                      <Upload size={16} />
                      {uploading ? "Uploading…" : "Upload Photos"}
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*,.pdf"
                        multiple
                        data-testid="project-photo-upload-input"
                        className="hidden"
                        onChange={handleUpload}
                      />
                    </label>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {photos.length ? (
                      photos.map((photo) => (
                        <button
                          key={photo.id}
                          type="button"
                          onClick={() => setSelectedPhoto(photo)}
                          className="group overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 text-left"
                        >
                          <div className="aspect-square bg-slate-100">
                            {photo.url ? (
                              <img
                                src={photo.url}
                                alt={photo.title || "Project photo"}
                                className="h-full w-full object-cover transition group-hover:scale-[1.03]"
                              />
                            ) : (
                              <div className="flex h-full items-center justify-center text-slate-400">
                                <ImageIcon size={22} />
                              </div>
                            )}
                          </div>
                          <div className="px-3 py-2">
                            <div className="truncate text-sm font-semibold text-slate-900">{photo.title}</div>
                            <div className="text-xs text-slate-500">{formatDate(photo.uploaded_at)}</div>
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="col-span-full rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500">
                        No project photos have been uploaded yet.
                      </div>
                    )}
                  </div>
                </SectionCard>
              </div>

              <aside className="space-y-4 lg:sticky lg:top-4 self-start">
                <SectionCard title="Payments" eyebrow="Escrow and milestones" testId="project-payments">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl bg-slate-50 p-3">
                      <div className="text-xs text-slate-500">Total</div>
                      <div className="mt-1 text-lg font-bold text-slate-900">{agreement.total_cost_label || money(agreement.total_cost)}</div>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-3">
                      <div className="text-xs text-slate-500">Escrow</div>
                      <div className="mt-1 text-lg font-bold text-slate-900">{paymentSummary.escrow_funded_label || "Waiting"}</div>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-3">
                      <div className="text-xs text-slate-500">Remaining</div>
                      <div className="mt-1 text-lg font-bold text-slate-900">{paymentSummary.remaining_to_fund_label || money(paymentSummary.remaining_to_fund)}</div>
                    </div>
                  </div>

                  <div className="mt-4 space-y-3">
                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">Escrow status</div>
                          <div className="text-xs text-slate-500">Funds release as milestones are approved.</div>
                        </div>
                        <Badge tone={paymentSummary.escrow_funded ? "emerald" : "amber"}>
                          {paymentSummary.escrow_funded ? "Funded" : "Waiting"}
                        </Badge>
                      </div>
                    </div>

                    {invoiceRows.length ? (
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Invoices</div>
                        <div className="mt-2 space-y-2">
                          {invoiceRows.map((row) => (
                            <a
                              key={row.id}
                              href={row.link}
                              className="block rounded-2xl border border-slate-200 bg-slate-50 p-3 transition hover:bg-slate-100"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="text-sm font-semibold text-slate-900">{row.label}</div>
                                  <div className="text-xs text-slate-500">{row.notes || formatDate(row.date)}</div>
                                </div>
                                <div className="text-right">
                                  <div className="text-sm font-bold text-slate-900">{row.amount_label}</div>
                                  <Badge tone={row.status === "paid" ? "emerald" : row.status === "approved" ? "amber" : "slate"}>
                                    {row.status_label}
                                  </Badge>
                                </div>
                              </div>
                            </a>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {drawRows.length ? (
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Draws</div>
                        <div className="mt-2 space-y-2">
                          {drawRows.map((row) => (
                            <a
                              key={row.id}
                              href={row.link}
                              className="block rounded-2xl border border-slate-200 bg-slate-50 p-3 transition hover:bg-slate-100"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="text-sm font-semibold text-slate-900">{row.label}</div>
                                  <div className="text-xs text-slate-500">{row.notes || formatDate(row.date)}</div>
                                </div>
                                <div className="text-right">
                                  <div className="text-sm font-bold text-slate-900">{row.amount_label}</div>
                                  <Badge tone={row.status === "released" ? "emerald" : row.status === "submitted" ? "amber" : "slate"}>
                                    {row.status_label}
                                  </Badge>
                                </div>
                              </div>
                            </a>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </SectionCard>

                <SectionCard title="Agreement" eyebrow="Summary" testId="project-agreement">
                  <div className="space-y-3 text-sm text-slate-700">
                    <div className="rounded-2xl bg-slate-50 p-3">
                      <div className="text-xs text-slate-500">Status</div>
                      <div className="mt-1 font-semibold text-slate-900">{agreement.status || "Draft"}</div>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-3">
                      <div className="text-xs text-slate-500">Payment plan</div>
                      <div className="mt-1 font-semibold text-slate-900">{agreement.payment_mode_label || "Escrow"}</div>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-3">
                      <div className="text-xs text-slate-500">Total cost</div>
                      <div className="mt-1 font-semibold text-slate-900">{agreement.total_cost_label || money(agreement.total_cost)}</div>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {agreement.agreement_url ? (
                        <ActionLink href={agreement.agreement_url} secondary>
                          Open Agreement
                        </ActionLink>
                      ) : null}
                      {agreement.funding_url ? (
                        <ActionLink href={agreement.funding_url} tone="blue">
                          Fund Deposit
                        </ActionLink>
                      ) : null}
                    </div>
                  </div>
                </SectionCard>

                <SectionCard title="Warranty" eyebrow="Post-completion support" testId="project-warranty">
                  {activeWarranty ? (
                    <div className="space-y-3 text-sm text-slate-700">
                      <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-900">
                        <div className="font-semibold">{activeWarranty.title || "Active warranty"}</div>
                        <div className="mt-1 text-xs font-medium text-emerald-800">
                          Active through {formatDate(activeWarranty.end_date)}
                          {activeWarranty.days_remaining !== null && activeWarranty.days_remaining !== undefined
                            ? ` (${activeWarranty.days_remaining} days remaining)`
                            : ""}
                        </div>
                      </div>
                      <p className="leading-6 text-slate-600">
                        {activeWarranty.coverage_details || "Your contractor can review covered workmanship issues from this completed project."}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <ActionLink onClick={() => setWarrantyModalOpen(true)} tone="emerald">
                          Request Warranty Work
                        </ActionLink>
                        <Badge tone="slate">{activeWarranty.open_request_count || 0} open request(s)</Badge>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="rounded-2xl bg-slate-50 p-3 text-sm leading-6 text-slate-600">
                        Warranty coverage will appear here after this project is completed and the contractor records active coverage.
                      </div>
                    </div>
                  )}
                </SectionCard>

                <SectionCard
                  title="Notifications"
                  eyebrow="Recent activity"
                  testId="project-notifications"
                >
                  {activity.length ? (
                    <div className="space-y-2">
                      {activity.map((item) => (
                        <a
                          key={item.id}
                          href={item.link || "#"}
                          className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 transition hover:bg-slate-100"
                        >
                          <div className={`mt-0.5 flex h-8 w-8 items-center justify-center rounded-xl border ${badgeTone(item.tone || "slate")}`}>
                            <ActivityIcon category={item.category} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-sm font-semibold text-slate-900">{item.title}</div>
                              <Badge tone={item.tone || "slate"}>{item.category.replaceAll("_", " ")}</Badge>
                            </div>
                            <p className="mt-1 text-sm leading-6 text-slate-600">{item.body}</p>
                            <div className="mt-1 text-xs text-slate-500">{formatDate(item.created_at)}</div>
                          </div>
                        </a>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500">
                      Recent updates will appear here as the project moves forward.
                    </div>
                  )}
                </SectionCard>

                <SectionCard title="Review" eyebrow="Post-completion" testId="project-review">
                  {review.eligible ? (
                    <div className="space-y-3">
                      <div className="rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-800">
                        {review.message || "Leave a review when the project is complete."}
                      </div>
                      {review.url ? (
                        <ActionLink href={review.url} tone="emerald">
                          Leave a Review
                        </ActionLink>
                      ) : null}
                    </div>
                  ) : (
                    <div className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-600">
                      {hero.contractor_rating?.review_count > 0
                        ? "The review step will appear once the project is complete."
                        : "New on MyHomeBro"}
                    </div>
                  )}
                </SectionCard>

                <SectionCard title="Quick Snapshot" eyebrow="Project health">
                  <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                    <div className="rounded-2xl bg-slate-50 p-3">
                      <div className="text-xs text-slate-500">Timeline</div>
                      <div className="mt-1 text-lg font-bold text-slate-900">
                        {milestoneStats.completed}/{milestoneStats.total}
                      </div>
                      <div className="text-xs text-slate-500">Completed milestones</div>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-3">
                      <div className="text-xs text-slate-500">Awaiting review</div>
                      <div className="mt-1 text-lg font-bold text-slate-900">{milestoneStats.awaitingReview}</div>
                      <div className="text-xs text-slate-500">Items waiting on approval</div>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-3">
                      <div className="text-xs text-slate-500">Overdue</div>
                      <div className="mt-1 text-lg font-bold text-slate-900">{milestoneStats.overdue}</div>
                      <div className="text-xs text-slate-500">Needs attention</div>
                    </div>
                  </div>
                </SectionCard>
              </aside>
            </div>
          </div>
        ) : null}
      </main>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-7xl gap-2">
          {primaryHref ? (
            <ActionLink href={primaryHref} tone={statusTone} className="flex-1">
              {nextAction.label || "Open"}
              <ArrowRight size={16} />
            </ActionLink>
          ) : (
            <ActionLink
              onClick={() => document.getElementById("timeline")?.scrollIntoView({ behavior: "smooth", block: "start" })}
              tone={statusTone}
              className="flex-1"
            >
              {nextAction.label || "View Timeline"}
            </ActionLink>
          )}
          <ActionLink href={secondaryHref} secondary className="flex-1">
            Ask Question
          </ActionLink>
        </div>
      </div>

      <Modal
        visible={warrantyModalOpen}
        title="Request Warranty Work"
        onClose={() => setWarrantyModalOpen(false)}
        testId="warranty-request-modal"
        containerClassName="max-w-2xl"
      >
        <form onSubmit={submitWarrantyRequest} className="space-y-4">
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-900">
            {activeWarranty?.title || "Active warranty"} is linked to this project and agreement.
          </div>
          <label className="block text-sm font-semibold text-slate-800">
            Issue title
            <input
              value={warrantyForm.title}
              onChange={(event) => updateWarrantyField("title", event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
              placeholder="e.g., Transition strip lifting"
              data-testid="warranty-request-title"
            />
          </label>
          <label className="block text-sm font-semibold text-slate-800">
            Issue description
            <textarea
              value={warrantyForm.description}
              onChange={(event) => updateWarrantyField("description", event.target.value)}
              className="mt-1 min-h-28 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
              placeholder="Describe what changed, when it started, and anything you have already tried."
              data-testid="warranty-request-description"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-semibold text-slate-800">
              Date noticed
              <input
                type="date"
                value={warrantyForm.date_noticed}
                onChange={(event) => updateWarrantyField("date_noticed", event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
              />
            </label>
            <label className="block text-sm font-semibold text-slate-800">
              Area affected
              <input
                value={warrantyForm.area_affected}
                onChange={(event) => updateWarrantyField("area_affected", event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
                placeholder="e.g., Hallway"
              />
            </label>
            <label className="block text-sm font-semibold text-slate-800">
              Severity
              <select
                value={warrantyForm.severity}
                onChange={(event) => updateWarrantyField("severity", event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </label>
            <label className="block text-sm font-semibold text-slate-800">
              Urgency
              <input
                value={warrantyForm.urgency}
                onChange={(event) => updateWarrantyField("urgency", event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
                placeholder="e.g., This week"
              />
            </label>
          </div>
          <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-800">
            <input
              type="checkbox"
              checked={warrantyForm.other_contractor_worked}
              onChange={(event) => updateWarrantyField("other_contractor_worked", event.target.checked)}
              className="mt-1"
            />
            <span>Another contractor has worked on this area since completion.</span>
          </label>
          <label className="block text-sm font-semibold text-slate-800">
            Preferred scheduling
            <textarea
              value={warrantyForm.preferred_scheduling}
              onChange={(event) => updateWarrantyField("preferred_scheduling", event.target.value)}
              className="mt-1 min-h-20 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
              placeholder="Share good days/times or access notes."
            />
          </label>
          <label className="block text-sm font-semibold text-slate-800">
            Photos, videos, or documents
            <input
              type="file"
              multiple
              accept="image/*,video/*,.pdf,.doc,.docx"
              onChange={(event) => setWarrantyFiles(Array.from(event.target.files || []))}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              data-testid="warranty-request-files"
            />
          </label>
          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setWarrantyModalOpen(false)}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={warrantySubmitting}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500 disabled:bg-emerald-300"
              data-testid="warranty-request-submit"
            >
              {warrantySubmitting ? "Submitting..." : "Submit Request"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        visible={Boolean(selectedPhoto)}
        title={selectedPhoto?.title || "Project photo"}
        onClose={() => setSelectedPhoto(null)}
        containerClassName="max-w-4xl"
        bodyClassName="max-h-[85vh] px-0 py-0"
      >
        {selectedPhoto ? (
          <div className="bg-slate-950">
            <img
              src={selectedPhoto.url}
              alt={selectedPhoto.title || "Project photo"}
              className="max-h-[80vh] w-full object-contain"
            />
            <div className="space-y-1 bg-white px-5 py-4">
              <div className="text-sm font-semibold text-slate-900">{selectedPhoto.title}</div>
              <div className="text-xs text-slate-500">{formatDate(selectedPhoto.uploaded_at)}</div>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
