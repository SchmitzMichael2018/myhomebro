import React from "react";
import { Button } from "./Button.jsx";

export function PaginationControls({
  page = 1,
  pageSize = 10,
  totalItems = 0,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50],
  theme = "operational",
  label = "records",
  className = "",
  testId = "pagination",
}) {
  const safePageSize = Math.max(1, Number(pageSize) || 10);
  const totalPages = Math.max(1, Math.ceil(Math.max(0, totalItems) / safePageSize));
  const safePage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const start = totalItems ? (safePage - 1) * safePageSize + 1 : 0;
  const end = Math.min(safePage * safePageSize, totalItems);

  return (
    <nav
      aria-label={`${label} pagination`}
      data-testid={testId}
      className={`flex flex-col gap-3 border-t border-[var(--mhb-border-divider)] px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between ${className}`.trim()}
    >
      <div className="text-[var(--mhb-text-muted)]" aria-live="polite">
        Showing {start}-{end} of {totalItems} {label}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-[var(--mhb-text-secondary)]">
          <span>Rows</span>
          <select
            aria-label={`Rows per page for ${label}`}
            value={safePageSize}
            onChange={(event) => onPageSizeChange?.(Number(event.target.value))}
            className="h-9 rounded-lg border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-control)] px-2 text-sm text-[var(--mhb-text-primary)]"
          >
            {pageSizeOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
        <Button
          theme={theme}
          variant="secondary"
          size="sm"
          disabled={safePage <= 1}
          onClick={() => onPageChange?.(safePage - 1)}
        >
          Previous
        </Button>
        <span className="min-w-20 text-center font-semibold text-[var(--mhb-text-secondary)]">
          Page {safePage} of {totalPages}
        </span>
        <Button
          theme={theme}
          variant="secondary"
          size="sm"
          disabled={safePage >= totalPages}
          onClick={() => onPageChange?.(safePage + 1)}
        >
          Next
        </Button>
      </div>
    </nav>
  );
}
