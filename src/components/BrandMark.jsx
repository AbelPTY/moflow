import React from 'react';

// MoFlow brand mark: an abstract flowing "M" that doubles as an upward
// cash-flow / chart path. Single-stroke, uses currentColor so it inherits the
// surrounding text/brand color and works in light and dark. Kept deliberately
// simple and square (32x32) so it reads at login, loading, and future app-icon
// sizes. No external asset, no animation.
//
// Props: size (px), className, strokeWidth.
export default function BrandMark({ size = 28, className = '', strokeWidth = 2.6 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      role="img"
      aria-label="MoFlow"
    >
      {/* faint trailing baseline for depth */}
      <path
        d="M4 25 L28 25"
        stroke="currentColor"
        strokeWidth={strokeWidth * 0.7}
        strokeLinecap="round"
        opacity="0.25"
      />
      {/* the flowing M / rising cash-flow path */}
      <path
        d="M5 23 L11 10 L16 17 L21 10 L27 23"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* endpoint node — a single "data point" accent */}
      <circle cx="27" cy="23" r="1.9" fill="currentColor" />
    </svg>
  );
}
