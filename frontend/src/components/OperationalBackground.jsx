import React from "react";

/**
 * Decorative backdrop for authenticated Operational Dark workspaces.
 * Theme and surface selectors own visibility so Light and curated/public
 * experiences never inherit the branded treatment.
 */
export default function OperationalBackground() {
  return (
    <div
      aria-hidden="true"
      className="mhb-operational-background"
      data-testid="operational-background"
    >
      <div className="mhb-operational-background__atmosphere" />
      <div className="mhb-operational-background__grid" />
      <svg
        className="mhb-operational-background__terrain"
        viewBox="0 0 1000 280"
        preserveAspectRatio="none"
        focusable="false"
      >
        <defs>
          <linearGradient id="mhb-terrain-stroke" x1="0" x2="1">
            <stop offset="0" stopColor="#60a5fa" stopOpacity="0" />
            <stop offset="0.38" stopColor="#60a5fa" stopOpacity="0.22" />
            <stop offset="1" stopColor="#38bdf8" stopOpacity="0.06" />
          </linearGradient>
          <linearGradient id="mhb-terrain-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="white" stopOpacity="0.85" />
            <stop offset="1" stopColor="white" stopOpacity="0" />
          </linearGradient>
          <mask id="mhb-terrain-mask">
            <rect width="1000" height="280" fill="url(#mhb-terrain-fade)" />
          </mask>
        </defs>
        <g
          fill="none"
          stroke="url(#mhb-terrain-stroke)"
          strokeWidth="1"
          mask="url(#mhb-terrain-mask)"
          vectorEffect="non-scaling-stroke"
        >
          <path d="M120 232 C235 218 270 166 365 182 S510 250 620 185 780 98 1000 148" />
          <path d="M150 248 C270 228 302 183 392 198 S520 259 646 201 805 120 1000 165" />
          <path d="M220 266 C330 242 354 205 435 216 S570 266 690 218 836 153 1000 184" />
          <path d="M300 278 C390 257 423 231 492 237 S625 276 738 238 864 184 1000 204" />
          <path d="M365 182 L392 198 L435 216 L492 237" />
          <path d="M510 250 L520 259 L570 266 L625 276" />
          <path d="M620 185 L646 201 L690 218 L738 238" />
          <path d="M780 98 L805 120 L836 153 L864 184" />
          <path d="M900 122 L915 142 L938 170 L958 194" />
        </g>
      </svg>
      <div className="mhb-operational-background__veil" />
    </div>
  );
}
