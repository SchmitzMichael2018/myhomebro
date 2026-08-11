import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import CustomerConversation from './CustomerConversation.jsx';

describe('CustomerConversation', () => {
  it('renders an accessible, mobile-contained Estimate question thread', () => {
    const markup = renderToStaticMarkup(
      <CustomerConversation
        endpoint="/messages/"
        customerMode
        title="Ask a Question"
        initialConversation={{
          message_count: 1,
          unread_count: 0,
          messages: [
            {
              id: 1,
              sender_type: 'contractor',
              message_text: 'Yes, cleanup is included.',
              lifecycle_context: 'estimate',
              estimate_version: 2,
              created_at: '2026-08-10T21:18:00Z',
            },
          ],
        }}
      />
    );

    expect(markup).toContain('aria-label="Ask a Question"');
    expect(markup).toContain('role="log"');
    expect(markup).toContain('maxLength="4000"');
    expect(markup).toContain('Estimate · Version 2');
    expect(markup).toContain('Yes, cleanup is included.');
    expect(markup).toContain('Request Changes instead');
    expect(markup).toContain('min-w-0');
    expect(markup).toContain('max-w-full');
  });
});
