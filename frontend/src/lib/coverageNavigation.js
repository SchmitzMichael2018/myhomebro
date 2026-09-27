export const COVERAGE_LEVELS = ['state', 'city', 'zip'];

export function coverageLevelFromSearch(params) {
  const explicit = params.get('coverage_level');
  if (COVERAGE_LEVELS.includes(explicit)) return explicit;
  if (params.get('city') || params.get('zip')) return 'zip';
  if (params.get('state')) return 'city';
  return 'state';
}

export function coverageLevelLabel(level) {
  if (level === 'zip') return 'ZIP areas';
  if (level === 'city') return 'cities';
  return 'states';
}

export function coverageZoom(level) {
  if (level === 'zip') return 10;
  if (level === 'city') return 6;
  return 4;
}

export function drilldownForPoint(point) {
  if (point.aggregation_level === 'state') {
    return {
      state: point.state,
      city: '',
      zip: '',
      area: point.id,
      coverage_level: 'city',
    };
  }
  if (point.aggregation_level === 'city') {
    return {
      state: point.state,
      city: point.city,
      zip: '',
      area: point.id,
      coverage_level: 'zip',
    };
  }
  return {
    state: point.state,
    city: point.city,
    zip: point.zip,
    area: point.id,
    coverage_level: 'zip',
  };
}

export function parentCoverageNavigation(filters) {
  if (filters.coverage_level === 'zip') {
    return {
      city: '',
      zip: '',
      area: filters.city ? `${filters.state}|${filters.city}|` : '',
      coverage_level: 'city',
    };
  }
  if (filters.coverage_level === 'city') {
    return {
      state: '',
      city: '',
      zip: '',
      area: filters.state ? `${filters.state}||` : '',
      coverage_level: 'state',
    };
  }
  return null;
}

export function selectionQuery(areaId) {
  const [state = '', city = '', zip = ''] = String(areaId || '').split('|');
  const aggregationLevel = zip ? 'zip' : city ? 'city' : 'state';
  return {
    aggregation_level: aggregationLevel,
    state,
    city,
    zip,
  };
}
