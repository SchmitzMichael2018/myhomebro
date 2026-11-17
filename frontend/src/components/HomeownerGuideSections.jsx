import React from 'react';

export function isHomeownerProjectGuide(item) {
  return item.audience === 'homeowner' && (item.sections || []).some(section => section.id === 'diy-readiness');
}

export function HomeownerGuideNavigation() {
  return (
    <nav aria-label="Project guide sections" className="mt-8 flex flex-wrap gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4" data-testid="homeowner-guide-navigation">
      <a href="#diy-route" className="inline-flex min-h-11 items-center rounded-xl bg-blue-800 px-5 font-bold text-white hover:text-white">Explore DIY tasks</a>
      <a href="#hire-route" className="inline-flex min-h-11 items-center rounded-xl border border-blue-300 bg-white px-5 font-bold text-blue-900">Prepare to hire</a>
      <button type="button" onClick={() => window.print()} className="min-h-11 rounded-xl px-4 font-semibold text-blue-900 underline">Print this guide</button>
    </nav>
  );
}

function TextSection({ section, numbered = false }) {
  const Heading = numbered ? 'h3' : 'h2';
  return (
    <section id={section.id} className={`scroll-mt-6 ${numbered ? 'rounded-2xl border border-slate-200 bg-white p-5 sm:p-6' : 'mt-10'}`}>
      <Heading className="text-xl font-bold text-slate-950">{section.title}</Heading>
      <p className="mt-3 whitespace-pre-line leading-8 text-slate-700">{section.body}</p>
    </section>
  );
}

export function HomeownerGuideSections({ sections = [] }) {
  const shared = sections.filter(section => !section.id.startsWith('diy-') && !section.id.startsWith('hire-') && section.id !== 'guide-sources');
  const diy = sections.filter(section => section.id.startsWith('diy-'));
  const hire = sections.filter(section => section.id.startsWith('hire-'));
  const sources = sections.find(section => section.id === 'guide-sources');
  return (
    <>
      {shared.map(section => <TextSection key={section.id} section={section} />)}
      <section id="diy-route" className="mt-12 scroll-mt-6" aria-labelledby="diy-route-heading" data-testid="homeowner-diy-guide">
        <p className="text-sm font-bold uppercase tracking-widest text-blue-800">Do it yourself, with clear limits</p>
        <h2 id="diy-route-heading" className="mt-2 text-3xl font-black text-slate-950">Your DIY walkthrough</h2>
        <p className="mt-3 leading-7 text-slate-700">Start with the readiness check. Complete only the tasks within your skills, the site's conditions and the product instructions. Pause when a stopping point applies.</p>
        <div className="mt-6 space-y-5">{diy.map(section => <TextSection key={section.id} section={section} numbered />)}</div>
      </section>
      <section id="hire-route" className="mt-12 scroll-mt-6" aria-labelledby="hire-route-heading" data-testid="homeowner-hiring-guide">
        <p className="text-sm font-bold uppercase tracking-widest text-blue-800">Hire with a clearer scope</p>
        <h2 id="hire-route-heading" className="mt-2 text-3xl font-black text-slate-950">Your contractor conversation checklist</h2>
        <div className="mt-6 space-y-5">{hire.map(section => <TextSection key={section.id} section={section} numbered />)}</div>
      </section>
      {sources ? <section className="mt-12 rounded-2xl border border-slate-200 bg-white p-6" aria-labelledby="guide-sources-heading">
        <h2 id="guide-sources-heading" className="text-2xl font-bold text-slate-950">{sources.title}</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">Confirm current local requirements and the instructions for your chosen products. These links provide context; they do not approve the design or site.</p>
        <ul className="mt-4 space-y-3">{sources.body.split('\n').map(line => {
          const [label, rawUrl] = line.split(' | ');
          let href;
          try { const url = new URL(rawUrl); if (url.protocol === 'https:') href = url.href; } catch { /* Render unrecognized source text without a link. */ }
          return <li key={line}>{href ? <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center font-semibold text-blue-800 underline">{label}<span className="sr-only"> (opens in a new tab)</span></a> : <span>{label}</span>}</li>;
        })}</ul>
      </section> : null}
    </>
  );
}
