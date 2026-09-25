import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

describe('admin coverage map adapter', () => {
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
