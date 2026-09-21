const ALLOWED_EVENTS = new Set([
  'landing_view',
  'improvement_template_view',
  'guide_view',
  'signup_started',
  'role_selected',
  'diy_project_started',
  'hire_pro_clicked',
  'contractor_profile_viewed',
  'contractor_invite_started',
]);

const clean = (value, maximum = 100) =>
  String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9 _./:+-]/g, '')
    .slice(0, maximum);

export function attributionPayload(eventType, location, extra = {}) {
  if (!ALLOWED_EVENTS.has(eventType))
    throw new Error('Unsupported public attribution event.');
  const params = new URLSearchParams(location?.search || '');
  return {
    event_type: eventType,
    landing_page: clean(location?.pathname || '/', 255),
    utm_source: clean(params.get('utm_source'), 64).toLowerCase(),
    utm_medium: clean(params.get('utm_medium'), 64).toLowerCase(),
    utm_campaign: clean(params.get('utm_campaign')),
    utm_content: clean(params.get('utm_content')),
    utm_term: clean(params.get('utm_term')),
    role: clean(extra.role, 32).toLowerCase(),
    object_type: clean(extra.objectType, 64).toLowerCase(),
    object_id: clean(extra.objectId, 80),
    metadata: extra.metadata || {},
  };
}

export async function trackAcquisitionEvent(
  eventType,
  location = window.location,
  extra = {}
) {
  const payload = attributionPayload(eventType, location, extra);
  try {
    await fetch('/api/projects/attribution/track/', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    // Measurement must never block the product experience.
  }
}

export function publicRouteEvent(pathname) {
  if (pathname === '/') return 'landing_view';
  if (pathname === '/faq' || pathname.includes('/guide')) return 'guide_view';
  if (
    pathname === '/improvements' ||
    pathname === '/improvements/' ||
    /^\/improvements\/[^/]+\/?$/.test(pathname)
  )
    return 'guide_view';
  if (['/register', '/signup', '/create-account'].includes(pathname))
    return 'signup_started';
  if (pathname.startsWith('/contractors/')) return 'contractor_profile_viewed';
  return null;
}
