import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TITLE,
  normalizeCanonicalPath,
  resolveSeoMetadata,
} from './seoMetadata.js';

describe('public SEO metadata', () => {
  it('defines complete indexable homepage metadata', () => {
    const metadata = resolveSeoMetadata('/');
    expect(metadata.title).toBe(DEFAULT_TITLE);
    expect(metadata.canonicalUrl).toBe('https://www.myhomebro.com/');
    expect(metadata.robots).toBe('index, follow');
    expect(metadata.image).toContain('myhomebro-default-1200x630.png');
    expect(metadata.structuredData.map((item) => item['@type'])).toEqual([
      'Organization',
      'WebSite',
    ]);
  });

  it('normalizes trailing slashes and keeps useful pages distinct', () => {
    expect(normalizeCanonicalPath('/faq/')).toBe('/faq');
    expect(resolveSeoMetadata('/faq/').canonicalUrl).toBe(
      'https://www.myhomebro.com/faq'
    );
    expect(resolveSeoMetadata('/faq').title).toBe(
      'Frequently Asked Questions | MyHomeBro'
    );
  });

  it('defaults private and tokenized routes to noindex', () => {
    const metadata = resolveSeoMetadata('/portal/private-token');
    expect(metadata.robots).toBe('noindex, nofollow');
    expect(metadata.canonicalUrl).not.toBe('https://www.myhomebro.com/');
    expect(metadata.title).not.toContain('Secure Escrow Payments');
  });

  it('uses the same slash-canonical San Antonio metadata without attribution parameters', () => {
    const metadata = resolveSeoMetadata('/san-antonio/?utm_source=example');
    expect(metadata.canonicalUrl).toBe('https://www.myhomebro.com/san-antonio/');
    expect(metadata.robots).toBe('index, follow');
    expect(metadata.structuredData[0]['@type']).toBe('WebPage');
    expect(metadata.structuredData[0].url).toBe(metadata.canonicalUrl);
    expect(resolveSeoMetadata('/start-project/').canonicalUrl).toBe('https://www.myhomebro.com/start-project');
  });
});
