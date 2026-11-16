import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PUBLIC_PLANNING_DRAFT_KEY,
  PUBLIC_PLANNING_DRAFT_MAX_BYTES,
  clearPublicPlanningDraft,
  readPublicPlanningDraft,
  validatePublicPlanningDraft,
  writePublicPlanningDraft,
} from './publicPlanningDraft.js';

function makeDraft() {
  return {
    version: 1,
    preview_token: 'signed-preview-token',
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    source_template_id: 101,
    guide_path: '/improvements/bathroom/replace-vanity/',
    inputs: {
      title: 'Replace vanity',
      desired_outcome: 'Replace without moving plumbing.',
      existing_conditions: '',
      confidence_notes: '',
      additional_context: '',
    },
    proposal: {
      summary: 'Check existing conditions before replacement.',
      limitations: 'Planning guidance only.',
      source: 'Project Assistant',
      questions: [{ id: 'q1', question: 'Are the shutoffs accessible?' }],
      warnings: [
        {
          level: 'professional_review',
          message: 'Consult a qualified plumber.',
        },
      ],
      assumptions: ['The layout remains unchanged.'],
      phases: [
        {
          client_id: 'phase-1',
          title: 'Prepare',
          description: '',
          tasks: [
            {
              client_id: 'task-1',
              title: 'Check measurements',
              description: '',
              participation_type: 'DO_IT_MYSELF',
              professional_review_recommended: false,
              reason: '',
              estimated_duration: '',
              estimated_cost: null,
              prerequisite_notes: '',
            },
          ],
        },
      ],
    },
  };
}
let values;
let storage;
beforeEach(() => {
  values = new Map();
  storage = {
    getItem: vi.fn((key) => values.get(key) ?? null),
    setItem: vi.fn((key, value) => values.set(key, value)),
    removeItem: vi.fn((key) => values.delete(key)),
  };
  vi.stubGlobal('window', { sessionStorage: storage });
});
afterEach(() => vi.unstubAllGlobals());

describe('public planning handoff', () => {
  it('round-trips the preview and explicitly clears it', () => {
    const draft = makeDraft();
    expect(writePublicPlanningDraft(draft)).toBe(true);
    expect(readPublicPlanningDraft()).toEqual(draft);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(clearPublicPlanningDraft()).toBe(true);
    expect(readPublicPlanningDraft()).toBeNull();
  });
  it('does not overwrite a valid draft with an invalid one', () => {
    const original = makeDraft();
    writePublicPlanningDraft(original);
    expect(writePublicPlanningDraft({ ...original, version: 2 })).toBe(false);
    expect(readPublicPlanningDraft()).toEqual(original);
  });
  it.each([
    [
      'missing token',
      (d) => {
        delete d.preview_token;
      },
    ],
    [
      'unknown version',
      (d) => {
        d.version = 2;
      },
    ],
    [
      'external path',
      (d) => {
        d.guide_path = 'https://example.com';
      },
    ],
    [
      'protocol-relative path',
      (d) => {
        d.guide_path = '//example.com/improvements/';
      },
    ],
    [
      'route traversal',
      (d) => {
        d.guide_path = '/improvements/../admin/';
      },
    ],
    [
      'invalid identifier',
      (d) => {
        d.source_template_id = '101';
      },
    ],
    [
      'expired preview',
      (d) => {
        d.expires_at = new Date(Date.now() - 1).toISOString();
      },
    ],
    [
      'invalid expiry',
      (d) => {
        d.expires_at = 'tomorrow';
      },
    ],
    [
      'missing input',
      (d) => {
        delete d.inputs.title;
      },
    ],
    [
      'blank outcome',
      (d) => {
        d.inputs.desired_outcome = '   ';
      },
    ],
    [
      'oversized input',
      (d) => {
        d.inputs.confidence_notes = 'x'.repeat(1001);
      },
    ],
    [
      'unexpected input',
      (d) => {
        d.inputs.owner_email = 'other@example.com';
      },
    ],
    [
      'unknown field',
      (d) => {
        d.owner = 'other';
      },
    ],
    [
      'unsafe content',
      (d) => {
        d.proposal.summary = { html: '<script />' };
      },
    ],
    [
      'unknown proposal field',
      (d) => {
        d.proposal.owner_email = 'other@example.com';
      },
    ],
    [
      'missing phases',
      (d) => {
        d.proposal.phases = [];
      },
    ],
    [
      'too many phases',
      (d) => {
        d.proposal.phases = Array(21).fill(d.proposal.phases[0]);
      },
    ],
    [
      'empty phase',
      (d) => {
        d.proposal.phases[0].tasks = [];
      },
    ],
    [
      'invalid participation',
      (d) => {
        d.proposal.phases[0].tasks[0].participation_type = 'AUTO_ASSIGN';
      },
    ],
    [
      'invalid cost',
      (d) => {
        d.proposal.phases[0].tasks[0].estimated_cost = 'Infinity';
      },
    ],
    [
      'invalid safety flag',
      (d) => {
        d.proposal.phases[0].tasks[0].professional_review_recommended = 'false';
      },
    ],
  ])('rejects %s and removes corrupt stored drafts', (_, change) => {
    const draft = makeDraft();
    change(draft);
    expect(validatePublicPlanningDraft(draft)).toBe(false);
    values.set(PUBLIC_PLANNING_DRAFT_KEY, JSON.stringify(draft));
    expect(readPublicPlanningDraft()).toBeNull();
    expect(values.has(PUBLIC_PLANNING_DRAFT_KEY)).toBe(false);
  });
  it('bounds stored data before parsing', () => {
    values.set(
      PUBLIC_PLANNING_DRAFT_KEY,
      ' '.repeat(PUBLIC_PLANNING_DRAFT_MAX_BYTES + 1)
    );
    expect(readPublicPlanningDraft()).toBeNull();
    expect(values.size).toBe(0);
  });
  it('bounds the total UTF-8 payload', () => {
    const draft = makeDraft();
    draft.proposal.phases = Array.from({ length: 20 }, (_, index) => ({
      ...draft.proposal.phases[0],
      client_id: `phase-${index}`,
      tasks: Array.from({ length: 40 }, (_, taskIndex) => ({
        ...draft.proposal.phases[0].tasks[0],
        client_id: `task-${index}-${taskIndex}`,
        description: '🙂'.repeat(1000),
      })),
    }));
    expect(validatePublicPlanningDraft(draft)).toBe(false);
    expect(writePublicPlanningDraft(draft)).toBe(false);
  });
  it('handles malformed JSON and non-object values', () => {
    for (const value of ['{bad', 'null', '[]', 'true']) {
      values.set(PUBLIC_PLANNING_DRAFT_KEY, value);
      expect(readPublicPlanningDraft()).toBeNull();
    }
  });
  it('reports silent write failures', () => {
    storage.setItem.mockImplementation(() => {});
    expect(writePublicPlanningDraft(makeDraft())).toBe(false);
  });
  it('handles a storage getter that throws', () => {
    Object.defineProperty(window, 'sessionStorage', {
      get() {
        throw new Error('Blocked');
      },
    });
    expect(writePublicPlanningDraft(makeDraft())).toBe(false);
    expect(readPublicPlanningDraft()).toBeNull();
    expect(clearPublicPlanningDraft()).toBe(false);
  });
  it('handles non-browser use safely', () => {
    vi.stubGlobal('window', undefined);
    expect(writePublicPlanningDraft(makeDraft())).toBe(false);
    expect(readPublicPlanningDraft()).toBeNull();
    expect(clearPublicPlanningDraft()).toBe(false);
  });
});
