// frontend/src/components/step1/SaveTemplateModal.jsx
// v2026-03-11-phase1-template-modal — clearer reusable-template messaging, template context preview, future marketplace-ready wording

import React, { useEffect, useMemo, useState } from "react";
import { safeTrim } from "./step1Utils";

function InfoPill({ label, value }) {
  if (!safeTrim(value)) return null;

  return (
    <span className="inline-flex items-center rounded-full border border-sky-300/40 bg-sky-400/10 px-2.5 py-1 text-[11px] font-medium text-sky-50">
      <span className="mr-1 text-sky-200">{label}:</span>
      <span>{value}</span>
    </span>
  );
}

function normalizeScopeLine(text) {
  return safeTrim(text)
    .replace(/\s+/g, " ")
    .replace(/\b(?:on|at|for)\s+\d{1,6}\s+[A-Za-z0-9 .'-]+?\s+(?:street|st\.?|avenue|ave\.?|road|rd\.?|drive|dr\.?|lane|ln\.?|court|ct\.?|circle|cir\.?|boulevard|blvd\.?|place|pl\.?|way)\b/gi, "")
    .replace(/\b\d{1,6}\s+[A-Za-z0-9 .'-]+?\s+(?:street|st\.?|avenue|ave\.?|road|rd\.?|drive|dr\.?|lane|ln\.?|court|ct\.?|circle|cir\.?|boulevard|blvd\.?|place|pl\.?|way)\b/gi, "the project property")
    .replace(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}'s\b/g, "the customer's")
    .replace(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,\s*\d{4})?\b/gi, "the scheduled project date")
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, "the scheduled project date")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "the scheduled project date")
    .replace(/\b\d+(?:\.\d+)?\s*(?:sq\.?\s*ft\.?|square feet|linear feet|lf|ft\.?|feet|in\.?|inches|yards?|yds?)\b/gi, "project-specific quantities")
    .replace(/\b\d+\s*(?:rooms?|windows?|doors?|gates?|fixtures?)\b/gi, "agreed quantities")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function milestoneTitle(row, index) {
  return safeTrim(row?.title) || safeTrim(row?.name) || `Milestone ${index + 1}`;
}

function milestoneDetail(row) {
  return (
    safeTrim(row?.description) ||
    safeTrim(row?.scope_summary) ||
    safeTrim(row?.summary) ||
    safeTrim(row?.details) ||
    safeTrim(row?.plan_details) ||
    safeTrim(row?.work_summary) ||
    safeTrim(row?.scope) ||
    ""
  );
}

function sentenceParts(text) {
  return safeTrim(text)
    .split(/(?<=[.!?])\s+|(?:\s+;\s+)|(?:\s+\|\s+)/)
    .map((line) => normalizeScopeLine(line).replace(/[.!?]+$/, ""))
    .filter(Boolean);
}

function normalizedKey(text) {
  return safeTrim(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|a|an|and|or|as|required|approved|agreed|project|work|areas?|scope)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueItems(items, limit = 12) {
  const seen = new Set();
  const result = [];
  for (const item of items.map((value) => normalizeScopeLine(value)).filter(Boolean)) {
    const key = normalizedKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item.replace(/[.!?]+$/, ""));
    if (result.length >= limit) break;
  }
  return result;
}

function includedWorkItemsFromText(text) {
  const source = normalizeScopeLine(text);
  const sourceHaystack = source.toLowerCase();
  if (!source) return [];

  const items = [];

  if (/\b(demo|demolish|remove|tear\s*out|tear-off|disposal)\b/.test(sourceHaystack)) {
    items.push("Remove existing materials, finishes, or debris as required for the approved scope.");
  }
  if (/\bprotect|cover|mask|contain\b/.test(sourceHaystack)) {
    items.push("Protect adjacent surfaces and work areas before active work begins.");
  }
  if (/\b(inspect|verify|confirm|layout|measure)\b/.test(sourceHaystack)) {
    items.push("Inspect existing conditions and confirm layout, access, and work requirements.");
  }
  if (/\b(prep|prepare|level|substrate|subfloor|surface|waterproof)\b/.test(sourceHaystack)) {
    items.push("Prepare substrates, surfaces, and work areas for the approved installation or repair.");
  }
  if (/\b(install|set|place|secure|replace)\b/.test(sourceHaystack) && /\b(floor|flooring|lvp|vinyl|hardwood|tile)\b/.test(sourceHaystack)) {
    items.push("Install new flooring materials according to approved layout and manufacturer specifications.");
  }
  if (/\b(install|set|place|secure|replace)\b/.test(sourceHaystack) && /\b(trim|transition|baseboard|molding|threshold)\b/.test(sourceHaystack)) {
    items.push("Install trim, transitions, and related finishing components.");
  }
  if (/\b(tile|vanity|tub|shower|fixture|cabinet|countertop|appliance|hardware)\b/.test(sourceHaystack)) {
    items.push("Install approved finish materials, fixtures, and components included in the template scope.");
  } else if (/\b(install|set|place|secure|replace)\b/.test(sourceHaystack)) {
    items.push("Install approved materials and components according to the template scope.");
  }
  if (/\b(repair|patch|restore|correct|fix)\b/.test(sourceHaystack)) {
    items.push("Repair affected materials and restore the work area to the agreed finish standard.");
  }
  if (/\b(paint|stain|prime|coat|finish)\b/.test(sourceHaystack)) {
    items.push("Apply approved finish materials according to product specifications.");
  }
  if (/\b(clean|cleanup|walkthrough|walk\s*through|review|closeout|punch)\b/.test(sourceHaystack)) {
    items.push("Perform final cleanup, quality review, and customer walkthrough.");
  }

  if (items.length) return items;

  return [source.length > 120 ? `${source.slice(0, 117).trim()}...` : source];
}

function inferMaterials(contextText = "") {
  const haystack = contextText.toLowerCase();
  if (/\b(floor|flooring|lvp|vinyl|hardwood|tile)\b/.test(haystack)) {
    return ["Flooring materials", "Underlayment or substrate preparation materials", "Trim and transitions", "Fasteners and adhesives"];
  }
  if (/\b(paint|painting|stain|coating|trim)\b/.test(haystack)) {
    return ["Paint, stain, or finish coatings", "Primer and patching materials", "Caulk and sealants", "Masking and protection materials"];
  }
  if (/\b(gutter|downspout)\b/.test(haystack)) {
    return ["Gutters and downspouts", "Hangers, brackets, and fasteners", "Elbows, outlets, and extensions", "Sealants and connection materials"];
  }
  if (/\b(roof|roofing|shingle|flashing)\b/.test(haystack)) {
    return ["Roofing materials", "Underlayment and flashing", "Fasteners and sealants", "Disposal and protection materials"];
  }
  if (/\b(fence|gate|privacy)\b/.test(haystack)) {
    return ["Fence posts, rails, and panels or pickets", "Gate hardware", "Concrete and fasteners", "Stain or finish materials if included"];
  }
  if (/\b(deck|porch)\b/.test(haystack)) {
    return ["Framing and decking materials", "Railing and stair components if included", "Structural fasteners and connectors", "Finish materials if included"];
  }
  if (/\b(drywall|ceiling|wall repair|plaster)\b/.test(haystack)) {
    return ["Drywall or patch materials", "Tape and joint compound", "Primer and finish materials", "Protection and cleanup materials"];
  }

  return ["Approved project materials", "Standard fasteners, adhesives, and consumables", "Protection and cleanup materials"];
}

function buildStructuredScope({ includedItems, materialItems }) {
  const included = uniqueItems(includedItems, 10);
  const materials = uniqueItems(materialItems, 8);
  const includedFallback = [
    "Review existing conditions and confirm the approved work plan.",
    "Prepare work areas and complete the agreed installation, repair, or service scope.",
    "Perform final cleanup and customer walkthrough.",
  ];

  return [
    "Included Work:",
    ...(included.length ? included : includedFallback).map((line) => `- ${line}.`),
    "",
    "Exclusions:",
    "- Structural repairs beyond minor surface preparation unless specifically included.",
    "- Hazardous material remediation.",
    "- Major electrical, plumbing, framing, or hidden-condition work unless added by written change order.",
    "",
    "Customer Responsibilities:",
    "- Provide access to work areas.",
    "- Remove personal belongings or fragile items from affected areas.",
    "- Approve material selections and schedule coordination before work begins.",
    "",
    "Materials:",
    ...(materials.length ? materials : inferMaterials()).map((line) => `- ${line}.`),
    "",
    "Assumptions:",
    "- Existing conditions are suitable for standard work unless noted during inspection.",
    "- Required materials, selections, and access are available before the scheduled work begins.",
    "- Work is limited to the approved template scope and mutually agreed change orders.",
  ].join("\n");
}

export function buildReusableScopeDraft({
  scopeDescription,
  projectTitle,
  projectType,
  projectSubtype,
  milestones,
} = {}) {
  const reviewedMilestones = (Array.isArray(milestones) ? milestones : [])
    .filter(Boolean)
    .map((row, index) => ({
      title: normalizeScopeLine(milestoneTitle(row, index)),
      detail: normalizeScopeLine(milestoneDetail(row)),
    }))
    .filter((row) => row.title || row.detail);

  const contextText = [
    projectSubtype,
    projectType,
    projectTitle,
    scopeDescription,
    ...reviewedMilestones.flatMap((row) => [row.title, row.detail]),
  ]
    .map((value) => normalizeScopeLine(value))
    .filter(Boolean)
    .join(" ");

  const sourceScope = safeTrim(scopeDescription);
  const includedSources = sourceScope
    ? sentenceParts(sourceScope)
    : reviewedMilestones.flatMap((row) => sentenceParts(row.detail || row.title));
  const includedItems = includedSources.flatMap((line) => includedWorkItemsFromText(line));

  return buildStructuredScope({
    includedItems,
    materialItems: inferMaterials(contextText),
  });
}

export default function SaveTemplateModal({
  open,
  onClose,
  onSubmit,
  busy,
  defaultName,
  defaultDescription,
  projectTitle,
  projectType,
  projectSubtype,
  milestoneCount,
  scopeDescription,
  milestones,
}) {
  const [name, setName] = useState(defaultName || "");
  const [description, setDescription] = useState(defaultDescription || "");
  const generatedScope = useMemo(
    () =>
      buildReusableScopeDraft({
        scopeDescription,
        projectTitle,
        projectType,
        projectSubtype,
        milestones,
      }),
    [scopeDescription, projectTitle, projectType, projectSubtype, milestones]
  );
  const [scope, setScope] = useState(generatedScope || "");
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (!open) return;
    setName(defaultName || "");
    setDescription(defaultDescription || "");
    setScope(generatedScope || "");
    setIsActive(true);
  }, [open, defaultName, defaultDescription, generatedScope]);

  const trimmedName = useMemo(() => safeTrim(name), [name]);
  const trimmedDescription = useMemo(() => safeTrim(description), [description]);
  const trimmedScope = useMemo(() => safeTrim(scope), [scope]);
  const reviewedMilestones = useMemo(
    () => (Array.isArray(milestones) ? milestones.filter(Boolean) : []),
    [milestones]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="shrink-0 border-b px-5 py-4">
          <div className="text-base font-semibold text-gray-900">Save Agreement as Template</div>
          <div className="mt-1 text-sm text-gray-600">
            Save this agreement as a reusable contractor template for future jobs. This is the first
            step toward building your template library for MyHomeBro.
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div
            className="rounded-lg border border-sky-400/30 bg-slate-950 p-3 shadow-inner shadow-sky-950/30"
            data-testid="save-template-context-card"
          >
            <div className="text-xs font-semibold uppercase tracking-wide text-sky-100">
              Template context
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <InfoPill label="Type" value={projectType} />
              <InfoPill label="Subtype" value={projectSubtype} />
              {milestoneCount != null ? (
                <span className="inline-flex items-center rounded-full border border-sky-300/40 bg-sky-400/10 px-2.5 py-1 text-[11px] font-medium text-sky-50">
                  <span className="mr-1 text-sky-200">Milestones:</span>
                  <span>{milestoneCount}</span>
                </span>
              ) : null}
            </div>
            <div className="mt-2 text-[11px] leading-5 text-sky-100/85">
              This saves your current project structure as a reusable starting point. You will still
              be able to edit project title, scope, pricing, and milestones on future agreements.
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                Reusable Scope
              </label>
              <button
                type="button"
                onClick={() => setScope(generatedScope)}
                disabled={busy || !generatedScope}
                data-testid="save-template-generate-reusable-scope"
                className="rounded-lg border border-sky-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-sky-800 hover:bg-sky-50 disabled:opacity-60"
              >
                Generate Reusable Scope
              </button>
            </div>
            <textarea
              data-testid="save-template-scope-input"
              className="mt-2 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm leading-6"
              rows={5}
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              placeholder="Describe the reusable scope in generic terms without job-specific measurements or pricing."
            />
            <div className="mt-1 text-[11px] text-slate-500">
              Keep this generic so it works across similar projects.
            </div>
          </div>

          {trimmedScope ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                Scope Preview
              </div>
              <div
                className="mt-2 text-sm leading-6 text-slate-700"
                data-testid="save-template-scope-preview"
              >
                {trimmedScope}
              </div>
            </div>
          ) : null}

          {reviewedMilestones.length ? (
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                  Milestone structure
                </div>
                <div className="text-[11px] text-slate-500">
                  Review the order before saving
                </div>
              </div>
              <div className="mt-3 space-y-2" data-testid="save-template-milestone-preview">
                {reviewedMilestones.map((milestone, index) => {
                  const title =
                    safeTrim(milestone?.title) || safeTrim(milestone?.name) || `Milestone ${index + 1}`;
                  const detail = safeTrim(milestone?.description);
                  return (
                    <div
                      key={milestone?.id || `${title}-${index}`}
                      className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
                    >
                      <div className="text-sm font-medium text-slate-800">
                        {index + 1}. {title}
                      </div>
                      {detail ? (
                        <div className="mt-1 text-xs leading-5 text-slate-600">{detail}</div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div>
            <label className="mb-1 block text-sm font-medium">Template Name</label>
            <input
              data-testid="save-template-name-input"
              className="w-full rounded border px-3 py-2 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Bedroom Addition - Standard 6 Milestone"
            />
            <div className="mt-1 text-[11px] text-gray-500">
              Use a reusable name contractors can recognize quickly later.
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Template Note (optional)</label>
            <textarea
              data-testid="save-template-note-input"
              className="w-full rounded border px-3 py-2 text-sm"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Internal note for your future use, such as common assumptions, exclusions, or when this template works best."
            />
            <div className="mt-1 text-[11px] text-gray-500">
              This is an internal template note, not the customer-facing agreement scope.
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            Save as active template
          </label>

          <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 px-3 py-3 text-[11px] text-gray-600">
            Future-ready: active templates can later appear in your Template Library and Template
            Marketplace workflow.
          </div>
        </div>

        <div className="shrink-0 flex items-center justify-end gap-2 border-t px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            data-testid="save-template-cancel-button"
            className="rounded border px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={() =>
              onSubmit?.({
                name: trimmedName,
                description: trimmedDescription,
                scope_description: trimmedScope,
                is_active: !!isActive,
              })
            }
            disabled={busy || !trimmedName}
            data-testid="save-template-confirm-button"
            className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {busy ? "Saving..." : "Save Template"}
          </button>
        </div>
      </div>
    </div>
  );
}
