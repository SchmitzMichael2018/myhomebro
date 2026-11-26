import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import logo from '../assets/myhomebro_logo.png';
import showcasePhoto from '../assets/website/gallery-showcase.webp';
import localServicePhoto from '../assets/website/gallery-local-service.webp';
import premiumPhoto from '../assets/website/gallery-premium.webp';
import foodPhoto from '../assets/website/gallery-food.webp';
import diningPhoto from '../assets/website/gallery-dining.webp';
import './WebDesignPage.css';
import './WebDesignGallery.css';
import { WEBSITE_TEMPLATES, findWebsiteTemplate, websiteTemplateDemoUrl } from '../lib/websiteTemplates.js';

const h = React.createElement;
const EMAIL = 'info@myhomebro.com';
const previewDetails = {
  'contractor-showcase': [showcasePhoto, 'A home that feels more like you.', 'Remodelers with finished projects to show', 'Project gallery and estimate inquiry'],
  'contractor-local': [localServicePhoto, 'Your home to-do list. Handled.', 'Local repair and home service businesses', 'Service list and quick estimate path'],
  'contractor-premium': [premiumPhoto, 'Spaces shaped around your life.', 'Custom builders with a photo portfolio', 'Full-width photography and project stories'],
  'restaurant-food': [foodPhoto, 'Good food. Your favorite people.', 'Restaurants that want the menu front and center', 'Featured dishes and searchable menu'],
  'restaurant-local': [diningPhoto, 'Your everyday favorite.', 'Neighborhood spots with regular walk-in traffic', 'Menu, hours, and location up front'],
  'restaurant-dining': [diningPhoto, 'An evening worth savoring.', 'Dining rooms where atmosphere matters', 'Dining photography, restaurant story, and visit details'],
};

const briefPath = (templateId = '') => '/webdesign/dashboard' + (templateId ? '?template=' + encodeURIComponent(templateId) : '');

function TemplateThumbnail({ template, featured = false }) {
  const [imageUrl, headline] = previewDetails[template.id];
  return h('a', { className: 'wd-template-image wd-template-image-' + template.id, href: websiteTemplateDemoUrl(template.id), 'aria-label': 'View ' + template.name + ' demo', 'data-testid': featured ? 'webdesign-template-preview' : undefined },
    h('img', { src: imageUrl, alt: '', onError: event => { event.currentTarget.hidden = true; }, loading: featured ? 'eager' : 'lazy', width: 960, height: 600 }),
    h('span', { className: 'wd-template-image-copy' }, h('small', null, template.business), h('strong', null, headline)),
    h('span', { className: 'wd-template-image-action', 'aria-hidden': true }, 'View example website ↗'));
}

function TemplateGallery() {
  const [filter, setFilter] = useState('All');
  const [showAll, setShowAll] = useState(false);
  const templates = showAll
    ? WEBSITE_TEMPLATES.filter(template => filter === 'All' || template.type === filter)
    : ['contractor-local', 'restaurant-food'].map(findWebsiteTemplate);
  return h('section', { id: 'templates', className: 'wd-container wd-section' },
    h('div', { className: 'wd-section-heading' },
      h('h2', null, 'Website examples'),
      h('p', null, 'Explore a contractor site and a restaurant site. When you start your request, you can choose a design or ask us to help.')),
    h('button', { type: 'button', className: 'wd-secondary wd-gallery-toggle', 'aria-expanded': showAll, 'aria-controls': 'webdesign-gallery', onClick: () => setShowAll(!showAll) }, showAll ? 'Show featured examples' : 'View full template gallery'),
    showAll && h('div', { className: 'wd-template-tabs', role: 'group', 'aria-label': 'Filter website templates' }, ...['All', 'Contractor', 'Restaurant'].map(item => h('button', { type: 'button', key: item, 'aria-pressed': filter === item, className: filter === item ? 'wd-active' : '', onClick: () => setFilter(item) }, item === 'All' ? 'All designs' : item + ' websites'))),
    h('div', { id: 'webdesign-gallery', className: 'wd-gallery-grid' + (showAll ? '' : ' wd-gallery-featured'), 'data-testid': 'website-template-gallery' }, ...templates.map(template => {
      const [, , audience, feature] = previewDetails[template.id];
      return h('article', { className: 'wd-gallery-card', key: template.id, 'data-testid': 'template-' + template.id },
        h(TemplateThumbnail, { template }),
        h('div', { className: 'wd-gallery-card-copy' },
          h('p', { className: 'wd-template-category' }, template.type),
          h('h3', null, template.name),
          h('p', null, audience),
          h('p', { className: 'wd-template-feature' }, feature),
          showAll && h(Link, { className: 'wd-text-link', to: briefPath(template.id), 'aria-label': 'Choose ' + template.name }, 'Use this design →')));
    })));
}

function QuoteForm({ business, setBusiness, selectedTemplate, setSelectedTemplate }) {
  const [step, setStep] = useState(1);
  const [values, setValues] = useState({ need: 'New website', company: '', website: '', details: '', budget: 'Please advise', timing: '', name: '', email: '', phone: '' });
  const [prepared, setPrepared] = useState(false);
  const heading = useRef(null);
  const update = event => setValues({ ...values, [event.target.name]: event.target.value });
  const go = next => { setStep(next); requestAnimationFrame(() => heading.current?.focus()); };
  const field = (label, name, type = 'text', required = false) => h('label', { key: name }, label, h('input', { name, type, required, value: values[name], onChange: update, maxLength: name === 'website' ? 500 : 160, autoComplete: ({name:'name',email:'email',phone:'tel',company:'organization'})[name] || 'off' }));
  const summary = `Website inquiry\n\nBusiness type: ${business}\nSelected design: ${findWebsiteTemplate(selectedTemplate)?.name || 'Help me choose'}\nProject: ${values.need}\nBusiness: ${values.company}\nCurrent website: ${values.website || 'None supplied'}\nDetails: ${values.details}\nBudget: ${values.budget}\nTiming: ${values.timing || 'Flexible'}\n\nName: ${values.name}\nEmail: ${values.email}\nPhone: ${values.phone || 'Not supplied'}`;
  const mailto = `mailto:${EMAIL}?subject=${encodeURIComponent('Website inquiry: ' + values.company)}&body=${encodeURIComponent(summary)}`;
  return h('div', { className: 'wd-quote-form' },
    h('p', { className: 'wd-eyebrow', 'aria-live': 'polite' }, `STEP ${step} OF 3 • NO ACCOUNT NEEDED`),
    h('h3', { ref: heading, tabIndex: -1 }, ['Tell us what you need.', 'A little about your business.', 'How can we reach you?'][step - 1]),
    h('form', { onSubmit: event => { event.preventDefault(); if (step < 3) go(step + 1); else setPrepared(true); } },
      step === 1 && h(React.Fragment, null,
        h('fieldset', null, h('legend', null, 'Your business'), ...['Contractor', 'Restaurant', 'Other small business'].map(item => h('label', { className: 'wd-choice', key: item }, h('input', { type: 'radio', name: 'business', checked: business === item, onChange: () => { setBusiness(item); if (findWebsiteTemplate(selectedTemplate)?.type !== item) setSelectedTemplate(''); } }), item))),
        h('label', null, 'Website design', h('select', {name:'template',value:selectedTemplate,onChange:event=>{setSelectedTemplate(event.target.value);const chosen=findWebsiteTemplate(event.target.value);if(chosen)setBusiness(chosen.type);}}, h('option',{value:''},'Help me choose'),...WEBSITE_TEMPLATES.map(item=>h('option',{key:item.id,value:item.id},item.type+' — '+item.name)))),
        h('label', null, 'What would you like help with?', h('select', { name: 'need', value: values.need, onChange: update }, ...['New website', 'Update my existing website', 'Redesign or replace my website', 'Website maintenance'].map(item => h('option', { key: item }, item))))),
      step === 2 && h(React.Fragment, null,
        field('Business name', 'company', 'text', true), field('Current website (optional)', 'website'),
        h('label', null, 'What should your website help customers do?', h('textarea', { name: 'details', required: true, maxLength: 1000, rows: 3, value: values.details, onChange: update, placeholder: 'For example: request estimates, browse a menu, or find our location.' })),
        h('div', { className: 'wd-fields' }, h('label', null, 'Approximate build budget', h('select', { name: 'budget', value: values.budget, onChange: update }, ...['Please advise', 'Under $1,000', '$1,000–$2,500', '$2,500+'].map(item => h('option', { key: item }, item)))), field('Preferred timing (optional)', 'timing'))),
      step === 3 && h(React.Fragment, null, field('Your name', 'name', 'text', true), field('Email address', 'email', 'email', true), field('Phone (optional)', 'phone', 'tel'), h('p', { className: 'wd-small' }, 'Review your inquiry, then send it using your email app. Nothing is submitted automatically.')),
      h('div', { className: 'wd-form-actions' }, step > 1 && h('button', { className: 'wd-secondary', type: 'button', onClick: () => { setPrepared(false); go(step - 1); } }, 'Back'), h('button', { className: 'wd-button', type: 'submit' }, step === 3 ? 'Review inquiry →' : 'Continue →'))),
    prepared && step === 3 && h('div', { className: 'wd-email-review', role: 'status' }, h('h4', null, 'Ready for your review'), h('pre', null, summary), h('a', { className: 'wd-button', href: mailto }, 'Open email to send ↗'), h('p', { className: 'wd-small' }, 'Your request is sent only when you send the email. If your email app does not open, copy the details above and email ', h('a', { href: `mailto:${EMAIL}` }, EMAIL), '.')));
}

export default function WebDesignPage() {
  const initialTemplate = findWebsiteTemplate(typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('template'));
  const [selectedTemplate,setSelectedTemplate] = useState(initialTemplate?.id || '');
  const [business,setBusiness] = useState(initialTemplate?.type || 'Contractor');
  useEffect(()=>{if(window.location.hash === '#quote') document.getElementById('quote')?.scrollIntoView();},[]);

  return h('div', { className: 'wd-page', 'data-testid': 'webdesign-page' },
    h('a', { className: 'wd-skip', href: '#webdesign-main' }, 'Skip to content'),
    h('header', { className: 'wd-header' }, h(Link, { className: 'wd-brand', to: '/', 'aria-label': 'MyHomeBro home' }, h('img', { src: logo, alt: '', width: 44, height: 44 }), h('span', null, 'MyHomeBro', h('small', null, 'WEB DESIGN'))),
      h('nav', { 'aria-label': 'Web design navigation' }, h('a', { href: '#templates' }, 'Templates'), h('a', { href: '#packages' }, 'Packages'), h('a', { href: '#process' }, 'How it works'), h(Link, { className: 'wd-dashboard-link', to: '/webdesign/dashboard' }, 'Customer dashboard'), h('a', { className: 'wd-button wd-button-small', href: '#quote' }, 'Start a free website request'))),
    h('main', { id: 'webdesign-main' },
      h('section', { className: 'wd-hero wd-container' },
        h('div', { className: 'wd-hero-copy' },
          h('h1', null, 'A website that works for your business.'),
          h('p', { className: 'wd-lead' }, 'Help customers find your services, browse your menu, or get in touch. We design and build websites for contractors and restaurants.'),
          h('p', { className: 'wd-lead' }, h('strong', null, 'Start with a free, three-step request.'), ' Once you send it, your project workspace is where you track progress.'),
          h('div', { className: 'wd-actions' }, h('a', { className: 'wd-button', href: '#templates' }, 'Explore the designs'), h('a', { className: 'wd-text-link', href: '#quote' }, 'Start a free website request →'))),
        h('div', { className: 'wd-hero-preview' }, h(TemplateThumbnail, { template: WEBSITE_TEMPLATES[0], featured: true }))),
      h(TemplateGallery),
      h('section', { id: 'packages', className: 'wd-container wd-section' },
        h('div', { className: 'wd-section-heading' },
          h('h2', null, 'Website packages'),
          h('p', null, 'We confirm your scope, timeline, and any recurring costs before you decide.')),
        h('div', { className: 'wd-package-grid' }, ...[
          ['One-Page Website', 'From $500', 'One mobile-friendly page based on a template, using content you provide. Includes one revision round and domain connection.'],
          ['Multi-Page Website', 'From $950', 'Up to four template-based pages, such as Home, Services or Menu, About, and Contact. Includes two revision rounds and domain connection.'],
          ['Website Updates & Integrations', 'Request a quote', 'Small fixes, new pages, and upgrades to an existing site. Ask about payments, analytics, automation, or AI tools.'],
        ].map(([name, price, description]) => h('article', { key: name },
          h('h3', null, name), h('p', { className: 'wd-package-price' }, price), h('p', null, description)))),
        h('div', { className: 'wd-actions' }, h('a', { className: 'wd-button', href: '#quote' }, 'Start a free website request'))),
      h('section', { id: 'process', className: 'wd-container wd-section' },
        h('div', { className: 'wd-section-heading' }, h('h2', null, 'How your website gets built'), h('p', null, 'You’ll see what’s included and what it costs before you decide whether to go ahead.')),
        h('ol', { className: 'wd-journey' }, ...[
          ['Send your request', 'Choose a starting design or ask us to help, add your business details, then review and send.'],
          ['Review your quote', 'Use your project workspace to share materials and review the scope, timing, and price before you decide.'],
          ['Approve your site', 'Review the preview, request changes in your workspace, and approve the site for launch.'],
        ].map(([title, copy]) => h('li', { key: title }, h('h3', null, title), h('p', null, copy))))),
      h('section', { id: 'ownership', className: 'wd-container wd-section' },
        h('div', { className: 'wd-section-heading' },
          h('h2', null, 'Domain ownership and hosting'),
          h('p', null, 'Your proposal explains what you own, who manages your site, and what it costs to keep it online.')),
        h('dl', { className: 'wd-ownership-grid' }, ...[
          ['You own your domain', 'Register your domain in your name or keep the one you already own.'],
          ['Hosting for new websites', 'We typically set up new websites on Cloudflare Pages. Your proposal lists who manages hosting and any recurring costs.'],
          ['Updates to an existing website', 'We review your current platform and hosting first. We confirm any changes to that setup with you before work begins.'],
          ['Handoff and ongoing care', 'Your proposal spells out which site files and account access you receive, who handles renewals, and any optional maintenance.'],
        ].map(([title, copy]) => h('div', { key: title }, h('dt', null, title), h('dd', null, copy))))),
      h('section', { id: 'quote', className: 'wd-container wd-section wd-quote' }, h('div', null, h('p', { className: 'wd-eyebrow' }, 'LET’S TALK ABOUT YOUR WEBSITE'), h('h2', null, 'A fresh start.', h('br'), 'Or a better next step.'), h('p', { className: 'wd-lead' }, 'Tell us what you have in mind. We’ll help identify the right starting point and scope.'), h('a', { className: 'wd-text-link', href: `mailto:${EMAIL}` }, EMAIL)), h('div', { className: 'wd-intake' },
        h('h3', null, 'Start your website request'),
        h('p', null, 'Sign in or create a MyHomeBro account to save your request, share files, and review your proposal when it’s ready.'),
        h(Link, { className: 'wd-button', to: briefPath(selectedTemplate) }, 'Start a free website request'),
        h('details', null, h('summary', null, 'Prefer to start by email?'), h(QuoteForm, { business, setBusiness, selectedTemplate, setSelectedTemplate })))),
      h('section', { className: 'wd-container wd-faq' }, h('h2', null, 'A few helpful answers.'), ...[
        ['Can you work on my existing website?', 'Yes. We first review its platform, access, and requested changes, then recommend an update, redesign, or rebuild.'], ['Do I need to move my domain?', 'Usually you can keep your existing domain registrar. We assess hosting and domain settings before making any changes, including settings used by business email.'], ['Can a restaurant include online ordering?', 'We can link to your existing ordering provider. A custom ordering system or deeper integration requires a separate scope and quote.'], ['How much does a website cost?', 'We quote after reviewing the template, content, pages, and features you need. Development and recurring services are listed separately.'],
        ['Are website credits available for MyHomeBro contractors?', 'Website credits are proposed and enrollment is closed. The existing MyHomeBro referral program has separate terms.'],
      ].map(([question, answer]) => h('details', { key: question }, h('summary', null, question), h('p', null, answer))))),
    h('footer', { className: 'wd-container wd-footer' }, h('span', null, 'MyHomeBro LLC • Web Design'), h('div', null, h(Link, { to: '/' }, 'Explore MyHomeBro ↗'), h(Link, { to: '/legal/privacy-policy' }, 'Privacy'), h(Link, { to: '/legal/terms-of-service' }, 'Terms'))));
}
