"use client";

import React from "react";
import Link from "next/link";
import { motion, AnimatePresence, useScroll, useTransform, useReducedMotion } from "framer-motion";
import { ArrowRight, ArrowDown } from "lucide-react";
import { EncryptedText } from "../../components/ui/encrypted-text";
import { BrandMark } from "../../components/shell/BrandMark";
import BlueprintSection from "../../components/marketing/BlueprintSection";
import FeaturesScrollSection from "../../components/marketing/FeaturesScrollSection";
import ServicesSection from "../../components/marketing/ServicesSection";
import FooterSection from "../../components/marketing/FooterSection";

// The hero cycles through the real event lifecycle, and the cue strip above it
// lights the matching stage.
const STAGES = ["DEFINE", "DISCOVER", "PLAN", "READY", "LIVE", "RECOVER"];

// An illustrative recovery run (clearly labelled as an example on the page).
const EXAMPLE_RUN: Array<{ t: string; kind: "source" | "agent" | "engine" | "go"; text: string }> = [
  { t: "18:02:11", kind: "source", text: "WhatsApp · Caterer: “Stuck in traffic, won't make it.”" },
  { t: "18:02:12", kind: "agent", text: "Interpreted as provider unavailable · catering · critical" },
  { t: "18:02:13", kind: "engine", text: "Impact: 6 tasks blocked, dinner service on critical path" },
  { t: "18:02:19", kind: "agent", text: "47 caterers found → 6 match 500 guests within 20 km" },
  { t: "18:03:40", kind: "source", text: "Backup B replied: available, ₹85,000, 30 min away" },
  { t: "18:03:41", kind: "engine", text: "Capacity ✓  Time ✓  Budget ✓  Location ✓" },
  { t: "18:04:02", kind: "go", text: "You approved. Backup B booked. Dinner back on schedule." },
];

const KIND_STYLE: Record<string, { glyph: string; cls: string; label: string }> = {
  source: { glyph: "◎", cls: "text-info-300", label: "Source" },
  agent: { glyph: "✦", cls: "text-agent-300", label: "Agent" },
  engine: { glyph: "✓", cls: "text-engine-300", label: "Engine" },
  go: { glyph: "▲", cls: "text-go-400", label: "Done" },
};

function ExampleRun() {
  const reduce = useReducedMotion();
  const [count, setCount] = React.useState(reduce ? EXAMPLE_RUN.length : 1);

  React.useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => {
      setCount((c) => (c >= EXAMPLE_RUN.length + 2 ? 1 : c + 1)); // hold on the final line briefly, then replay
    }, 1400);
    return () => clearInterval(id);
  }, [reduce]);

  const visible = EXAMPLE_RUN.slice(0, Math.min(count, EXAMPLE_RUN.length));

  return (
    <div className="w-full max-w-[460px] overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] shadow-2xl backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
        <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-label text-ink-400">
          <span className="cue-light bg-cue-500 animate-cue-blink" />
          Example run · caterer cancels
        </span>
        <span className="font-mono text-[10px] text-ink-500">recover</span>
      </div>
      <ol className="h-[236px] space-y-0 overflow-hidden px-4 py-3 font-mono text-[11.5px] leading-[1.55]">
        <AnimatePresence initial={false}>
          {visible.map((line) => {
            const k = KIND_STYLE[line.kind];
            return (
              <motion.li
                key={line.t + line.text}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.35, ease: [0.2, 0.7, 0.2, 1] }}
                className="grid grid-cols-[64px_14px_1fr] gap-2 py-[3px]"
              >
                <span className="text-ink-500">{line.t}</span>
                <span className={k.cls} title={k.label}>
                  {k.glyph}
                </span>
                <span className={line.kind === "go" ? "text-go-300" : "text-ink-200"}>{line.text}</span>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ol>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-white/[0.06] px-4 py-2.5 font-mono text-[10px] text-ink-500">
        <span>
          <span className="text-agent-300">✦</span> agent proposed
        </span>
        <span>
          <span className="text-engine-300">✓</span> engine verified
        </span>
        <span>
          <span className="text-info-300">◎</span> external source
        </span>
        <span>
          <span className="text-go-400">▲</span> executed
        </span>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const [stageIndex, setStageIndex] = React.useState(1);
  const { scrollY } = useScroll();

  const navWidth = useTransform(scrollY, [0, 150], ["95%", "72%"]);
  const navMaxWidth = useTransform(scrollY, [0, 150], ["1200px", "980px"]);
  const navPadding = useTransform(scrollY, [0, 150], ["14px 22px", "8px 16px"]);
  const navTop = useTransform(scrollY, [0, 150], ["20px", "12px"]);

  React.useEffect(() => {
    const interval = setInterval(() => {
      setStageIndex((prev) => (prev + 1) % STAGES.length);
    }, 3600);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="relative min-h-screen bg-ink-950 font-sans text-ink-50 selection:bg-cue-600 selection:text-white">
      {/* Atmosphere: dot field + crimson stage glow */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[110vh] bg-dots-dark opacity-70" aria-hidden />
      <div
        className="pointer-events-none absolute left-1/2 top-[18%] z-0 h-[620px] w-[620px] -translate-x-1/2 rounded-full"
        style={{ background: "radial-gradient(circle, rgba(214,0,60,0.16) 0%, rgba(214,0,60,0) 65%)" }}
        aria-hidden
      />

      {/* Floating nav */}
      <motion.header style={{ top: navTop }} className="fixed left-0 z-50 flex w-full justify-center px-4 sm:px-6">
        <motion.div
          style={{ width: navWidth, maxWidth: navMaxWidth, padding: navPadding }}
          className="flex min-w-0 items-center justify-between gap-6 rounded-full border border-white/10 bg-ink-950/60 text-white shadow-[0_10px_40px_-12px_rgba(0,0,0,0.6)] backdrop-blur-md"
        >
          <Link href="/" className="flex flex-shrink-0 items-center gap-2.5 pl-1">
            <BrandMark className="h-7 w-7" />
            <span className="font-display text-[14px] font-extrabold tracking-[0.1em]" style={{ fontStretch: "88%" }}>
              EVENTRA
            </span>
          </Link>
          <nav className="hidden min-w-0 flex-1 items-center justify-center gap-7 whitespace-nowrap text-[12.5px] font-medium text-ink-400 lg:flex">
            <a href="#product" className="transition-colors hover:text-white">
              Product
            </a>
            <a href="#features" className="transition-colors hover:text-white">
              Features
            </a>
            <a href="#how" className="transition-colors hover:text-white">
              How it works
            </a>
            <Link href="/events/conference_demo/live" className="transition-colors hover:text-white">
              Live demo
            </Link>
          </nav>
          <div className="flex flex-shrink-0 items-center gap-1.5">
            <Link
              href="/login"
              className="hidden rounded-full px-4 py-2 text-[12.5px] font-semibold text-ink-300 transition-colors hover:text-white sm:inline-flex"
            >
              Sign in
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 rounded-full bg-cue-600 px-4 py-2 text-[12.5px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] transition-colors hover:bg-cue-500"
            >
              Open app <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </motion.div>
      </motion.header>

      <main className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col items-center px-5 pt-[18vh] sm:px-10">
        {/* Cue strip — the six lifecycle stages, the current one lit */}
        <ol className="mb-10 grid w-full grid-cols-3 gap-y-2 font-mono text-[10px] uppercase tracking-label sm:grid-cols-6" aria-label="Event lifecycle">
          {STAGES.map((s, i) => {
            const on = i === stageIndex;
            return (
              <li key={s} className="flex items-center gap-2">
                <span
                  className={`cue-light transition-colors duration-500 ${
                    on ? "bg-cue-500" : i < stageIndex ? "bg-ink-500" : "bg-ink-700"
                  }`}
                />
                <span className={`transition-colors duration-500 ${on ? "text-white" : "text-ink-500"}`}>
                  {String(i + 1).padStart(2, "0")} {s}
                </span>
              </li>
            );
          })}
        </ol>

        {/* Dot-matrix stage word */}
        <div className="relative mb-12 flex min-h-[220px] w-full flex-1 items-center justify-center sm:min-h-[280px]">
          <AnimatePresence mode="wait">
            <motion.div
              key={STAGES[stageIndex]}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.45 }}
              className="flex w-full items-center justify-center text-center"
              aria-live="polite"
            >
              <EncryptedText
                text={STAGES[stageIndex]}
                charset="ABCDEFGHIJKLMNOPQRSTUVWXYZ"
                revealDelayMs={70}
                flipDelayMs={30}
                className="font-display text-[clamp(64px,13vw,190px)] font-black leading-none tracking-[-0.04em]"
                encryptedClassName="text-cue-500 opacity-80 drop-shadow-[0_0_18px_rgba(214,0,60,0.55)]"
                revealedClassName="text-white drop-shadow-[0_0_24px_rgba(255,255,255,0.18)]"
                style={{
                  fontStretch: "80%",
                  WebkitMaskImage: "radial-gradient(circle, black 38%, transparent 42%)",
                  WebkitMaskSize: "6px 6px",
                  maskImage: "radial-gradient(circle, black 38%, transparent 42%)",
                  maskSize: "6px 6px",
                }}
              />
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Pitch + example run */}
        <div className="grid w-full grid-cols-1 items-end gap-12 pb-16 lg:grid-cols-[1fr_auto] lg:gap-16">
          <div className="max-w-[54ch]">
            <h1
              className="m-0 mb-5 font-display text-[36px] font-extrabold leading-[1] tracking-[-0.03em] text-white sm:text-[48px]"
              style={{ fontStretch: "85%" }}
            >
              Plan the event. Run the event.{" "}
              <span className="text-cue-500">Adapt when reality changes.</span>
            </h1>
            <p className="mb-8 max-w-[50ch] text-[16px] leading-[1.6] text-ink-300 sm:text-[17px]">
              EVENTRA finds real venues and vendors, calls and messages them for quotes, and when
              something breaks on the day, traces the impact and lines up a recovery. Every step shows
              what the agent proposed, what the engine verified, and what you approved.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 rounded-full bg-cue-600 px-6 py-3 text-[14px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_14px_30px_-10px_rgba(214,0,60,0.6)] transition-all hover:-translate-y-0.5 hover:bg-cue-500"
              >
                Start planning <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="#product"
                className="inline-flex items-center gap-2 rounded-full border border-white/15 px-5 py-3 text-[14px] font-semibold text-ink-100 transition-colors hover:bg-white/5"
              >
                See how it works <ArrowDown className="h-4 w-4" />
              </a>
            </div>
          </div>

          <ExampleRun />
        </div>
      </main>

      <div id="product">
        <BlueprintSection />
      </div>
      <div id="features">
        <FeaturesScrollSection />
      </div>
      <div id="how">
        <ServicesSection />
      </div>
      <FooterSection />
    </div>
  );
}
