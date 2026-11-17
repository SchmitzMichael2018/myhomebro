import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import api, { getAccessToken } from '../api';
import LoginForm from '../components/LoginForm.jsx';
import { WEBSITE_TEMPLATES, findWebsiteTemplate, websiteTemplateDemoUrl } from '../lib/websiteTemplates.js';
import './WebsiteCustomerDashboard.css';

const h = React.createElement;
const emptyBrief = template => ({ business_name: '', business_type: template?.type === 'Restaurant' ? 'restaurant' : 'contractor', template_id: template?.id || '', current_website: '', description: '', services: '', contact_details: '', design_notes: '' });
const steps = ['brief', 'review', 'building', 'preview', 'launched', 'maintenance'];
const labels = ['Your brief', 'Review', 'Build', 'Preview', 'Launch', 'Care'];
const endpoint = '/projects/website-service-projects/';
function safeLink(url) { try { return ['http:', 'https:'].includes(new URL(url).protocol) ? url : null; } catch { return null; } }
function failure(error) {
  const data = error?.response?.data;
  if (error?.response?.status === 401) return 'Your session has expired. Sign in again to continue.';
  if (data && typeof data === 'object' && Object.keys(data).length) return Object.entries(data).map(([key, value]) => (key === 'detail' ? '' : key.replaceAll('_', ' ') + ': ') + (Array.isArray(value) ? value.join(' ') : String(value))).join(' ');
  return 'We could not save that change. Your information is still here. Please try again.';
}

export default function WebsiteCustomerDashboard() {
  const location = useLocation();
  if (!getAccessToken()) return h('div', { className: 'wcd-login' },
    h('div', { className: 'wcd-login-note' }, h(Link, { to: '/webdesign' }, '← Web design'), h('strong', null, 'Your website workspace'), h('span', null, 'Use your existing MyHomeBro account. Contractors do not need a second login.')),
    h(LoginForm, { redirectTo: location.pathname + location.search }));
  return h(Workspace, { key: location.search });
}

function Workspace() {
  const { search } = useLocation();
  const initialTemplate = findWebsiteTemplate(new URLSearchParams(search).get('template'));
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(null);
  const [brief, setBrief] = useState(() => emptyBrief(initialTemplate));
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [message, setMessage] = useState('');
  const [file, setFile] = useState(null);
  const [uploadKey, setUploadKey] = useState(0);

  function select(next) {
    if (dirty && !window.confirm('Leave without saving your website brief?')) return;
    setProject(next); setBrief(next ? Object.fromEntries(Object.keys(emptyBrief()).map(key => [key, next[key] || ''])) : emptyBrief(initialTemplate));
    setDirty(false); setMessage(''); setFile(null); setUploadKey(key => key + 1); setError(''); setNotice('');
  }
  function receive(next) { setProject(next); setProjects(rows => [next, ...rows.filter(row => row.id !== next.id)]); }
  async function load() {
    setLoading(true); setError('');
    try {
      const { data } = await api.get(endpoint);
      const rows = Array.isArray(data) ? data : data.results || [];
      setProjects(rows);
      if (rows.length && !initialTemplate) select(rows[0]);
    } catch (err) { setError(failure(err)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const warn = event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  async function run(action) {
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (err) { setError(failure(err)); } finally { setBusy(false); }
  }
  const change = event => { setBrief(current => ({ ...current, [event.target.name]: event.target.value })); setDirty(true); setNotice(''); };
  const field = (label, name, options = {}) => h('label', { className: options.wide ? 'wcd-wide' : '', key: name }, h('span', null, label),
    h(options.rows ? 'textarea' : 'input', { name, value: brief[name], onChange: change, maxLength: 8000, ...options, wide: undefined }));
  const currentStep = Math.max(0, steps.indexOf(project?.status || 'brief'));
  const template = findWebsiteTemplate(brief.template_id);
  async function download(material) {
    await run(async () => {
      const { data } = await api.get(`${endpoint}${project.id}/materials/${material.id}/download/`, { responseType: 'blob' });
      const url = URL.createObjectURL(data); const anchor = document.createElement('a');
      anchor.href = url; anchor.download = material.original_name; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
  return h('div', { className: 'wcd', 'data-testid': 'website-customer-dashboard' },
    h('header', { className: 'wcd-header' }, h(Link, { to: '/webdesign', className: 'wcd-brand' }, 'MyHomeBro', h('span', null, 'WEB DESIGN')), h('nav', null, h(Link, { to: '/webdesign#templates' }, 'Template gallery'), h(Link, { to: '/app' }, 'MyHomeBro account'))),
    h('div', { className: 'wcd-layout' },
      h('aside', { className: 'wcd-sidebar' }, h('p', { className: 'wcd-eyebrow' }, 'CUSTOMER WORKSPACE'), h('h2', null, 'Your websites'),
        ...projects.map(row => h('button', { key: row.id, type: 'button', disabled: busy, className: project?.id === row.id ? 'wcd-project active' : 'wcd-project', onClick: () => select(row) }, h('strong', null, row.business_name), h('span', null, row.status_label))),
        h('button', { type: 'button', className: 'wcd-secondary', disabled: busy || loading, onClick: () => select(null) }, '+ New website project'),
        h('div', { className: 'wcd-sidebar-note' }, h('strong', null, 'From first idea to launch.'), h('p', null, 'Keep your business information, website materials, and feedback together.'))),
      h('main', { className: 'wcd-main' },
        h('div', { className: 'wcd-title' }, h('div', null, h('p', { className: 'wcd-eyebrow' }, 'LET’S BUILD SOMETHING THAT FITS'), h('h1', null, project?.business_name || 'Your next website starts here.'), h('p', null, project ? 'Your project, materials, and next steps — all in one place.' : 'Tell us about your business. Save a brief, then add your photos and files.')), h('span', { className: 'wcd-badge' }, project?.status_label || 'New project')),
        error && h('div', { role: 'alert', className: 'wcd-alert' }, error),
        notice && h('div', { role: 'status', className: 'wcd-success' }, notice),
        loading ? h('p', { role: 'status' }, 'Loading your website projects…') : h(React.Fragment, null,
          h('ol', { className: 'wcd-progress', 'aria-label': 'Website project progress' }, ...labels.map((label, i) => h('li', { key: label, className: i <= currentStep ? 'reached' : '', 'aria-current': i === currentStep ? 'step' : undefined }, h('span', null, String(i + 1).padStart(2, '0')), label))),
          h('div', { className: 'wcd-columns' },
            h('section', { className: 'wcd-card' }, h('div', { className: 'wcd-card-heading' }, h('div', null, h('p', { className: 'wcd-eyebrow' }, '01 / THE FOUNDATION'), h('h2', null, 'Your business brief')), h('span', { className: 'wcd-muted' }, dirty ? 'Unsaved changes' : project ? 'Saved' : 'Not saved yet')),
              h('form', { onSubmit: event => { event.preventDefault(); run(async () => {
                const { data } = project ? await api.patch(`${endpoint}${project.id}/`, brief) : await api.post(endpoint, brief);
                receive(data); setDirty(false); setNotice('Your website brief is saved.');
              }); } }, h('fieldset', { disabled: busy, className: 'wcd-fields' },
                field('Business name', 'business_name', { required: true, maxLength: 180 }),
                h('label', null, h('span', null, 'Business type'), h('select', { name: 'business_type', value: brief.business_type, onChange: change }, ...[['contractor', 'Contractor'], ['restaurant', 'Restaurant'], ['other', 'Other business']].map(([value, title]) => h('option', { key: value, value }, title)))),
                h('label', { className: 'wcd-wide' }, h('span', null, 'Starting design'), h('select', { name: 'template_id', value: brief.template_id, onChange: change }, h('option', { value: '' }, 'Help me choose'), ...WEBSITE_TEMPLATES.map(row => h('option', { key: row.id, value: row.id }, `${row.type} — ${row.name}`)))),
                field('Current website (optional)', 'current_website', { type: 'url', placeholder: 'https://', wide: true, maxLength: 200 }),
                field('What do you want your website to do?', 'description', { rows: 4, wide: true, placeholder: 'New website or updates? Tell us your goals, preferred pages, and what customers should be able to do.' }),
                field('Services, menu, or business description', 'services', { rows: 4, wide: true, placeholder: 'Services and service areas, or menu items, hours, and location.' }),
                field('Public business contact information', 'contact_details', { rows: 3, wide: true, maxLength: 3000, placeholder: 'The business phone, email, address, and social links you want shown on your website.' }),
                field('Look, feel, and other requests', 'design_notes', { rows: 3, wide: true, placeholder: 'Colors, reference websites, features, timing, budget, and maintenance preferences. Please do not share passwords.' }),
                h('div', { className: 'wcd-wide wcd-actions' }, h('button', { className: 'wcd-primary', type: 'submit', 'data-testid': 'website-save-brief' }, busy ? 'Saving…' : project ? 'Save changes' : 'Save website brief'), template && h('a', { href: websiteTemplateDemoUrl(template.id), target: '_blank', rel: 'noopener noreferrer' }, 'View design demo ↗'))))),
            h('aside', { className: 'wcd-right' },
              h('section', { className: 'wcd-card wcd-next' }, h('p', { className: 'wcd-eyebrow' }, 'YOUR NEXT STEP'), h('h2', null, project?.status === 'brief' ? 'Ready when you are.' : project ? 'Keep things moving.' : 'Make it yours.'), h('p', null, project?.next_step || (project?.status === 'brief' ? 'Add your goals and business contact information, save, then submit your brief for review.' : project ? 'We’ll review your information and update this space with your next steps. You can keep adding materials below.' : 'Choose a design and save your business brief to start your project.')),
                project?.status === 'brief' && h('button', { className: 'wcd-primary', disabled: busy || dirty, onClick: () => run(async () => { const { data } = await api.post(`${endpoint}${project.id}/submit/`); receive(data); setNotice('Your brief has been submitted for review.'); }) }, 'Submit brief for review'),
                dirty && project && h('small', null, 'Save your changes before submitting.')),
              h('section', { className: 'wcd-card' }, h('p', { className: 'wcd-eyebrow' }, 'YOUR WEBSITE'), h('h2', null, 'Preview & launch'),
                safeLink(project?.preview_url) ? h('a', { className: 'wcd-secondary', href: project.preview_url, target: '_blank', rel: 'noopener noreferrer' }, 'Open website preview ↗') : h('p', null, 'Your working website preview will appear here when it is ready.'),
                safeLink(project?.live_url) && h('a', { className: 'wcd-secondary', href: project.live_url, target: '_blank', rel: 'noopener noreferrer' }, 'Visit live website ↗')),
              h('section', { className: 'wcd-card' }, h('p', { className: 'wcd-eyebrow' }, 'SCOPE & BILLING'), h('h2', null, 'Agree on the plan first.'), h('p', null, 'We’ll confirm your build price, hosting, and any ongoing care before work begins. Saving a brief does not charge you.'), h('small', null, 'Checkout and contractor website credits are not available in this workspace yet.')))),
          h('div', { className: 'wcd-bottom' },
            h('section', { className: 'wcd-card' }, h('p', { className: 'wcd-eyebrow' }, '02 / YOUR MATERIALS'), h('h2', null, 'Photos, logos & documents'), h('p', null, 'Share photos you own or have permission to use. JPG, PNG, WebP, or PDF; up to 5 MB each and 20 files per project. Files are private to your account and the MyHomeBro team.'),
              project ? h(React.Fragment, null,
                h('ul', { className: 'wcd-file-list' }, ...(project.materials || []).map(material => h('li', { key: material.id }, h('span', null, material.original_name, h('small', null, `${Math.ceil(material.size / 1024)} KB`)), h('button', { type: 'button', disabled: busy, onClick: () => download(material) }, 'Download')))),
                h('form', { onSubmit: event => { event.preventDefault(); if (!file) return; run(async () => {
                  const body = new FormData(); body.append('file', file);
                  const { data } = await api.post(`${endpoint}${project.id}/materials/`, body, { headers: { 'Content-Type': 'multipart/form-data' } });
                  receive({ ...project, materials: [...(project.materials || []), data] }); setFile(null); setUploadKey(key => key + 1); setNotice('Your file has been uploaded.');
                }); } }, h('label', { className: 'wcd-file-input' }, 'Choose a photo or PDF', h('input', { key: uploadKey, type: 'file', accept: '.jpg,.jpeg,.png,.webp,.pdf', disabled: busy, onChange: event => { setFile(event.target.files?.[0] || null); } })), h('button', { className: 'wcd-secondary', disabled: busy || !file || file.size > 5 * 1024 * 1024, type: 'submit' }, 'Upload file'), file?.size > 5 * 1024 * 1024 && h('p', { role: 'alert' }, 'Please choose a file smaller than 5 MB.'))) : h('p', { className: 'wcd-muted' }, 'Save your brief to upload materials.')),
            h('section', { className: 'wcd-card' }, h('p', { className: 'wcd-eyebrow' }, '03 / KEEP IN TOUCH'), h('h2', null, 'Questions & change requests'),
              project ? h(React.Fragment, null,
                h('form', { onSubmit: event => { event.preventDefault(); run(async () => {
                  const { data } = await api.post(`${endpoint}${project.id}/requests/`, { message });
                  receive({ ...project, requests: [data, ...(project.requests || [])] }); setMessage(''); setNotice('Your request has been saved for the MyHomeBro team.');
                }); } }, h('label', null, 'What would you like us to know?', h('textarea', { value: message, onChange: event => setMessage(event.target.value), required: true, maxLength: 5000, rows: 3, disabled: busy })), h('button', { className: 'wcd-secondary', type: 'submit', disabled: busy || !message.trim() }, 'Send request')),
                h('ul', { className: 'wcd-request-list' }, ...(project.requests || []).map(request => h('li', { key: request.id }, h('span', { className: 'wcd-badge' }, ({ open: 'Open', in_progress: 'In progress', done: 'Completed' })[request.status] || request.status), h('p', null, request.message), h('small', null, new Date(request.created_at).toLocaleDateString()), request.response && h('div', { className: 'wcd-response' }, h('strong', null, 'MyHomeBro response'), h('p', null, request.response)))))) : h('p', { className: 'wcd-muted' }, 'Save your brief to start a conversation about your website.')))))));
}
