import React from "react";

/**
 * EVENTRA mark: the original hexagon + core, set in a crimson "cue light" tile.
 * Used in the app sidebar, auth and marketing so the identity is consistent.
 */
export function BrandMark({ className = "h-8 w-8", glow = true }: { className?: string; glow?: boolean }) {
  return (
    <span
      className={`relative grid shrink-0 place-items-center rounded-[28%] bg-cue-600 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25),inset_0_-2px_0_rgba(0,0,0,0.15)] ${
        glow ? "after:absolute after:inset-0 after:-z-10 after:rounded-[28%] after:bg-cue-600 after:opacity-60 after:blur-md" : ""
      } ${className}`}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className="h-[58%] w-[58%]" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round">
        <polygon points="12 2.5 3.5 7.25 3.5 16.75 12 21.5 20.5 16.75 20.5 7.25" />
        <circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" />
      </svg>
    </span>
  );
}
