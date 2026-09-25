import { importLibrary, setOptions } from '@googlemaps/js-api-loader';

let librariesPromise = null;
let configuredKey = '';

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
    ]).then(([maps, marker]) => ({
      Map: maps.Map,
      AdvancedMarkerElement: marker.AdvancedMarkerElement,
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
}) {
  const adapter = await googleLibraries(config);
  if (typeof adapter.createCoverageMap === 'function') {
    return adapter.createCoverageMap({
      container,
      config,
      points,
      layers,
      onSelect,
      onViewportChange,
    });
  }

  const map = new adapter.Map(container, {
    center: { lat: 39.5, lng: -98.35 },
    zoom: 4,
    mapId: config.mapId,
    streetViewControl: false,
    mapTypeControl: false,
    fullscreenControl: true,
    gestureHandling: 'cooperative',
  });
  let markers = [];
  let idleListener = null;

  function update(nextPoints, nextLayers) {
    markers.forEach((marker) => {
      marker.map = null;
    });
    markers = nextPoints.map((point) => {
      const size = Math.max(32, Math.min(54, 28 + Math.sqrt(point.total || 1) * 5));
      const content = document.createElement('button');
      content.type = 'button';
      content.className = 'mhb-coverage-marker';
      content.style.cssText = [
        `width:${size}px`,
        `height:${size}px`,
        `background:${markerTone(point, nextLayers)}`,
        'border:3px solid rgba(255,255,255,.88)',
        'border-radius:9999px',
        'color:white',
        'font:700 11px/1.1 system-ui,sans-serif',
        'box-shadow:0 4px 18px rgba(0,0,0,.45)',
        'cursor:pointer',
      ].join(';');
      content.textContent = String(point.total || 0);
      content.setAttribute(
        'aria-label',
        `${[point.city, point.state, point.zip].filter(Boolean).join(', ')}: ${markerLabel(point, nextLayers)}`,
      );
      const marker = new adapter.AdvancedMarkerElement({
        map,
        position: { lat: point.latitude, lng: point.longitude },
        title: content.getAttribute('aria-label'),
        content,
        gmpClickable: true,
      });
      content.addEventListener('click', () => onSelect(point));
      if (typeof marker.addListener === 'function') {
        marker.addListener('click', () => onSelect(point));
      }
      return marker;
    });
  }

  update(points, layers);
  if (typeof map.addListener === 'function') {
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
  }

  return {
    update,
    reset() {
      map.setCenter({ lat: 39.5, lng: -98.35 });
      map.setZoom(4);
    },
    focus(point) {
      map.panTo({ lat: point.latitude, lng: point.longitude });
      map.setZoom(point.aggregation_level === 'state' ? 6 : 10);
    },
    destroy() {
      idleListener?.remove?.();
      markers.forEach((marker) => {
        marker.map = null;
      });
    },
  };
}
