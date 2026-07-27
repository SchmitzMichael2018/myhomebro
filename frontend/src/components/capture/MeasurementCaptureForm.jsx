import React, { useCallback, useEffect, useState } from 'react';

import {
  createProjectCapture,
  getCaptureProjectOptions,
} from '../../api/captures.js';
import { Button, InlineAlert } from '../ui';
import ManualMeasurementEditor, {
  createManualMeasurement,
} from './ManualMeasurementEditor.jsx';

const PURPOSES = [
  'flooring',
  'wall_finish',
  'painting',
  'ceiling',
  'door',
  'window',
  'cabinetry',
  'countertop',
  'fencing',
  'roofing',
  'general_room',
  'custom',
];

export default function MeasurementCaptureForm({
  onSaved,
  onCancel,
  initialProjectId = '',
  initialDimensions = null,
  initialSourceText = '',
  initialFiles = [],
}) {
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(initialProjectId);
  const [roomName, setRoomName] = useState('');
  const [purpose, setPurpose] = useState('general_room');
  const [measurement, setMeasurement] = useState(() => ({
    ...createManualMeasurement(),
    ...(initialDimensions?.length ? { length: initialDimensions.length } : {}),
    ...(initialDimensions?.width ? { width: initialDimensions.width } : {}),
  }));
  const [preview, setPreview] = useState(null);
  const [files, setFiles] = useState(initialFiles);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const handlePreview = useCallback(setPreview, []);

  useEffect(() => {
    getCaptureProjectOptions()
      .then(setProjects)
      .catch(() =>
        setError(
          'Projects could not be loaded. Check your connection and try again.'
        )
      );
  }, []);

  async function submit(event) {
    event.preventDefault();
    if (!preview)
      return setError(
        'Complete the dimensions and wait for the authoritative calculation.'
      );
    setError('');
    setBusy(true);
    try {
      const capture = await createProjectCapture(
        {
          capture_type: 'measurement',
          capture_method: 'typed',
          project_id: Number(projectId),
          raw_text_payload: {
            text: initialSourceText || `Manual ${measurement.profile.replaceAll('_', ' ')} measurement`,
            input_metadata: {
              room_name: roomName,
              room_type: 'general_room',
              purpose,
              guided_profile: measurement.profile,
              tolerance_profile:
                purpose === 'cabinetry'
                  ? 'cabinetry'
                  : purpose === 'countertop'
                    ? 'countertop'
                    : 'general_construction',
              entries: preview.entries,
              adjustments: preview.adjustments,
              annotations: [],
              conversational_source_text: initialSourceText,
            },
          },
        },
        files
      );
      onSaved(capture);
    } catch (reason) {
      setError(
        reason?.response?.data?.detail ||
          'Measurement could not be saved. Your entries remain on this screen.'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="grid min-w-0 gap-4 pb-20 sm:pb-0"
      data-testid="measurement-capture-form"
    >
      <div>
        <h2 className="text-xl font-bold">Enter Measurements</h2>
        <p className="mt-1 text-sm text-[var(--mhb-text-secondary)]">
          Manual dimensions are the primary path. Plan and photo tools remain
          available after review.
        </p>
      </div>
      <label className="grid gap-1 text-sm font-semibold">
        Project
        <select
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
          required
          className="min-h-12 w-full rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3"
        >
          <option value="">Choose a project</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.title}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold">
          Room or area
          <input
            value={roomName}
            onChange={(event) => setRoomName(event.target.value)}
            required
            placeholder="Kitchen flooring"
            className="min-h-12 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3"
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Purpose
          <select
            value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
            className="min-h-12 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3"
          >
            {PURPOSES.map((value) => (
              <option key={value} value={value}>
                {value.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ManualMeasurementEditor
        projectId={projectId}
        value={measurement}
        onChange={setMeasurement}
        onPreview={handlePreview}
      />
      <label className="grid gap-1 text-sm font-semibold">
        Supporting photos or documents (optional)
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          multiple
          onChange={(event) => setFiles([...event.target.files])}
        />
      </label>
      {error ? (
        <InlineAlert theme="operational" tone="danger">
          {error}
        </InlineAlert>
      ) : null}
      <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-[var(--mhb-border-default)] bg-[var(--mhb-surface-card-elevated)] p-4 sm:static sm:mx-0 sm:justify-end sm:border-0 sm:bg-transparent sm:p-0">
        <Button
          type="button"
          variant="secondary"
          theme="operational"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          theme="operational"
          loading={busy}
          disabled={!projectId || !roomName.trim() || !preview}
        >
          Save for review
        </Button>
      </div>
    </form>
  );
}
