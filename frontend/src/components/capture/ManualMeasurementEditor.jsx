import React, { useEffect, useId, useRef, useState } from 'react';
import { Minus, Plus, Trash2 } from 'lucide-react';

import { previewManualMeasurement } from '../../api/captures.js';
import { Button, InlineAlert } from '../ui';

const TYPES = [
  ['linear_measurement', 'Linear measurement'],
  ['rectangle', 'Rectangle'],
  ['wall_with_deductions', 'Wall area with deductions'],
  ['multi_section_area', 'Multiple-section area'],
];
const SOURCES = [
  ['field_verified_manual', 'Field verified'],
  ['approximate_manual', 'Approximate'],
  ['laser_manual', 'Manual laser reading'],
  ['plan_derived', 'From plan'],
  ['photo_estimated', 'Photo estimate'],
];

const key = () => crypto.randomUUID();
const newDeduction = () => ({
  deduction_key: key(),
  type: 'door',
  label: 'Door',
  width: '',
  height: '',
  quantity: 1,
});
const newSection = (label = 'Main area') => ({
  section_key: key(),
  label,
  operation: 'add',
  length: '',
  width: '',
  notes: '',
});

export default function ManualMeasurementEditor({
  projectId,
  value,
  onChange,
  onPreview,
}) {
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    setPreview(null);
    onPreview?.(null);
    if (!projectId) return undefined;
    const current = ++requestId.current;
    const timer = setTimeout(async () => {
      setPending(true);
      setError('');
      try {
        const result = await previewManualMeasurement(projectId, value);
        if (current === requestId.current) {
          setPreview(result);
          onPreview?.(result);
        }
      } catch (reason) {
        if (current === requestId.current) {
          setError(
            reason?.response?.data?.detail ||
              'Enter complete, valid dimensions to calculate.'
          );
          onPreview?.(null);
        }
      } finally {
        if (current === requestId.current) setPending(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [projectId, value, onPreview]);

  const change = (patch) => onChange({ ...value, ...patch });
  const updateDeduction = (index, patch) =>
    change({
      deductions: value.deductions.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row
      ),
    });
  const updateSection = (index, patch) =>
    change({
      sections: value.sections.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row
      ),
    });

  return (
    <div className="grid min-w-0 gap-4" data-testid="manual-measurement-editor">
      <InlineAlert theme="operational" tone="info">
        Enter field dimensions and let MyHomeBro calculate the result. Material
        waste is added later in Takeoff.
      </InlineAlert>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold">
          Calculation type
          <select
            value={value.profile}
            onChange={(event) => change({ profile: event.target.value })}
            className="min-h-12 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3"
            data-testid="measurement-profile"
          >
            {TYPES.map(([profile, label]) => (
              <option key={profile} value={profile}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Source and verification
          <select
            value={value.source}
            onChange={(event) => change({ source: event.target.value })}
            className="min-h-12 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3"
          >
            {SOURCES.map(([source, label]) => (
              <option key={source} value={source}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {value.profile === 'linear_measurement' ? (
        <Dimension
          label="Length"
          value={value.length}
          onChange={(length) => change({ length })}
        />
      ) : null}
      {value.profile === 'rectangle' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Dimension
            label="Length"
            value={value.length}
            onChange={(length) => change({ length })}
          />
          <Dimension
            label="Width"
            value={value.width}
            onChange={(width) => change({ width })}
          />
        </div>
      ) : null}
      {value.profile === 'wall_with_deductions' ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Dimension
              label="Wall length"
              value={value.length}
              onChange={(length) => change({ length })}
            />
            <Dimension
              label="Wall height"
              value={value.height}
              onChange={(height) => change({ height })}
            />
          </div>
          <div className="grid gap-3">
            {value.deductions.map((row, index) => (
              <section
                key={row.deduction_key}
                className="rounded-xl border border-[var(--mhb-border-default)] p-3"
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <strong>Deduction {index + 1}</strong>
                  <button
                    type="button"
                    aria-label={`Remove deduction ${index + 1}`}
                    onClick={() =>
                      window.confirm('Remove this deduction?') &&
                      change({
                        deductions: value.deductions.filter(
                          (_, rowIndex) => rowIndex !== index
                        ),
                      })
                    }
                    className="min-h-11 min-w-11 rounded-lg border border-[var(--mhb-border-default)]"
                  >
                    <Trash2 className="mx-auto" size={17} />
                  </button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1 text-sm">
                    Label
                    <input
                      value={row.label}
                      onChange={(event) =>
                        updateDeduction(index, { label: event.target.value })
                      }
                      className="min-h-12 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3"
                    />
                  </label>
                  <label className="grid gap-1 text-sm">
                    Type
                    <select
                      value={row.type}
                      onChange={(event) =>
                        updateDeduction(index, { type: event.target.value })
                      }
                      className="min-h-12 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3"
                    >
                      {['door', 'window', 'opening', 'cabinet', 'custom'].map(
                        (type) => (
                          <option key={type}>{type}</option>
                        )
                      )}
                    </select>
                  </label>
                  <Dimension
                    label="Width"
                    value={row.width}
                    onChange={(width) => updateDeduction(index, { width })}
                  />
                  <Dimension
                    label="Height"
                    value={row.height}
                    onChange={(height) => updateDeduction(index, { height })}
                  />
                  <label className="grid gap-1 text-sm">
                    Quantity
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={row.quantity}
                      onChange={(event) =>
                        updateDeduction(index, { quantity: event.target.value })
                      }
                      className="min-h-12 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3 text-lg"
                    />
                  </label>
                </div>
              </section>
            ))}
            <Button
              type="button"
              variant="secondary"
              theme="operational"
              icon={Minus}
              onClick={() =>
                change({ deductions: [...value.deductions, newDeduction()] })
              }
            >
              Add deduction
            </Button>
          </div>
        </>
      ) : null}
      {value.profile === 'multi_section_area' ? (
        <div className="grid gap-3">
          {value.sections.map((row, index) => (
            <section
              key={row.section_key}
              className="rounded-xl border border-[var(--mhb-border-default)] p-3"
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <strong>Section {index + 1}</strong>
                {index ? (
                  <button
                    type="button"
                    aria-label={`Remove section ${index + 1}`}
                    onClick={() =>
                      window.confirm('Remove this section?') &&
                      change({
                        sections: value.sections.filter(
                          (_, rowIndex) => rowIndex !== index
                        ),
                      })
                    }
                    className="min-h-11 min-w-11 rounded-lg border border-[var(--mhb-border-default)]"
                  >
                    <Trash2 className="mx-auto" size={17} />
                  </button>
                ) : null}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-sm">
                  Label
                  <input
                    value={row.label}
                    onChange={(event) =>
                      updateSection(index, { label: event.target.value })
                    }
                    className="min-h-12 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3"
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  Operation
                  <select
                    value={row.operation}
                    disabled={!index}
                    onChange={(event) =>
                      updateSection(index, { operation: event.target.value })
                    }
                    className="min-h-12 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3"
                  >
                    <option value="add">Add area</option>
                    <option value="subtract">Subtract area</option>
                  </select>
                </label>
                <Dimension
                  label="Length"
                  value={row.length}
                  onChange={(length) => updateSection(index, { length })}
                />
                <Dimension
                  label="Width"
                  value={row.width}
                  onChange={(width) => updateSection(index, { width })}
                />
              </div>
            </section>
          ))}
          <Button
            type="button"
            variant="secondary"
            theme="operational"
            icon={Plus}
            onClick={() =>
              change({
                sections: [
                  ...value.sections,
                  newSection(`Section ${value.sections.length + 1}`),
                ],
              })
            }
          >
            Add section
          </Button>
        </div>
      ) : null}

      <section
        className="rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] p-4"
        aria-live="polite"
        aria-busy={pending}
        data-testid="measurement-preview"
      >
        <div className="text-sm font-bold">Authoritative calculation</div>
        {pending ? <p className="mt-2 text-sm">Recalculating…</p> : null}
        {!pending && error ? (
          <p className="mt-2 text-sm text-[var(--mhb-danger-text)]">{error}</p>
        ) : null}
        {!pending && preview ? (
          <div className="mt-2 grid gap-2">
            {preview.calculations.map((result) => (
              <div
                key={result.result_type}
                className="flex flex-wrap justify-between gap-2"
              >
                <span>{result.label}</span>
                <strong>
                  {result.display_value}{' '}
                  {result.display_unit.replaceAll('_', ' ')}
                </strong>
              </div>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}

export function createManualMeasurement() {
  return {
    profile: 'rectangle',
    source: 'approximate_manual',
    length: '',
    width: '',
    height: '',
    deductions: [],
    sections: [newSection()],
  };
}

function Dimension({ label, value, onChange }) {
  const generatedId = useId();
  const id = `dimension-${generatedId.replaceAll(':', '')}`;
  return (
    <label htmlFor={id} className="grid gap-1 text-sm font-semibold">
      {label}
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode="decimal"
        placeholder={'12 ft 6 in, 12 1/2 ft, or 3.81 m'}
        className="min-h-12 min-w-0 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3 text-lg"
      />
    </label>
  );
}
