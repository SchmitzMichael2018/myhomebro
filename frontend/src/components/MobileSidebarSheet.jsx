import React from "react";

/**
 * Generic off-canvas sheet that wraps your existing Sidebar.
 * Usage: <MobileSidebarSheet open={open} onClose={()=>setOpen(false)}>{sidebar}</MobileSidebarSheet>
 */
export default function MobileSidebarSheet({ open, onClose, children }) {
  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.35)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 200ms ease",
          zIndex: 70,
        }}
      />
      {/* Panel */}
      <aside
        role="dialog"
        aria-modal="true"
        style={{
          position: "fixed",
          top: 0,
          bottom: 0,
          left: 0,
          width: 280,
          maxWidth: "86vw",
          background: "#0f172a",
          color: "#e2e8f0",
          transform: open ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 240ms cubic-bezier(.2,.8,.2,1)",
          zIndex: 80,
          overflowY: "auto",
          boxShadow: "2px 0 24px rgba(0,0,0,.35)",
        }}
      >
        <div style={{ padding: 12, display: "flex", justifyContent: "flex-end" }}>
          <button
            aria-label="Close menu"
            onClick={onClose}
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              border: "none",
              background: "rgba(255,255,255,0.12)",
              color: "#fff",
              fontSize: 18,
              lineHeight: "36px",
            }}
          >
            ✕
          </button>
        </div>
        <div style={{ padding: 8 }}>{children}</div>
      </aside>
    </>
  );
}
