import React from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { Button } from "./Button.jsx";
import { EmptyState, LoadingSkeleton } from "./feedback.jsx";
import { ActionMenu } from "./navigation.jsx";
import { StatusBadge } from "./surfaces.jsx";
import { cx } from "./designSystemUtils.js";

function cellValue(row, column) {
  if (typeof column.accessor === "function") return column.accessor(row);
  return row?.[column.accessor ?? column.key];
}

export function DataTable({
  columns = [],
  rows = [],
  rowKey = "id",
  caption = "",
  loading = false,
  loadingLabel = "Loading table",
  emptyState = null,
  toolbar = null,
  selectable = false,
  selectedKeys = [],
  onSelectionChange,
  sort = null,
  onSortChange,
  bulkActions = null,
  rowActions = null,
  pagination = null,
  theme = "default",
  className = "",
  ...props
}) {
  const selected = new Set(selectedKeys);
  const keys = rows.map((row, index) => row?.[rowKey] ?? index);
  const allSelected = keys.length > 0 && keys.every((key) => selected.has(key));

  function toggleAll() {
    onSelectionChange?.(allSelected ? [] : keys);
  }

  function toggleOne(key) {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelectionChange?.([...next]);
  }

  function sortIcon(column) {
    if (sort?.key !== column.key) return <ChevronsUpDown className="h-3.5 w-3.5" aria-hidden="true" />;
    return sort.direction === "desc"
      ? <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
      : <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />;
  }

  function requestSort(column) {
    const direction = sort?.key === column.key && sort.direction === "asc" ? "desc" : "asc";
    onSortChange?.({ key: column.key, direction });
  }

  if (loading) {
    return (
      <div className={cx(
        "rounded-2xl border p-5",
        theme === "operational"
          ? "border-[var(--mhb-border-default)] bg-[var(--mhb-surface-card)] text-[var(--mhb-text-primary)] shadow-[var(--mhb-shadow-card)]"
          : "border-slate-200 bg-white",
        className
      )} {...props}>
        {toolbar}
        <LoadingSkeleton theme={theme} variant="table" label={loadingLabel} className={toolbar ? "mt-4" : ""} />
      </div>
    );
  }

  if (!rows.length) {
    return emptyState || <EmptyState theme={theme} title="No records found" description="Adjust the filters or add the first record when you are ready." />;
  }

  return (
    <section className={cx(
      "overflow-hidden rounded-2xl border",
      theme === "operational"
        ? "border-[var(--mhb-border-default)] bg-[var(--mhb-surface-card)] text-[var(--mhb-text-primary)] shadow-[var(--mhb-shadow-card)]"
        : "border-slate-200 bg-white shadow-sm",
      className
    )} {...props}>
      {toolbar ? <div className="p-3">{toolbar}</div> : null}
      {selectable && selected.size && bulkActions ? (
        <div className={cx("flex flex-wrap items-center justify-between gap-3 border-y px-4 py-3", theme === "operational" ? "border-[var(--mhb-border-selected)] bg-[var(--mhb-surface-selected)]" : "border-blue-200 bg-blue-50")}>
          <span className={cx("text-sm font-bold", theme === "operational" ? "text-[var(--mhb-text-primary)]" : "text-blue-900")}>{selected.size} selected</span>
          <div className="flex flex-wrap gap-2">{bulkActions}</div>
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left text-sm">
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead className={cx("border-b text-xs uppercase tracking-wide", theme === "operational" ? "border-[var(--mhb-border-divider)] bg-[var(--mhb-surface-inset)] text-[var(--mhb-text-secondary)]" : "border-slate-200 bg-slate-50 text-slate-600")}>
            <tr>
              {selectable ? (
                <th scope="col" className="w-12 px-4 py-3">
                  <input type="checkbox" aria-label="Select all rows" checked={allSelected} onChange={toggleAll} className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600" />
                </th>
              ) : null}
              {columns.map((column) => (
                <th key={column.key} scope="col" className={cx("px-4 py-3 font-black", column.headerClassName)}>
                  {column.sortable ? (
                    <button type="button" onClick={() => requestSort(column)} className="inline-flex items-center gap-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
                      {column.header}
                      {sortIcon(column)}
                    </button>
                  ) : column.header}
                </th>
              ))}
              {rowActions ? <th scope="col" className="w-14 px-4 py-3"><span className="sr-only">Actions</span></th> : null}
            </tr>
          </thead>
          <tbody className={cx("divide-y", theme === "operational" ? "divide-[var(--mhb-border-divider)]" : "divide-slate-100")}>
            {rows.map((row, index) => {
              const key = row?.[rowKey] ?? index;
              return (
                <tr key={key} className={cx(theme === "operational" ? "text-[var(--mhb-text-secondary)] hover:bg-[var(--mhb-table-row-hover)]" : "text-slate-700 hover:bg-slate-50")}>
                  {selectable ? (
                    <td className="px-4 py-3">
                      <input type="checkbox" aria-label={`Select row ${index + 1}`} checked={selected.has(key)} onChange={() => toggleOne(key)} className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600" />
                    </td>
                  ) : null}
                  {columns.map((column) => {
                    const value = cellValue(row, column);
                    const content = column.render
                      ? column.render(value, row)
                      : column.status
                        ? <StatusBadge status={value} />
                        : value;
                    return <td key={column.key} className={cx("px-4 py-3", column.cellClassName)}>{content}</td>;
                  })}
                  {rowActions ? <td className="px-4 py-3"><ActionMenu items={rowActions(row)} /></td> : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pagination ? (
        <div className={cx("flex flex-col gap-3 border-t px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between", theme === "operational" ? "border-[var(--mhb-border-divider)]" : "border-slate-200")}>
          <span className={cx(theme === "operational" ? "text-[var(--mhb-text-muted)]" : "text-slate-600")}>{pagination.label || `Page ${pagination.page || 1}`}</span>
          <div className="flex gap-2">
            <Button theme={theme} variant="secondary" size="sm" disabled={!pagination.hasPrevious} onClick={pagination.onPrevious}>Previous</Button>
            <Button theme={theme} variant="secondary" size="sm" disabled={!pagination.hasNext} onClick={pagination.onNext}>Next</Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
