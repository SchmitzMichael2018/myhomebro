export const AI_SCOPE_FIELDS = Object.freeze(["description", "scope_of_work", "included_work", "excluded_work", "assumptions", "allowances"]);

export function buildAiScopePatch(candidate = {}) {
  return Object.fromEntries(AI_SCOPE_FIELDS.filter((key) => Object.prototype.hasOwnProperty.call(candidate, key)).map((key) => [key, candidate[key]]));
}

export function mergeAiScopeFields(current = {}, candidate = {}) {
  return { ...current, ...buildAiScopePatch(candidate) };
}
