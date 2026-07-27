export const CONVERSATIONAL_CAPTURE_STATES = {
  COMPOSING: "composing",
  ROUTING: "routing",
  SUGGESTION: "suggestion_ready",
  NEEDS_INFORMATION: "needs_information",
  SELECTING_CONTEXT: "selecting_context",
  CONFIRMING: "confirming",
  CREATING: "creating_capture",
  HANDING_OFF: "handing_off",
  UNSUPPORTED: "unsupported",
  FAILED: "failed",
};

export const CONVERSATIONAL_CAPTURE_TRANSITIONS = {
  composing: ["routing"],
  routing: ["suggestion_ready", "needs_information", "unsupported", "failed"],
  suggestion_ready: ["confirming", "selecting_context", "composing", "routing"],
  needs_information: ["routing", "selecting_context", "composing"],
  selecting_context: ["needs_information", "suggestion_ready", "confirming"],
  confirming: ["creating_capture", "handing_off", "suggestion_ready"],
  creating_capture: ["confirming"],
  handing_off: ["confirming"],
  unsupported: ["composing", "routing"],
  failed: ["composing", "routing"],
};

export function canTransitionConversationalCapture(current, next) {
  return current === next
    || Boolean(CONVERSATIONAL_CAPTURE_TRANSITIONS[current]?.includes(next));
}

