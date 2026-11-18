import React, { useEffect, useState } from 'react';
import api from '../api';

const h = React.createElement;
const blankDish = () => ({ id: crypto.randomUUID(), name: '', description: '', category: 'Menu', price: '0.00', available: true, vegetarian: false, photo_id: null });
const errorText = error => error?.response?.data?.detail || (error?.response?.status === 400 ? 'Check the dish names, categories, prices, and photos, then try saving again.' : 'We could not complete that change. Your edits are still here. Please try again.');

function MenuPhoto({ projectId, photoId, name }) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let objectUrl;
    api.get(`/projects/website-service-projects/${projectId}/menu/photos/${photoId}/`, { responseType: 'blob' }).then(({ data }) => {
      objectUrl = URL.createObjectURL(data);
      if (active) setUrl(objectUrl); else URL.revokeObjectURL(objectUrl);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [projectId, photoId]);
  return url ? h('img', { src: url, alt: name || 'Dish photo', className: 'wcd-menu-photo' }) : h('p', { className: 'wcd-muted', role: 'status' }, failed ? 'Photo preview unavailable. Try reopening the editor.' : 'Loading photo…');
}

export default function RestaurantMenuEditor({ projectId, onDirtyChange }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState(null);
  const [items, setItems] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [focusId, setFocusId] = useState('');
  const endpoint = `/projects/website-service-projects/${projectId}/menu/`;

  useEffect(() => { onDirtyChange?.(dirty || busy); return () => onDirtyChange?.(false); }, [dirty, busy, onDirtyChange]);
  async function run(action) {
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }
  function receive(data) { setState(data); setItems(data.items); setDirty(false); }
  function load() { return run(async () => { const { data } = await api.get(endpoint); receive(data); }); }
  useEffect(() => { if (open && !state) load(); }, [open]);
  function update(id, values) { setItems(rows => rows.map(row => row.id === id ? { ...row, ...values } : row)); setDirty(true); setNotice(''); }
  function move(index, direction) {
    setItems(rows => { const result = [...rows]; const target = index + direction; [result[index], result[target]] = [result[target], result[index]]; return result; });
    setDirty(true); setNotice('');
  }
  async function upload(id, file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setError('Choose a photo smaller than 5 MB.'); return; }
    await run(async () => {
      const body = new FormData(); body.append('file', file);
      const { data } = await api.post(endpoint + 'photos/', body, { headers: { 'Content-Type': 'multipart/form-data' } });
      update(id, { photo_id: data.id }); setNotice('Photo uploaded privately. Save and publish to show it on your menu.');
    });
  }
  const current = state?.is_published && state.published_revision === state.revision;
  const field = (item, title, name, props = {}) => h('label', { key: name }, h('span', null, title),
    h(props.rows ? 'textarea' : 'input', { value: item[name], onChange: event => update(item.id, { [name]: event.target.value }), 'aria-label': `${title} for dish ${items.indexOf(item) + 1}`, ...props }));

  return h('section', { className: 'wcd-card wcd-menu-editor', 'data-testid': 'restaurant-menu-editor' },
    h('div', { className: 'wcd-menu-heading' }, h('div', null, h('p', { className: 'wcd-eyebrow' }, 'FOR YOUR RESTAURANT'), h('h2', null, 'Your restaurant menu'), h('p', null, 'Add dishes, update prices, and show off your food. Publish when you’re ready.')),
      h('button', { type: 'button', className: 'wcd-secondary', 'aria-expanded': open, 'aria-controls': 'restaurant-menu-body', onClick: () => setOpen(value => !value) }, open ? 'Close editor' : 'Manage menu')),
    open && h('div', { id: 'restaurant-menu-body' },
      error && h('div', { role: 'alert', className: 'wcd-alert' }, String(error)),
      notice && h('div', { role: 'status', className: 'wcd-success' }, notice),
      !state ? h('div', null, h('p', { role: 'status' }, busy ? 'Loading your menu…' : 'Your menu could not be loaded.'), !busy && h('button', { className: 'wcd-secondary', onClick: load }, 'Try again')) : h(React.Fragment, null,
        h('div', { className: 'wcd-menu-status' }, h('span', { className: 'wcd-badge' }, dirty ? 'Unsaved changes' : current ? 'Published menu is up to date' : state.is_published ? 'Saved draft — not yet published' : 'Draft menu — not public'),
          h('span', null, 'Prices in USD. Unavailable dishes are hidden from the published menu.')),
        h('form', { onSubmit: event => { event.preventDefault(); run(async () => { const { data } = await api.put(endpoint, { revision: state.revision, items }); receive(data); setNotice('Your menu draft is saved. Publish it to update the connected website.'); }); } },
          h('fieldset', { disabled: busy, className: 'wcd-menu-fieldset' },
            items.length === 0 && h('p', { className: 'wcd-menu-empty' }, 'No dishes yet. Add your first menu item to get started.'),
            h('div', { className: 'wcd-menu-dishes' }, ...items.map((item, index) => h('article', { key: item.id, className: 'wcd-menu-dish', 'data-testid': 'menu-dish' },
              h('div', { className: 'wcd-menu-dish-top' }, h('h3', null, item.name || `New dish ${index + 1}`),
                h('div', { className: 'wcd-menu-order' }, h('button', { type: 'button', disabled: index === 0 || busy, 'aria-label': `Move dish ${index + 1} up`, onClick: () => move(index, -1) }, '↑'), h('button', { type: 'button', disabled: index === items.length - 1 || busy, 'aria-label': `Move dish ${index + 1} down`, onClick: () => move(index, 1) }, '↓'))),
              h('div', { className: 'wcd-menu-photo-area' }, item.photo_id ? h(MenuPhoto, { key: item.photo_id, projectId, photoId: item.photo_id, name: item.name }) : h('div', { className: 'wcd-menu-photo-empty' }, 'Your food photo here'),
                h('label', { className: 'wcd-menu-photo-picker' }, item.photo_id ? 'Replace photo' : 'Add a photo', h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', 'aria-label': `Photo for dish ${index + 1}`, onChange: event => { upload(item.id, event.target.files?.[0]); event.target.value = ''; } })),
                item.photo_id && h('button', { type: 'button', className: 'wcd-menu-text-button', onClick: () => update(item.id, { photo_id: null }) }, 'Remove photo')),
              h('div', { className: 'wcd-fields' },
                field(item, 'Dish name', 'name', { required: true, maxLength: 120, autoFocus: focusId === item.id }),
                field(item, 'Price ($)', 'price', { type: 'number', min: '0', max: '999999.99', step: '0.01', required: true, inputMode: 'decimal' }),
                h('div', { className: 'wcd-wide' }, field(item, 'Category', 'category', { required: true, maxLength: 80, placeholder: 'Starters, sandwiches, desserts…' })),
                h('div', { className: 'wcd-wide' }, field(item, 'Description', 'description', { rows: 3, maxLength: 2000, placeholder: 'Ingredients, sides, and what makes it special.' }))),
              h('div', { className: 'wcd-menu-options' }, h('label', null, h('input', { type: 'checkbox', checked: item.available, onChange: event => update(item.id, { available: event.target.checked }) }), 'Available on the menu'), h('label', null, h('input', { type: 'checkbox', checked: item.vegetarian, onChange: event => update(item.id, { vegetarian: event.target.checked }) }), 'Vegetarian')),
              h('button', { type: 'button', className: 'wcd-menu-remove', onClick: () => { if (window.confirm(`Remove ${item.name || 'this dish'} from your draft? Publish changes to remove it from the website.`)) { setItems(rows => rows.filter(row => row.id !== item.id)); setDirty(true); } } }, 'Remove dish')))),
            h('div', { className: 'wcd-actions' }, h('button', { type: 'button', className: 'wcd-secondary', disabled: items.length >= 150, onClick: () => { const item = blankDish(); setItems(rows => [...rows, item]); setFocusId(item.id); setDirty(true); } }, '+ Add menu item'),
              h('button', { type: 'submit', className: 'wcd-primary', disabled: !dirty, 'data-testid': 'save-menu-draft' }, busy ? 'Saving…' : 'Save menu draft')))),
        h('div', { className: 'wcd-menu-publish' }, h('div', null, h('strong', null, 'Ready to update the website?'), h('p', null, dirty ? 'Save your changes first. Your published menu stays as it is until you publish.' : 'Publishing makes dish details and selected photos public on your connected website. Use photos you own or have permission to publish.')),
          h('div', { className: 'wcd-actions' }, h('button', { type: 'button', className: 'wcd-primary', disabled: busy || dirty || current || (!items.length && !state.is_published), 'data-testid': 'publish-menu', onClick: () => { if (window.confirm(items.length ? 'Publish this menu? Dish details, prices, and selected photos will be publicly visible on your connected website.' : 'Publish an empty menu? All dishes will be removed from the public menu.')) run(async () => { const { data } = await api.post(endpoint + 'publish/', { revision: state.revision }); receive(data); setNotice('Your menu is published. Connected websites show the update when the page is refreshed.'); }); } }, current && !dirty ? 'Menu is up to date' : state.is_published ? 'Publish menu changes' : 'Publish menu'),
            state.is_published && h('button', { type: 'button', className: 'wcd-secondary', disabled: busy || dirty, onClick: () => { if (window.confirm('Take your menu offline? The connected website will show a menu-unavailable message. Your draft will stay saved.')) run(async () => { const { data } = await api.post(endpoint + 'unpublish/', { revision: state.revision }); receive(data); setNotice('Your menu is offline. Your draft is still saved.'); }); } }, 'Take menu offline'))),
        h('button', { type: 'button', className: 'wcd-menu-text-button', disabled: busy, onClick: () => { if (!dirty || window.confirm('Discard your unsaved menu edits and reload the saved version?')) load(); } }, 'Reload saved menu'),
        h('details', { className: 'wcd-menu-connection' }, h('summary', null, 'Website connection details'), h('p', null, 'MyHomeBro connects this address to your restaurant template during setup. Once connected, published menu updates do not require a website rebuild. Until setup is complete, publishing here alone will not change an existing external website.'), h('label', null, 'Public menu feed address', h('input', { value: state.feed_url, readOnly: true, onFocus: event => event.target.select() }))))));
}
