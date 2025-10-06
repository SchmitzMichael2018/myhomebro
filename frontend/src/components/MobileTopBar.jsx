import React from "react";

export default function MobileTopBar({ onMenu }) {
  return (
    <div
      className="mhb-mobile-topbar"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "12px 16px",
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: "linear-gradient(135deg, #0d47ff 0%, #6b86ff 50%, #e0c166 100%)",
        boxShadow: "0 2px 10px rgba(0,0,0,0.15)",
      }}
    >
      <button
        aria-label="Open menu"
        onClick={onMenu}
        style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          border: "none",
          background: "rgba(255,255,255,0.15)",
          color: "#fff",
          fontSize: 20,
          lineHeight: "40px",
        }}
      >
        ☰
      </button>
      <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#fff" }}>
        <img
          src="/static/myhomebro_logo.png"
          alt="MyHomeBro"
          style={{ width: 32, height: 32, borderRadius: 8 }}
        />
        <strong style={{ fontSize: 18 }}>Dashboard</strong>
      </div>
    </div>
  );
}
