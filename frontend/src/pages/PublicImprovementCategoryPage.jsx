import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { applySeoMetadata, SITE_ORIGIN } from '../lib/seoMetadata.js';
import {
  ImprovementGrid,
  LibraryShell,
} from './PublicImprovementLibraryPage.jsx';

export default function PublicImprovementCategoryPage() {
  const { categorySlug } = useParams();
  const [data, setData] = useState(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/projects/public/improvements/${categorySlug}/`)
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((value) => {
        if (!active) return;
        setData(value);
        applySeoMetadata(window.location.pathname, {
          title: `${value.name} Projects & DIY Guides | MyHomeBro`,
          description: `Explore published ${value.name.toLowerCase()} project guides and decide whether to DIY or get contractor help.`,
          socialDescription: `Explore published ${value.name.toLowerCase()} project guides from MyHomeBro.`,
          canonicalUrl: `${SITE_ORIGIN}/improvements/${value.slug}/`,
          robots: 'index, follow',
          structuredData: breadcrumbData(value.name, value.slug),
        });
      });
    return () => {
      active = false;
    };
  }, [categorySlug]);

  return (
    <LibraryShell>
      <div className="mx-auto max-w-6xl px-4 pt-8 sm:px-6">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link to="/">Home</Link> <span aria-hidden="true">›</span>{' '}
          <Link to="/improvements/">Improvement Library</Link>{' '}
          <span aria-hidden="true">›</span>{' '}
          <span>{data?.name || 'Category'}</span>
        </nav>
        <h1 className="mt-6 text-4xl font-bold text-slate-950">
          {data?.name || 'Published projects'}
        </h1>
        <p className="mt-3 max-w-3xl text-lg text-slate-600">
          Explore published {data?.name?.toLowerCase() || ''} project guides,
          understand the work, and choose your next step.
        </p>
      </div>
      <div className="mt-10">
        <ImprovementGrid
          items={data?.improvements || []}
          loading={!data}
          heading={`${data?.name || ''} project guides`}
        />
      </div>
    </LibraryShell>
  );
}

function breadcrumbData(name, slug) {
  return [
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: 'Home',
          item: `${SITE_ORIGIN}/`,
        },
        {
          '@type': 'ListItem',
          position: 2,
          name: 'Improvement Library',
          item: `${SITE_ORIGIN}/improvements/`,
        },
        {
          '@type': 'ListItem',
          position: 3,
          name,
          item: `${SITE_ORIGIN}/improvements/${slug}/`,
        },
      ],
    },
  ];
}
