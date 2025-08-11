import React, { useState, useEffect } from 'react';
import { useParams, useNavigate }      from 'react-router-dom';
import ReactMarkdown                   from 'react-markdown';
import remarkGfm                       from 'remark-gfm';

export default function LegalPage() {
  const { slug }   = useParams();       // "terms_of_service" or "privacy_policy"
  const navigate   = useNavigate();
  const [content, setContent] = useState('');
  const [error,   setError]   = useState(null);

  useEffect(() => {
    // now pulling from public/legal/*.md
    fetch(`/legal/${slug}.md`)
      .then(res => {
        if (!res.ok) throw new Error(`Failed to load /legal/${slug}.md`);
        return res.text();
      })
      .then(setContent)
      .catch(setError);
  }, [slug]);

  if (error) {
    return (
      <div className="p-6 text-red-600">
        <p>Could not load “{slug}.md”</p>
        <button
          onClick={() => navigate(-1)}
          className="mt-4 text-blue-600 hover:underline"
        >
          ← Back
        </button>
      </div>
    );
  }

  if (!content) {
    return <div className="p-6 text-center">Loading…</div>;
  }

  // Render links: open PDFs & external in new tab
  const LinkRenderer = ({ href, children }) => {
    const isPdf = /\.pdf$/i.test(href);
    const isExternal = href.startsWith('http');
    return (
      <a
        href={href}
        {...(isPdf || isExternal
          ? { target: '_blank', rel: 'noopener noreferrer' }
          : {}
        )}
        className="text-blue-600 hover:underline"
      >
        {children}
      </a>
    );
  };

  return (
    <div className="prose max-w-none p-6 mx-auto">
      <button
        onClick={() => navigate(-1)}
        className="text-blue-600 hover:underline mb-6 block"
      >
        ← Back
      </button>

      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{ a: LinkRenderer }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
