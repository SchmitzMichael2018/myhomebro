function getGlobal(target = globalThis) {
  return target?.window || target;
}

export const VOICE_STATES = {
  IDLE: "idle",
  LISTENING: "listening",
  PROCESSING: "processing",
  SPEAKING: "speaking",
  WAITING: "waiting_for_user",
  REVIEW_READY: "review_ready",
  APPROVAL_REQUIRED: "approval_required",
  ERROR: "error",
};

export const DEFAULT_VOICE_SETTINGS = {
  voiceResponses: "tap_to_listen",
  speechRate: "normal",
};

export function normalizeVoiceSettings(value = {}) {
  const voiceResponses = ["off", "tap_to_listen", "always"].includes(value.voiceResponses)
    ? value.voiceResponses
    : DEFAULT_VOICE_SETTINGS.voiceResponses;
  const speechRate = ["slow", "normal", "fast"].includes(value.speechRate)
    ? value.speechRate
    : DEFAULT_VOICE_SETTINGS.speechRate;
  return { voiceResponses, speechRate };
}

export function rateForSpeechSetting(value = "normal") {
  if (value === "slow") return 0.82;
  if (value === "fast") return 1.18;
  return 1;
}

export function loadVoiceSettings(storageKey = "mhb.projectAssistant.voiceSettings") {
  if (typeof window === "undefined" || !window.localStorage) return DEFAULT_VOICE_SETTINGS;
  try {
    return normalizeVoiceSettings(JSON.parse(window.localStorage.getItem(storageKey) || "{}"));
  } catch {
    return DEFAULT_VOICE_SETTINGS;
  }
}

export function saveVoiceSettings(settings, storageKey = "mhb.projectAssistant.voiceSettings") {
  const normalized = normalizeVoiceSettings(settings);
  if (typeof window !== "undefined" && window.localStorage) {
    window.localStorage.setItem(storageKey, JSON.stringify(normalized));
  }
  return normalized;
}

export class BrowserVoiceService {
  constructor(target = globalThis) {
    this.target = getGlobal(target);
    this.recognition = null;
    this.listening = false;
    this.speaking = false;
  }

  recognitionCtor() {
    return this.target?.SpeechRecognition || this.target?.webkitSpeechRecognition || null;
  }

  synthesis() {
    return this.target?.speechSynthesis || null;
  }

  isSupported() {
    return Boolean(this.recognitionCtor() || this.synthesis());
  }

  isListening() {
    return this.listening;
  }

  isSpeaking() {
    return this.speaking;
  }

  startListening(callbacks = {}) {
    const Recognition = this.recognitionCtor();
    if (!Recognition) {
      callbacks.onError?.({ code: "unsupported", message: "Speech recognition is unavailable in this browser." });
      return null;
    }

    this.stopListening();
    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = callbacks.lang || "en-US";

    recognition.onstart = () => {
      this.listening = true;
      callbacks.onStart?.();
    };
    recognition.onresult = (event) => {
      const results = Array.from(event?.results || []);
      const transcript = results
        .map((result) => result?.[0]?.transcript || "")
        .join(" ")
        .trim();
      const isFinal = results.some((result) => result?.isFinal);
      callbacks.onResult?.({ transcript, isFinal, rawEvent: event });
    };
    recognition.onerror = (event) => {
      this.listening = false;
      callbacks.onError?.({ code: event?.error || "recognition_error", message: event?.message || "Speech recognition failed." });
    };
    recognition.onend = () => {
      this.listening = false;
      callbacks.onEnd?.();
    };

    this.recognition = recognition;
    try {
      recognition.start();
    } catch (error) {
      this.listening = false;
      callbacks.onError?.({ code: "start_failed", message: error?.message || "Speech recognition could not start." });
    }
    return recognition;
  }

  stopListening() {
    if (this.recognition) {
      try {
        this.recognition.stop?.();
      } catch {
        // Browser implementations can throw if already stopped.
      }
    }
    this.listening = false;
  }

  cancelListening() {
    if (this.recognition) {
      try {
        this.recognition.abort?.();
      } catch {
        // Browser implementations can throw if already stopped.
      }
    }
    this.listening = false;
  }

  speak(text, options = {}) {
    const synthesis = this.synthesis();
    const Utterance = this.target?.SpeechSynthesisUtterance;
    const phrase = String(text || "").trim();
    if (!synthesis || !Utterance || !phrase) {
      options.onError?.({ code: "speech_unavailable", message: "Speech synthesis is unavailable." });
      return null;
    }
    this.stopSpeaking();
    const utterance = new Utterance(phrase);
    utterance.rate = options.rate || 1;
    utterance.onstart = () => {
      this.speaking = true;
      options.onStart?.();
    };
    utterance.onend = () => {
      this.speaking = false;
      options.onEnd?.();
    };
    utterance.onerror = (event) => {
      this.speaking = false;
      options.onError?.({ code: event?.error || "speech_error", message: "Speech synthesis failed." });
    };
    synthesis.speak(utterance);
    return utterance;
  }

  stopSpeaking() {
    const synthesis = this.synthesis();
    if (synthesis) {
      synthesis.cancel?.();
    }
    this.speaking = false;
  }
}

export function createVoiceService(target = globalThis) {
  return new BrowserVoiceService(target);
}
