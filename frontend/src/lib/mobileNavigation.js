export function pageShellOwnsMobileNavigation({ title, showLogo = true } = {}) {
  return Boolean(title || showLogo);
}
