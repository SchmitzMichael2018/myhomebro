import React from 'react';
import { ArrowRight, CheckCircle2, ExternalLink, Globe2, Image, QrCode, Search, Star } from 'lucide-react';

const badgeTone = {
  Required: 'border-red-200 bg-red-50 text-red-700',
  'Highly Recommended': 'border-amber-200 bg-amber-50 text-amber-700',
  Recommended: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  Optional: 'border-slate-200 bg-slate-50 text-slate-600',
  Completed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
};

function ReadinessRow({ item }) {
  const Icon = item.icon;
  const statusText = item.key === 'profile' ? item.detail.replace(' item', '').replace('s missing', ' missing').replace(' missing', ' missing') : item.detail;
  return <article className="grid gap-2 border-t border-slate-100 px-2 py-2.5 first:border-t-0 md:grid-cols-[120px_minmax(135px,1fr)_65px_42px_105px] md:items-center md:py-1.5 2xl:grid-cols-[128px_minmax(210px,1fr)_85px_50px_125px]">
    <div><span className={`inline-flex whitespace-nowrap rounded-md border px-2 py-1 text-[11px] font-bold ${badgeTone[item.priority]}`}>{item.priority}</span></div>
    <div className="flex min-w-0 items-start gap-2"><span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${item.iconTone}`}><Icon aria-hidden="true" className="h-3.5 w-3.5" /></span><div className="min-w-0"><h3 className="text-sm font-bold leading-4 text-slate-950">{item.title}</h3><p className="mt-0.5 text-xs leading-4 text-slate-500">{item.reason}</p></div></div>
    <div className="text-xs font-semibold text-slate-600">{statusText}</div>
    <div className={`text-xs font-bold ${item.impact === 'High' ? 'text-red-600' : item.impact === 'Medium' ? 'text-amber-600' : 'text-slate-500'}`}>{item.impact}</div>
    <button type="button" onClick={item.onClick} className="inline-flex min-h-8 items-center justify-center rounded-lg border border-blue-300 px-2 text-xs font-bold text-blue-700 hover:bg-blue-50">{item.action}</button>
  </article>;
}

export default function MarketingOverview({
  websitePublished,
  staleContentRisk,
  readinessScore,
  blockers = [],
  missingRequiredFields = [],
  checklist = [],
  portfolioCount = 0,
  reviewCount = 0,
  hasSeo,
  publicUrl,
  websiteStatus,
  heroImage,
  companyFacts = [],
  qrAvailable,
  goToStep,
  onEditCompany,
}) {
  const tasks = [
    !websitePublished ? { key: 'publish', priority: 'Required', title: 'Publish your website', reason: 'Finish setup to publish online.', detail: `${readinessScore}% ready`, impact: 'High', action: 'Continue Website', onClick: () => goToStep('website'), icon: Globe2, iconTone: 'bg-violet-50 text-violet-700' } : null,
    missingRequiredFields.length ? { key: 'profile', priority: 'Required', title: 'Complete business information', reason: 'Add missing public business facts.', detail: `${missingRequiredFields.length} item${missingRequiredFields.length === 1 ? '' : 's'} missing`, impact: 'High', action: 'Complete Info', onClick: () => goToStep('profile'), icon: CheckCircle2, iconTone: 'bg-blue-50 text-blue-700' } : null,
    { key: 'portfolio', priority: 'Highly Recommended', title: 'Add portfolio photos', reason: 'Show completed work.', complete: portfolioCount >= 3, detail: portfolioCount ? `${portfolioCount} public` : 'No public work yet', impact: 'High', action: 'Open Portfolio', onClick: () => goToStep('gallery'), icon: Image, iconTone: 'bg-amber-50 text-amber-700' },
    { key: 'reviews', priority: 'Highly Recommended', title: 'Collect and showcase reviews', reason: 'Show customer proof.', complete: reviewCount > 0, detail: reviewCount ? `${reviewCount} public` : 'No public reviews', impact: 'Medium', action: 'Manage Reviews', onClick: () => goToStep('reviews'), icon: Star, iconTone: 'bg-amber-50 text-amber-700' },
    { key: 'seo', priority: 'Recommended', title: 'Improve SEO and visibility', reason: 'Complete local-search basics.', complete: hasSeo, detail: hasSeo ? 'Basics complete' : 'Setup incomplete', impact: 'Medium', action: 'Improve SEO', onClick: () => goToStep('seo'), icon: Search, iconTone: 'bg-emerald-50 text-emerald-700' },
    { key: 'qr', priority: 'Optional', title: 'Download QR code', reason: 'Share your public link in print.', complete: qrAvailable, detail: qrAvailable ? 'Ready' : 'Public link required', impact: 'Low', action: qrAvailable ? 'Open QR' : 'Review Profile', onClick: () => goToStep(qrAvailable ? 'publish' : 'profile'), icon: QrCode, iconTone: 'bg-slate-100 text-slate-700' },
  ].filter(Boolean);
  const incompleteTasks = tasks.filter((item) => !item.complete);
  const completedTasks = tasks.filter((item) => item.complete);
  const completedChecks = checklist.filter((item) => item.complete || item.completed || item.status === 'complete').length;
  const blockerCount = blockers.length || missingRequiredFields.length;
  const alertCount = staleContentRisk ? 1 : 0;
  const goodCount = Math.max(completedChecks, 0);

  return <section className="space-y-3" data-testid="marketing-overview-tab">
    <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_280px]">
      <div className="space-y-3">
        <section data-testid="marketing-readiness" className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"><div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-black text-slate-950">Marketing Readiness</h2><p className="mt-0.5 text-sm text-slate-500">Finish the highest-impact work first.</p></div><span className="whitespace-nowrap rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">{completedTasks.length} of {tasks.length} complete</span></div><div className="mt-2 hidden border-y border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] font-bold text-slate-500 md:grid md:grid-cols-[120px_minmax(135px,1fr)_65px_42px_105px] 2xl:grid-cols-[128px_minmax(210px,1fr)_85px_50px_125px]"><span>Priority</span><span>Task</span><span>Status</span><span>Impact</span><span>Action</span></div><div data-testid="marketing-readiness-list">{incompleteTasks.map((item) => <ReadinessRow key={item.key} item={item} />)}</div>{completedTasks.length ? <div data-testid="marketing-completed" className="mt-2 border-t border-slate-200 pt-2"><div className="text-xs font-bold text-slate-700">Completed</div><div className="mt-1 flex flex-wrap gap-2">{completedTasks.map((item) => <button key={item.key} type="button" onClick={item.onClick} className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-bold ${badgeTone.Completed}`}><CheckCircle2 className="h-3.5 w-3.5" />{item.title.replace('Download ', '')}</button>)}</div></div> : null}</section>

        <section data-testid="marketing-website-readiness" className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"><h2 className="text-lg font-black text-slate-950">Website Readiness</h2><div className="mt-2 grid gap-2 sm:grid-cols-[1.5fr_repeat(3,90px)] sm:items-center"><div><div className="text-sm font-bold capitalize text-slate-900">{websitePublished ? 'Published' : websiteStatus}</div><div className="text-3xl font-black text-slate-950">{readinessScore}% <span className="text-xs font-semibold text-slate-500">ready</span></div><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.min(readinessScore, 100)}%` }} /></div></div><div className="rounded-lg border border-red-100 p-2"><div className="text-lg font-black">{blockerCount}</div><div className="text-xs text-slate-500">Blockers</div></div><div className="rounded-lg border border-amber-100 p-2"><div className="text-lg font-black">{alertCount}</div><div className="text-xs text-slate-500">Alerts</div></div><div className="rounded-lg border border-emerald-100 p-2"><div className="text-lg font-black">{goodCount}</div><div className="text-xs text-slate-500">Good</div></div></div></section>

        <section data-testid="marketing-assets" className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"><h2 className="text-lg font-black text-slate-950">Marketing Channels &amp; Assets</h2><p className="mt-0.5 text-xs text-slate-500">Open the tools that manage your public presence.</p><div className="mt-2 grid gap-2 sm:grid-cols-2">{tasks.filter((item) => !['publish', 'profile'].includes(item.key)).map((item) => <button key={item.key} type="button" onClick={item.onClick} className="flex items-center gap-2 rounded-lg border border-slate-200 p-2 text-left hover:border-blue-300">{React.createElement(item.icon, { className: 'h-4 w-4 text-blue-600', 'aria-hidden': true })}<div className="min-w-0 flex-1"><div className="font-bold text-slate-900">{item.key === 'portfolio' ? 'Portfolio' : item.key === 'reviews' ? 'Reviews' : item.key === 'seo' ? 'SEO' : 'QR Code'}</div><div className="mt-0.5 text-xs text-slate-500">{item.complete ? 'Ready' : 'Setup available'}</div></div><span className={`rounded-md border px-2 py-1 text-[10px] font-bold ${item.complete ? badgeTone.Completed : badgeTone[item.priority]}`}>{item.complete ? 'Completed' : item.priority}</span><ArrowRight className="h-4 w-4 text-slate-400" /></button>)}</div></section>
      </div>

      <aside className="space-y-3">
        <section data-testid="marketing-inherited-company-facts" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="text-base font-black text-slate-950">Inherited from Company Profile</h2><p className="mt-1 text-xs leading-5 text-slate-500">Keep your business information accurate and consistent.</p><dl className="mt-3 divide-y divide-slate-100">{companyFacts.slice(0, 6).map(([label, value]) => <div key={label} className="grid grid-cols-[90px_1fr] gap-2 py-2 text-xs"><dt className="font-bold text-slate-600">{label}</dt><dd className="truncate text-slate-800">{value || 'Not available'}</dd></div>)}</dl><button type="button" onClick={onEditCompany} className="mt-3 min-h-9 w-full rounded-lg border border-slate-300 text-xs font-bold text-blue-700">Edit Company Profile</button></section>
        <section data-testid="marketing-website-snapshot" className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"><h2 className="text-base font-black text-slate-950">Website Snapshot</h2>{heroImage ? <a href="/app/marketing/preview?mode=desktop" target="_blank" rel="noreferrer"><img src={heroImage} alt="Website preview" className="mt-2 h-24 w-full rounded-lg object-cover" /></a> : null}<dl className="mt-2 space-y-2 text-xs"><div className="flex justify-between gap-3"><dt className="font-bold text-slate-600">Status</dt><dd className="font-bold capitalize text-slate-900">{websiteStatus}</dd></div><div><dt className="font-bold text-slate-600">Public URL</dt><dd className="mt-0.5 truncate text-blue-700">{publicUrl || 'Not published yet'}</dd></div><div className="flex justify-between gap-3"><dt className="font-bold text-slate-600">Readiness</dt><dd className="font-black text-slate-900">{readinessScore}%</dd></div></dl>{publicUrl ? <a href={publicUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-9 w-full items-center justify-center rounded-lg border border-slate-300 text-xs font-bold text-blue-700">Open Public Profile <ExternalLink className="ml-1 h-3.5 w-3.5" /></a> : null}</section>
        <section data-testid="marketing-quick-actions" className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"><h2 className="text-base font-black text-slate-950">Quick Actions</h2><div className="mt-1 divide-y divide-slate-100">{[{ label: 'Manage Reviews', step: 'reviews' }, { label: 'Open Portfolio', step: 'gallery' }, { label: 'Improve SEO', step: 'seo' }, { label: 'Download QR', step: qrAvailable ? 'publish' : 'profile' }].map((action) => <button key={action.label} type="button" onClick={() => goToStep(action.step)} className="flex min-h-9 w-full items-center text-left text-xs font-bold text-slate-800">{action.label}<ArrowRight className="ml-auto h-4 w-4" /></button>)}</div></section>
      </aside>
    </div>
  </section>;
}
