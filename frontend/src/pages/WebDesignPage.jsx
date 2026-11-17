import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import logo from '../assets/myhomebro_logo.png';
import './WebDesignPage.css';

const h = React.createElement;
const EMAIL = 'schmitzmichael1985@gmail.com';
const examples = {
  contractor: { name: 'Oak & Stone', label: 'CONSTRUCTION & REMODELING', title: 'Good work. Built to last.', text: 'Thoughtful renovations. Practical improvements. A home that works for you.', action: 'Request an estimate', items: ['Renovations', 'Outdoor living', 'Home improvements'] },
  restaurant: { name: 'The Neighborhood Table', label: 'LOCAL KITCHEN • GOOD COMPANY', title: 'Your new usual.', text: 'Fresh favorites, familiar faces, and something worth coming back for.', action: 'Explore our menu', items: ['Seasonal menu', 'Hours & location', 'Catering'] },
};

function Example({ type }) {
  const item = examples[type];
  return h('div', { className: `wd-browser wd-${type}`, 'data-testid': 'webdesign-template-preview' },
    h('div', { className: 'wd-browser-bar' }, h('span', { 'aria-hidden': true }, '● ● ●'), h('span', null, 'Illustrative template • your branding goes here')),
    h('div', { className: 'wd-example' },
      h('div', { className: 'wd-example-nav' }, h('strong', null, item.name), h('span', null, type === 'contractor' ? 'Services / Our work / Contact' : 'Menu / Our story / Visit')),
      h('div', { className: 'wd-example-body' }, h('div', null, h('small', null, item.label), h('h3', null, item.title), h('p', null, item.text), h('span', { className: 'wd-example-cta' }, item.action, ' ↗')),
        h('div', { className: 'wd-art', 'aria-hidden': true }, type === 'contractor' ? h('div', { className: 'wd-house' }) : h('div', { className: 'wd-plate' }))),
      h('div', { className: 'wd-example-bottom' }, ...item.items.map(item => h('span', { key: item }, item)))));
}

function QuoteForm({ business, setBusiness }) {
  const [step, setStep] = useState(1);
  const [values, setValues] = useState({ need: 'New website', company: '', website: '', details: '', budget: 'Please advise', timing: '', name: '', email: '', phone: '' });
  const [prepared, setPrepared] = useState(false);
  const heading = useRef(null);
  const update = event => setValues({ ...values, [event.target.name]: event.target.value });
  const go = next => { setStep(next); requestAnimationFrame(() => heading.current?.focus()); };
  const field = (label, name, type = 'text', required = false) => h('label', { key: name }, label, h('input', { name, type, required, value: values[name], onChange: update, maxLength: name === 'website' ? 500 : 160, autoComplete: ({name:'name',email:'email',phone:'tel',company:'organization'})[name] || 'off' }));
  const summary = `Website inquiry\n\nBusiness type: ${business}\nProject: ${values.need}\nBusiness: ${values.company}\nCurrent website: ${values.website || 'None supplied'}\nDetails: ${values.details}\nBudget: ${values.budget}\nTiming: ${values.timing || 'Flexible'}\n\nName: ${values.name}\nEmail: ${values.email}\nPhone: ${values.phone || 'Not supplied'}`;
  const mailto = `mailto:${EMAIL}?subject=${encodeURIComponent('Website inquiry: ' + values.company)}&body=${encodeURIComponent(summary)}`;
  return h('div', { className: 'wd-quote-form' },
    h('p', { className: 'wd-eyebrow', 'aria-live': 'polite' }, `STEP ${step} OF 3 • NO ACCOUNT NEEDED`),
    h('h3', { ref: heading, tabIndex: -1 }, ['Tell us what you need.', 'A little about your business.', 'How can we reach you?'][step - 1]),
    h('form', { onSubmit: event => { event.preventDefault(); if (step < 3) go(step + 1); else setPrepared(true); } },
      step === 1 && h(React.Fragment, null,
        h('fieldset', null, h('legend', null, 'Your business'), ...['Contractor', 'Restaurant', 'Other small business'].map(item => h('label', { className: 'wd-choice', key: item }, h('input', { type: 'radio', name: 'business', checked: business === item, onChange: () => setBusiness(item) }), item))),
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
  const [template, setTemplate] = useState('contractor');
  const [business, setBusiness] = useState('Contractor');
  return h('div', { className: 'wd-page', 'data-testid': 'webdesign-page' },
    h('a', { className: 'wd-skip', href: '#webdesign-main' }, 'Skip to content'),
    h('header', { className: 'wd-header' }, h(Link, { className: 'wd-brand', to: '/', 'aria-label': 'MyHomeBro home' }, h('img', { src: logo, alt: '', width: 44, height: 44 }), h('span', null, 'MyHomeBro', h('small', null, 'WEB DESIGN'))),
      h('nav', { 'aria-label': 'Web design navigation' }, h('a', { href: '#templates' }, 'Templates'), h('a', { href: '#process' }, 'How it works'), h('a', { className: 'wd-button wd-button-small', href: '#quote' }, 'Let’s build your website ↗'))),
    h('main', { id: 'webdesign-main' },
      h('section', { className: 'wd-hero wd-container' },
        h('div', { className: 'wd-hero-copy' }, h('p', { className: 'wd-eyebrow' }, 'FOR THE BUSINESSES THAT KEEP US GOING'), h('h1', null, 'Your business.', h('br'), 'Looking its ', h('em', null, 'best.')),
          h('p', { className: 'wd-lead' }, 'Professional websites for contractors and restaurants. A proven starting point, your own personality, and help from the first idea to launch.'),
          h('div', { className: 'wd-actions' }, h('a', { className: 'wd-button', href: '#templates' }, 'Explore the templates ↗'), h('a', { className: 'wd-text-link', href: '#quote' }, 'Already have a website? →')),
          h('p', { className: 'wd-hero-note' }, 'Mobile-friendly. Customized for you. Built to grow.')),
        h('div', { className: 'wd-hero-preview' }, h(Example, { type: 'contractor' }), h('div', { className: 'wd-preview-caption' }, h('span', null, 'YOUR NEXT CHAPTER, ONLINE.'), h('span', null, '01 / CONTRACTOR CONCEPT')))),
      h('div', { className: 'wd-benefits' }, ...['Your brand, front and center', 'Clear calls to action', 'Domain & launch guidance', 'Optional ongoing care'].map(item => h('span', { key: item }, '✓ ', item))),
      h('section', { id: 'templates', className: 'wd-container wd-section' }, h('div', { className: 'wd-section-heading' }, h('div', null, h('p', { className: 'wd-eyebrow' }, 'A SMARTER START'), h('h2', null, 'Start with a structure.', h('br'), 'Make it your own.')), h('p', null, 'Choose a direction. We tailor the colors, photos, wording, and features to your business. These examples show the possibilities, not past client work.')),
        h('div', { className: 'wd-template-tabs', role: 'group', 'aria-label': 'Choose a template example' }, ...Object.keys(examples).map(type => h('button', { key: type, type: 'button', 'aria-pressed': template === type, onClick: () => setTemplate(type), className: template === type ? 'wd-active' : '' }, type === 'contractor' ? '01 / Contractor websites' : '02 / Restaurant websites'))),
        h('div', { className: 'wd-template-layout' }, h(Example, { type: template }), h('div', { className: 'wd-template-details' }, h('p', { className: 'wd-eyebrow' }, template === 'contractor' ? 'BUILT FOR YOUR TRADE' : 'A TASTE OF YOUR BUSINESS'), h('h3', null, template === 'contractor' ? 'Turn your work into your best introduction.' : 'Give customers a reason to stop by.'), h('ul', null, ...(template === 'contractor' ? ['Services and service areas', 'Project photos and your business story', 'Estimate inquiries and click-to-call links', 'MyHomeBro project and referral links'] : ['Easy-to-read menu and food photos', 'Hours, location, and contact information', 'Links to your ordering or reservation provider', 'Catering inquiries and your restaurant story']).map(item => h('li', { key: item }, item))), h('a', { className: 'wd-text-link', href: '#quote', onClick: () => setBusiness(template === 'contractor' ? 'Contractor' : 'Restaurant') }, 'Plan a website like this →')))),
      h('section', { className: 'wd-credit' }, h('div', { className: 'wd-container wd-credit-grid' }, h('div', null, h('p', { className: 'wd-eyebrow' }, 'FOR MYHOMEBRO CONTRACTORS'), h('h2', null, 'A website that could', h('br'), 'help pay for itself.'), h('p', null, 'Pay for your website development upfront. Our proposed website-credit program would let contractors earn credits through qualifying MyHomeBro projects.'), h('a', { className: 'wd-button', href: '#quote', onClick: () => setBusiness('Contractor') }, 'Ask about contractor credits ↗')),
        h('div', { className: 'wd-credit-notes' }, h('h3', null, 'Two ways to connect with MyHomeBro'), h('p', null, h('strong', null, 'Referral rewards'), h('br'), 'Share your referral QR code or link under the applicable MyHomeBro referral program.'), h('p', null, h('strong', null, 'Proposed website credits'), h('br'), 'Earn toward your development cost through eligible platform activity. Separate from referral rewards.'), h('p', { className: 'wd-small' }, 'Website credits are not yet available. Amounts, eligibility, limits, redemption, and treatment of maintenance fees must be finalized before enrollment. No credit or reimbursement is guaranteed.')))),
      h('section', { id: 'process', className: 'wd-container wd-section' }, h('p', { className: 'wd-eyebrow' }, 'FROM IDEA TO ONLINE'), h('h2', null, 'A clear process.', h('br'), 'At every step.'), h('div', { className: 'wd-steps' }, ...[
        ['Choose your direction', 'Tell us about your business. We review existing sites before quoting changes.'], ['Agree on the plan', 'Confirm pages, features, price, responsibilities, and any recurring costs.'], ['Make it yours', 'Share your content and photos. We build a preview and gather your feedback.'], ['Launch with confidence', 'Connect your domain, check the details, and hand over access or arrange ongoing care.'],
      ].map(([title, text], index) => h('article', { key: title }, h('span', null, `0${index + 1}`), h('h3', null, title), h('p', null, text))))),
      h('section', { className: 'wd-container wd-care' }, h('div', null, h('p', { className: 'wd-eyebrow' }, 'AFTER LAUNCH'), h('h2', null, 'You run your business.', h('br'), 'We can look after the website.')), h('div', null, h('p', null, 'Choose a build and handoff, or ask about ongoing maintenance for content updates, website checks, and hosting management.'), h('p', { className: 'wd-small' }, 'Maintenance scope, response times, domain renewals, hosting costs, and third-party charges are agreed separately. Custom ordering, booking systems, and advanced features are quoted individually.'))),
      h('section', { id: 'quote', className: 'wd-container wd-section wd-quote' }, h('div', null, h('p', { className: 'wd-eyebrow' }, 'LET’S TALK ABOUT YOUR WEBSITE'), h('h2', null, 'A fresh start.', h('br'), 'Or a better next step.'), h('p', { className: 'wd-lead' }, 'Tell us what you have in mind. We’ll help identify the right starting point and scope.'), h('p', { className: 'wd-small' }, 'Prefer to talk? ', h('a', { href: 'tel:+14846648861' }, '(484) 664-8861')), h('a', { className: 'wd-text-link', href: `mailto:${EMAIL}` }, EMAIL)), h(QuoteForm, { business, setBusiness })),
      h('section', { className: 'wd-container wd-faq' }, h('h2', null, 'A few helpful answers.'), ...[
        ['Can you work on my existing website?', 'Yes. We first review its platform, access, and requested changes, then recommend an update, redesign, or rebuild.'], ['Do I need to move my domain?', 'Usually you can keep your existing domain registrar. We assess hosting and domain settings before making any changes, including settings used by business email.'], ['Can a restaurant include online ordering?', 'We can link to your existing ordering provider. A custom ordering system or deeper integration requires a separate scope and quote.'], ['How much does a website cost?', 'We quote after reviewing the template, content, pages, and features you need. Development and recurring services are listed separately.'],
      ].map(([question, answer]) => h('details', { key: question }, h('summary', null, question), h('p', null, answer))))),
    h('footer', { className: 'wd-container wd-footer' }, h('span', null, 'MyHomeBro LLC • Web Design'), h('div', null, h(Link, { to: '/' }, 'Explore MyHomeBro ↗'), h(Link, { to: '/legal/privacy-policy' }, 'Privacy'), h(Link, { to: '/legal/terms-of-service' }, 'Terms'))));
}
