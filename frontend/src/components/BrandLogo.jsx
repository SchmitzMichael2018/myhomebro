import React from "react";
// IMPORTANT: this path is relative to THIS file.
// If you move this component, update the path accordingly.
import logo from "../assets/myhomebro_logo.png";

/**
 * BrandLogo
 * - Uses Vite asset import so the final build references the hashed file.
 * - No hard-coded /static paths required.
 */
export default function BrandLogo({ className = "", height = 56, showText = true }) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <img
        src={logo}
        alt="MyHomeBro"
        height={height}
        style={{ height }}
      />
      {showText && <span className="text-2xl font-bold">MyHomeBro</span>}
    </div>
  );
}
