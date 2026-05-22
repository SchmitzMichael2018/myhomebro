import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { CircleAlert, MessageSquareReply, RefreshCw, Send, Ticket } from "lucide-react";

import { getSupportTicket, listSupportTickets, replyToSupportTicket } from "../api";
import ContractorPageSurface from "../components/dashboard/ContractorPageSurface.jsx";
import SupportRequestModal from "../components/SupportRequestModal.jsx";
import { useWhoAmI } from "../hooks/useWhoAmI.js";

function fmtDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return String(value);
  }
}

function Badge({ children, tone = "slate" }) {
  const tones = {
    slate: "border-slate-200 bg-slate-50 text-slate-700",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
    rose: "border-rose-200 bg-rose-50 text-rose-800",
    blue: "border-blue-200 bg-blue-50 text-blue-800",
  };

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${tones[tone] || tones.slate}`}>
      {children}
    </span>
  );
}

function toneForStatus(status) {
  const key = String(status || "").toLowerCase();
  if (key === "resolved") return "emerald";
  if (key === "closed") return "slate";
  if (key === "in_review") return "blue";
  if (key === "waiting_on_user") return "amber";
  return "slate";
}

function toneForPriority(priority) {
  const key = String(priority || "").toLowerCase();
  if (key === "urgent") return "rose";
  if (key === "high") return "amber";
  if (key === "low") return "slate";
  return "blue";
}

function titleCase(value) {
  const text = String(value || "").replaceAll("_", " ").trim();
  if (!text) return "—";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function TicketTable({ rows, onSelect }) {
  if (!rows.length) {
    return (
      <div data-testid="support-tickets-empty" className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-sm text-slate-600">
        You have not submitted any support tickets yet.
      </div>
    );
  }

  return (
    <div data-testid="support-tickets-table" className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <th className="px-4 py-3">Ticket</th>
            <th className="px-4 py-3">Subject</th>
            <th className="px-4 py-3">Category</th>
            <th className="px-4 py-3">Priority</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Created</th>
            <th className="px-4 py-3">Updated</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((ticket) => (
            <tr
              key={ticket.ticket_number}
              data-testid={`support-ticket-row-${ticket.ticket_number}`}
              className="cursor-pointer border-b border-slate-100 last:border-b-0 hover:bg-slate-50"
              onClick={() => onSelect(ticket)}
            >
              <td className="px-4 py-3 font-semibold text-slate-900">{ticket.ticket_number}</td>
              <td className="px-4 py-3 text-slate-700">{ticket.subject}</td>
              <td className="px-4 py-3 text-slate-700">{ticket.category_display || titleCase(ticket.category)}</td>
              <td className="px-4 py-3">
                <Badge tone={toneForPriority(ticket.priority)}>{ticket.priority_display || titleCase(ticket.priority)}</Badge>
              </td>
              <td className="px-4 py-3">
                <Badge tone={toneForStatus(ticket.status)}>{ticket.status_display || titleCase(ticket.status)}</Badge>
              </td>
              <td className="px-4 py-3 text-slate-600">{fmtDate(ticket.created_at)}</td>
              <td className="px-4 py-3 text-slate-600">{fmtDate(ticket.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SupportTicketsPage() {
  const { ticketNumber } = useParams();
  const navigate = useNavigate();
  const { data: identity } = useWhoAmI();

  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(Boolean(ticketNumber));
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [supportOpen, setSupportOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replySaving, setReplySaving] = useState(false);

  const currentEmail = identity?.email || identity?.user?.email || "";

  const fetchTickets = async () => {
    setLoading(true);
    try {
      const data = await listSupportTickets();
      const rows = Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : [];
      setTickets(rows);
      return rows;
    } catch (error) {
      console.error(error);
      toast.error("Unable to load your tickets.");
      setTickets([]);
      return [];
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTickets();
  }, []);

  useEffect(() => {
    let active = true;

    async function fetchDetail() {
      if (!ticketNumber) {
        setSelectedTicket(null);
        setDetailLoading(false);
        return;
      }

      setDetailLoading(true);
      try {
        const ticket = await getSupportTicket(ticketNumber);
        if (!active) return;
        setSelectedTicket(ticket);
      } catch (error) {
        if (!active) return;
        console.error(error);
        toast.error("Unable to load that ticket.");
        setSelectedTicket(null);
        navigate("/app/support", { replace: true });
      } finally {
        if (active) setDetailLoading(false);
      }
    }

    fetchDetail();
    return () => {
      active = false;
    };
  }, [ticketNumber, navigate]);

  useEffect(() => {
    setReplyOpen(false);
    setReplyText("");
  }, [ticketNumber]);

  const selectedTicketFromList = useMemo(
    () => tickets.find((ticket) => ticket.ticket_number === ticketNumber) || null,
    [tickets, ticketNumber]
  );

  const detail = selectedTicket || selectedTicketFromList;
  const conversation = useMemo(() => {
    if (!detail) return [];
    if (Array.isArray(detail.messages) && detail.messages.length) return detail.messages;
    if (detail.message) {
      return [
        {
          id: `${detail.ticket_number || "ticket"}-initial`,
          sender_display: detail.submitted_by_name || detail.email || "User",
          sender_role_display: "User",
          message: detail.message,
          message_text: detail.message,
          created_at: detail.created_at,
          is_internal: false,
        },
      ];
    }
    return [];
  }, [detail]);

  const submitReply = async () => {
    if (!detail?.ticket_number || replySaving) return;
    const messageText = String(replyText || "").trim();
    if (!messageText) {
      toast.error("Please enter a reply message.");
      return;
    }

    setReplySaving(true);
    try {
      const updated = await replyToSupportTicket(detail.ticket_number, { message: messageText });
      setSelectedTicket(updated);
      setTickets((prev) =>
        prev.map((ticket) => (ticket.ticket_number === updated.ticket_number ? updated : ticket))
      );
      setReplyText("");
      setReplyOpen(false);
      toast.success("Reply added.");
    } catch (error) {
      console.error(error);
      toast.error("Unable to add your reply.");
    } finally {
      setReplySaving(false);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      await fetchTickets();
      if (ticketNumber) {
        const ticket = await getSupportTicket(ticketNumber);
        setSelectedTicket(ticket);
      }
      toast.success("Tickets refreshed.");
    } catch (error) {
      console.error(error);
      toast.error("Unable to refresh tickets.");
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <ContractorPageSurface
      eyebrow="Support"
      title="Support"
      subtitle="Send a support request and review your past tickets in one place."
      variant="operational"
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
          <div className="space-y-1">
            <div className="text-sm font-semibold text-slate-900">Need help?</div>
            <div className="text-sm text-slate-600">
              Open a support ticket, and we’ll send you a confirmation email with a ticket number.
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setSupportOpen(true)}
              data-testid="open-support-request-button"
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
            >
              <Ticket size={16} />
              New Support Request
            </button>
            <button
              type="button"
              onClick={refresh}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw size={16} />
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        {detail ? (
          <section data-testid="support-ticket-detail" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Ticket Detail</div>
                <h2 className="mt-1 text-2xl font-black text-slate-950">{detail.ticket_number}</h2>
                <p className="mt-1 text-sm text-slate-600">{detail.subject}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={toneForStatus(detail.status)}>{detail.status_display || titleCase(detail.status)}</Badge>
                <Badge tone={toneForPriority(detail.priority)}>{detail.priority_display || titleCase(detail.priority)}</Badge>
              </div>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <DetailCard label="Category" value={detail.category_display || titleCase(detail.category)} />
              <DetailCard label="Email" value={detail.email || "—"} />
              <DetailCard label="Created" value={fmtDate(detail.created_at)} />
              <DetailCard label="Updated" value={fmtDate(detail.updated_at)} />
              <DetailCard label="User Role" value={detail.user_role || "—"} />
              <DetailCard label="Related" value={formatRelated(detail.related_object)} />
            </div>

            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Conversation</div>
                  <div className="mt-1 text-xs text-slate-500">
                    Keep replying here so the full thread stays in one ticket.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setReplyOpen((prev) => !prev)}
                  data-testid="support-ticket-add-reply-button"
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <MessageSquareReply size={14} />
                  Add Reply
                </button>
              </div>

              <div className="mt-4 space-y-3">
                {conversation.length ? (
                  conversation.map((message, idx) => (
                    <div
                      key={message.id || `${detail.ticket_number}-message-${idx}`}
                      className="rounded-2xl border border-slate-200 bg-white p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                          {message.sender_display || message.sender_role_display || "Message"}
                        </div>
                        <div className="text-xs text-slate-500">{fmtDate(message.created_at)}</div>
                      </div>
                      <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                        {message.message || message.message_text || "—"}
                      </div>
                      {message.is_internal ? (
                        <div className="mt-2 text-xs font-semibold text-amber-700">Internal note</div>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-600">
                    No conversation messages yet.
                  </div>
                )}
              </div>

              {replyOpen ? (
                <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                  <label className="block">
                    <span className="mb-1 block text-sm font-semibold text-slate-700">Reply</span>
                    <textarea
                      data-testid="support-ticket-reply-input"
                      rows={5}
                      value={replyText}
                      onChange={(event) => setReplyText(event.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none ring-0 focus:border-slate-500"
                      placeholder="Add a follow-up message to this ticket."
                    />
                  </label>
                  <div className="mt-3 flex flex-wrap justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setReplyOpen(false)}
                      className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={submitReply}
                      disabled={replySaving}
                      data-testid="support-ticket-submit-reply-button"
                      className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Send size={16} />
                      {replySaving ? "Sending..." : "Send Follow-up"}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            {detail.attachment_url ? (
              <a
                href={detail.attachment_url}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                <CircleAlert size={16} />
                Open Attachment
              </a>
            ) : null}
          </section>
        ) : null}

        <section className="space-y-3">
          <div>
            <h3 className="text-lg font-bold text-slate-950">My Tickets</h3>
            <p className="text-sm text-slate-600">Track every support request you’ve submitted.</p>
          </div>

          {loading || detailLoading ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-600 shadow-sm">
              Loading tickets...
            </div>
          ) : (
            <TicketTable
              rows={tickets}
              onSelect={(ticket) => navigate(`/app/support/${ticket.ticket_number}`)}
            />
          )}
        </section>
      </div>

      <SupportRequestModal
        visible={supportOpen}
        onClose={() => setSupportOpen(false)}
        defaultEmail={currentEmail}
        onSubmitted={(ticket) => {
          setTickets((prev) => [ticket, ...prev.filter((row) => row.ticket_number !== ticket.ticket_number)]);
          setSelectedTicket(ticket);
        }}
      />
    </ContractorPageSurface>
  );
}

function DetailCard({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-2 text-sm font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function formatRelated(relatedObject) {
  if (!relatedObject) return "—";
  const type = relatedObject.label || relatedObject.type || "Related Item";
  const id = relatedObject.id ? ` #${relatedObject.id}` : "";
  return `${type}${id}`;
}


