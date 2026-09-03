export const SIGNATURE_METHODS = Object.freeze({
  TYPE: "type",
  DRAW: "draw",
  UPLOAD: "upload",
});

export function hasSignatureForMethod(method, { typedName = "", hasDrawn = false, sigFile = null } = {}) {
  if (method === SIGNATURE_METHODS.DRAW) return Boolean(hasDrawn);
  if (method === SIGNATURE_METHODS.UPLOAD) return Boolean(sigFile);
  return String(typedName).trim().length > 1;
}
