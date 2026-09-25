import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { waitForBasemap } from './googleCoverageMap';

function fakeMap() {
  const listeners = new Map();
  const removed = vi.fn();
  return {
    listeners,
    removed,
    addListener(event, callback) {
      listeners.set(event, callback);
      return { remove: removed };
    },
  };
}

describe('admin coverage map adapter', () => {
  it('does not report readiness until Google signals visible tiles', async () => {
    vi.useFakeTimers();
    try {
      const map = fakeMap();
      const { ready } = waitForBasemap(map, undefined, 100);
      let resolved = false;
      ready.then(() => { resolved = true; });
      await Promise.resolve();
      expect(resolved).toBe(false);
      map.listeners.get('tilesloaded')();
      await ready;
      expect(resolved).toBe(true);
      expect(map.removed).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('times out without tiles and permits cancellation without leaking listeners', async () => {
    vi.useFakeTimers();
    try {
      const map = fakeMap();
      const { ready } = waitForBasemap(map, undefined, 100);
      const rejection = expect(ready).rejects.toMatchObject({ category: 'timeout' });
      await vi.advanceTimersByTimeAsync(100);
      await rejection;
      expect(map.removed).toHaveBeenCalledOnce();

      const nextMap = fakeMap();
      const pending = waitForBasemap(nextMap, undefined, 100);
      const cancelled = expect(pending.ready).rejects.toMatchObject({ category: 'cancelled' });
      pending.cancel();
      await cancelled;
      expect(nextMap.removed).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the modern advanced marker API without deprecated map layers', () => {
    const source = fs.readFileSync(
      new URL('./googleCoverageMap.js', import.meta.url),
      'utf8',
    );

    expect(source).toContain("importLibrary('marker')");
    expect(source).toContain('AdvancedMarkerElement');
    expect(source).toContain("addEventListener('gmp-click'");
    expect(source).not.toContain("addListener('click'");
    expect(source).not.toContain('content,');
    expect(source).not.toContain('google.maps.Marker');
    expect(source).not.toContain('HeatmapLayer');
    expect(source).not.toContain("importLibrary('drawing')");
  });

  it('reads only the dedicated Vite browser configuration', () => {
    const source = fs.readFileSync(
      new URL('./googleCoverageMap.js', import.meta.url),
      'utf8',
    );

    expect(source).toContain('VITE_GOOGLE_MAPS_API_KEY');
    expect(source).toContain('VITE_GOOGLE_MAPS_MAP_ID');
    expect(source).not.toContain('GOOGLE_PLACES_API_KEY');
    expect(source).not.toContain('mhb-google-maps-api-key');
  });

  it('bridges only the two public Maps values from the production root env', () => {
    const config = fs.readFileSync(
      new URL('../../vite.config.js', import.meta.url),
      'utf8',
    );
    expect(config).toContain('"VITE_GOOGLE_MAPS_API_KEY", "VITE_GOOGLE_MAPS_MAP_ID"');
    expect(config).toContain('"VITE_GOOGLE_MAPS_"');
    expect(config).not.toContain('GOOGLE_PLACES_API_KEY');
    expect(config).not.toContain('TURNSTILE_SECRET_KEY');
  });
});
