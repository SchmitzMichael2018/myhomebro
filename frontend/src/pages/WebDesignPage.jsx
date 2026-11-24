import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import logo from '../assets/myhomebro_logo.png';
import './WebDesignPage.css';
import './WebDesignGallery.css';
import { WEBSITE_TEMPLATES, findWebsiteTemplate, websiteTemplateDemoUrl } from '../lib/websiteTemplates.js';

const h = React.createElement;
const EMAIL = 'schmitzmichael1985@gmail.com';
const previewDetails = {
  'contractor-showcase': ['1600210492486-724fe5c67fb0', 'A home that feels more like you.', 'Remodelers with finished projects to show', 'Project gallery and estimate inquiry'],
  'contractor-local': ['1600607687920-4e2a09cf159d', 'Your home to-do list. Handled.', 'Local repair and home service businesses', 'Service list and quick estimate path'],
  'contractor-premium': ['1600566753086-00f18fb6b3ea', 'Spaces shaped around your life.', 'Custom builders with a photo portfolio', 'Full-width photography and project stories'],
  'restaurant-food': ['1547592180-85f173990554', 'Good food. Your favorite people.', 'Restaurants that want the menu front and center', 'Featured dishes and searchable menu'],
  'restaurant-local': ['1517248135467-4c7edcad34c4', 'Your everyday favorite.', 'Neighborhood spots with regular walk-in traffic', 'Menu, hours, and location up front'],
  'restaurant-dining': ['1517248135467-4c7edcad34c4', 'An evening worth savoring.', 'Dining rooms where atmosphere matters', 'Dining photography, restaurant story, and visit details'],
};

const briefPath = (templateId = '') => '/webdesign/dashboard' + (templateId ? '?template=' + encodeURIComponent(templateId) : '');

function TemplateThumbnail({ template, featured = false }) {
  const [photo, headline] = previewDetails[template.id];
  const imageUrl = `https://images.unsplash.com/photo-${photo}?auto=format&fit=crop&w=960&q=80`;
  return h('a', { className: 'wd-template-image wd-template-image-' + template.id, href: websiteTemplateDemoUrl(template.id), 'aria-label': 'View ' + template.name + ' demo', 'data-testid': featured ? 'webdesign-template-preview' : undefined },
    h('img', { src: imageUrl, alt: '', loading: featured ? 'eager' : 'lazy', width: 960, height: 600 }),
    h('span', { className: 'wd-template-image-copy' }, h('small', null, template.business), h('strong', null, headline)),
    h('span', { className: 'wd-template-image-action', 'aria-hidden': true }, 'View example website ↗'));
}

function TemplateGallery() {
  const [filter, setFilter] = useState('All');
  const templates = WEBSITE_TEMPLATES.filter(template => filter === 'All' || template.type === filter);
  return h('section', { id: 'templates', className: 'wd-container wd-section' },
    h('div', { className: 'wd-section-heading' }, h('h2', null, 'Find a design that fits.'), h('p', null, 'Explore sample websites for fictional businesses. We’ll customize your design with your brand, photos, and the features agreed in your proposal.')),
    h('div', { className: 'wd-template-tabs', role: 'group', 'aria-label': 'Filter website templates' }, ...['All', 'Contractor', 'Restaurant'].map(item => h('button', { type: 'button', key: item, 'aria-pressed': filter === item, className: filter === item ? 'wd-active' : '', onClick: () => setFilter(item) }, item === 'All' ? 'All designs' : item + ' websites'))),
    h('div', { className: 'wd-gallery-grid', 'data-testid': 'website-template-gallery' }, ...templates.map(template => {
      const [, , audience, feature] = previewDetails[template.id];
      return h('article', { className: 'wd-gallery-card', key: template.id, 'data-testid': 'template-' + template.id },
        h(TemplateThumbnail, { template }),
        h('div', { className: 'wd-gallery-card-copy' },
          h('p', { className: 'wd-template-category' }, template.type),
          h('h3', null, template.name),
          h('p', null, audience),
          h('p', { className: 'wd-template-feature' }, feature),
          h(Link, { className: 'wd-text-link', to: briefPath(template.id), 'aria-label': 'Choose ' + template.name }, 'Use this design →')));
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
      h('nav', { 'aria-label': 'Web design navigation' }, h('a', { href: '#templates' }, 'Templates'), h('a', { href: '#process' }, 'How it works'), h(Link, { className: 'wd-dashboard-link', to: '/webdesign/dashboard' }, 'Customer dashboard'), h('a', { className: 'wd-button wd-button-small', href: '#quote' }, 'Start a free website request'))),
    h('main', { id: 'webdesign-main' },
      h('section', { className: 'wd-hero wd-container' },
        h('div', { className: 'wd-hero-copy' },
          h('h1', null, 'A website that works for your business.'),
          h('p', { className: 'wd-lead' }, 'Help customers find your services, browse your menu, or get in touch. We design and build websites for contractors and restaurants.'),
          h('div', { className: 'wd-actions' }, h('a', { className: 'wd-button', href: '#templates' }, 'Explore the designs'), h('a', { className: 'wd-text-link', href: '#quote' }, 'Start a free website request →'))),
        h('div', { className: 'wd-hero-preview' }, h(TemplateThumbnail, { template: WEBSITE_TEMPLATES[0], featured: true }))),
      h(TemplateGallery),
      h('section', { id: 'process', className: 'wd-container wd-section' },
        h('div', { className: 'wd-section-heading' }, h('h2', null, 'How your website gets built'), h('p', null, 'You’ll see the what’s included and what it costs before you decide whether to go ahead.')),
        h('ol', { className: 'wd-journey' }, ...[
          ['Send your website request', 'Tell us what your business needs. Pick a design or ask us to help you choose.'],
          ['Review your proposal', 'We confirm the pages, features, timeline, revisions, and any recurring costs.'],
          ['Accept and pay', 'If the proposal works for you, accept the terms and pay securely through Stripe.'],
          ['Review your preview', 'We build the site using your content and share it for feedback.'],
          ['Approve and launch', 'Once you approve the design, we schedule launch and confirm how you’ll access your website.'],
        ].map(([title, copy]) => h('li', { key: title }, h('h3', null, title), h('p', null, copy))))),
      h('section', { className: 'wd-credit' }, h('div', { className: 'wd-container wd-credit-grid' }, h('div', null, h('p', { className: 'wd-eyebrow' }, 'FOR MYHOMEBRO CONTRACTORS'), h('h2', null, 'A website that could', h('br'), 'help pay for itself.'), h('p', null, 'Pay for your website development upfront. Our proposed website-credit program would let contractors earn credits through qualifying MyHomeBro projects.'), h('a', { className: 'wd-button', href: '#quote', onClick: () => setBusiness('Contractor') }, 'Ask about contractor credits ↗')),
        h('div', { className: 'wd-credit-notes' }, h('h3', null, 'Two ways to connect with MyHomeBro'), h('p', null, h('strong', null, 'Referral rewards'), h('br'), 'Share your referral QR code or link under the applicable MyHomeBro referral program.'), h('p', null, h('strong', null, 'Proposed website credits'), h('br'), 'Earn toward your development cost through eligible platform activity. Separate from referral rewards.'), h('p', { className: 'wd-small' }, 'Website credits are not yet available. Amounts, eligibility, limits, redemption, and treatment of maintenance fees must be finalized before enrollment. No credit or reimbursement is guaranteed.')))),
      h('section', { className: 'wd-container wd-care' }, h('div', null, h('p', { className: 'wd-eyebrow' }, 'AFTER LAUNCH'), h('h2', null, 'You run your business.', h('br'), 'We can look after the website.')), h('div', null, h('p', null, 'Choose a one-time build with website access at launch, or ask about ongoing maintenance for content updates, website checks, and hosting management.'), h('p', { className: 'wd-small' }, 'Maintenance scope, response times, domain renewals, hosting costs, and third-party charges are agreed separately. Custom ordering, booking systems, and advanced features are quoted individually.'))),
      h('section', { id: 'quote', className: 'wd-container wd-section wd-quote' }, h('div', null, h('p', { className: 'wd-eyebrow' }, 'LET’S TALK ABOUT YOUR WEBSITE'), h('h2', null, 'A fresh start.', h('br'), 'Or a better next step.'), h('p', { className: 'wd-lead' }, 'Tell us what you have in mind. We’ll help identify the right starting point and scope.'), h('p', { className: 'wd-small' }, 'Prefer to talk? ', h('a', { href: 'tel:+14846648861' }, '(484) 664-8861')), h('a', { className: 'wd-text-link', href: `mailto:${EMAIL}` }, EMAIL)), h('div', { className: 'wd-intake' },
        h('h3', null, 'Start your website request'),
        h('p', null, 'Sign in or create a MyHomeBro account to save your request, share files, and review your proposal when it’s ready.'),
        h(Link, { className: 'wd-button', to: briefPath(selectedTemplate) }, 'Start a free website request'),
        h('details', null, h('summary', null, 'Prefer to start by email?'), h(QuoteForm, { business, setBusiness, selectedTemplate, setSelectedTemplate })))),
      h('section', { className: 'wd-container wd-faq' }, h('h2', null, 'A few helpful answers.'), ...[
        ['Can you work on my existing website?', 'Yes. We first review its platform, access, and requested changes, then recommend an update, redesign, or rebuild.'], ['Do I need to move my domain?', 'Usually you can keep your existing domain registrar. We assess hosting and domain settings before making any changes, including settings used by business email.'], ['Can a restaurant include online ordering?', 'We can link to your existing ordering provider. A custom ordering system or deeper integration requires a separate scope and quote.'], ['How much does a website cost?', 'We quote after reviewing the template, content, pages, and features you need. Development and recurring services are listed separately.'],
      ].map(([question, answer]) => h('details', { key: question }, h('summary', null, question), h('p', null, answer))))),
    h('footer', { className: 'wd-container wd-footer' }, h('span', null, 'MyHomeBro LLC • Web Design'), h('div', null, h(Link, { to: '/' }, 'Explore MyHomeBro ↗'), h(Link, { to: '/legal/privacy-policy' }, 'Privacy'), h(Link, { to: '/legal/terms-of-service' }, 'Terms'))));
}
