import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import api from '../api';
import PublicWebsiteRenderer from '../components/website/PublicWebsiteRenderer.jsx';

function normalizeMode(value) {
  return String(value || '').toLowerCase() === 'mobile' ? 'mobile' : 'desktop';
}

export default function ContractorWebsitePreviewPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [mode, setMode] = useState(normalizeMode(searchParams.get('mode')));
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setMode(normalizeMode(searchParams.get('mode')));
  }, [searchParams]);

  useEffect(() => {
    let mounted = true;

    async function loadPreview() {
      try {
        setLoading(true);
        setError('');
        const { data } = await api.get('/projects/contractor/website/preview/', {
          params: { _ts: Date.now() },
          headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
        });
        if (mounted) setPayload(data || null);
      } catch (err) {
        console.error(err);
        if (mounted) setError('We could not load your draft website preview yet.');
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadPreview();
    return () => {
      mounted = false;
    };
  }, []);

  function switchMode(nextMode) {
    setMode(nextMode);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('mode', nextMode);
    setSearchParams(nextParams, { replace: true });
  }

  const publicUrl = payload?.website?.public_url || '';
  const isPublished = payload?.website?.status === 'published';

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-5 md:px-6" data-testid="contractor-website-preview-page">
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        <header className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">Draft preview</div>
            <h1 className="mt-1 text-2xl font-black text-slate-950">Website Preview</h1>
            <p className="mt-1 text-sm text-slate-600">
              Review the website exactly as customers will see it. Previewing does not publish changes.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-xl border border-slate-200 bg-slate-100 p-1" data-testid="full-preview-mode-toggle">
              {['desktop', 'mobile'].map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => switchMode(item)}
                  className={`rounded-lg px-4 py-2 text-sm font-black transition ${
                    mode === item ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-950'
                  }`}
                >
                  {item === 'desktop' ? 'Desktop' : 'Mobile'}
                </button>
              ))}
            </div>
            {isPublished && publicUrl ? (
              <a
                href={publicUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50"
              >
                Open Live Site
              </a>
            ) : null}
            <Link
              to="/app/marketing?tab=website"
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-blue-700"
            >
              Back to Design
            </Link>
          </div>
        </header>

        {loading ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-600 shadow-sm">
            Loading website preview...
          </section>
        ) : error || !payload ? (
          <section className="rounded-2xl border border-rose-200 bg-white p-8 shadow-sm">
            <h2 className="text-xl font-black text-slate-950">Preview unavailable</h2>
            <p className="mt-2 text-sm text-slate-600">{error || 'Preview data is unavailable.'}</p>
          </section>
        ) : (
          <section
            className={`rounded-2xl border border-slate-200 bg-white p-3 shadow-sm ${
              mode === 'mobile' ? 'py-8' : 'p-4'
            }`}
            data-testid={mode === 'mobile' ? 'full-preview-mobile-frame' : 'full-preview-desktop-frame'}
          >
            {mode === 'mobile' ? (
              <div className="mx-auto w-[390px] max-w-full rounded-[2.5rem] border-[10px] border-slate-950 bg-slate-950 p-2 shadow-2xl">
                <div className="mx-auto mb-2 h-1.5 w-24 rounded-full bg-slate-700" />
                <div className="max-h-[760px] overflow-auto rounded-[1.75rem] bg-white">
                  <PublicWebsiteRenderer payload={payload} previewMode="mobile" />
                </div>
              </div>
            ) : (
              <div className="mx-auto max-w-7xl" data-testid="full-preview-desktop-canvas">
                <PublicWebsiteRenderer payload={payload} previewMode="desktop" />
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
