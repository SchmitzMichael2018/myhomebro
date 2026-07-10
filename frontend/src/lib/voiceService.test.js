import { describe, expect, it, vi } from "vitest";

import {
  BrowserVoiceService,
  normalizeVoiceSettings,
  rateForSpeechSetting,
  VOICE_STATES,
} from "./voiceService.js";

describe("voiceService", () => {
  it("normalizes voice settings and speech rates", () => {
    expect(normalizeVoiceSettings({ voiceResponses: "always", speechRate: "fast" })).toEqual({
      voiceResponses: "always",
      speechRate: "fast",
    });
    expect(normalizeVoiceSettings({ voiceResponses: "loud", speechRate: "warp" })).toEqual({
      voiceResponses: "tap_to_listen",
      speechRate: "normal",
    });
    expect(rateForSpeechSetting("slow")).toBeLessThan(rateForSpeechSetting("normal"));
    expect(rateForSpeechSetting("fast")).toBeGreaterThan(rateForSpeechSetting("normal"));
  });

  it("reports unavailable speech APIs cleanly", () => {
    const service = new BrowserVoiceService({});
    const onError = vi.fn();
    expect(service.isSupported()).toBe(false);
    expect(service.startListening({ onError })).toBeNull();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "unsupported" }));
  });

  it("starts recognition and returns final transcript", () => {
    let instance;
    class RecognitionMock {
      constructor() {
        instance = this;
      }
      start = vi.fn(() => this.onstart?.());
      stop = vi.fn(() => this.onend?.());
    }
    const service = new BrowserVoiceService({ SpeechRecognition: RecognitionMock });
    const onResult = vi.fn();
    service.startListening({ onResult });
    expect(service.isListening()).toBe(true);
    instance.onresult({
      results: [
        { 0: { transcript: "Sarah needs flooring" }, isFinal: true },
      ],
    });
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({
      transcript: "Sarah needs flooring",
      isFinal: true,
    }));
    service.stopListening();
    expect(service.isListening()).toBe(false);
  });

  it("speaks with browser synthesis", () => {
    const speak = vi.fn((utterance) => utterance.onstart?.());
    const cancel = vi.fn();
    class UtteranceMock {
      constructor(text) {
        this.text = text;
      }
    }
    const service = new BrowserVoiceService({
      speechSynthesis: { speak, cancel },
      SpeechSynthesisUtterance: UtteranceMock,
    });
    const utterance = service.speak("Review the draft.", { rate: 0.82 });
    expect(speak).toHaveBeenCalled();
    expect(utterance.text).toBe("Review the draft.");
    expect(utterance.rate).toBe(0.82);
    expect(service.isSpeaking()).toBe(true);
    service.stopSpeaking();
    expect(cancel).toHaveBeenCalled();
    expect(service.isSpeaking()).toBe(false);
  });

  it("exports explicit voice states", () => {
    expect(VOICE_STATES.LISTENING).toBe("listening");
    expect(VOICE_STATES.APPROVAL_REQUIRED).toBe("approval_required");
  });
});
