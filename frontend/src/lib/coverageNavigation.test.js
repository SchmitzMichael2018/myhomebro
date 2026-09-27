import { describe, expect, it } from 'vitest';
import {
  coverageLevelFromSearch,
  drilldownForPoint,
  parentCoverageNavigation,
  selectionQuery,
} from './coverageNavigation';

describe('coverage navigation', () => {
  it('restores explicit levels and infers compatible levels for older URLs', () => {
    expect(coverageLevelFromSearch(new URLSearchParams())).toBe('state');
    expect(coverageLevelFromSearch(new URLSearchParams('state=TX'))).toBe('city');
    expect(coverageLevelFromSearch(new URLSearchParams('state=TX&city=Austin'))).toBe('zip');
    expect(coverageLevelFromSearch(new URLSearchParams('coverage_level=state&state=TX'))).toBe('state');
  });

  it('selects and drills state and city points while keeping ZIP terminal', () => {
    expect(drilldownForPoint({
      id: 'TX||', aggregation_level: 'state', state: 'TX', city: '', zip: '',
    })).toEqual({
      state: 'TX', city: '', zip: '', area: 'TX||', coverage_level: 'city',
    });
    expect(drilldownForPoint({
      id: 'TX|Austin|', aggregation_level: 'city', state: 'TX', city: 'Austin', zip: '',
    })).toEqual({
      state: 'TX', city: 'Austin', zip: '', area: 'TX|Austin|', coverage_level: 'zip',
    });
    expect(drilldownForPoint({
      id: 'TX|Austin|78701', aggregation_level: 'zip', state: 'TX', city: 'Austin', zip: '78701',
    })).toEqual({
      state: 'TX', city: 'Austin', zip: '78701', area: 'TX|Austin|78701', coverage_level: 'zip',
    });
  });

  it('returns exactly one level and selects the parent aggregate', () => {
    expect(parentCoverageNavigation({
      coverage_level: 'zip', state: 'TX', city: 'Austin',
    })).toEqual({
      city: '', zip: '', area: 'TX|Austin|', coverage_level: 'city',
    });
    expect(parentCoverageNavigation({
      coverage_level: 'city', state: 'TX',
    })).toEqual({
      state: '', city: '', zip: '', area: 'TX||', coverage_level: 'state',
    });
  });

  it('derives an exact aggregate lookup from an area id', () => {
    expect(selectionQuery('TX||')).toEqual({
      aggregation_level: 'state', state: 'TX', city: '', zip: '',
    });
    expect(selectionQuery('TX|Austin|')).toEqual({
      aggregation_level: 'city', state: 'TX', city: 'Austin', zip: '',
    });
    expect(selectionQuery('TX|Austin|78701')).toEqual({
      aggregation_level: 'zip', state: 'TX', city: 'Austin', zip: '78701',
    });
  });
});
