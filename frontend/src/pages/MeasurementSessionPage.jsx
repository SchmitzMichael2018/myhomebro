import React, { useEffect, useState } from "react";
import { ArrowLeft, Camera, Ruler } from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { getMeasurementSession } from "../api/captures.js";
import { InlineAlert } from "../components/ui";

function friendly(value) {
  return String(value || "").replaceAll("_", " ");
}

export default function MeasurementSessionPage() {
  const { sessionId } = useParams();
  const [session, setSession] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getMeasurementSession(sessionId).then(setSession).catch((reason) => setError(reason?.response?.data?.detail || "Measurement session could not be loaded."));
  }, [sessionId]);

  if (error) return <div className="p-4 sm:p-6"><InlineAlert theme="operational" tone="danger">{error}</InlineAlert></div>;
  if (!session) return <div className="p-6 text-[var(--mhb-text-muted)]">Loading measurement session…</div>;

  return (
    <main className="min-w-0 p-4 sm:p-6" data-testid="measurement-session-page">
      <Link to={`/app/capture/${session.source_capture_id}`} className="mb-4 inline-flex min-h-11 items-center gap-2 text-sm font-bold text-blue-400"><ArrowLeft size={17} /> Source Capture receipt</Link>
      <header className="mb-5">
        <div className="text-xs font-bold uppercase tracking-widest text-[var(--mhb-text-muted)]">Measurement session</div>
        <h1 className="mt-1 text-2xl font-bold">{session.room_name}</h1>
        <p className="mt-1 text-sm text-[var(--mhb-text-secondary)]">{session.project_title} · {friendly(session.purpose)} · Version {session.version}</p>
      </header>
      <InlineAlert theme="operational" tone={session.status === "confirmed" ? "success" : "warning"}>
        Status: {friendly(session.status)}. Calculations cannot be more reliable than their least-trusted input.
      </InlineAlert>
      <div className="mt-5 grid min-w-0 gap-5 lg:grid-cols-2">
        <section className="rounded-2xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-card)] p-4">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-bold"><Ruler size={19} /> Readings</h2>
          <div className="grid gap-3">
            {session.entries.map((entry) => (
              <article key={entry.id} className="min-w-0 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] p-3">
                <div className="flex flex-wrap justify-between gap-2"><strong>{entry.label}</strong><span className="rounded-full border border-[var(--mhb-border-default)] px-2 py-0.5 text-xs font-bold">{friendly(entry.verification_status)}</span></div>
                <div className="mt-1 break-words text-lg">{entry.raw_value}</div>
                <div className="mt-1 text-xs text-[var(--mhb-text-muted)]">{friendly(entry.dimension_type)} · {friendly(entry.source_method)} · {entry.measured_by_name || "Unknown"} · {new Date(entry.measured_at).toLocaleString()}</div>
              </article>
            ))}
          </div>
        </section>
        <section className="rounded-2xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-card)] p-4">
          <h2 className="mb-3 text-lg font-bold">Deterministic calculations</h2>
          <div className="grid gap-3">
            {session.calculated_results.map((result) => (
              <article key={result.id} className="rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] p-3">
                <div className="flex flex-wrap justify-between gap-2"><strong>{result.label}</strong><span>{result.display_value} {friendly(result.display_unit)}</span></div>
                <div className="mt-1 text-xs text-[var(--mhb-text-muted)]">{result.formula_key} · calculation v{result.calculation_version} · {friendly(result.verification_status)}</div>
                <div className="mt-1 break-all text-xs text-[var(--mhb-text-muted)]">Inputs: {result.source_entry_keys.join(", ")}</div>
              </article>
            ))}
            {!session.calculated_results.length ? <p className="text-sm text-[var(--mhb-text-muted)]">No complete guided calculation is available yet.</p> : null}
          </div>
        </section>
        <section className="rounded-2xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-card)] p-4">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-bold"><Camera size={19} /> Photos and annotations</h2>
          {session.attachments.length ? session.attachments.map((attachment) => <a key={attachment.id} href={attachment.download_url} className="block min-h-11 break-words text-blue-400">{attachment.filename} · {attachment.annotations.length} annotation(s)</a>) : <p className="text-sm text-[var(--mhb-text-muted)]">No reference photos attached.</p>}
        </section>
        <section className="rounded-2xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-card)] p-4">
          <h2 className="mb-3 text-lg font-bold">Revision history</h2>
          <ol className="grid gap-2 text-sm">{session.events.map((event) => <li key={event.id}><strong>{friendly(event.event_type)}</strong> · v{event.session_version} · {event.actor_name} · {new Date(event.created_at).toLocaleString()}</li>)}</ol>
        </section>
      </div>
    </main>
  );
}
