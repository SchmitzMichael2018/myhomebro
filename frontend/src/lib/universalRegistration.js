export function registrationDestination(role, referralCode = '') {
  const ref = String(referralCode || '').trim();
  if (role === 'contractor') {
    return ref ? `/signup?ref=${encodeURIComponent(ref)}` : '/signup';
  }
  if (role === 'property_manager') return '/create-account?role=property_manager';
  return '/create-account?role=customer';
}
