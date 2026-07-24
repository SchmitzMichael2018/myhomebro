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
        viewBox="0 0 1200 320"
        preserveAspectRatio="none"
        focusable="false"
      >
        <defs>
          <linearGradient id="mhb-terrain-stroke" x1="0" x2="1">
            <stop offset="0" stopColor="#60a5fa" stopOpacity="0" />
            <stop offset="0.3" stopColor="#0ea5e9" stopOpacity="0.65" />
            <stop offset="0.68" stopColor="#2563eb" stopOpacity="0.92" />
            <stop offset="1" stopColor="#38bdf8" stopOpacity="0.42" />
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
          <path d="M0 260 C170 252 235 226 340 232 S515 278 650 218 805 60 930 146 1060 104 1200 82" />
          <path d="M0 270 C180 261 250 240 354 246 S528 286 667 231 818 80 944 160 1070 121 1200 100" />
          <path d="M0 281 C194 271 264 254 370 260 S546 296 686 245 834 104 961 178 1082 140 1200 121" />
          <path d="M0 292 C205 282 281 268 390 274 S566 306 708 260 852 132 980 198 1096 162 1200 144" />
          <path d="M0 304 C222 294 302 284 414 288 S590 316 734 278 876 165 1002 221 1110 188 1200 171" />
          <path d="M340 232 L354 246 L370 260 L390 274 L414 288" />
          <path d="M515 278 L528 286 L546 296 L566 306 L590 316" />
          <path d="M650 218 L667 231 L686 245 L708 260 L734 278" />
          <path d="M805 60 L818 80 L834 104 L852 132 L876 165" />
          <path d="M866 95 L880 113 L897 136 L916 163 L941 193" />
          <path d="M930 146 L944 160 L961 178 L980 198 L1002 221" />
          <path d="M1015 135 L1029 150 L1046 168 L1065 188 L1088 211" />
          <path d="M1060 104 L1070 121 L1082 140 L1096 162 L1110 188" />
          <path d="M1124 91 L1135 106 L1148 124 L1163 145 L1180 166" />
        </g>
      </svg>
      <div className="mhb-operational-background__veil" />
    </div>
  );
}
