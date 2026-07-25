import React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, FileImage } from "lucide-react";
import toast from "react-hot-toast";

import { archiveCapture } from "../api/captures.js";
import {
  Button,
  Card,
  InlineAlert,
  LoadingSkeleton,
  StatusBadge,
  WorkspacePageHeader,
} from "../components/ui";
import { useCapture } from "../hooks/useCaptures.js";

const LABELS = {
  quick_lead: "Quick Lead",
  quick_note: "Quick Note",
  photo: "Photo",
  receipt: "Receipt",
  opportunity: "Opportunity",
};

const STATUS_TONES = {
  saved: "draft",
  ready_for_review: "required",
  applied: "complete",
  archived: "complete",
  failed: "blocked",
  apply_failed: "blocked",
};

function ValueRow({ label, value }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className="grid gap-1 border-b border-[var(--mhb-border-divider)] py-3 sm:grid-cols-[10rem_1fr]">
      <dt className="text-sm font-bold text-[var(--mhb-text-muted)]">{label}</dt>
      <dd className="whitespace-pre-wrap break-words text-sm text-[var(--mhb-text-primary)]">
        {String(value)}
      </dd>
    </div>
  );
}

export default function CaptureDetailPage() {
  const { captureId } = useParams();
  const navigate = useNavigate();
  const { capture, loading, error, reload } = useCapture(captureId);

  async function archive() {
    try {
      await archiveCapture(capture.id, {
        expected_version: capture.version,
        reason: "Archived from Capture detail",
      });
      toast.success("Capture archived.");
      await reload();
    } catch (requestError) {
      toast.error(requestError?.response?.data?.detail || "Capture could not be archived.");
    }
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-5xl p-4 sm:p-6 lg:p-8">
        <LoadingSkeleton theme="operational" variant="workspace" label="Loading Capture" />
      </div>
    );
  }

  if (error || !capture) {
    return (
      <div className="mx-auto w-full max-w-5xl p-4 sm:p-6 lg:p-8">
        <InlineAlert theme="operational" tone="danger">
          {error || "Capture not found."}
        </InlineAlert>
      </div>
    );
  }

  const raw = capture.raw_text_payload || {};

  return (
    <div
      className="mx-auto w-full max-w-5xl space-y-5 p-4 sm:p-6 lg:p-8"
      data-testid="capture-detail"
    >
      <WorkspacePageHeader
        theme="operational"
        title={LABELS[capture.capture_type] || "Capture"}
        subtitle={`Saved ${new Date(capture.created_at).toLocaleString()}`}
        status={STATUS_TONES[capture.status] || "pending"}
        secondaryActions={
          <Button
            type="button"
            variant="secondary"
            theme="operational"
            icon={ArrowLeft}
            onClick={() => navigate("/app/capture")}
          >
            Back to Inbox
          </Button>
        }
        primaryAction={
          capture.status !== "archived" ? (
            <Button type="button" variant="secondary" theme="operational" onClick={archive}>
              Archive
            </Button>
          ) : null
        }
      />

      <Card theme="operational" padding="md">
        <h2 className="text-lg font-black">Original contents</h2>
        <dl className="mt-3">
          <ValueRow label="Name" value={raw.name} />
          <ValueRow label="Phone" value={raw.phone} />
          <ValueRow label="Email" value={raw.email} />
          <ValueRow label="Title" value={raw.title} />
          <ValueRow label="Text" value={raw.text} />
          <ValueRow label="Transcript" value={raw.transcript} />
          <ValueRow label="Notes" value={raw.notes} />
          <ValueRow label="Language" value={raw.language} />
        </dl>
      </Card>

      <Card theme="operational" padding="md">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-black">Artifacts</h2>
          <span className="text-sm text-[var(--mhb-text-muted)]">
            {capture.artifacts?.length || 0}
          </span>
        </div>
        {capture.artifacts?.length ? (
          <div className="mt-3 grid gap-3">
            {capture.artifacts.map((artifact) => (
              <div
                key={artifact.id}
                className="flex items-center gap-3 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] p-3"
              >
                <FileImage className="h-5 w-5 text-blue-500" aria-hidden="true" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold">
                    {artifact.original_filename || "Photo"}
                  </div>
                  <div className="text-xs text-[var(--mhb-text-muted)]">
                    {artifact.mime_type} · {artifact.file_size} bytes
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-[var(--mhb-text-muted)]">
            No artifacts were saved with this Capture.
          </p>
        )}
      </Card>

      <Card theme="operational" padding="md">
        <h2 className="text-lg font-black">Metadata</h2>
        <dl className="mt-3">
          <ValueRow label="Status" value={capture.status?.replaceAll("_", " ")} />
          <ValueRow label="Capture method" value={capture.capture_method?.replaceAll("_", " ")} />
          <ValueRow label="Creator" value={capture.captured_by_name || "Unknown creator"} />
          <ValueRow label="Version" value={capture.version} />
          <ValueRow label="Original timestamp" value={new Date(capture.original_captured_at).toLocaleString()} />
        </dl>
      </Card>

      <Card theme="operational" padding="md">
        <h2 className="text-lg font-black">Timeline</h2>
        <ol className="mt-3 grid gap-3">
          {(capture.events || []).map((event) => (
            <li
              key={event.id}
              className="border-l-2 border-[var(--mhb-border-selected)] pl-3"
            >
              <div className="text-sm font-bold">
                {event.event_type?.replaceAll("_", " ")}
              </div>
              <div className="text-xs text-[var(--mhb-text-muted)]">
                {new Date(event.created_at).toLocaleString()}
                {event.to_status ? ` · ${event.to_status.replaceAll("_", " ")}` : ""}
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
