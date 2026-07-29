import { describe, expect, it } from 'vitest';
import {
  normalizeGuidedVideoState,
  readGuidedVideoState,
  writeGuidedVideoState,
} from './storage';

describe('guided video preference persistence', () => {
  it('validates untrusted stored preferences', () => {
    expect(
      normalizeGuidedVideoState({
        dock: 'offscreen',
        mode: 'verify-it',
        width: 9999,
        volume: 4,
      })
    ).toMatchObject({
      dock: 'bottom-left',
      mode: 'watch',
      width: 720,
      volume: 1,
    });
  });

  it('round trips safe preferences and progress', () => {
    const values = new Map();
    const storage = {
      getItem: (key) => values.get(key),
      setItem: (key, value) => values.set(key, value),
    };
    writeGuidedVideoState(
      { mode: 'watch-and-do', dock: 'top-left', progress: { tutorial: 34 } },
      storage
    );
    expect(readGuidedVideoState(storage)).toMatchObject({
      mode: 'watch-and-do',
      dock: 'top-left',
      progress: { tutorial: 34 },
    });
  });

  it('recovers from malformed storage', () => {
    expect(readGuidedVideoState({ getItem: () => '{bad' })).toMatchObject({
      mode: 'watch',
      dock: 'bottom-left',
    });
  });
});
