"use client";

import React from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import IsometricStack from "./IsometricStack";

const LAYERS = [
  { glyph: "◎", cls: "text-info-600", label: "Real world", desc: "Maps, venues, vendors, calls, WhatsApp, replies" },
  { glyph: "✦", cls: "text-agent-600", label: "Agent", desc: "Searches, interprets messages, proposes actions" },
  { glyph: "✓", cls: "text-engine-600", label: "Engine", desc: "Checks capacity, schedule, budget and dependencies" },
  { glyph: "●", cls: "text-ink-900", label: "You", desc: "Approve, override or take over at any point" },
];

export default function BlueprintSection() {
  return (
    <section className="relative min-h-screen w-full overflow-hidden border-t border-ink-200 bg-paper pb-20 font-sans text-ink-900 selection:bg-cue-600 selection:text-white sm:pb-0">
      {/* Drafting grid */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.5]"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(27,24,21,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(27,24,21,0.06) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
        aria-hidden
      />

      {/* Title block */}
      <div className="relative flex flex-col justify-between border-b border-ink-200 bg-paper/70 px-6 font-mono text-[10px] uppercase tracking-label text-ink-500 backdrop-blur-sm sm:px-12 md:flex-row">
        <div className="border-ink-200 py-4 md:border-r md:pr-12">
          <span className="text-cue-600">01</span> / The product
        </div>
        <div className="border-ink-200 py-4 md:border-l md:pl-12">Assembly · 4 layers · one event</div>
      </div>

      <div className="relative mx-auto grid min-h-[70vh] max-w-[1400px] grid-cols-1 lg:grid-cols-2">
        <div className="relative flex min-w-0 flex-col justify-center border-ink-200 px-6 py-20 sm:px-12 lg:border-r lg:py-28">
          <h2
            className="mb-10 font-display text-[clamp(48px,6vw,92px)] font-black leading-[0.9] tracking-[-0.035em]"
            style={{ fontStretch: "82%" }}
          >
            <span className="text-ink-900">One operating</span>
            <br />
            <span className="text-ink-400">loop for every</span>
            <br />
            <span className="text-ink-400">event.</span>
          </h2>

          <div className="mb-8 h-px w-full bg-ink-200" />

          <p className="max-w-[46ch] text-[16px] leading-relaxed text-ink-600 sm:text-[17px]">
            Most event tools stop at the plan. EVENTRA keeps going: it turns your brief into a plan,
            sources and contacts real providers, runs the day with you, and recovers when a vendor
            cancels or the schedule slips — without hiding how it decided.
          </p>

          <ul className="mt-10 grid max-w-[520px] grid-cols-1 gap-px overflow-hidden rounded-xl border border-ink-200 bg-ink-200 sm:grid-cols-2">
            {LAYERS.map((l) => (
              <li key={l.label} className="bg-paper/95 p-4">
                <div className="flex items-center gap-2 text-[13px] font-semibold">
                  <span className={l.cls}>{l.glyph}</span>
                  {l.label}
                </div>
                <p className="mt-1 text-[12.5px] leading-snug text-ink-500">{l.desc}</p>
              </li>
            ))}
          </ul>

          <div className="mt-10 w-full max-w-[520px] border-t border-ink-200 pt-6">
            <Link
              href="/events/conference_demo/live"
              className="group inline-flex items-center text-[13px] font-semibold text-ink-900 transition-colors hover:text-cue-600"
            >
              Open the live command center
              <ArrowUpRight className="ml-1 h-4 w-4 text-cue-600 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>

        <div className="relative flex min-w-0 items-center justify-center px-6 py-16 lg:min-h-[500px] lg:py-20">
          <IsometricStack />
        </div>
      </div>

      {/* Drawing footer */}
      <div className="absolute bottom-0 left-0 w-full border-t border-ink-200 bg-paper/70 backdrop-blur-sm">
        <div className="mx-auto grid max-w-[1400px] grid-cols-2 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-500 md:grid-cols-4">
          {[
            ["Input", "Your event brief"],
            ["Sources", "Maps · calls · WhatsApp"],
            ["Checks", "Deterministic engine"],
            ["Control", "Human approval"],
          ].map(([k, v], i) => (
            <div
              key={k}
              className={`border-ink-200 p-4 ${i < 2 ? "border-b md:border-b-0" : ""} ${i % 2 === 0 ? "border-r" : "md:border-r"} ${
                i === 3 ? "md:border-r-0" : ""
              }`}
            >
              <span className="mb-1.5 block text-[9px] text-ink-400">{k}</span>
              <span className="font-sans text-[12px] font-semibold normal-case tracking-normal text-ink-900">{v}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
