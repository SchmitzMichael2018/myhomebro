import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../../api';
import { PaginationControls } from '../ui/PaginationControls.jsx';
import {
  createCoverageMap,
  readAdminMapConfig,
} from '../../lib/googleCoverageMap';

const inputClass = 'mhb-admin-control';
const panelClass = 'rounded-xl border border-white/10 bg-white/[0.08] p-4';
const LAYERS = [
  ['demand', 'Active demand'],
  ['claimed_supply', 'Claimed supply'],
  ['directory_prospects', 'Directory prospects'],
  ['coverage_gaps', 'Coverage gaps'],
];
const CLASSIFICATIONS = {
  critical_gap: 'Critical gap',
  limited_supply: 'Limited supply',
  covered: 'Coverage ready',
  supply_only: 'Coverage ready',
};
const COVERAGE_PAGE_SIZES = [25, 50, 100];
const MAP_LOCATION_EXPLANATION = 'MyHomeBro has aggregate records for this area, but not enough privacy-safe business-location data to place a representative marker.';

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function aggregationLevelForZoom(zoom) {
  if (Number(zoom) >= 9) return 'zip';
  if (Number(zoom) >= 5) return 'city';
  return 'state';
}

function filtersFromSearch(search) {
  const params = new URLSearchParams(search);
  const layers = (params.has('layers') ? params.get('layers') : 'demand,claimed_supply,directory_prospects,coverage_gaps')
    .split(',')
    .filter(Boolean);
  return {
    trade: params.get('trade') || '',
    state: params.get('state') || '',
    city: params.get('city') || '',
    zip: params.get('zip') || '',
    date_range: params.get('date_range') || '90d',
    classification: params.get('classification') || '',
    layers,
    area: params.get('area') || '',
    coverage_page: positiveInt(params.get('coverage_page'), 1),
    coverage_page_size: COVERAGE_PAGE_SIZES.includes(positiveInt(params.get('coverage_page_size'), 25))
      ? positiveInt(params.get('coverage_page_size'), 25)
      : 25,
    coverage_sort: params.get('coverage_sort') || 'largest_coverage_gap',
  };
}

function locationLabel(point) {
  return [point.city, point.state, point.zip].filter(Boolean).join(', ');
}

function coverageQuery(filters, viewport) {
  const params = {
    trade: filters.trade,
    state: filters.state,
    city: filters.city,
    zip: filters.zip,
    date_range: filters.date_range,
    classification: filters.classification,
    layer: filters.layers.length ? filters.layers.join(',') : 'none',
    coverage_page: filters.coverage_page,
    coverage_page_size: filters.coverage_page_size,
    coverage_sort: filters.coverage_sort,
    ...viewport,
  };
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== '' && value != null),
  );
}

function SummaryCard({ label, value, tone = 'text-white' }) {
  return (
    <div className={panelClass}>
      <dt className="text-[11px] font-bold uppercase tracking-wide text-sky-100/60">{label}</dt>
      <dd className={`mt-1 text-2xl font-black ${tone}`}>{Number(value || 0).toLocaleString()}</dd>
    </div>
  );
}

export default function AdminMarketplaceCoverageMap({ onOpenRequests, onOpenDirectory }) {
  const location = useLocation();
  const navigate = useNavigate();
  const filters = useMemo(() => filtersFromSearch(location.search), [location.search]);
  const [data, setData] = useState({ points: [], coverage_areas: { results: [], pagination: {} }, summary: {}, facets: {}, location_needed: {} });
  const [viewport, setViewport] = useState({ zoom: 4 });
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState('');
  const [mapStatus, setMapStatus] = useState('loading');
  const [mapError, setMapError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [coverageRetryKey, setCoverageRetryKey] = useState(0);
  const mapHostRef = useRef(null);
  const mapControllerRef = useRef(null);
  const viewportTimerRef = useRef(null);
  const filtersRef = useRef(filters);
  const locationRef = useRef(location);
  const pointsRef = useRef(data.points || []);
  const layersRef = useRef(filters.layers);
  const selectedAreaRef = useRef(filters.area);
  const aggregationLevelRef = useRef(aggregationLevelForZoom(viewport.zoom));
  filtersRef.current = filters;
  locationRef.current = location;
  pointsRef.current = data.points || [];
  layersRef.current = filters.layers;
  selectedAreaRef.current = filters.area;
  const config = useMemo(() => readAdminMapConfig(), []);
  const layersKey = filters.layers.join(',');
  const requestParams = useMemo(
    () => coverageQuery({
      trade: filters.trade,
      state: filters.state,
      city: filters.city,
      zip: filters.zip,
      date_range: filters.date_range,
      classification: filters.classification,
      layers: layersKey ? layersKey.split(',') : [],
      coverage_page: filters.coverage_page,
      coverage_page_size: filters.coverage_page_size,
      coverage_sort: filters.coverage_sort,
    }, viewport),
    [
      filters.trade,
      filters.state,
      filters.city,
      filters.zip,
      filters.date_range,
      filters.classification,
      filters.coverage_page,
      filters.coverage_page_size,
      filters.coverage_sort,
      layersKey,
      viewport,
    ],
  );
  const selected = useMemo(
    () => data.coverage_areas?.results?.find((point) => point.id === filters.area)
      || data.points?.find((point) => point.id === filters.area)
      || null,
    [data.coverage_areas?.results, data.points, filters.area],
  );

  const updateSearch = useCallback((changes, { replace = false } = {}) => {
    const currentFilters = filtersRef.current;
    const currentLocation = locationRef.current;
    const next = { ...currentFilters, ...changes };
    if ('state' in changes && changes.state !== currentFilters.state) {
      next.city = '';
      next.zip = '';
      next.area = '';
    }
    if ('city' in changes && changes.city !== currentFilters.city) {
      next.zip = '';
      next.area = '';
    }
    if ('zip' in changes && changes.zip !== currentFilters.zip) next.area = '';
    const resetsCoveragePage = [
      'trade', 'state', 'city', 'zip', 'date_range', 'classification',
      'layers', 'coverage_sort', 'coverage_page_size',
    ].some((key) => key in changes && changes[key] !== currentFilters[key]);
    if (resetsCoveragePage) next.coverage_page = 1;
    const params = new URLSearchParams(currentLocation.search);
    const setOrDelete = (key, value, defaultValue = '') => {
      if (value === defaultValue || value === '' || value == null) params.delete(key);
      else params.set(key, String(value));
    };
    setOrDelete('trade', next.trade);
    setOrDelete('state', next.state);
    setOrDelete('city', next.city);
    setOrDelete('zip', next.zip);
    setOrDelete('date_range', next.date_range, '90d');
    setOrDelete('classification', next.classification);
    if (next.layers.length !== LAYERS.length) params.set('layers', next.layers.join(','));
    else params.delete('layers');
    setOrDelete('area', next.area);
    setOrDelete('coverage_page', next.coverage_page, 1);
    setOrDelete('coverage_page_size', next.coverage_page_size, 25);
    setOrDelete('coverage_sort', next.coverage_sort, 'largest_coverage_gap');
    navigate({ pathname: currentLocation.pathname, search: params.toString() ? `?${params}` : '' }, { replace });
  }, [navigate]);

  const selectPoint = useCallback((point) => {
    updateSearch({ area: point.id });
  }, [updateSearch]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setApiError('');
    api.get('/projects/admin/marketplace/coverage/', {
      params: requestParams,
    }).then(({ data: payload }) => {
      if (active) setData(payload || { points: [], coverage_areas: { results: [], pagination: {} }, summary: {}, facets: {}, location_needed: {} });
    }).catch((error) => {
      if (active) {
        setApiError(error?.response?.data?.detail || 'Coverage intelligence could not be loaded.');
      }
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [requestParams, coverageRetryKey]);

  useEffect(() => {
    if (!config.apiKey || !config.mapId) {
      setMapStatus('missing_config');
      return undefined;
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setMapStatus('offline');
      return undefined;
    }
    let active = true;
    let pendingController = null;
    const abortController = new AbortController();
    setMapStatus('loading');
    setMapError('');
    createCoverageMap({
      container: mapHostRef.current,
      config,
      points: pointsRef.current,
      layers: layersRef.current,
      selectedAreaId: selectedAreaRef.current,
      signal: abortController.signal,
      onSelect: selectPoint,
      onViewportChange(nextViewport) {
        clearTimeout(viewportTimerRef.current);
        viewportTimerRef.current = setTimeout(() => {
          if (!active) return;
          const nextLevel = aggregationLevelForZoom(nextViewport.zoom);
          if (nextLevel !== aggregationLevelRef.current) {
            aggregationLevelRef.current = nextLevel;
            updateSearch({ coverage_page: 1 }, { replace: true });
          }
          setViewport(nextViewport);
        }, 350);
      },
    }).then(async (controller) => {
      pendingController = controller;
      await controller.ready;
      if (!active) {
        controller.destroy?.();
        return;
      }
      mapControllerRef.current = controller;
      controller.update?.(pointsRef.current, layersRef.current, selectedAreaRef.current);
      setMapStatus('ready');
    }).catch((error) => {
      pendingController?.destroy?.();
      if (active) {
        const category = error?.category === 'timeout' ? 'timeout' : 'provider_error';
        console.warn(`[coverage-map] ${category}`);
        setMapStatus(category);
        setMapError(category === 'timeout'
          ? 'The basemap did not finish loading. Coverage data remains available below.'
          : 'The map provider is unavailable. Coverage data remains available below.');
      }
    });
    return () => {
      active = false;
      abortController.abort();
      clearTimeout(viewportTimerRef.current);
      pendingController?.destroy?.();
      mapControllerRef.current = null;
    };
  }, [retryKey, config, selectPoint, updateSearch]);

  useEffect(() => {
    mapControllerRef.current?.update?.(data.points || [], filters.layers, filters.area);
  }, [data.points, filters.layers, filters.area]);

  const cities = (data.facets?.cities || []).filter(
    (row) => !filters.state || row.state === filters.state,
  );
  const zips = (data.facets?.zips || []).filter(
    (row) => (!filters.state || row.state === filters.state)
      && (!filters.city || row.city === filters.city),
  );
  const summary = data.summary || {};
  const coverageAreas = data.coverage_areas?.results || [];
  const coveragePagination = data.coverage_areas?.pagination || {};

  return (
    <div className="space-y-4" data-testid="admin-marketplace-coverage-workspace">
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryCard label="Active demand" value={summary.active_demand} tone="text-amber-100" />
        <SummaryCard label="Eligible claimed supply" value={summary.eligible_claimed_supply} tone="text-emerald-100" />
        <SummaryCard label="Directory prospects" value={summary.directory_prospects} tone="text-sky-100" />
        <SummaryCard label="Coverage areas" value={summary.area_count} />
        <SummaryCard label="Location data needed" value={data.location_needed?.total} tone="text-slate-200" />
      </dl>

      <div className={`${panelClass} space-y-3`} data-testid="admin-marketplace-coverage-filters">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <select className={inputClass} aria-label="Filter map trade" value={filters.trade} onChange={(event) => updateSearch({ trade: event.target.value, area: '' })}>
            <option value="">All trades</option>
            {(data.facets?.trades || []).map((trade) => <option key={trade} value={trade}>{trade}</option>)}
          </select>
          <select className={inputClass} aria-label="Filter map state" value={filters.state} onChange={(event) => updateSearch({ state: event.target.value })}>
            <option value="">All states</option>
            {(data.facets?.states || []).map((state) => <option key={state} value={state}>{state}</option>)}
          </select>
          <select className={inputClass} aria-label="Filter map city" value={filters.city} disabled={!filters.state} onChange={(event) => updateSearch({ city: event.target.value })}>
            <option value="">All cities</option>
            {cities.map((row) => <option key={`${row.state}-${row.city}`} value={row.city}>{row.city}</option>)}
          </select>
          <select className={inputClass} aria-label="Filter map ZIP" value={filters.zip} disabled={!filters.city} onChange={(event) => updateSearch({ zip: event.target.value })}>
            <option value="">All ZIPs</option>
            {zips.map((row) => <option key={`${row.state}-${row.city}-${row.zip}`} value={row.zip}>{row.zip}</option>)}
          </select>
          <select className={inputClass} aria-label="Filter demand date range" value={filters.date_range} onChange={(event) => updateSearch({ date_range: event.target.value, area: '' })}>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="12m">Last 12 months</option>
            <option value="all">All retained demand</option>
          </select>
          <select className={inputClass} aria-label="Filter coverage classification" value={filters.classification} onChange={(event) => updateSearch({ classification: event.target.value, area: '' })}>
            <option value="">All coverage states</option>
            {Object.entries(CLASSIFICATIONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <fieldset>
          <legend className="text-xs font-bold uppercase tracking-wide text-sky-100/60">Map layers</legend>
          <div className="mt-2 flex flex-wrap gap-3">
            {LAYERS.map(([value, label]) => (
              <label key={value} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-white/10 px-3 text-sm font-semibold text-sky-50">
                <input
                  type="checkbox"
                  checked={filters.layers.includes(value)}
                  onChange={(event) => {
                    const layers = event.target.checked
                      ? [...filters.layers, value]
                      : filters.layers.filter((item) => item !== value);
                    updateSearch({ layers, area: '' });
                  }}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="rounded-lg border border-white/15 px-3 py-2 text-sm font-bold text-white" onClick={() => { setViewport({ zoom: 4 }); mapControllerRef.current?.reset?.(); updateSearch({ trade: '', state: '', city: '', zip: '', date_range: '90d', classification: '', layers: LAYERS.map(([value]) => value), area: '' }); }}>
            Reset national view
          </button>
          <button type="button" className="rounded-lg border border-white/15 px-3 py-2 text-sm font-bold text-white" onClick={() => updateSearch({ trade: '', state: '', city: '', zip: '', date_range: '90d', classification: '', layers: LAYERS.map(([value]) => value), area: '' })}>
            Clear filters
          </button>
          <span className="text-sm text-sky-100/70" aria-live="polite">
            {loading ? 'Updating coverage…' : `${summary.returned_area_count || 0} areas · ${data.aggregation_level || 'state'} aggregation`}
          </span>
        </div>
      </div>

      {apiError ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-300/30 bg-rose-500/10 p-4 text-sm font-semibold text-rose-100">
          <span>{apiError}</span>
          <button type="button" className="rounded-lg border border-rose-200/40 px-3 py-2" onClick={() => setCoverageRetryKey((value) => value + 1)}>Retry coverage data</button>
        </div>
      ) : null}
      {data.limited ? <div role="status" className="rounded-xl border border-amber-300/30 bg-amber-500/10 p-3 text-sm text-amber-100">{data.instruction}</div> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="overflow-hidden rounded-2xl border border-sky-200/20 bg-[#061a39]" role="region" aria-label="National marketplace coverage map">
          <div className="border-b border-white/10 px-4 py-3">
            <h3 className="font-black text-white">United States marketplace coverage</h3>
            <p className="mt-1 text-xs text-sky-100/65">Use the accessible aggregate list below as an alternative to map navigation. No homeowner coordinates are displayed.</p>
          </div>
          <div className="relative h-[340px] sm:h-[430px]" data-testid="admin-marketplace-google-map">
            <div ref={mapHostRef} className="h-full w-full" aria-hidden={mapStatus !== 'ready'} />
            {mapStatus === 'loading' ? <div role="status" className="absolute inset-0 grid place-items-center bg-slate-950/80 text-sm font-bold text-white">Loading United States basemap…</div> : null}
            {mapStatus === 'missing_config' ? <div role="status" className="absolute inset-0 grid place-items-center bg-slate-950/90 p-6 text-center text-sm text-sky-100">Google Maps is not configured for this environment. Aggregate coverage remains available below.</div> : null}
            {['provider_error', 'timeout', 'offline'].includes(mapStatus) ? (
              <div role="alert" className="absolute inset-0 grid place-items-center bg-slate-950/90 p-6 text-center text-sm text-sky-100">
                <div><p>{mapStatus === 'offline' ? 'You appear to be offline. Coverage data remains available below.' : mapError}</p><button type="button" className="mt-3 rounded-lg bg-white px-3 py-2 font-bold text-slate-900" onClick={() => setRetryKey((value) => value + 1)}>Retry map</button></div>
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-2 border-t border-white/10 px-4 py-3 text-xs font-semibold text-sky-100" aria-label="Coverage map legend">
            <span><span aria-hidden="true" className="mr-1 text-amber-300">●</span>Demand</span>
            <span><span aria-hidden="true" className="mr-1 text-teal-300">●</span>Eligible claimed supply</span>
            <span><span aria-hidden="true" className="mr-1 text-blue-300">●</span>Directory prospects</span>
            <span><span aria-hidden="true" className="mr-1 text-red-400">●</span>Critical gap</span>
            <span><span aria-hidden="true" className="mr-1 text-orange-300">●</span>Limited supply</span>
          </div>
        </div>

        <aside className={panelClass} aria-live="polite" data-testid="admin-marketplace-coverage-detail">
          {selected ? (
            <>
              <h3 className="text-lg font-black text-white">{locationLabel(selected)}</h3>
              <p className="mt-1 text-sm font-semibold text-sky-100">{selected.coverage_status_label || CLASSIFICATIONS[selected.coverage_classification] || selected.coverage_classification}</p>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-sky-100/55">Active requests</dt><dd className="text-xl font-black text-white">{selected.counts?.active_demand || 0}</dd></div>
                <div><dt className="text-sky-100/55">Unanswered</dt><dd className="text-xl font-black text-white">{selected.counts?.unanswered_demand || 0}</dd></div>
                <div><dt className="text-sky-100/55">Eligible claimed</dt><dd className="text-xl font-black text-white">{selected.counts?.eligible_claimed_supply || 0}</dd></div>
                <div><dt className="text-sky-100/55">Prospects</dt><dd className="text-xl font-black text-white">{selected.counts?.directory_prospects || 0}</dd></div>
              </dl>
              <div className="mt-4">
                <div className="text-xs font-bold uppercase tracking-wide text-sky-100/55">Top trades</div>
                <p className="mt-1 text-sm text-sky-50">{(selected.trade_mix || []).slice(0, 4).map((row) => row.trade).join(', ') || 'No classified trades'}</p>
              </div>
              <p className="mt-4 text-xs leading-5 text-sky-100/65">This aggregate uses normalized geography and safe representative points. It never contains a homeowner address or request coordinate.</p>
              {selected.has_marker === false ? <p className="mt-3 rounded-lg border border-amber-200/25 bg-amber-300/10 p-3 text-xs leading-5 text-amber-100">{MAP_LOCATION_EXPLANATION}</p> : null}
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={() => onOpenRequests({ state: selected.state, city: selected.city, zip: selected.zip })} className="rounded-lg bg-white px-3 py-2 text-xs font-extrabold text-slate-900">View requests</button>
                <button type="button" onClick={() => onOpenDirectory({ state: selected.state, city: selected.city, zip: selected.zip })} className="rounded-lg border border-white/15 px-3 py-2 text-xs font-extrabold text-white">View Directory</button>
                {selected.has_marker !== false ? <button type="button" onClick={() => mapControllerRef.current?.focus?.(selected)} className="rounded-lg border border-white/15 px-3 py-2 text-xs font-extrabold text-white">Zoom to area</button> : null}
              </div>
            </>
          ) : <div className="text-sm text-sky-100/70">Select an aggregate marker or list row to inspect privacy-safe demand and supply intelligence.</div>}
        </aside>
      </div>

      <div className={panelClass} data-testid="admin-marketplace-coverage-fallback">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-black text-white">Coverage Areas</h3>
            <p className="mt-1 max-w-3xl text-sm text-sky-100/70">Exact demand and contractor-supply totals for the selected geographic level. Areas without a privacy-safe map location remain available here.</p>
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold text-sky-100">
            <span>Sort</span>
            <select className={inputClass} aria-label="Sort Coverage Areas" value={filters.coverage_sort} onChange={(event) => updateSearch({ coverage_sort: event.target.value })}>
              <option value="largest_coverage_gap">Largest coverage gap</option>
              <option value="highest_demand">Highest demand</option>
              <option value="lowest_demand">Lowest demand</option>
              <option value="highest_claimed_supply">Highest eligible claimed supply</option>
              <option value="highest_directory_prospects">Highest Directory prospects</option>
              <option value="area_name">Area name</option>
            </select>
          </label>
        </div>
        {loading ? <div role="status" className="py-8 text-center text-sm font-semibold text-sky-100/70">Loading Coverage Areas…</div> : null}
        {!loading && !apiError ? (
          <>
        <div className="mt-3 hidden overflow-x-auto md:block">
          <table className="min-w-full text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-sky-100/60"><th className="px-2 py-2">Area</th><th className="px-2 py-2">Demand</th><th className="px-2 py-2">Eligible claimed supply</th><th className="px-2 py-2">Directory prospects</th><th className="px-2 py-2">Coverage status</th></tr></thead>
            <tbody>
              {coverageAreas.map((point) => (
                <tr key={point.id} aria-selected={filters.area === point.id} className={`border-t border-white/10 ${filters.area === point.id ? 'bg-sky-300/15 ring-1 ring-inset ring-sky-200/50' : ''}`}>
                  <td className="px-2 py-2"><button type="button" aria-pressed={filters.area === point.id} data-testid={`admin-marketplace-coverage-area-${point.id}`} className="rounded font-bold text-white underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-sky-200" onClick={() => selectPoint(point)}>{locationLabel(point)}</button></td>
                  <td className="px-2 py-2 text-sky-50">{point.counts?.active_demand || 0}</td>
                  <td className="px-2 py-2 text-sky-50">{point.counts?.eligible_claimed_supply || 0}</td>
                  <td className="px-2 py-2 text-sky-50">{point.counts?.directory_prospects || 0}</td>
                  <td className="px-2 py-2 text-sky-50">
                    <span title={point.has_marker === false ? MAP_LOCATION_EXPLANATION : undefined} aria-label={point.has_marker === false ? `${point.coverage_status_label}. ${MAP_LOCATION_EXPLANATION}` : point.coverage_status_label}>
                      {point.coverage_status_label || CLASSIFICATIONS[point.coverage_classification] || point.coverage_classification}
                    </span>
                  </td>
                </tr>
              ))}
              {!coverageAreas.length ? <tr><td colSpan={5} className="px-2 py-8 text-center text-sky-100/70">No coverage areas match the current filters. <button type="button" className="font-bold underline" onClick={() => updateSearch({ trade: '', state: '', city: '', zip: '', classification: '', coverage_page: 1 })}>Clear filters</button></td></tr> : null}
            </tbody>
          </table>
        </div>
        <div className="mt-3 space-y-3 md:hidden" data-testid="admin-marketplace-coverage-cards">
          {coverageAreas.map((point) => (
            <button
              type="button"
              key={point.id}
              aria-pressed={filters.area === point.id}
              onClick={() => selectPoint(point)}
              className={`block w-full rounded-xl border p-4 text-left focus:outline-none focus:ring-2 focus:ring-sky-200 ${filters.area === point.id ? 'border-sky-200/60 bg-sky-300/15' : 'border-white/10 bg-white/5'}`}
            >
              <div className="font-extrabold text-white">{locationLabel(point)}</div>
              <div className="mt-1 text-sm font-semibold text-sky-100">{point.coverage_status_label}</div>
              {point.has_marker === false ? <div className="mt-2 text-xs leading-5 text-amber-100">{MAP_LOCATION_EXPLANATION}</div> : null}
              <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div><dt className="text-sky-100/60">Demand</dt><dd className="mt-1 font-bold text-white">{point.counts?.active_demand || 0}</dd></div>
                <div><dt className="text-sky-100/60">Eligible claimed</dt><dd className="mt-1 font-bold text-white">{point.counts?.eligible_claimed_supply || 0}</dd></div>
                <div><dt className="text-sky-100/60">Prospects</dt><dd className="mt-1 font-bold text-white">{point.counts?.directory_prospects || 0}</dd></div>
              </dl>
            </button>
          ))}
          {!coverageAreas.length ? <div className="py-6 text-center text-sm text-sky-100/70">No coverage areas match the current filters. <button type="button" className="font-bold underline" onClick={() => updateSearch({ trade: '', state: '', city: '', zip: '', classification: '', coverage_page: 1 })}>Clear filters</button></div> : null}
        </div>
        <PaginationControls
          page={coveragePagination.page || filters.coverage_page}
          pageSize={coveragePagination.page_size || filters.coverage_page_size}
          totalItems={coveragePagination.total || 0}
          pageSizeOptions={COVERAGE_PAGE_SIZES}
          label="areas"
          testId="admin-marketplace-coverage-pagination"
          onPageChange={(page) => updateSearch({ coverage_page: page })}
          onPageSizeChange={(pageSize) => updateSearch({ coverage_page_size: pageSize })}
        />
          </>
        ) : null}
      </div>
    </div>
  );
}
