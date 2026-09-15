const INVALID_CREDENTIAL_PATTERNS = [
  "no active account found with the given credentials",
  "invalid email or password",
  "invalid credentials",
];

export function getLoginErrorMessage(error) {
  const status = Number(error?.response?.status || 0);
  const rawMessage = String(
    error?.response?.data?.detail ||
      error?.response?.data?.message ||
      error?.message ||
      ""
  ).trim();
  const normalizedMessage = rawMessage.toLowerCase();

  if (
    status === 401 ||
    INVALID_CREDENTIAL_PATTERNS.some((pattern) => normalizedMessage.includes(pattern))
  ) {
    return "Email or password is incorrect. Please try again.";
  }

  return rawMessage || "Unable to sign in right now. Please try again.";
}
