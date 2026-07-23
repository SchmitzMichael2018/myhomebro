import React, { useEffect, useRef, useState } from "react";
import { Check, Monitor, Moon, Palette, Sun } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useAppearance } from "../context/AppearanceContext.jsx";

const OPTIONS = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

export default function AppearanceMenu() {
  const { appearance, resolvedTheme, setAppearance } = useAppearance();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const optionRefs = useRef([]);
  const isMarketing = location.pathname.startsWith("/app/marketing");
  const TriggerIcon = appearance === "system" ? Monitor : resolvedTheme === "dark" ? Moon : Sun;

  const closeAndRestoreFocus = () => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  useEffect(() => {
    if (!open) return undefined;
    const selectedIndex = Math.max(0, OPTIONS.findIndex((option) => option.value === appearance));
    requestAnimationFrame(() => optionRefs.current[selectedIndex]?.focus());

    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAndRestoreFocus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [appearance, open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Appearance"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="appearance-menu-trigger"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-800 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
      >
        <TriggerIcon className="h-4.5 w-4.5" aria-hidden="true" />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Appearance"
          data-testid="appearance-menu"
          className="mhb-appearance-menu absolute right-0 top-[calc(100%+0.5rem)] w-64 overflow-hidden rounded-2xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-elevated)] p-2 text-[var(--mhb-text-primary)] shadow-2xl"
        >
          <div className="flex items-center gap-2 px-3 py-2 text-xs font-black uppercase tracking-[0.14em] text-[var(--mhb-text-muted)]">
            <Palette className="h-4 w-4" aria-hidden="true" />
            Appearance
          </div>
          {OPTIONS.map((option, index) => {
            const Icon = option.icon;
            const selected = appearance === option.value;
            return (
              <button
                key={option.value}
                ref={(node) => { optionRefs.current[index] = node; }}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                data-testid={`appearance-option-${option.value}`}
                onClick={() => {
                  setAppearance(option.value);
                  closeAndRestoreFocus();
                }}
                className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-bold hover:bg-[var(--mhb-interactive-ghost-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mhb-border-focus)]"
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span className="flex-1">{option.label}</span>
                {selected ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
              </button>
            );
          })}
          {isMarketing ? (
            <p className="mx-2 mt-2 border-t border-[var(--mhb-border-divider)] px-1 pb-2 pt-3 text-xs leading-5 text-[var(--mhb-text-muted)]">
              Marketing uses its curated workspace appearance.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
