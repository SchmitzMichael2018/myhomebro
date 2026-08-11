import React, { useEffect, useState } from 'react';
import api from '../api';

const contextLabel = (message) =>
  message.lifecycle_context === 'estimate'
    ? `Estimate${message.estimate_version ? ` · Version ${message.estimate_version}` : ''}`
    : message.lifecycle_context === 'agreement'
      ? 'Agreement'
      : 'Project';
const timeLabel = (value) =>
  value
    ? new Date(value).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '';

export default function CustomerConversation({
  endpoint,
  initialConversation = null,
  customerMode = false,
  title = 'Messages',
}) {
  const [conversation, setConversation] = useState(
    initialConversation || { messages: [], message_count: 0, unread_count: 0 }
  );
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!initialConversation && endpoint)
      api
        .get(endpoint)
        .then(({ data }) => setConversation(data.conversation || data))
        .catch(() => setError('Messages could not be loaded.'));
  }, [endpoint, initialConversation]);
  async function send() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const key =
        globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
      const { data } = await api.post(
        endpoint,
        { message: text },
        { headers: { 'Idempotency-Key': key } }
      );
      setConversation(data.conversation || data);
      setText('');
    } catch (reason) {
      setError(
        reason?.response?.data?.message?.[0] ||
          reason?.response?.data?.detail ||
          'Message could not be sent.'
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="min-w-0 rounded-2xl border border-white/10 bg-slate-900 p-5"
      data-testid="customer-conversation"
      aria-label={title}
    >
      <h2 className="text-lg font-black text-white">{title}</h2>
      <p className="mt-1 text-sm text-slate-300">
        {customerMode
          ? 'Ask for clarification without changing the estimate.'
          : `${conversation.message_count || 0} messages${conversation.unread_count ? ` · ${conversation.unread_count} unread` : ''}`}
      </p>
      <div
        className="mt-4 max-h-80 space-y-3 overflow-y-auto"
        role="log"
        aria-label="Conversation messages"
      >
        {(conversation.messages || []).length ? (
          conversation.messages.map((item) => (
            <article
              key={item.id}
              className="min-w-0 rounded-xl border border-white/10 bg-slate-950/35 p-3"
            >
              <div className="flex flex-col gap-1 sm:flex-row sm:justify-between">
                <strong className="text-sm text-white">
                  {item.sender_type === 'customer'
                    ? 'Customer'
                    : customerMode
                      ? 'Contractor'
                      : 'You'}
                </strong>
                <span className="text-xs text-slate-400">
                  {timeLabel(item.created_at)}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-200">
                {item.message_text}
              </p>
              <div className="mt-2 text-xs font-bold text-sky-200">
                {contextLabel(item)}
              </div>
            </article>
          ))
        ) : (
          <p className="rounded-xl border border-dashed border-white/10 p-4 text-sm text-slate-400">
            No messages yet.
          </p>
        )}
      </div>
      <label
        className="mt-4 block text-sm font-bold text-white"
        htmlFor={`conversation-reply-${customerMode ? 'customer' : 'contractor'}`}
      >
        {customerMode ? 'Ask a question' : 'Reply to customer'}
      </label>
      <textarea
        id={`conversation-reply-${customerMode ? 'customer' : 'contractor'}`}
        value={text}
        onChange={(event) => setText(event.target.value)}
        maxLength={4000}
        className="mt-2 min-h-24 w-full max-w-full rounded-xl border border-white/15 bg-slate-950 p-3 text-white"
        placeholder={
          customerMode ? 'What would you like to clarify?' : 'Write a reply'
        }
      />
      {error ? (
        <p className="mt-2 text-sm text-rose-300" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        onClick={send}
        disabled={!text.trim() || busy}
        className="mt-3 min-h-11 rounded-lg bg-sky-300 px-4 py-2 font-black text-slate-950 disabled:opacity-50"
        data-testid="conversation-send"
      >
        {busy ? 'Sending…' : customerMode ? 'Send Question' : 'Send Reply'}
      </button>
      {customerMode ? (
        <p className="mt-2 text-xs text-slate-400">
          For changes to scope, pricing, or schedule, use Request Changes
          instead.
        </p>
      ) : null}
    </section>
  );
}
