import React from 'react';

// Article sections remain plain text. Only explicit, secure Markdown links are
// recognized; raw HTML, images, and non-HTTPS destinations are never interpreted.
export default function SourceLinkedText({ text }) {
  const value = String(text || '');
  const links = /\[([^\]\n]{1,200})\]\((https:\/\/[^\s()<>]+)\)/g;
  const parts = [];
  let cursor = 0;

  for (const match of value.matchAll(links)) {
    let destination;
    try {
      destination = new URL(match[2]);
    } catch {
      continue;
    }
    if (
      destination.protocol !== 'https:' ||
      !destination.hostname ||
      destination.username ||
      destination.password
    ) {
      continue;
    }
    parts.push(value.slice(cursor, match.index));
    parts.push(
      <a
        key={match.index}
        href={destination.href}
        target="_blank"
        rel="noopener noreferrer"
        className="break-words font-semibold text-blue-800 underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {match[1]}
      </a>
    );
    cursor = match.index + match[0].length;
  }
  parts.push(value.slice(cursor));
  return <>{parts}</>;
}
