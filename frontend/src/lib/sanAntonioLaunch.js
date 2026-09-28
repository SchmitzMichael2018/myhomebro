// Only established acquisition keys cross the public launch-page handoff.
const ATTRIBUTION_KEYS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'ref', 'source', 'qr_source', 'campaign',
];
const SAFE_VALUE = /^[a-zA-Z0-9 _./:+-]+$/;

export const CONTRACTOR_SEARCH_HANDOFF = '/start-project';

export function sanAntonioCtaUrl(destination, search = '') {
  const url = new URL(destination, 'https://www.myhomebro.com');
  const incoming = new URLSearchParams(search);
  for (const key of ATTRIBUTION_KEYS) {
    const value = (incoming.get(key) || '').trim();
    if (value && value.length <= 100 && SAFE_VALUE.test(value)) {
      url.searchParams.set(key, value);
    }
  }
  if (url.pathname === CONTRACTOR_SEARCH_HANDOFF && !url.searchParams.has('source')) {
    url.searchParams.set('source', 'san_antonio_launch');
  }
  return `${url.pathname}${url.search}`;
}
