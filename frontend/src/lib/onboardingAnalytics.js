import api from "../api";

function storageKey(eventType, step = "") {
  return `mhb:onboarding-event:${eventType}:${step || "none"}`;
}

export async function trackOnboardingEvent({
  eventType,
  step = "",
  context = {},
  once = false,
}) {
  if (!eventType) return null;

  if (once && typeof window !== "undefined") {
    const key = storageKey(eventType, step);
    if (window.sessionStorage.getItem(key) === "1") {
      return null;
    }
    window.sessionStorage.setItem(key, "1");
  }

  try {
    const { data } = await api.post("/projects/contractors/onboarding/events/", {
      event_type: eventType,
      step,
      context,
      once,
    });
    return data;
  } catch (error) {
    console.error("Failed to track onboarding event", error);
    return null;
  }
}
