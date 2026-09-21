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
