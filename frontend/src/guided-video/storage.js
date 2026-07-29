export const GUIDED_VIDEO_STORAGE_KEY = 'mhb.guided-video.v1';
const docks = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'free'];
const modes = ['watch', 'watch-and-do'];

export function normalizeGuidedVideoState(value = {}) {
  const width = Number(value.width);
  const height = Number(value.height);
  return {
    mode: modes.includes(value.mode) ? value.mode : 'watch',
    dock: docks.includes(value.dock) ? value.dock : 'bottom-left',
    width: Number.isFinite(width) ? Math.min(720, Math.max(320, width)) : 480,
    height: Number.isFinite(height)
      ? Math.min(620, Math.max(260, height))
      : 410,
    x: Math.max(8, Number.isFinite(Number(value.x)) ? Number(value.x) : 16),
    y: Math.max(8, Number.isFinite(Number(value.y)) ? Number(value.y) : 80),
    playbackRate: [0.75, 1, 1.25, 1.5, 2].includes(Number(value.playbackRate))
      ? Number(value.playbackRate)
      : 1,
    captions: Boolean(value.captions),
    muted: Boolean(value.muted),
    volume: Math.min(
      1,
      Math.max(
        0,
        Number.isFinite(Number(value.volume)) ? Number(value.volume) : 1
      )
    ),
    progress:
      value.progress && typeof value.progress === 'object'
        ? value.progress
        : {},
  };
}

export function readGuidedVideoState(storage = globalThis?.localStorage) {
  try {
    return normalizeGuidedVideoState(
      JSON.parse(storage?.getItem(GUIDED_VIDEO_STORAGE_KEY) || '{}')
    );
  } catch {
    return normalizeGuidedVideoState();
  }
}

export function writeGuidedVideoState(
  value,
  storage = globalThis?.localStorage
) {
  try {
    storage?.setItem(
      GUIDED_VIDEO_STORAGE_KEY,
      JSON.stringify(normalizeGuidedVideoState(value))
    );
  } catch {
    // Playback remains usable when storage is unavailable.
  }
}
