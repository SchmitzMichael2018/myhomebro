export const SITE_ORIGIN = 'https://www.myhomebro.com';
export const DEFAULT_TITLE = 'MyHomeBro | Plan, Hire & Manage Home Projects';
export const DEFAULT_DESCRIPTION =
  'Plan DIY projects, connect with contractors, manage agreements, track milestones, make project payments, and keep your home improvements organized with MyHomeBro.';
export const SOCIAL_DESCRIPTION =
  'DIY or hiring a pro? Plan projects, connect with contractors, manage the work, and keep your home improvements organized in one place.';
export const DEFAULT_SOCIAL_IMAGE = `${SITE_ORIGIN}/static/social/myhomebro-default-1200x630.png`;

const ROUTES = {
  '/': {
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    socialDescription: SOCIAL_DESCRIPTION,
    index: true,
    structuredData: [
      {
        '@type': 'Organization',
        '@id': `${SITE_ORIGIN}/#organization`,
        name: 'MyHomeBro',
        url: `${SITE_ORIGIN}/`,
        logo: `${SITE_ORIGIN}/static/myhomebro_logo.png`,
        description: DEFAULT_DESCRIPTION,
      },
      {
        '@type': 'WebSite',
        '@id': `${SITE_ORIGIN}/#website`,
        url: `${SITE_ORIGIN}/`,
        name: 'MyHomeBro',
        publisher: { '@id': `${SITE_ORIGIN}/#organization` },
      },
    ],
  },
  '/faq': {
    title: 'Frequently Asked Questions | MyHomeBro',
    description:
      'Clear answers about MyHomeBro projects, contractors, payments, refunds, disputes, AI assistance, privacy, and records.',
    index: true,
  },
  '/login': { title: 'Log In | MyHomeBro', index: false },
  '/signup': { title: 'Create Your MyHomeBro Account', index: false },
  '/register': { title: 'Create Your MyHomeBro Account', index: false },
  '/create-account': { title: 'Create Your MyHomeBro Account', index: false },
  '/start-project': { title: 'Start a Home Project | MyHomeBro', index: false },
  '/forgot-password': { title: 'Reset Password | MyHomeBro', index: false },
  '/legal/terms-of-service': {
    title: 'Terms of Service | MyHomeBro',
    description: 'Read the terms that govern use of the MyHomeBro platform.',
    index: true,
  },
  '/legal/privacy-policy': {
    title: 'Privacy Policy | MyHomeBro',
    description:
      'Learn how MyHomeBro collects, uses, and protects personal data.',
    index: true,
  },
};

export function normalizeCanonicalPath(pathname = '/') {
  const path = `/${String(pathname)
    .split(/[?#]/, 1)[0]
    .replace(/^\/+|\/+$/g, '')}`;
  return path === '/' ? '/' : path;
}

export function resolveSeoMetadata(pathname) {
  const path = normalizeCanonicalPath(pathname);
  const route = ROUTES[path] || {};
  const index = route.index === true;
  return {
    title: route.title || DEFAULT_TITLE,
    description: route.description || DEFAULT_DESCRIPTION,
    socialDescription:
      route.socialDescription || route.description || DEFAULT_DESCRIPTION,
    canonicalUrl: `${SITE_ORIGIN}${path}`,
    image: route.image || DEFAULT_SOCIAL_IMAGE,
    type: route.type || 'website',
    robots: index ? 'index, follow' : 'noindex, nofollow',
    structuredData: route.structuredData || [],
  };
}

function upsertMeta(selector, attributes) {
  let element = document.head.querySelector(selector);
  if (!element) {
    element = document.createElement('meta');
    document.head.appendChild(element);
  }
  Object.entries(attributes).forEach(([name, value]) =>
    element.setAttribute(name, value)
  );
}

export function applySeoMetadata(pathname, overrides = {}) {
  const metadata = { ...resolveSeoMetadata(pathname), ...overrides };
  document.title = metadata.title;
  upsertMeta('meta[name="description"]', {
    name: 'description',
    content: metadata.description,
  });
  upsertMeta('meta[name="robots"]', {
    name: 'robots',
    content: metadata.robots,
  });
  [
    ['og:title', metadata.title],
    ['og:description', metadata.socialDescription],
    ['og:type', metadata.type],
    ['og:url', metadata.canonicalUrl],
    ['og:image', metadata.image],
  ].forEach(([property, content]) =>
    upsertMeta(`meta[property="${property}"]`, { property, content })
  );
  [
    ['twitter:card', 'summary_large_image'],
    ['twitter:title', metadata.title],
    ['twitter:description', metadata.socialDescription],
    ['twitter:image', metadata.image],
  ].forEach(([name, content]) =>
    upsertMeta(`meta[name="${name}"]`, { name, content })
  );

  let canonical = document.head.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement('link');
    canonical.rel = 'canonical';
    document.head.appendChild(canonical);
  }
  canonical.href = metadata.canonicalUrl;

  document.head
    .querySelectorAll('script[data-seo-structured-data]')
    .forEach((node) => node.remove());
  if (metadata.structuredData.length) {
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.dataset.seoStructuredData = 'true';
    script.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': metadata.structuredData,
    }).replace(/</g, '\\u003c');
    document.head.appendChild(script);
  }
  return metadata;
}
