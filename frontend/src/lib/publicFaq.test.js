import { describe, expect, it } from 'vitest';

import {
  buildPublicFaqJsonLd,
  filterPublicFaqItems,
  PUBLIC_FAQ_CATEGORIES,
  PUBLIC_FAQ_CURATED_IDS,
  PUBLIC_FAQ_CURATED_ITEMS,
  PUBLIC_FAQ_ITEMS,
} from './publicFaq.js';

describe('public FAQ content', () => {
  it('covers launch-critical product and trust topics without outdated terminology', () => {
    const content = PUBLIC_FAQ_ITEMS.map(
      (item) => `${item.question} ${item.answer}`
    ).join(' ');
    [
      'What is MyHomeBro?',
      'Is MyHomeBro a contractor marketplace?',
      'Does MyHomeBro replace accounting software?',
      'What is Project Assistant?',
      'What is Smart Capture?',
      'How does the dispute process work?',
      'How can a homeowner request a refund?',
      'What does MyHomeBro cost contractors?',
      'Who can see project information?',
      'Does the installed app store private project information offline?',
    ].forEach((question) => expect(content).toContain(question));
    [
      'AI Copilot',
      'AI Workspace',
      'guaranteed contractor',
      'instant legal resolution',
    ].forEach((term) => expect(content).not.toContain(term));
    expect(PUBLIC_FAQ_CATEGORIES.length).toBeLessThanOrEqual(7);
  });

  it('keeps FAQPage structured data synchronized with visible content', () => {
    const jsonLd = buildPublicFaqJsonLd(PUBLIC_FAQ_CURATED_ITEMS);
    expect(jsonLd['@type']).toBe('FAQPage');
    expect(jsonLd.mainEntity).toHaveLength(PUBLIC_FAQ_CURATED_ITEMS.length);
    expect(jsonLd.mainEntity.map((entry) => entry.name)).toEqual(
      PUBLIC_FAQ_CURATED_ITEMS.map((item) => item.question)
    );
    expect(jsonLd.mainEntity.map((entry) => entry.acceptedAnswer.text)).toEqual(
      PUBLIC_FAQ_CURATED_ITEMS.map((item) => item.answer)
    );
  });

  it('derives the curated modal questions from the authoritative full FAQ source', () => {
    expect(PUBLIC_FAQ_CURATED_ITEMS).toHaveLength(12);
    expect(PUBLIC_FAQ_CURATED_ITEMS.map((item) => item.id)).toEqual(
      PUBLIC_FAQ_CURATED_IDS
    );
    expect(PUBLIC_FAQ_ITEMS).toHaveLength(48);
  });

  it('filters by audience, category, and answer text', () => {
    const contractorItems = filterPublicFaqItems({ audience: 'contractor' });
    const homeownerItems = filterPublicFaqItems({ audience: 'customer' });
    expect(
      contractorItems.some((item) => item.id === 'employee-work-review')
    ).toBe(true);
    expect(
      homeownerItems.some((item) => item.id === 'employee-work-review')
    ).toBe(false);
    expect(
      homeownerItems.some((item) => item.id === 'homeowner-refund-request')
    ).toBe(true);

    const disputeItems = filterPublicFaqItems({ category: 'disputes-records' });
    expect(
      disputeItems.every((item) => item.categoryId === 'disputes-records')
    ).toBe(true);

    const searchItems = filterPublicFaqItems({ query: '72-hour' });
    expect(searchItems.map((item) => item.id)).toEqual(
      expect.arrayContaining(['fund-release', 'invoice-review-window'])
    );
  });
});
