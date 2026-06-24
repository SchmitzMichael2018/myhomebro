import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import api from '../api';
import PublicWebsiteRenderer from '../components/website/PublicWebsiteRenderer.jsx';

export default function PublicWebsitePage() {
  const { slug, pageSlug } = useParams();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    async function loadWebsite() {
      try {
        setLoading(true);
        setError('');
        const path = pageSlug
          ? `/projects/public/websites/${encodeURIComponent(slug)}/${encodeURIComponent(pageSlug)}/`
          : `/projects/public/websites/${encodeURIComponent(slug)}/`;
        const { data } = await api.get(path);
        if (mounted) setPayload(data || null);
      } catch (err) {
        console.error(err);
        if (mounted) setError('This website is not published or is temporarily unavailable.');
      } finally {
        if (mounted) setLoading(false);
      }
    }
    loadWebsite();
    return () => {
      mounted = false;
    };
  }, [slug, pageSlug]);

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto max-w-5xl rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-600 shadow-sm">
          Loading website...
        </div>
      </main>
    );
  }

  if (error || !payload) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-black text-slate-900">Website unavailable</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">{error || 'This website is not available.'}</p>
          <Link to="/" className="mt-5 inline-flex rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
            Return home
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 md:py-10" data-testid="public-website-page">
      <div className="mx-auto max-w-6xl">
        <PublicWebsiteRenderer payload={payload} currentPage={payload.current_page} slug={slug} />
      </div>
    </main>
  );
}
