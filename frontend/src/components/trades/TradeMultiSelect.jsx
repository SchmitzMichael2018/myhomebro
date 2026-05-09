import React, { useMemo, useState } from "react";
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
  className = "",
  disabled = false,
}) {
  const [query, setQuery] = useState("");
  const selected = useMemo(() => normalizeSelectedTrades(value), [value]);
  const popularTrades = useMemo(() => catalog.filter((trade) => trade.popular), [catalog]);
  const filteredTrades = useMemo(() => {
    const normalizedQuery = normalizeTradeText(query);
    return catalog.filter((trade) => matchTrade(trade, normalizedQuery));
  }, [catalog, query]);

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

  return (
    <div className={className}>
      <div className="space-y-5">
        {showPopular ? (
          <div>
            <div className="text-sm font-semibold text-slate-900">{popularLabel}</div>
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
                    className={`min-h-11 rounded-full border px-4 py-2 text-sm font-semibold transition ${
                      active
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {trade.label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <div>
          <div className="text-sm font-semibold text-slate-900">{label}</div>
          {helpText ? <div className="mt-1 text-sm text-slate-600">{helpText}</div> : null}
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchPlaceholder}
            className="mt-2 h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm text-slate-900 placeholder:text-slate-400"
            data-testid={`${testIdPrefix}-search`}
            disabled={disabled}
          />
          <div
            className="mt-3 max-h-64 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-2"
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
                      className={`min-h-12 rounded-xl border px-3 py-3 text-left text-sm font-semibold transition ${
                        active
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      <div>{trade.label}</div>
                      <div className={`mt-1 text-xs ${active ? "text-slate-200" : "text-slate-500"}`}>
                        Tap to {active ? "remove" : "add"} trade
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="px-3 py-4 text-sm text-slate-600">{emptyText}</div>
            )}
          </div>
        </div>

        <div>
          <div className="text-sm font-semibold text-slate-900">{selectedLabel}</div>
          <div className="mt-3 flex flex-wrap gap-2" data-testid={`${testIdPrefix}-selected`}>
            {selected.length ? (
              selected.map((trade) => (
                <span
                  key={trade}
                  data-testid={`${testIdPrefix}-chip-${toTestId(trade)}`}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-900 bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
                >
                  {trade}
                  <button
                    type="button"
                    aria-label={`Remove ${trade}`}
                    onClick={() => removeTrade(trade)}
                    className="rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-xs font-bold text-white hover:bg-white/20"
                  >
                    ×
                  </button>
                </span>
              ))
            ) : (
              <div className="text-sm text-slate-500">Select one or more trades to personalize your setup.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export { normalizeTradeText, normalizeSelectedTrades, toTestId };
