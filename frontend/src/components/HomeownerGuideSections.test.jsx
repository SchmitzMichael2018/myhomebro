import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HomeownerGuideNavigation, HomeownerGuideSections, isHomeownerProjectGuide } from './HomeownerGuideSections.jsx';

describe('homeowner guide reading paths', () => {
  it('renders shared decisions, both paths and source links without losing section content', () => {
    const sections = [
      { id: 'plan-local', title: 'Local checks', body: 'Check the actual address.' },
      { id: 'diy-readiness', title: 'Readiness', body: 'Cosmetic work only.' },
      { id: 'diy-01', title: 'Prepare', body: 'Protect retained finishes.' },
      { id: 'hire-scope', title: 'Scope', body: 'Compare written work packages.' },
      { id: 'custom-note', title: 'Extra guidance', body: 'Keep owner notes visible.' },
      { id: 'guide-sources', title: 'Sources', body: 'City permits | https://www.sa.gov/\nUnsafe source | javascript:alert(1)' },
    ];
    const markup = renderToStaticMarkup(<><HomeownerGuideNavigation /><HomeownerGuideSections sections={sections} /></>);
    expect(markup).toContain('href="#diy-route"');
    expect(markup).toContain('id="diy-route"');
    expect(markup).toContain('href="#hire-route"');
    expect(markup).toContain('id="hire-route"');
    for (const section of sections.slice(0, -1)) expect(markup).toContain(section.body);
    expect(markup).toContain('href="https://www.sa.gov/"');
    expect(markup).not.toContain('href="javascript:');
  });

  it('leaves contractor articles on their existing reading layout', () => {
    expect(isHomeownerProjectGuide({ audience: 'contractor', sections: [{ id: 'diy-readiness' }] })).toBe(false);
    expect(isHomeownerProjectGuide({ audience: 'homeowner', sections: [] })).toBe(false);
    expect(isHomeownerProjectGuide({ audience: 'homeowner', sections: [{ id: 'diy-readiness' }] })).toBe(true);
  });
});
