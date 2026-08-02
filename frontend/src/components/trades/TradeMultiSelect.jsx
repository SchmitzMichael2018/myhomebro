import React, { useMemo, useRef, useState } from "react";
import { TRADE_CATALOG } from "./tradeCatalog";

function normalizeTradeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSelectedTrades(value) {
  const list = Array.isArray(value) ? value : [];
  const seen = new Set();
  const next = [];
  for (const item of list) {
    const text = String(item || "").trim();
    if (!text) continue;
    const key = normalizeTradeText(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    next.push(text);
  }
  return next;
}

function validateCustomService(value, canonical = [], custom = []) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (!text) return { error: "Enter a service name." };
  if (text.length < 2 || text.length > 80 || !/[a-z0-9]/i.test(text)) return { error: "Use 2–80 characters." };
  if (/<[^>]*>|https?:\/\/|www\.|\S+@\S+\.\S+|(?:\+?\d[\d ().-]{7,}\d)/i.test(text)) {
    return { error: "Enter a service, not contact information." };
  }
  const key = normalizeTradeText(text);
  if ([...canonical, ...custom].some((item) => normalizeTradeText(item) === key)) {
    return { error: "This service already exists." };
  }
  return { value: text };
}

function toTestId(label, suffix = "") {
  const base = normalizeTradeText(label).replace(/\s+/g, "-");
  return suffix ? `${suffix}-${base}` : base;
}

function matchTrade(item, query) {
  if (!query) return true;
  const search = normalizeTradeText(query);
  if (!search) return true;
  const haystack = normalizeTradeText([item.label, ...(item.aliases || [])].join(" "));
  return haystack.includes(search);
}

export default function TradeMultiSelect({
  value = [],
  onChange,
  label = "Search all trades",
  helpText = "Select one or more trades you offer.",
  popularLabel = "Popular trades",
  selectedLabel = "Selected trades",
  searchPlaceholder = "Start typing to search for your trade...",
  emptyText = "No matching trade found. Try a broader term.",
  testIdPrefix = "trade-multi-select",
  catalog = TRADE_CATALOG,
  showPopular = true,
  popularLimit = null,
  selectedFirst = false,
  hideSelectedFromResults = false,
  className = "",
  disabled = false,
  customServices = [],
  onCustomServicesChange,
  allowCustomServices = false,
}) {
  const [query, setQuery] = useState("");
  const [customOpen, setCustomOpen] = useState(false);
  const [customValue, setCustomValue] = useState("");
  const [customError, setCustomError] = useState("");
  const customInputRef = useRef(null);
  const selected = useMemo(() => normalizeSelectedTrades(value), [value]);
  const popularTrades = useMemo(() => {
    const popular = catalog.filter(
      (trade) => trade.popular && (!hideSelectedFromResults || !selected.some(
        (item) => normalizeTradeText(item) === normalizeTradeText(trade.label)
      ))
    );
    return Number.isInteger(popularLimit) && popularLimit > 0
      ? popular.slice(0, popularLimit)
      : popular;
  }, [catalog, hideSelectedFromResults, popularLimit, selected]);
  const filteredTrades = useMemo(() => {
    const normalizedQuery = normalizeTradeText(query);
    return catalog.filter(
      (trade) =>
        matchTrade(trade, normalizedQuery) &&
        (!hideSelectedFromResults ||
          !selected.some(
            (item) =>
              normalizeTradeText(item) === normalizeTradeText(trade.label)
          ))
    );
  }, [catalog, hideSelectedFromResults, query, selected]);

  function emit(next) {
    if (typeof onChange === "function") {
      onChange(normalizeSelectedTrades(next));
    }
  }

  function addTrade(labelText) {
    if (disabled) return;
    if (selected.some((item) => normalizeTradeText(item) === normalizeTradeText(labelText))) {
      return;
    }
    emit([...selected, labelText]);
  }

  function removeTrade(labelText) {
    if (disabled) return;
    const key = normalizeTradeText(labelText);
    emit(selected.filter((item) => normalizeTradeText(item) !== key));
  }

  function openCustom() {
    setCustomOpen(true);
    setCustomError("");
    setTimeout(() => customInputRef.current?.focus(), 0);
  }

  function cancelCustom() {
    setCustomOpen(false);
    setCustomValue("");
    setCustomError("");
  }

  function addCustom() {
    const result = validateCustomService(customValue, catalog.map((item) => item.label), customServices);
    if (result.error) return setCustomError(result.error);
    onCustomServicesChange?.([...customServices, result.value]);
    cancelCustom();
  }

  return (
    <div className={className}>
      <div className="flex flex-col gap-5">
        {showPopular ? (
          <div>
            <div className="text-sm font-semibold text-[var(--mhb-text-primary)]">{popularLabel}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {popularTrades.map((trade) => {
                const active = selected.some(
                  (item) => normalizeTradeText(item) === normalizeTradeText(trade.label)
                );
                return (
                  <button
                    key={trade.label}
                    type="button"
                    aria-pressed={active}
                    onClick={() => (active ? removeTrade(trade.label) : addTrade(trade.label))}
                    className={`mhb-trade-option min-h-11 rounded-full border px-4 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mhb-border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--mhb-surface-card)] ${
                      active
                        ? "is-selected border-[var(--mhb-border-selected)] bg-[var(--mhb-interactive-primary)] text-[var(--mhb-text-inverse)]"
                        : "border-[var(--mhb-border-default)] bg-[var(--mhb-surface-control)] text-[var(--mhb-text-secondary)] hover:bg-[var(--mhb-surface-interactive-hover)]"
                    }`}
                  >
                    {active ? <span aria-hidden="true">✓ </span> : null}
                    {trade.label}
                    {active ? <span className="sr-only"> selected</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <div>
          <div className="text-sm font-semibold text-[var(--mhb-text-primary)]">{label}</div>
          {helpText ? <div className="mt-1 text-sm text-[var(--mhb-text-secondary)]">{helpText}</div> : null}
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={label}
            className="mt-2 h-12 w-full rounded-2xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-control)] px-4 text-sm text-[var(--mhb-text-primary)] placeholder:text-[var(--mhb-text-muted)] hover:border-[var(--mhb-border-strong)] focus:border-[var(--mhb-border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--mhb-border-focus)]"
            data-testid={`${testIdPrefix}-search`}
            disabled={disabled}
          />
          <div
            className="mt-3 max-h-56 overflow-y-auto rounded-2xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] p-2 lg:max-h-none lg:overflow-visible"
            data-testid={`${testIdPrefix}-results`}
          >
            {filteredTrades.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {filteredTrades.map((trade) => {
                  const active = selected.some(
                    (item) => normalizeTradeText(item) === normalizeTradeText(trade.label)
                  );
                  return (
                    <button
                      type="button"
                      key={trade.label}
                      aria-pressed={active}
                      onClick={() => (active ? removeTrade(trade.label) : addTrade(trade.label))}
                      data-testid={`${testIdPrefix}-option-${toTestId(trade.label)}`}
                      disabled={disabled}
                      className={`mhb-trade-option min-h-12 rounded-xl border px-3 py-3 text-left text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mhb-border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--mhb-surface-inset)] ${
                        active
                          ? "is-selected border-[var(--mhb-border-selected)] bg-[var(--mhb-interactive-primary)] text-[var(--mhb-text-inverse)]"
                          : "border-[var(--mhb-border-default)] bg-[var(--mhb-surface-control)] text-[var(--mhb-text-secondary)] hover:bg-[var(--mhb-surface-interactive-hover)]"
                      }`}
                    >
                      <div>{trade.label}</div>
                      <div className={`mt-1 text-xs ${active ? "text-[var(--mhb-text-inverse)] opacity-80" : "text-[var(--mhb-text-muted)]"}`}>
                        {active ? "Selected service" : "Add service"}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="px-3 py-4 text-sm text-[var(--mhb-text-secondary)]">{emptyText}</div>
            )}
          </div>
          {allowCustomServices ? (
            <div className="mt-3 rounded-2xl border border-dashed border-[var(--mhb-border-default)] bg-[var(--mhb-surface-interactive)] p-3">
              {!customOpen ? (
                <button type="button" onClick={openCustom} className="text-sm font-semibold underline decoration-2 underline-offset-4 text-[var(--mhb-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mhb-border-focus)]" data-testid={`${testIdPrefix}-custom-open`}>
                  Can&apos;t find your service? Add another service
                </button>
              ) : (
                <div>
                  <label htmlFor={`${testIdPrefix}-custom-input`} className="text-sm font-semibold text-[var(--mhb-text-primary)]">Service name</label>
                  <p className="mt-1 text-xs text-[var(--mhb-text-secondary)]">Examples: Epoxy flooring, cabinet refinishing, appliance installation</p>
                  <input id={`${testIdPrefix}-custom-input`} ref={customInputRef} value={customValue} maxLength={80} onChange={(event) => { setCustomValue(event.target.value); setCustomError(""); }} onKeyDown={(event) => event.key === "Escape" && cancelCustom()} aria-invalid={Boolean(customError)} aria-describedby={`${testIdPrefix}-custom-help`} className="mt-2 h-12 w-full rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-control)] px-3 text-[var(--mhb-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--mhb-border-focus)]" data-testid={`${testIdPrefix}-custom-input`} />
                  <div id={`${testIdPrefix}-custom-help`} aria-live="polite" className="mt-1 min-h-5 text-sm text-[var(--mhb-status-blocked-text)]">{customError}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" onClick={addCustom} className="mhb-btn mhb-btn-primary" data-testid={`${testIdPrefix}-custom-add`}>Add service</button>
                    <button type="button" onClick={cancelCustom} className="mhb-btn mhb-btn-secondary">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>

        <div className={selectedFirst ? "-order-1" : ""}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold text-[var(--mhb-text-primary)]">{selectedLabel}</div>
            <div
              className="text-sm font-medium text-[var(--mhb-text-secondary)]"
              aria-live="polite"
              data-testid={`${testIdPrefix}-count`}
            >
              {selected.length + customServices.length} {selected.length + customServices.length === 1 ? "service" : "services"} selected
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2" data-testid={`${testIdPrefix}-selected`}>
            {selected.length ? (
              selected.map((trade) => (
                <span
                  key={trade}
                  data-testid={`${testIdPrefix}-chip-${toTestId(trade)}`}
                  className="mhb-trade-chip inline-flex items-center gap-2 rounded-full border border-[var(--mhb-border-selected)] bg-[var(--mhb-interactive-primary)] px-3 py-2 text-sm font-semibold text-[var(--mhb-text-inverse)]"
                >
                  <span aria-hidden="true">✓</span>
                  {trade}
                  <button
                    type="button"
                    aria-label={`Remove ${trade}`}
                    onClick={() => removeTrade(trade)}
                    className="mhb-trade-chip-remove rounded-full border border-current bg-transparent px-2 py-0.5 text-xs font-bold text-[var(--mhb-text-inverse)] opacity-80 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mhb-border-focus)]"
                  >
                    ×
                  </button>
                </span>
              ))
            ) : !customServices.length ? (
              <div className="text-sm text-[var(--mhb-text-secondary)]">No services selected yet.</div>
            ) : null}
            {customServices.map((service) => (
              <span key={service} className="inline-flex items-center gap-2 rounded-full border border-[var(--mhb-border-selected)] bg-[var(--mhb-surface-control)] px-3 py-2 text-sm font-semibold text-[var(--mhb-text-primary)]" data-testid={`${testIdPrefix}-custom-chip-${toTestId(service)}`}>
                {service}<span className="text-xs font-medium">Custom</span>
                <button type="button" aria-label={`Remove ${service}`} onClick={() => onCustomServicesChange?.(customServices.filter((item) => item !== service))} className="rounded-full border border-current px-2 py-0.5">×</button>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export { normalizeTradeText, normalizeSelectedTrades, toTestId, validateCustomService };
