import { describe, expect, it, vi } from "vitest";
import {
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE,
  normalizeAppearance,
  readStoredAppearance,
  resolveAppearance,
  subscribeToSystemAppearance,
} from "./AppearanceContext.jsx";

function storageWith(value) {
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn(),
  };
}

describe("Appearance preference", () => {
  it("defaults missing and invalid values to Dark", () => {
    expect(readStoredAppearance(storageWith(null))).toBe(DEFAULT_APPEARANCE);
    expect(readStoredAppearance(storageWith("sepia"))).toBe("dark");
    expect(normalizeAppearance(undefined)).toBe("dark");
  });

  it.each(["light", "dark", "system"])("restores the stored %s value", (value) => {
    const storage = storageWith(value);
    expect(readStoredAppearance(storage)).toBe(value);
    expect(storage.getItem).toHaveBeenCalledWith(APPEARANCE_STORAGE_KEY);
  });

  it("resolves System from the OS without replacing the saved value", () => {
    expect(resolveAppearance("system", true)).toBe("dark");
    expect(resolveAppearance("system", false)).toBe("light");
  });

  it("keeps explicit Light and Dark independent of OS changes", () => {
    expect(resolveAppearance("light", true)).toBe("light");
    expect(resolveAppearance("dark", false)).toBe("dark");
  });

  it("subscribes to System changes and cleans up the listener", () => {
    let listener;
    const removeEventListener = vi.fn();
    const matchMedia = vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn((event, callback) => {
        expect(event).toBe("change");
        listener = callback;
      }),
      removeEventListener,
    }));
    const onChange = vi.fn();

    const cleanup = subscribeToSystemAppearance(matchMedia, onChange);
    expect(onChange).toHaveBeenCalledWith(true);
    listener({ matches: false });
    expect(onChange).toHaveBeenLastCalledWith(false);
    cleanup();
    expect(removeEventListener).toHaveBeenCalledWith("change", listener);
  });
});
