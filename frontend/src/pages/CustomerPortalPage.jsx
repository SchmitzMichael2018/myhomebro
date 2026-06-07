import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ExternalLink, FileText, FolderKanban, Home, Mail, ShieldCheck, WalletCards } from "lucide-react";
import toast from "react-hot-toast";

import api, { setTokens } from "../api";
import CustomerDashboard from "../components/CustomerDashboard.jsx";
import Modal from "../components/Modal.jsx";
import logo from "../assets/myhomebro_logo.png";

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  } catch {
    return String(value);
  }
}

function formatMoney(value) {
  const number = Number(value || 0);
  return number.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function Badge({ children, tone = "slate" }) {
  const tones = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    rose: "border-rose-200 bg-rose-50 text-rose-800",
    indigo: "border-indigo-200 bg-indigo-50 text-indigo-800",
    slate: "border-slate-200 bg-slate-50 text-slate-700",
  };
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${tones[tone] || tones.slate}`}>
      {children}
    </span>
  );
}

function SummaryCard({ label, value, sublabel, tone = "slate", testId }) {
  const tones = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-900",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    indigo: "border-indigo-200 bg-indigo-50 text-indigo-900",
    slate: "border-slate-200 bg-white text-slate-900",
  };

  return (
    <div data-testid={testId} className={`rounded-2xl border p-4 shadow-sm ${tones[tone] || tones.slate}`}>
      <div className="text-xs font-semibold uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-2 text-2xl font-bold tabular-nums">{value}</div>
      {sublabel ? <div className="mt-1 text-xs opacity-70">{sublabel}</div> : null}
    </div>
  );
}

function SectionTable({ testId, rows, columns, emptyText, onRowClick }) {
  if (!rows.length) {
    return (
      <div
        data-testid={`${testId}-empty`}
        className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600"
      >
        {emptyText}
      </div>
    );
  }

  return (
    <div data-testid={testId} className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            {columns.map((column) => (
              <th key={column.key} className="px-3 py-2">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              data-testid={`${testId}-row-${row.id}`}
              className={`border-b border-slate-100 last:border-b-0 ${onRowClick ? "cursor-pointer hover:bg-slate-50" : ""}`}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((column) => (
                <td key={column.key} className="px-3 py-3 align-top">
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function detailPairs(kind, row) {
  if (!row) return [];
  if (kind === "request") {
    return [
      ["Project", row.project_title],
      ["Project Class", row.project_class_label],
      ["Status", row.status_label],
      ["Latest Activity", formatDate(row.latest_activity)],
      ["Bids", String(row.bids_count ?? 0)],
      ["Notes", row.notes || "—"],
    ];
  }
  if (kind === "bid") {
    return [
      ["Project", row.request_title || row.project_title],
      ["Project Address", row.request_address || "—"],
      ["Contractor", row.contractor_name],
      ["Project Class", row.project_class_label],
      ["Bid Amount", row.bid_amount_label || "—"],
      ["Submitted", formatDate(row.submitted_at)],
      ["Status", row.status_label],
      ["Outcome", row.status_note || "—"],
      ["Next Action", row.next_action?.label || "View details"],
      ["Timeline", row.timeline || "—"],
      ["Proposal", row.proposal_summary || "—"],
      ["Payment Structure", row.payment_structure_summary || "—"],
      [
        "Milestones",
        Array.isArray(row.milestone_preview) && row.milestone_preview.length
          ? row.milestone_preview.join(", ")
          : "—",
      ],
      ["Agreement", row.linked_agreement_id ? `Agreement #${row.linked_agreement_id}` : "—"],
      ["Notes", row.notes || "—"],
    ];
  }
  if (kind === "agreement") {
    return [
      ["Project", row.project_title],
      ["Contractor", row.contractor_name],
      ["Project Class", row.project_class_label],
      ["Status", row.status_label],
      ["Signed", row.is_fully_signed ? "Yes" : "No"],
      ["Updated", formatDate(row.updated_at)],
    ];
  }
  if (kind === "payment") {
    return [
      ["Project", row.project_title],
      ["Type", row.record_type_label],
      ["Amount", row.amount_label || "—"],
      ["Status", row.status_label],
      ["Date", formatDate(row.date)],
      ["Reference", row.reference || "—"],
      ["Notes", row.notes || "—"],
    ];
  }
  if (kind === "document") {
    return [
      ["Title", row.title],
      ["Type", row.type_label],
      ["Project", row.project_title],
      ["Updated", formatDate(row.date)],
    ];
  }
  return [];
}

function openTarget(row) {
  if (row?.kind === "bid" && row.linked_agreement_token) {
    return `/agreements/magic/${row.linked_agreement_token}`;
  }
  return row?.details_url || row?.action_target || row?.url || "";
}

function canAcceptCustomerBid(row) {
  if (!row) return false;
  if (row.linked_agreement_id) return false;
  if (row.status_group === "declined_expired") return false;
  return Boolean(row.can_accept);
}

export default function CustomerPortalPage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();

  const [requestEmail, setRequestEmail] = useState("");
  const [requestingLink, setRequestingLink] = useState(false);
  const [requestSent, setRequestSent] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [passwordForm, setPasswordForm] = useState({ password: "", password_confirm: "" });
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [loading, setLoading] = useState(Boolean(token));
  const [loadError, setLoadError] = useState("");
  const [portal, setPortal] = useState(null);
  const [selected, setSelected] = useState(null);
  const [compareRequest, setCompareRequest] = useState(null);
  const [acceptingBidId, setAcceptingBidId] = useState(null);

  useEffect(() => {
    let mounted = true;

    async function loadPortal() {
      if (!token) {
        setLoading(false);
        setLoadError("");
        setPortal(null);
        return;
      }

      setLoading(true);
      setLoadError("");
      try {
        const { data } = await api.get(`/projects/customer-portal/${encodeURIComponent(token)}/`);
        if (!mounted) return;
        setPortal(data);
      } catch (error) {
        if (!mounted) return;
        const detail = error?.response?.data?.detail || "We could not open that portal link.";
        setLoadError(detail);
        setPortal(null);
        toast.error(detail);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadPortal();
    return () => {
      mounted = false;
    };
  }, [token]);

  const summary = portal?.summary || {};
  const requests = Array.isArray(portal?.requests) ? portal.requests : [];
  const bids = Array.isArray(portal?.bids) ? portal.bids : [];
  const agreements = Array.isArray(portal?.agreements) ? portal.agreements : [];
  const payments = Array.isArray(portal?.payments) ? portal.payments : [];
  const documents = Array.isArray(portal?.documents) ? portal.documents : [];

  const portalTitle = portal?.customer?.name ? `${portal.customer.name} - MyHomeBro Records` : "MyHomeBro Records";
  const compareBids = useMemo(() => {
    if (!compareRequest) return [];
    const key = compareRequest.comparison_key || "";
    return bids.filter((bid) => (bid.comparison_key || "") === key);
  }, [compareRequest, bids]);

  const compareableRequests = useMemo(
    () => requests.filter((row) => Number(row.bids_count || 0) > 1 && !row.agreement_id),
    [requests]
  );

  const handleAcceptBid = async (bid) => {
    const bidKey = bid?.id || "";
    if (!token || !bidKey) return;
    setAcceptingBidId(bidKey);
    try {
      const { data } = await api.post(
        `/projects/customer-portal/${encodeURIComponent(token)}/bids/${encodeURIComponent(bidKey)}/accept/`
      );
      if (data?.portal) {
        setPortal(data.portal);
      }
      toast.success(
        data?.created ? "Your bid has been accepted and your agreement is ready." : "This bid is already linked to an agreement."
      );
      if (data?.detail_url) {
        setSelected(null);
      }
    } catch (error) {
      toast.error(error?.response?.data?.detail || "We could not accept that bid right now.");
    } finally {
      setAcceptingBidId("");
    }
  };

  const sections = useMemo(
    () => [
      {
        key: "requests",
        title: "My Requests",
        rows: requests,
        emptyText: "Your project requests will appear here once they are started.",
        columns: [
          { key: "project", label: "Project", render: (row) => <div className="font-semibold text-slate-900">{row.project_title}</div> },
          { key: "class", label: "Project Class", render: (row) => <Badge>{row.project_class_label}</Badge> },
          { key: "activity", label: "Latest Activity", render: (row) => row.latest_activity ? formatDate(row.latest_activity) : "—" },
          { key: "bids", label: "Bids", render: (row) => String(row.bids_count ?? 0) },
          { key: "status", label: "Status", render: (row) => <Badge tone={row.status === "converted" ? "emerald" : row.status === "submitted" ? "indigo" : "amber"}>{row.status_label}</Badge> },
          {
            key: "action",
            label: "Action",
            render: (row) =>
              openTarget(row) ? (
                <a
                  href={openTarget(row)}
                  className="inline-flex items-center gap-1 font-semibold text-indigo-700 hover:text-indigo-900"
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  Open
                  <ExternalLink size={14} />
                </a>
              ) : row.bids_count > 1 ? (
                <button
                  type="button"
                  className="font-semibold text-indigo-700 hover:text-indigo-900"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCompareRequest(row);
                  }}
                >
                  Compare bids
                </button>
              ) : (
                <button
                  type="button"
                  className="font-semibold text-indigo-700 hover:text-indigo-900"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelected({ kind: "request", row });
                  }}
                >
                  View
                </button>
              ),
          },
        ],
        kind: "request",
      },
      {
        key: "bids",
        title: "Bids",
        rows: bids,
        emptyText: "Bids will appear here when contractors respond to your request.",
        columns: [
          { key: "project", label: "Project", render: (row) => <div className="font-semibold text-slate-900">{row.project_title}</div> },
          { key: "contractor", label: "Contractor", render: (row) => row.contractor_name || "Your contractor" },
          { key: "class", label: "Project Class", render: (row) => <Badge>{row.project_class_label}</Badge> },
          { key: "amount", label: "Bid Amount", render: (row) => row.bid_amount_label || "—" },
          { key: "status", label: "Status", render: (row) => <Badge tone={row.status === "awarded" ? "emerald" : row.status === "under_review" ? "amber" : "slate"}>{row.status_label}</Badge> },
          {
            key: "action",
            label: "Action",
            render: (row) =>
              openTarget(row) ? (
                <a
                  href={openTarget(row)}
                  className="inline-flex items-center gap-1 font-semibold text-indigo-700 hover:text-indigo-900"
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  {row.next_action?.label || "Open"}
                  <ExternalLink size={14} />
                </a>
              ) : row.can_accept ? (
                <button
                  type="button"
                  className="font-semibold text-indigo-700 hover:text-indigo-900"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelected({ kind: "bid", row });
                  }}
                >
                  View
                </button>
              ) : (
                <button
                  type="button"
                  className="font-semibold text-indigo-700 hover:text-indigo-900"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelected({ kind: "bid", row });
                  }}
                >
                  View
                </button>
              ),
          },
        ],
        kind: "bid",
      },
      {
        key: "agreements",
        title: "Agreements",
        rows: agreements,
        emptyText: "Your signed and active agreements will appear here.",
        columns: [
          { key: "project", label: "Project", render: (row) => <div className="font-semibold text-slate-900">{row.project_title}</div> },
          { key: "contractor", label: "Contractor", render: (row) => row.contractor_name || "Your contractor" },
          { key: "class", label: "Project Class", render: (row) => <Badge>{row.project_class_label}</Badge> },
          { key: "status", label: "Status", render: (row) => <Badge tone={row.is_fully_signed ? "emerald" : "amber"}>{row.status_label}</Badge> },
          {
            key: "action",
            label: "Action",
            render: (row) =>
              openTarget(row) ? (
                <a
                  href={openTarget(row)}
                  className="inline-flex items-center gap-1 font-semibold text-indigo-700 hover:text-indigo-900"
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  View Agreement
                  <ExternalLink size={14} />
                </a>
              ) : (
                <button
                  type="button"
                  className="font-semibold text-indigo-700 hover:text-indigo-900"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelected({ kind: "agreement", row });
                  }}
                >
                  View
                </button>
              ),
          },
        ],
        kind: "agreement",
      },
      {
        key: "payments",
        title: "Payments",
        rows: payments,
        emptyText: "Completed payments will appear here once funds are paid out.",
        columns: [
          { key: "project", label: "Project", render: (row) => <div className="font-semibold text-slate-900">{row.project_title}</div> },
          { key: "type", label: "Type", render: (row) => <Badge>{row.record_type_label}</Badge> },
          { key: "date", label: "Date", render: (row) => formatDate(row.date) },
          { key: "amount", label: "Amount", render: (row) => row.amount_label || "—" },
          { key: "status", label: "Status", render: (row) => <Badge tone={row.status_label === "Paid" ? "emerald" : "amber"}>{row.status_label}</Badge> },
          {
            key: "action",
            label: "Action",
            render: (row) =>
              openTarget(row) ? (
                <a
                  href={openTarget(row)}
                  className="inline-flex items-center gap-1 font-semibold text-indigo-700 hover:text-indigo-900"
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  Open
                  <ExternalLink size={14} />
                </a>
              ) : (
                <button
                  type="button"
                  className="font-semibold text-indigo-700 hover:text-indigo-900"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelected({ kind: "payment", row });
                  }}
                >
                  View
                </button>
              ),
          },
        ],
        kind: "payment",
      },
      {
        key: "documents",
        title: "Documents",
        rows: documents,
        emptyText: "Agreement files and shared documents will appear here when available.",
        columns: [
          { key: "title", label: "Title", render: (row) => <div className="font-semibold text-slate-900">{row.title}</div> },
          { key: "type", label: "Type", render: (row) => <Badge>{row.type_label}</Badge> },
          { key: "project", label: "Project", render: (row) => row.project_title },
          { key: "date", label: "Updated", render: (row) => formatDate(row.date) },
          {
            key: "action",
            label: "Action",
            render: (row) =>
              row.url ? (
                <a
                  href={row.url}
                  className="inline-flex items-center gap-1 font-semibold text-indigo-700 hover:text-indigo-900"
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  Open
                  <ExternalLink size={14} />
                </a>
              ) : (
                <button
                  type="button"
                  className="font-semibold text-indigo-700 hover:text-indigo-900"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelected({ kind: "document", row });
                  }}
                >
                  View
                </button>
              ),
          },
        ],
        kind: "document",
      },
    ],
    [requests, bids, agreements, payments, documents]
  );

  const selectedPairs = detailPairs(selected?.kind, selected?.row);

  const handleCustomerLogin = async (event) => {
    event.preventDefault();
    setLoginLoading(true);
    setLoginError("");
    try {
      const loginResponse = await api.post("/auth/login/", {
        email: loginForm.email.trim().toLowerCase(),
        password: loginForm.password,
      });
      const access = loginResponse.data?.access || loginResponse.data?.access_token;
      const refresh = loginResponse.data?.refresh || loginResponse.data?.refresh_token;
      if (!access) throw new Error("Login succeeded but no token was returned.");
      setTokens(access, refresh || null, true);
      const { data } = await api.get("/projects/customer-portal/account/");
      setPortal(data);
      toast.success("Welcome back to your Customer Portal.");
    } catch (error) {
      const message = error?.response?.data?.detail || "Invalid email or password.";
      setLoginError(message);
      toast.error(message);
    } finally {
      setLoginLoading(false);
    }
  };

  const handleCreatePassword = async (event) => {
    event.preventDefault();
    if (!token) return;
    setSavingPassword(true);
    setPasswordError("");
    try {
      const { data } = await api.post(`/projects/customer-portal/${encodeURIComponent(token)}/create-password/`, passwordForm);
      if (data?.portal) setPortal(data.portal);
      setPasswordSaved(true);
      setPasswordForm({ password: "", password_confirm: "" });
      toast.success("Password created for next time.");
    } catch (error) {
      const responseData = error?.response?.data || {};
      const message =
        responseData?.detail ||
        responseData?.password?.[0] ||
        responseData?.password_confirm?.[0] ||
        responseData?.non_field_errors?.[0] ||
        "Could not create that password.";
      setPasswordError(message);
      toast.error(message);
    } finally {
      setSavingPassword(false);
    }
  };

  if (portal) {
    const showCreatePasswordPrompt = Boolean(token && portal?.account && !portal.account.has_usable_password && !passwordSaved);
    return (
      <div className="relative">
        <CustomerDashboard
          portal={portal}
          token={token || portal?.account?.portal_token || ""}
          onPortalUpdate={(nextPortal) => {
            if (nextPortal) setPortal(nextPortal);
          }}
        />
        {showCreatePasswordPrompt ? (
          <div data-testid="customer-portal-create-password-prompt" className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-xl rounded-3xl border border-amber-300/45 bg-slate-950/95 p-5 text-white shadow-2xl shadow-slate-950/50 backdrop-blur">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-200">Faster access next time</div>
            <h2 className="mt-1 text-lg font-bold">Create a password for faster access next time.</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              This uses the verified customer email connected to this secure portal link.
            </p>
            <form onSubmit={handleCreatePassword} className="mt-4 grid gap-3 sm:grid-cols-2">
              <input
                data-testid="customer-portal-create-password-input"
                type="password"
                value={passwordForm.password}
                onChange={(event) => setPasswordForm((prev) => ({ ...prev, password: event.target.value }))}
                placeholder="Password"
                className="min-h-11 rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-amber-300"
                required
              />
              <input
                data-testid="customer-portal-create-password-confirm-input"
                type="password"
                value={passwordForm.password_confirm}
                onChange={(event) => setPasswordForm((prev) => ({ ...prev, password_confirm: event.target.value }))}
                placeholder="Confirm password"
                className="min-h-11 rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-amber-300"
                required
              />
              {passwordError ? (
                <div data-testid="customer-portal-create-password-error" className="sm:col-span-2 rounded-xl border border-rose-300/35 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">
                  {passwordError}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                <button
                  type="submit"
                  disabled={savingPassword}
                  className="rounded-xl bg-amber-300 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-amber-200 disabled:opacity-60"
                >
                  {savingPassword ? "Saving..." : "Create Password"}
                </button>
                <button
                  type="button"
                  onClick={() => setPasswordSaved(true)}
                  className="rounded-xl border border-slate-600 bg-slate-900 px-4 py-2 text-sm font-semibold text-slate-200 hover:border-slate-400"
                >
                  Maybe later
                </button>
              </div>
            </form>
          </div>
        ) : null}
      </div>
    );
  }

  if (!token) {
    const valueCards = [
      {
        title: "Projects & Payments",
        copy: "Review agreements, invoices, escrow activity, and milestone progress.",
        icon: WalletCards,
      },
      {
        title: "Documents & Warranties",
        copy: "Keep agreements, receipts, photos, and warranty details organized.",
        icon: FileText,
      },
      {
        title: "Property Records",
        copy: "Build a history of completed work, service records, and important home documents.",
        icon: Home,
      },
    ];

    return (
      <div data-testid="customer-portal-access-page" className="min-h-screen overflow-x-hidden bg-slate-950 text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(251,191,36,0.18),transparent_30%),radial-gradient(circle_at_88%_8%,rgba(56,189,248,0.16),transparent_28%),linear-gradient(135deg,#020617_0%,#0f172a_46%,#082f49_100%)]" />
        <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-6 sm:px-6 lg:px-8">
          <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <Link to="/" className="inline-flex items-center gap-3">
              <img src={logo} alt="MyHomeBro" data-testid="customer-portal-logo" className="h-12 w-12 rounded-2xl object-cover shadow-lg shadow-blue-950/30" />
              <span>
                <span className="block text-xl font-bold tracking-tight">MyHome<span className="text-amber-300">Bro</span></span>
                <span className="block text-xs font-semibold uppercase tracking-[0.2em] text-amber-100/75">Customer Portal</span>
              </span>
            </Link>
            <nav className="flex flex-wrap gap-2">
              <Link
                to="/start-project"
                data-testid="customer-portal-start-project-link"
                className="inline-flex min-h-11 items-center justify-center rounded-xl border border-amber-200/45 bg-amber-300/15 px-4 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-300/25"
              >
                Start a Project
              </Link>
              <Link
                to="/"
                data-testid="customer-portal-back-home-link"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-600 bg-slate-950/60 px-4 py-2 text-sm font-semibold text-slate-200 hover:border-slate-400"
              >
                <ArrowLeft size={16} />
                Back to Home
              </Link>
            </nav>
          </header>

          <main className="grid flex-1 items-center gap-8 py-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(390px,0.75fr)] lg:py-16">
            <section className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-200/35 bg-amber-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-100">
                <ShieldCheck size={14} />
                Secure customer workspace
              </div>
              <h1 className="mt-5 text-4xl font-black tracking-tight text-white sm:text-5xl lg:text-6xl">
                Customer Portal
              </h1>
              <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-200">
                Access your projects, payments, documents, warranties, and property records in one secure place.
              </p>
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                {[
                  "Project updates and milestones",
                  "Secure payment and invoice review",
                  "Documents, warranties, and home records",
                ].map((item) => (
                  <div key={item} className="rounded-2xl border border-white/10 bg-slate-950/45 p-4 text-sm font-semibold leading-6 text-slate-100">
                    <div className="mb-3 h-1.5 w-10 rounded-full bg-amber-300" />
                    {item}
                  </div>
                ))}
              </div>

              <div className="mt-8 grid gap-4 md:grid-cols-3">
                {valueCards.map(({ title, copy, icon: Icon }) => (
                  <article key={title} className="rounded-3xl border border-slate-700/80 bg-slate-900/60 p-5 shadow-xl shadow-slate-950/20 backdrop-blur">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-amber-200/35 bg-amber-300/15 text-amber-100">
                      <Icon size={20} />
                    </div>
                    <h2 className="mt-4 text-base font-bold text-white">{title}</h2>
                    <p className="mt-2 text-sm leading-6 text-slate-300">{copy}</p>
                  </article>
                ))}
              </div>
            </section>

            <section className="space-y-4 rounded-3xl border border-white/10 bg-slate-950/72 p-5 shadow-2xl shadow-slate-950/40 backdrop-blur sm:p-6" data-testid="customer-portal-access-card">
              <div className="flex items-start gap-3">
                <div className="rounded-2xl border border-amber-200/40 bg-amber-300/15 p-3 text-amber-100">
                  <ShieldCheck size={22} />
                </div>
                <div>
                  <h2 className="text-2xl font-bold tracking-tight text-white">Welcome back to MyHomeBro</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    Log in to open your Customer Portal, or use a secure access link if you have not created a password yet.
                  </p>
                </div>
              </div>

              <form onSubmit={handleCustomerLogin} data-testid="customer-portal-login-form" className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4">
                <div className="text-sm font-bold text-white">Returning customer login</div>
                <div className="mt-3 grid gap-3">
                  <input
                    data-testid="customer-portal-login-email-input"
                    type="email"
                    value={loginForm.email}
                    onChange={(event) => {
                      setLoginForm((prev) => ({ ...prev, email: event.target.value }));
                      setLoginError("");
                    }}
                    placeholder="Email"
                    className="min-h-12 rounded-xl border border-slate-600 bg-slate-950 px-4 py-3 text-base text-white outline-none placeholder:text-slate-500 focus:border-amber-300"
                    required
                  />
                  <input
                    data-testid="customer-portal-login-password-input"
                    type="password"
                    value={loginForm.password}
                    onChange={(event) => {
                      setLoginForm((prev) => ({ ...prev, password: event.target.value }));
                      setLoginError("");
                    }}
                    placeholder="Password"
                    className="min-h-12 rounded-xl border border-slate-600 bg-slate-950 px-4 py-3 text-base text-white outline-none placeholder:text-slate-500 focus:border-amber-300"
                    required
                  />
                  {loginError ? (
                    <div data-testid="customer-portal-login-error" className="rounded-xl border border-rose-300/35 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
                      {loginError}
                    </div>
                  ) : null}
                  <button
                    type="submit"
                    data-testid="customer-portal-login-button"
                    disabled={loginLoading}
                    className="inline-flex min-h-12 items-center justify-center rounded-xl bg-amber-300 px-5 py-3 text-sm font-black text-slate-950 shadow-[0_12px_30px_rgba(251,191,36,0.2)] hover:bg-amber-200 disabled:opacity-60"
                  >
                    {loginLoading ? "Logging in..." : "Log In"}
                  </button>
                  <Link to="/forgot-password" className="text-sm font-semibold text-amber-100 hover:text-amber-50">
                    Forgot Password?
                  </Link>
                </div>
              </form>

              <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-xl border border-sky-300/35 bg-sky-400/10 p-2 text-sky-100">
                    <Mail size={18} />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-white">Need a secure access link?</div>
                    <p className="mt-1 text-sm leading-6 text-slate-300">
                      Enter the email address connected to your project. We'll send a secure link to access your customer records.
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <input
                    data-testid="customer-portal-email-input"
                    type="email"
                    value={requestEmail}
                    onChange={(e) => {
                      setRequestEmail(e.target.value);
                      setRequestError("");
                    }}
                    placeholder="you@example.com"
                    className="min-h-12 min-w-0 flex-1 rounded-xl border border-slate-600 bg-slate-950 px-4 py-3 text-base text-white outline-none placeholder:text-slate-500 focus:border-amber-300"
                  />
                  <button
                    type="button"
                    data-testid="customer-portal-send-link-button"
                    disabled={requestingLink}
                    onClick={async () => {
                      const email = requestEmail.trim();
                      if (!email) {
                        const message = "Please enter the email address connected to your project.";
                        setRequestError(message);
                        toast.error(message);
                        return;
                      }
                      setRequestingLink(true);
                      setRequestError("");
                      try {
                        await api.post("/projects/customer-portal/request-link/", { email });
                        setRequestSent(true);
                        toast.success("If we found your records, we sent a secure link.");
                      } catch (error) {
                        const message = error?.response?.data?.detail || "We could not send the link right now.";
                        setRequestError(message);
                        toast.error(message);
                      } finally {
                        setRequestingLink(false);
                      }
                    }}
                    className="inline-flex min-h-12 items-center justify-center rounded-xl bg-amber-300 px-5 py-3 text-sm font-black text-slate-950 shadow-[0_12px_30px_rgba(251,191,36,0.2)] hover:bg-amber-200 disabled:opacity-60"
                  >
                    {requestingLink ? "Sending..." : "Email Me a Secure Link"}
                  </button>
                </div>
                {requestSent ? (
                  <div data-testid="customer-portal-link-sent" className="mt-4 rounded-xl border border-emerald-300/35 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
                    If we found a matching project record, a secure portal link is on the way.
                  </div>
                ) : null}
                {requestError ? (
                  <div data-testid="customer-portal-link-error" className="mt-4 rounded-xl border border-rose-300/35 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
                    {requestError}
                  </div>
                ) : null}
              </div>

              <div className="rounded-2xl border border-slate-700 bg-slate-900/55 p-4">
                <div className="flex items-start gap-3 text-sm leading-6 text-slate-300">
                  <ShieldCheck className="mt-0.5 shrink-0 text-amber-100" size={18} />
                  <p>Only records connected to your email will be shown.</p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Link to="/start-project" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-amber-200/45 bg-amber-300/15 px-4 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-300/25">
                  <FolderKanban size={16} />
                  Start a Project
                </Link>
                <Link to="/" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-600 bg-slate-950/70 px-4 py-2 text-sm font-semibold text-slate-200 hover:border-slate-400">
                  Back to Home
                </Link>
              </div>
            </section>
          </main>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto max-w-6xl rounded-3xl border bg-white p-8 shadow-sm">
          <div className="text-sm font-semibold uppercase tracking-wide text-slate-500">MyHomeBro Records</div>
          <div className="mt-3 text-2xl font-bold text-slate-900">Loading your records...</div>
          <div className="mt-2 text-sm text-slate-600">We are opening your secure portal.</div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto max-w-6xl rounded-3xl border bg-white p-8 shadow-sm">
          <div className="text-sm font-semibold uppercase tracking-wide text-slate-500">MyHomeBro Records</div>
          <div className="mt-3 text-2xl font-bold text-slate-900">We could not open that link</div>
          <div className="mt-2 text-sm text-slate-600">{loadError}</div>
          <div className="mt-6">
            <button
              type="button"
              onClick={() => navigate("/portal")}
              className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              Request a new link
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Legacy fallback shell retained only as a defensive no-token/no-payload path.
  // The active Customer Portal experience is CustomerDashboard above.
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto max-w-7xl">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
          <div className="flex flex-col gap-4 border-b border-slate-200 pb-6 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">MyHomeBro Records</div>
              <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">
                {portalTitle}
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                Track your requests, bids, agreements, payments, and documents in one secure place.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                to="/portal"
                className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Request new link
              </Link>
              <Link
                to="/start-project"
                className="inline-flex items-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                Start a project
              </Link>
            </div>
          </div>

          <div data-testid="customer-portal-summary" className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <SummaryCard label="Active Requests" value={summary.active_requests ?? 0} tone="indigo" testId="customer-portal-summary-active-requests" />
            <SummaryCard label="Bids Received" value={summary.bids_received ?? 0} tone="amber" testId="customer-portal-summary-bids" />
            <SummaryCard label="Active Agreements" value={summary.active_agreements ?? 0} tone="emerald" testId="customer-portal-summary-agreements" />
            <SummaryCard label="Payments" value={summary.payments ?? 0} tone="slate" testId="customer-portal-summary-payments" />
            <SummaryCard label="Documents" value={summary.documents ?? 0} tone="slate" testId="customer-portal-summary-documents" />
          </div>

          <div className="mt-8 space-y-8">
            {sections.map((section) => (
              <section key={section.key} className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-950">{section.title}</h2>
                    <div className="text-sm text-slate-600">{section.rows.length} item{section.rows.length === 1 ? "" : "s"}</div>
                  </div>
                  {section.key === "bids" && compareableRequests.length ? (
                    <button
                      type="button"
                      data-testid="customer-portal-compare-bids-button"
                      className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      onClick={() => setCompareRequest(compareableRequests[0])}
                    >
                      Compare bids
                    </button>
                  ) : null}
                </div>
                <SectionTable
                  testId={`customer-portal-${section.key}`}
                  rows={section.rows}
                  columns={section.columns}
                  emptyText={section.emptyText}
                  onRowClick={(row) => setSelected({ kind: section.kind, row })}
                />
              </section>
            ))}
          </div>
        </div>
      </div>

      <Modal
        visible={!!selected}
        title={
          selected?.kind === "request"
            ? "Request details"
            : selected?.kind === "bid"
              ? "Bid details"
              : selected?.kind === "agreement"
                ? "Agreement details"
                : selected?.kind === "payment"
                  ? "Payment details"
                  : "Document details"
        }
        onClose={() => setSelected(null)}
      >
            {selected ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {selectedPairs.map(([label, value]) => (
                <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
                  <div className="mt-1 text-sm font-medium text-slate-900">{value || "—"}</div>
                </div>
              ))}
            </div>
            {openTarget(selected.row) ? (
              <a
                href={openTarget(selected.row)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                Open linked item
                <ExternalLink size={14} />
              </a>
            ) : null}
            {selected?.kind === "bid" && selected?.row?.can_accept ? (
              <button
                type="button"
                data-testid="customer-portal-bid-accept-button"
                onClick={() => handleAcceptBid(selected.row)}
                disabled={acceptingBidId === selected.row.id}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {acceptingBidId === selected.row.id ? "Accepting..." : "Accept Bid"}
              </button>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        visible={!!compareRequest}
        title="Compare bids"
        onClose={() => setCompareRequest(null)}
      >
        {compareRequest ? (
          <div className="space-y-4">
            <div>
              <div className="text-sm font-semibold text-slate-900">{compareRequest.project_title}</div>
              <div className="text-sm text-slate-600">{compareRequest.project_address || "Your project request"}</div>
            </div>
            {compareBids.length ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {compareBids.map((bid) => {
                  const awarded = bid.is_awarded || bid.status === "awarded";
                  return (
                    <div
                      key={bid.bid_id}
                      className={`rounded-2xl border p-4 shadow-sm ${awarded ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-base font-semibold text-slate-950">{bid.contractor_name || "Contractor"}</div>
                          <div className="mt-1 text-xs text-slate-500">{bid.project_class_label}</div>
                        </div>
                        <Badge tone={awarded ? "emerald" : bid.status_group === "under_review" ? "amber" : "slate"}>
                          {bid.status_label}
                        </Badge>
                      </div>
                      {bid.status_note ? (
                        <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                          {bid.status_note}
                        </div>
                      ) : null}

                      <div className="mt-4 text-3xl font-bold tabular-nums text-slate-950">
                        {bid.bid_amount_label || "—"}
                      </div>

                      <div className="mt-3 space-y-2 text-sm text-slate-700">
                        <div><span className="font-semibold text-slate-900">Timeline:</span> {bid.timeline || "—"}</div>
                        <div><span className="font-semibold text-slate-900">Proposal:</span> {bid.proposal_summary || "—"}</div>
                        <div><span className="font-semibold text-slate-900">Milestones:</span> {Array.isArray(bid.milestone_preview) && bid.milestone_preview.length ? bid.milestone_preview.join(", ") : "—"}</div>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                          onClick={() => setSelected({ kind: "bid", row: bid })}
                        >
                          View details
                        </button>
                        {bid.linked_agreement_id ? (
                          <a
                            data-testid={`customer-portal-compare-open-${bid.id}`}
                            href={openTarget(bid)}
                            className="rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                          >
                            Open Agreement
                          </a>
                        ) : canAcceptCustomerBid(bid) ? (
                          <button
                            type="button"
                            data-testid={`customer-portal-compare-accept-${bid.id}`}
                            onClick={() => handleAcceptBid(bid)}
                            disabled={acceptingBidId === bid.id}
                            className="rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                          >
                            {acceptingBidId === bid.id ? "Accepting..." : "Accept Bid"}
                          </button>
                        ) : (
                          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                            Another contractor was selected for this project.
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">
                We do not have multiple bids for this request yet.
              </div>
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
