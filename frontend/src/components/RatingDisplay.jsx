import React from 'react';

function formatRating(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(1) : '0.0';
}

export default function RatingDisplay({
  rating = null,
  count = 0,
  fallbackLabel = 'New on MyHomeBro',
  className = '',
  testId = '',
  inverted = false,
}) {
  const reviewCount = Math.max(0, Number(count || 0));
  const hasReviews = reviewCount > 0;
  const filledStars = hasReviews ? Math.max(0, Math.min(5, Math.round(Number(rating) || 0))) : 0;
  const titleClass = inverted ? 'text-white' : 'text-slate-800';
  const badgeClass = inverted
    ? 'border-white/20 bg-white/10 text-white'
    : 'border-slate-200 bg-slate-50 text-slate-600';

  return (
    <div data-testid={testId || undefined} className={["flex flex-col gap-1", className].filter(Boolean).join(' ')}>
      <div className="flex items-center gap-1 text-amber-400" aria-hidden="true">
        {Array.from({ length: 5 }).map((_, index) => (
          <span key={index} className={index < filledStars ? 'text-amber-400' : 'text-slate-200'}>
            ★
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`text-sm font-semibold ${titleClass}`}>
          {hasReviews ? `${formatRating(rating)} average rating` : fallbackLabel}
        </span>
        {hasReviews ? (
          <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${badgeClass}`}>
            {reviewCount} verified review{reviewCount === 1 ? '' : 's'}
          </span>
        ) : null}
      </div>
    </div>
  );
}
