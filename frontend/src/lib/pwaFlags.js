function enabled(value) {
  return String(value || "").toLowerCase() === "true";
}

export const PWA_FLAGS = {
  enabled: enabled(import.meta.env.VITE_PWA_ENABLED),
  installPrompt: enabled(import.meta.env.VITE_PWA_INSTALL_PROMPT_ENABLED),
  offlineDrafts: enabled(import.meta.env.VITE_PWA_OFFLINE_DRAFTS_ENABLED),
};

