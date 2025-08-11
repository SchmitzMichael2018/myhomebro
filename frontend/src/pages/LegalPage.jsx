import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Shows either the Markdown or a link to the full PDF for Terms or Privacy.
 * Accepts slug as a prop when used inside a modal,
 * or falls back to URL param for standalone routes.
 */
export default function LegalPage({ slug: propSlug, onClose }) {
  const { slug: paramSlug } = useParams();
  const slug = propSlug || paramSlug;
  const navigate = useNavigate();

  const [content, setContent] = useState('');
  const [error, setError]     = useState(null);

  useEffect(() => {
    if (!slug) return;
    fetch(`/static/legal/${slug}.md`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to load ' + slug);
        return res.text();
      })
      .then(setContent)
      .catch(err => setError(err));
  }, [slug]);

  if (error) {
    return (
      <div className="p-6 text-red-600">
        Could not load “{slug}.md”<br/>
        {/* Only show back button if not in a modal */}
        {!onClose && (
          <button
            onClick={() => navigate('/agreements')}
            className="text-blue-600 hover:underline mt-4 block"
          >
            ← Back
          </button>
        )}
      </div>
    );
  }

  if (!content) {
    return <div className="p-6 text-center">Loading…</div>;
  }

  // PDF filenames must match slug
  const pdfFilename = slug === 'terms_of_service'
    ? 'terms_of_service.pdf'
    : 'privacy_policy.pdf';
  const documentName = slug === 'terms_of_service' ? 'Terms of Service' : 'Privacy Policy';

  return (
    <div className="prose max-w-none p-6 mx-auto">
      {/* Only show back button if not in a modal */}
      {!onClose && (
        <button
          onClick={() => navigate(-1)}
          className="text-blue-600 hover:underline mb-6 block"
        >
          ← Back
        </button>
      )}

      {/* Ensures ReactMarkdown receives a single string as its child */}
      <ReactMarkdown remarkPlugins={[remarkGfm]}> {content.trim()} </ReactMarkdown>

      <div className="mt-8">
        <p>
          This is the easy-to-scan web version of our {documentName}.
          For the full, legally binding text, please download the{' '}
          <a
            href={`/static/legal/${pdfFilename}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline inline-flex items-center"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            {documentName} PDF
          </a>.
        </p>
      </div>
    </div>
  );
}