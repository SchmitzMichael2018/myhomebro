// src/components/Spinner.jsx

import React from 'react';

/**
 * A simple loading spinner using Tailwind CSS classes.
 */
export function Spinner({ size = 5, color = 'blue-500' }) {
  const dimension = `h-${size} w-${size}`;
  const border = `border-${color}`;
  return (
    <div className="flex justify-center items-center" role="status" aria-label="Loading">
      <div
        className={`animate-spin rounded-full border-2 border-t-2 border-gray-200 ${dimension} border-t-${color}`}
      />
    </div>
  );
}
