import { describe, expect, it } from 'vitest';

import { getAssistantHandoff } from './assistantHandoff.js';

function handoff(meta) {
  return {
    assistantIntent: 'navigate_app',
    assistantContext: { workspace: 'marketing' },
    assistantHandoffMeta: meta,
  };
}

describe('assistant handoff ownership', () => {
  it('accepts a correctly targeted Marketing handoff', () => {
    const result = getAssistantHandoff(handoff({
      source_workspace: 'assistant', target_workspace: 'marketing', created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    }), { targetWorkspace: 'marketing' });
    expect(result.rejected).toBe(false);
    expect(result.context.workspace).toBe('marketing');
  });

  it('rejects unrelated and expired handoffs', () => {
    expect(getAssistantHandoff(handoff({ target_workspace: 'agreements' }), { targetWorkspace: 'marketing' }).rejected).toBe(true);
    expect(getAssistantHandoff(handoff({
      target_workspace: 'marketing', expires_at: new Date(Date.now() - 1_000).toISOString(),
    }), { targetWorkspace: 'marketing' }).rejected).toBe(true);
  });

  it('rejects legacy unowned handoffs for Marketing without throwing', () => {
    const result = getAssistantHandoff({ assistantIntent: 'create_agreement', assistantContext: { agreement_id: 9 } }, { targetWorkspace: 'marketing' });
    expect(result.rejected).toBe(true);
    expect(result.context).toEqual({});
  });
});
