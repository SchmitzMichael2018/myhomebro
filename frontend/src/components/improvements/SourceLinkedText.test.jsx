import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import SourceLinkedText from './SourceLinkedText.jsx';

const render = (text) => renderToStaticMarkup(<SourceLinkedText text={text} />);

describe('reviewed article source links', () => {
  it('renders descriptive HTTPS sources while preserving surrounding text', () => {
    const html = render('See [City inspections](https://www.sa.gov/inspections) before work.\nThen [EPA guidance](https://www.epa.gov/lead).');
    expect(html).toContain('href="https://www.sa.gov/inspections"');
    expect(html).toContain('>City inspections</a> before work.\nThen ');
    expect(html).toContain('href="https://www.epa.gov/lead"');
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
  });

  it.each([
    '[Unsafe](javascript:alert(1))',
    '[Unsafe](data:text/html,test)',
    '[Insecure](http://example.com)',
    '[Credentials](https://user:password@example.com)',
    '[Invalid](https://)',
  ])('leaves unsupported destinations as plain text: %s', (text) => {
    expect(render(text)).not.toContain('<a ');
    expect(render(text)).toContain(text);
  });

  it('escapes raw HTML and text in link labels without rendering images', () => {
    const html = render('<script>alert(1)</script> [<img src=x>](https://www.epa.gov/lead)');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img src=x&gt;</a>');
  });

  it('keeps rejected text before a later valid link', () => {
    const html = render('[Invalid](https://) and [Valid](https://www.epa.gov/)');
    expect(html).toContain('[Invalid](https://) and <a ');
    expect(html).toContain('>Valid</a>');
  });
});
