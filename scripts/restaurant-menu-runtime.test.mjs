import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const folder = path.join(repo, 'frontend/public/webdesign-templates');
const runtime = fs.readFileSync(path.join(folder, 'site.js'), 'utf8');
const publicId = '12345678-1234-1234-1234-123456789abc';
const feed = `https://www.myhomebro.com/api/projects/public/restaurant-menus/${publicId}/`;
const tick = () => new Promise(resolve => setImmediate(resolve));

function run({ id = 'restaurant-food', connected, data, ok = true, page = 'menu' } = {}) {
  const scope = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(folder, 'configs', id + '.js'), 'utf8'), scope);
  if (connected !== undefined) scope.window.websiteConfig.menuFeedUrl = connected;
  const handlers = {};
  const elements = {
    site: { innerHTML: '' }, main: { focus() {} }, 'menu-results': { innerHTML: '' },
    'menu-search': { value: '', addEventListener: (event, action) => { handlers.search = action; } },
    vegetarian: { checked: false, addEventListener: (event, action) => { handlers.vegetarian = action; } },
  };
  const calls = [];
  Object.assign(scope, {
    location: { hash: '#' + page, href: 'https://example-restaurant.test/' }, URL, FormData, Intl, AbortController, setTimeout, clearTimeout,
    fetch: async (url, options) => { calls.push({ url, options }); return { ok, json: async () => data }; },
    document: { getElementById: id => elements[id] || null, body: { style: { setProperty() {} }, classList: { toggle() {} } }, querySelector: () => ({ addEventListener() {} }), querySelectorAll: () => [] },
  });
  scope.window.addEventListener = () => {};
  scope.window.scrollTo = () => {};
  vm.runInNewContext(runtime, scope);
  return { calls, elements, handlers, scope };
}

test('all six default designs remain usable without network requests', async () => {
  for (const id of ['contractor-showcase', 'contractor-local', 'contractor-premium', 'restaurant-food', 'restaurant-local', 'restaurant-dining']) {
    const result = run({ id, page: 'home' });
    await tick();
    assert.equal(result.calls.length, 0, id);
    assert.ok(result.elements.site.innerHTML.includes('<main'), id);
  }
});

test('connected menu replaces samples, formats prices, renders safe photos, and preserves filters', async () => {
  const result = run({ connected: feed, data: { currency: 'USD', items: [
    { name: '<script>Sandwich</script>', description: 'Vegetables', category: 'Lunch', price: '12.50', vegetarian: true, photo_url: feed + 'photos/abcdefab-1234-1234-1234-123456789abc/' },
    { name: 'Soup', description: 'Chicken broth', category: 'Lunch', price: '6.00', vegetarian: false, photo_url: '' },
  ] } });
  assert.match(result.elements['menu-results'].innerHTML, /Loading the latest menu/);
  await tick();
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0].options.credentials, 'omit');
  assert.equal(result.calls[0].options.cache, 'no-store');
  assert.match(result.elements['menu-results'].innerHTML, /\$12\.50/);
  assert.match(result.elements['menu-results'].innerHTML, /menu-dish-photo/);
  assert.match(result.elements['menu-results'].innerHTML, /&lt;script&gt;Sandwich/);
  assert.doesNotMatch(result.elements['menu-results'].innerHTML, /<script>/);
  result.elements.vegetarian.checked = true;
  result.handlers.vegetarian();
  assert.doesNotMatch(result.elements['menu-results'].innerHTML, />Soup</);
  result.elements['menu-search'].value = 'no matching food';
  result.handlers.search();
  assert.match(result.elements['menu-results'].innerHTML, /No dishes match/);
});

test('offline, malformed, and unpublished feeds never restore example dishes', async () => {
  for (const options of [
    { ok: false }, { data: { currency: 'EUR', items: [] } },
    { data: { currency: 'USD', items: [{ name: 'Unsafe', description: '', category: 'Menu', price: 'NaN' }] } },
    { data: { currency: 'USD', items: [{ name: 'Unsafe photo', description: '', category: 'Menu', price: '1.00', photo_url: 'https://other.test/image.jpg' }] } },
  ]) {
    const result = run({ connected: feed, ...options });
    await tick();
    assert.match(result.elements['menu-results'].innerHTML, /temporarily unavailable/);
    assert.equal(result.scope.window.websiteConfig.menu.length, 0);
  }
});

test('runtime refuses noncanonical feed URLs without requesting them', async () => {
  for (const connected of ['https://other.test/menu.json', 'http://www.myhomebro.com/api/projects/public/restaurant-menus/' + publicId + '/', feed + '?token=private']) {
    const result = run({ connected });
    await tick();
    assert.equal(result.calls.length, 0);
    assert.match(result.elements['menu-results'].innerHTML, /temporarily unavailable/);
  }
});

test('restaurant export explicitly connects a validated menu feed and rejects unsafe options', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mhb-menu-export-'));
  const script = path.join(repo, 'scripts/create-customer-website.mjs');
  try {
    const result = spawnSync(process.execPath, [script, 'restaurant-food', 'example-kitchen', '--menu-feed-url', feed], { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const scope = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(cwd, 'customer-sites/example-kitchen/site.config.js'), 'utf8'), scope);
    assert.equal(scope.window.websiteConfig.menuFeedUrl, feed);
    assert.match(fs.readFileSync(path.join(cwd, 'customer-sites/example-kitchen/README.md'), 'utf8'), /published menu content and photos load from MyHomeBro/);
    for (const args of [ ['restaurant-food', 'bad-site', '--menu-feed-url', 'https://other.test/menu.json'], ['contractor-local', 'wrong-type', '--menu-feed-url', feed], ['restaurant-food', 'unknown-option', '--secret', feed] ]) {
      assert.notEqual(spawnSync(process.execPath, [script, ...args], { cwd }).status, 0);
    }
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});
