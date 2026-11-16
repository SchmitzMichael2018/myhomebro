export function registrationDestination(
  role,
  referralCode = '',
  continuation = {}
) {
  const params = new URLSearchParams();
  if (role !== 'contractor') {
    params.set(
      'role',
      role === 'property_manager' ? 'property_manager' : 'customer'
    );
  }
  const ref = String(referralCode || '').trim();
  if (ref) params.set('ref', ref);
  ['intent', 'template_id', 'next'].forEach((key) => {
    const value = String(continuation?.[key] || '').trim();
    if (value) params.set(key, value);
  });

  if (role === 'contractor') {
    const query = params.toString();
    return query ? `/signup?${query}` : '/signup';
  }
  return `/create-account?${params.toString()}`;
}

export function customerContinuationDestination(nextValue, portalToken) {
  const next = String(nextValue || '').trim();
  if (!next.startsWith('/') || next.startsWith('//')) return '';
  if (next === '/portal' || next.startsWith('/portal?')) {
    const query = next.includes('?') ? next.slice(next.indexOf('?')) : '';
    return `/portal/${encodeURIComponent(portalToken)}${query}`;
  }
  return next;
}

// Login happens inside the portal, so carry its supported workspace intent
// directly instead of dropping it or accepting an arbitrary redirect.
export function customerPortalLoginDestination(
  nextValue,
  email = '',
  role = ''
) {
  const params = new URLSearchParams();
  try {
    const next = new URL(String(nextValue || ''), 'https://www.myhomebro.com');
    if (
      next.origin === 'https://www.myhomebro.com' &&
      next.pathname === '/portal'
    ) {
      for (const key of [
        'workspace',
        'action',
        'planning_draft',
        'template_id',
      ]) {
        const value = next.searchParams.get(key);
        if (value && /^[a-zA-Z0-9_-]{1,80}$/.test(value))
          params.set(key, value);
      }
    }
  } catch {
    // Invalid continuations fall back to ordinary portal login.
  }
  if (email.trim()) params.set('email', email.trim().toLowerCase());
  if (role === 'property_manager') params.set('role', role);
  return `/portal${params.size ? `?${params}` : ''}`;
}
