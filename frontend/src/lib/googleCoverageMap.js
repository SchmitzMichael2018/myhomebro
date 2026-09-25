import { importLibrary, setOptions } from '@googlemaps/js-api-loader';

let librariesPromise = null;
let configuredKey = '';
const BASEMAP_TIMEOUT_MS = 12000;

function mapFailure(category) {
  const error = new Error(`Coverage map ${category}`);
  error.category = category;
  return error;
}

export function waitForBasemap(map, signal, timeoutMs) {
  let cancel;
  const ready = new Promise((resolve, reject) => {
    let settled = false;
    let listener;
    let timer;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      listener?.remove?.();
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => finish(mapFailure('cancelled'));
    cancel = onAbort;
    if (signal?.aborted) {
      onAbort();
      return;
    }
    // A constructed Map and the marker library do not prove that the vector
    // basemap rendered. Google fires tilesloaded after visible tiles finish.
    listener = map.addListener?.('tilesloaded', () => finish());
    if (!listener) {
      finish(mapFailure('provider_error'));
      return;
    }
    signal?.addEventListener?.('abort', onAbort, { once: true });
    timer = setTimeout(() => finish(mapFailure('timeout')), timeoutMs);
  });
  return { ready, cancel: () => cancel?.() };
}

function markerTone(point, layers) {
  if (layers.includes('coverage_gaps')) {
    if (point.coverage_classification === 'critical_gap') return '#dc2626';
    if (point.coverage_classification === 'limited_supply') return '#d97706';
    if (point.coverage_classification === 'covered') return '#16a34a';
  }
  if (layers.includes('demand') && point.counts?.active_demand) return '#d4a72c';
  if (layers.includes('claimed_supply') && point.counts?.eligible_claimed_supply) return '#0d9488';
  return '#2563eb';
}

function markerLabel(point, layers) {
  if (layers.includes('coverage_gaps')) {
    return String(point.coverage_classification || '').replaceAll('_', ' ');
  }
  if (layers.includes('demand')) return `${point.counts?.active_demand || 0} demand`;
  if (layers.includes('claimed_supply')) {
    return `${point.counts?.eligible_claimed_supply || 0} claimed`;
  }
  return `${point.counts?.directory_prospects || 0} prospects`;
}

async function googleLibraries(config) {
  if (typeof window !== 'undefined' && window.__MHB_ADMIN_MAP_ADAPTER__) {
    return window.__MHB_ADMIN_MAP_ADAPTER__;
  }
  if (!librariesPromise) {
    configuredKey = config.apiKey;
    setOptions({
      key: config.apiKey,
      v: 'weekly',
      mapIds: [config.mapId],
    });
    librariesPromise = Promise.all([
      importLibrary('maps'),
      importLibrary('marker'),
      importLibrary('core'),
    ]).then(([maps, marker, core]) => ({
      Map: maps.Map,
      AdvancedMarkerElement: marker.AdvancedMarkerElement,
      ColorScheme: core.ColorScheme,
    })).catch((error) => {
      librariesPromise = null;
      configuredKey = '';
      throw error;
    });
  }
  if (configuredKey && configuredKey !== config.apiKey) {
    throw new Error('Google Maps was already configured for this page.');
  }
  return librariesPromise;
}

export function readAdminMapConfig() {
  if (typeof window !== 'undefined' && window.__MHB_ADMIN_MAP_CONFIG__) {
    return window.__MHB_ADMIN_MAP_CONFIG__;
  }
  return {
    apiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '',
    mapId: import.meta.env.VITE_GOOGLE_MAPS_MAP_ID || '',
  };
}

export async function createCoverageMap({
  container,
  config,
  points,
  layers,
  onSelect,
  onViewportChange,
  selectedAreaId = '',
  signal,
}) {
  const adapter = await googleLibraries(config);
  if (signal?.aborted) throw mapFailure('cancelled');

  const map = new adapter.Map(container, {
    center: { lat: 39.5, lng: -98.35 },
    zoom: 4,
    mapId: config.mapId,
    colorScheme: adapter.ColorScheme.DARK,
    streetViewControl: false,
    mapTypeControl: false,
    fullscreenControl: true,
    zoomControl: true,
    gestureHandling: 'cooperative',
  });
  let markers = [];
  let idleListener = null;
  let rendered = false;
  let destroyed = false;
  let latestPoints = points;
  let latestLayers = layers;
  let latestSelectedAreaId = selectedAreaId;
  const basemap = waitForBasemap(map, signal, adapter.readyTimeoutMs || BASEMAP_TIMEOUT_MS);

  function update(nextPoints, nextLayers, nextSelectedAreaId = '') {
    latestPoints = nextPoints;
    latestLayers = nextLayers;
    latestSelectedAreaId = nextSelectedAreaId;
    if (!rendered || destroyed) return;
    markers.forEach((marker) => {
      marker.map = null;
    });
    markers = [...latestPoints].sort((a, b) => String(a.id).localeCompare(String(b.id))).map((point, index) => {
      const selected = point.id === latestSelectedAreaId;
      const size = Math.max(44, Math.min(56, 34 + Math.sqrt(point.total || 1) * 5));
      const content = document.createElement('div');
      content.className = `mhb-coverage-marker${selected ? ' mhb-coverage-marker--selected' : ''}`;
      content.style.cssText = [
        `width:${size}px`,
        `height:${size}px`,
        `background:${markerTone(point, nextLayers)}`,
        `border:3px solid ${selected ? '#ffffff' : 'rgba(255,255,255,.88)'}`,
        'border-radius:9999px',
        'color:white',
        'font:800 12px/1 system-ui,sans-serif',
        `box-shadow:0 4px 18px rgba(0,0,0,.45)${selected ? ',0 0 0 4px #facc15' : ''}`,
        'cursor:pointer',
        'display:grid',
        'place-items:center',
        'box-sizing:border-box',
        'white-space:nowrap',
        'overflow:visible',
      ].join(';');
      content.textContent = String(point.total || 0);
      const label = `${[point.city, point.state, point.zip].filter(Boolean).join(', ')}: ${markerLabel(point, nextLayers)}; ${point.total || 0} total`;
      content.setAttribute(
        'aria-label',
        label,
      );
      const marker = new adapter.AdvancedMarkerElement({
        map,
        position: { lat: point.latitude, lng: point.longitude },
        title: label,
        gmpClickable: true,
        collisionBehavior: selected ? 'REQUIRED_AND_HIDES_OPTIONAL' : 'OPTIONAL_AND_HIDES_LOWER_PRIORITY',
        zIndex: selected ? 1000000 : 100000 - index,
      });
      marker.setAttribute('data-coverage-area', point.id);
      marker.append(content);
      marker.addEventListener('gmp-click', () => onSelect(point));
      return marker;
    });
  }

  const ready = basemap.ready.then(() => {
    if (destroyed) throw mapFailure('cancelled');
    rendered = true;
    update(latestPoints, latestLayers, latestSelectedAreaId);
    idleListener = map.addListener('idle', () => {
      const bounds = map.getBounds?.();
      const southWest = bounds?.getSouthWest?.();
      const northEast = bounds?.getNorthEast?.();
      if (!southWest || !northEast) return;
      onViewportChange({
        zoom: map.getZoom?.() || 4,
        south: southWest.lat(),
        west: southWest.lng(),
        north: northEast.lat(),
        east: northEast.lng(),
      });
    });
  });

  return {
    ready,
    update,
    reset() {
      if (!rendered || destroyed) return;
      map.setCenter({ lat: 39.5, lng: -98.35 });
      map.setZoom(4);
    },
    focus(point) {
      if (!rendered || destroyed) return;
      map.panTo({ lat: point.latitude, lng: point.longitude });
      map.setZoom(point.aggregation_level === 'state' ? 6 : 10);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      basemap.cancel();
      idleListener?.remove?.();
      markers.forEach((marker) => {
        marker.map = null;
      });
      container.replaceChildren();
    },
  };
}
