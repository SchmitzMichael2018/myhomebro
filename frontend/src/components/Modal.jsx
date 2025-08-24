// src/components/Modal.jsx
import React, { useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";

/**
 * Accessible modal rendered via a portal:
 * - Locks page scroll while open
 * - Closes on overlay click and Escape
 * - Keeps focus trapped inside the dialog
 * - All hooks declared at top (no conditional hooks)
 *
 * Props:
 * - visible: boolean
 * - title: string
 * - onClose: () => void
 * - children: React.ReactNode
 */
export default function Modal({
  visible = false,
  title = "",
  onClose = () => {},
  children,
}) {
  const containerRef = useRef(null);
  const titleIdRef = useRef(`modal-title-${Math.random().toString(36).slice(2)}`);

  // Lock body scroll while open
  useEffect(() => {
    if (!visible) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev || "";
    };
  }, [visible]);

  // Escape to close + focus trap (Tab/Shift+Tab)
  useEffect(() => {
    if (!visible) return;

    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Tab" && containerRef.current) {
        const focusable = containerRef.current.querySelectorAll(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
        );
        const nodes = Array.from(focusable);
        if (!nodes.length) return;

        const first = nodes[0];
        const last = nodes[nodes.length - 1];

        if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, onClose]);

  // Autofocus close button (or first focusable)
  useEffect(() => {
    if (!visible || !containerRef.current) return;
    const node =
      containerRef.current.querySelector("[data-autofocus]") ||
      containerRef.current.querySelector(
        "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
      );
    node?.focus();
  }, [visible]);

  const handleOverlayClick = useCallback(
    (e) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose]
  );

  if (!visible) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleIdRef.current : undefined}
      onClick={handleOverlayClick}
    >
      <div
        ref={containerRef}
        className="mx-4 w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <header className="flex items-center justify-between border-b px-5 py-3">
          <h3 id={titleIdRef.current} className="text-xl font-semibold text-gray-800">
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            data-autofocus
            className="rounded p-1 text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            ✕
          </button>
        </header>
        <section className="max-h-[70vh] overflow-y-auto px-5 py-4">
          {children}
        </section>
      </div>
    </div>,
    document.body
  );
}
