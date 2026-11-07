"use client";

import React from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { BrandMark } from "../shell/BrandMark";

const COLUMNS: Array<{ title: string; links: Array<{ label: string; href: string }> }> = [
  {
    title: "Product",
    links: [
      { label: "The product", href: "#product" },
      { label: "Features", href: "#features" },
      { label: "How it works", href: "#how" },
    ],
  },
  {
    title: "Try it",
    links: [
      { label: "Plan a new event", href: "/events/new" },
      { label: "Live command center", href: "/events/conference_demo/live" },
      { label: "Vendor discovery", href: "/events/conference_demo/vendors" },
    ],
  },
  {
    title: "Account",
    links: [
      { label: "Sign in", href: "/login" },
      { label: "Create an account", href: "/register" },
      { label: "My events", href: "/dashboard" },
    ],
  },
];

const linkCls =
  "group inline-flex w-fit items-center gap-1 underline decoration-ink-900/20 underline-offset-4 transition-colors hover:text-cue-700 hover:decoration-cue-600";

export default function FooterSection() {
  return (
    <footer className="relative z-20 flex min-h-screen w-full flex-col justify-between overflow-hidden bg-paper px-6 py-10 font-sans text-ink-900 md:px-12">
      {/* Top bar */}
      <div className="mb-16 flex w-full flex-col items-start justify-between gap-6 md:mb-0 md:flex-row md:items-center">
        <Link href="/" className="flex items-center gap-2.5 transition-opacity hover:opacity-80">
          <BrandMark className="h-7 w-7" glow={false} />
          <span className="font-display text-[14px] font-extrabold tracking-[0.1em]" style={{ fontStretch: "88%" }}>
            EVENTRA
          </span>
        </Link>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 rounded-full bg-ink-900 px-5 py-2.5 text-[13px] font-semibold text-ink-50 transition-colors hover:bg-cue-600"
        >
          Open the app <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>

      {/* Big wordmark */}
      <div className="my-16 flex w-full flex-1 flex-col justify-center md:my-0" aria-hidden>
        <div
          className="flex w-full flex-col items-start justify-between font-display font-black uppercase leading-[0.84] tracking-[-0.045em] md:flex-row"
          style={{ fontStretch: "78%" }}
        >
          <div className="m-0 text-[17vw] md:text-[10vw]">Adaptive</div>
          <div className="m-0 mt-2 text-[17vw] text-ink-300 md:mt-0 md:text-right md:text-[10vw]">Events</div>
        </div>
        <div
          className="m-0 flex items-end gap-[2vw] font-display text-[17vw] font-black uppercase leading-[0.84] tracking-[-0.045em] md:text-[10vw]"
          style={{ fontStretch: "78%" }}
        >
          Operations
          <span className="mb-[1.6vw] inline-block h-[2.4vw] w-[2.4vw] min-h-[12px] min-w-[12px] rounded-full bg-cue-600 shadow-[0_0_24px_rgba(214,0,60,0.6)] animate-cue-blink" />
        </div>
      </div>

      <div className="my-16 h-px w-full bg-ink-900/10 md:my-20" />

      {/* Links */}
      <div className="mb-16 grid w-full grid-cols-1 gap-12 text-[14px] font-medium sm:grid-cols-2 md:mb-24 md:grid-cols-4 md:text-[15px]">
        <div className="max-w-[30ch] text-ink-600">
          <p className="mb-6 font-mono text-[10.5px] uppercase tracking-label text-ink-400">About</p>
          <p className="leading-relaxed">
            Adaptive event operations: discovery, engagement, live execution and recovery, with every
            step traceable.
          </p>
        </div>
        {COLUMNS.map((col) => (
          <div key={col.title}>
            <p className="mb-6 font-mono text-[10.5px] uppercase tracking-label text-ink-400">{col.title}</p>
            <ul className="flex flex-col gap-3">
              {col.links.map((l) => (
                <li key={l.label}>
                  <Link href={l.href} className={linkCls}>
                    {l.label}
                    <ArrowUpRight className="h-3 w-3 opacity-40 transition-opacity group-hover:opacity-100" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Bottom bar */}
      <div className="flex w-full flex-col items-center justify-between gap-4 pt-6 text-[13px] font-medium text-ink-500 md:flex-row">
        <div className="font-mono text-[11px] uppercase tracking-label">© Eventra 2026</div>
        <div className="font-mono text-[11px] uppercase tracking-label text-ink-400">Plan · Run · Adapt</div>
        <div>
          Website architecture by <span className="text-ink-900">Aniket</span>
        </div>
      </div>
    </footer>
  );
}
