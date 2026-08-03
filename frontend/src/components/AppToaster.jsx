import React from "react";
import { ToastBar, Toaster, toast } from "react-hot-toast";
import { useLocation } from "react-router-dom";
import { TOAST_PRESENTATION } from "./toastPresentation.js";

export default function AppToaster() {
  const { pathname } = useLocation();
  const isAuthenticatedSurface = pathname.startsWith("/app") || pathname.startsWith("/onboarding");

  return (
    <Toaster
      containerClassName={
        isAuthenticatedSurface
          ? "mhb-toast-region mhb-toast-region--authenticated"
          : "mhb-toast-region"
      }
      position="top-center"
      toastOptions={{
        className: "mhb-toast mhb-toast--info",
        duration: 6000,
        error: {
          ...TOAST_PRESENTATION.error,
          ariaProps: { role: "alert", "aria-live": "assertive" },
        },
        success: {
          ...TOAST_PRESENTATION.success,
          ariaProps: { role: "status", "aria-live": "polite" },
        },
        loading: TOAST_PRESENTATION.loading,
        blank: TOAST_PRESENTATION.blank,
        custom: TOAST_PRESENTATION.custom,
      }}
    >
      {(notification) => (
        <ToastBar toast={notification}>
          {({ icon, message }) => (
            <div className="mhb-toast__content">
              <span aria-hidden="true" className="mhb-toast__icon">{icon}</span>
              <div className="mhb-toast__message">{message}</div>
              <button
                aria-label="Dismiss notification"
                className="mhb-toast__close"
                onClick={() => toast.dismiss(notification.id)}
                type="button"
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
          )}
        </ToastBar>
      )}
    </Toaster>
  );
}
