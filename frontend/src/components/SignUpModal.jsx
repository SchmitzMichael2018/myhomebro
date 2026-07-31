import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ContractorSignupForm } from "./SignUpForm.jsx";

export default function SignUpModal() {
  const [visible, setVisible] = useState(false);
  const overlayRef = useRef(null);
  const openerRef = useRef(null);

  const open = useCallback(() => {
    openerRef.current = document.activeElement;
    setVisible(true);
  }, []);

  const close = useCallback(() => {
    setVisible(false);
    window.setTimeout(() => {
      const opener = openerRef.current;
      const fallback = document.querySelector('[data-testid="landing-contractor-signup-button"], [data-testid="landing-sign-in-button"]');
      (opener?.isConnected ? opener : fallback)?.focus?.();
    }, 0);
  }, []);

  useEffect(() => {
    window.mhbOpenSignup = open;
    window.addEventListener("mhb:open-signup", open);
    return () => {
      try {
        delete window.mhbOpenSignup;
      } catch {
        /* Compatibility callback cleanup is best-effort. */
      }
      window.removeEventListener("mhb:open-signup", open);
    };
  }, [open]);

  useEffect(() => {
    if (!visible) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = overlayRef.current?.querySelector('[role="dialog"]');
      const focusable = Array.from(dialog?.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])') || []);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [close, visible]);

  if (!visible) return null;

  return createPortal(
    <div
      className="mhb-modal-overlay mhb-signup-modal-overlay"
      data-testid="signup-modal"
      ref={overlayRef}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="mhb-modal-card mhb-signup-modal-card" role="dialog" aria-modal="true" aria-labelledby="mhb-signup-title">
        <button type="button" className="mhb-modal-close mhb-signup-modal-close" onClick={close} aria-label="Close contractor signup">
          ×
        </button>
        <div className="mhb-modal-body">
          <ContractorSignupForm embedded onComplete={close} />
        </div>
      </div>
    </div>,
    document.body
  );
}
