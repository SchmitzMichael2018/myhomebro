// src/components/LegalDocs.jsx
import React from 'react';

export default function LegalDocs() {
  const base = '/static/legal';

  return (
    <div className="my-10">
      <section className="mb-12">
        <h3 className="text-xl font-semibold mb-4">Terms of Service</h3>
        <iframe
          src={`${base}/terms_of_service.pdf`}
          title="Terms of Service"
          width="100%"
          height="600px"
          className="border border-gray-300 rounded w-full"
        />
        <p className="mt-2">
          <a
            href={`${base}/terms_of_service.pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
          >
            Download Full Terms of Service (PDF)
          </a>
        </p>
      </section>

      <section>
        <h3 className="text-xl font-semibold mb-4">Privacy Policy</h3>
        <iframe
          src={`${base}/privacy_policy.pdf`}
          title="Privacy Policy"
          width="100%"
          height="600px"
          className="border border-gray-300 rounded w-full"
        />
        <p className="mt-2">
          <a
            href={`${base}/privacy_policy.pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
          >
            Download Full Privacy Policy (PDF)
          </a>
        </p>
      </section>
    </div>
  );
}
