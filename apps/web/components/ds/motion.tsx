"use client";

/**
 * EVENTRA motion kit — friendly, purposeful animation.
 *
 *  <PopCard>        card that springs in (scale + lift) and lifts on hover
 *  <StaggerList>    children pop in one after another
 *  <AnimatedNumber> counts up to a value when it changes
 *  <Reveal>         fades/slides content in when scrolled into view
 *  <PresenceList>   items animate in AND out (removed rows collapse away)
 *  <Celebrate>      a short "done" burst for completed actions
 *
 * All of it respects prefers-reduced-motion (content simply appears).
 */
import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion, type HTMLMotionProps } from "framer-motion";

export const SPRING = { type: "spring" as const, stiffness: 420, damping: 30, mass: 0.8 };
export const SPRING_SOFT = { type: "spring" as const, stiffness: 260, damping: 26 };
export const EASE_OUT = [0.2, 0.7, 0.2, 1] as const;

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/* ── PopCard ─────────────────────────────────────────────────── */
type PopCardProps = HTMLMotionProps<"div"> & {
  /** position in a list — adds a small stagger delay */
  index?: number;
  /** lift + shadow on hover (default true) */
  interactive?: boolean;
  /** highlight ring that pulses once, e.g. when the card needs attention */
  attention?: boolean;
};

export function PopCard({ index = 0, interactive = true, attention = false, className, children, ...rest }: PopCardProps) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      layout={!reduce}
      initial={reduce ? false : { opacity: 0, y: 14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduce ? undefined : { opacity: 0, scale: 0.96, transition: { duration: 0.18 } }}
      transition={{ ...SPRING, delay: reduce ? 0 : Math.min(index, 10) * 0.045 }}
      whileHover={interactive && !reduce ? { y: -3, boxShadow: "0 18px 36px -16px rgba(27,24,21,0.28)" } : undefined}
      whileTap={interactive && !reduce ? { scale: 0.985 } : undefined}
      className={cx("relative", attention && "ring-2 ring-standby-300 ring-offset-2 ring-offset-paper", className)}
      {...rest}
    >
      {attention && !reduce && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[inherit] ring-2 ring-standby-400"
          initial={{ opacity: 0.9, scale: 1 }}
          animate={{ opacity: 0, scale: 1.04 }}
          transition={{ duration: 1.4, repeat: 2, ease: "easeOut" }}
        />
      )}
      {children as React.ReactNode}
    </motion.div>
  );
}

/* ── StaggerList ─────────────────────────────────────────────── */
export function StaggerList({
  children,
  className,
  as = "div",
  itemAs,
  gap = 0.05,
}: {
  children: React.ReactNode;
  className?: string;
  as?: "div" | "ul" | "ol" | "section";
  /** element for each item wrapper; defaults to "li" inside lists, else "div" */
  itemAs?: "div" | "li";
  gap?: number;
}) {
  const reduce = useReducedMotion();
  const Comp = motion[as] as typeof motion.div;
  const Item = motion[itemAs ?? (as === "ul" || as === "ol" ? "li" : "div")] as typeof motion.div;
  return (
    <Comp
      className={className}
      initial={reduce ? false : "hidden"}
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: gap } } }}
    >
      {React.Children.map(children, (child, i) =>
        child == null ? null : (
          <Item
            key={(React.isValidElement(child) && child.key) || i}
            variants={{
              hidden: { opacity: 0, y: 12, scale: 0.98 },
              show: { opacity: 1, y: 0, scale: 1, transition: SPRING },
            }}
            className="min-w-0"
          >
            {child}
          </Item>
        )
      )}
    </Comp>
  );
}

/* ── PresenceList (enter + exit) ─────────────────────────────── */
export function PresenceItem({
  children,
  className,
  layoutId,
}: {
  children: React.ReactNode;
  className?: string;
  layoutId?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      layout={!reduce}
      layoutId={layoutId}
      initial={reduce ? false : { opacity: 0, height: 0, y: -6 }}
      animate={{ opacity: 1, height: "auto", y: 0 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0, x: 24, transition: { duration: 0.22, ease: EASE_OUT } }}
      transition={SPRING_SOFT}
      className={cx("overflow-hidden", className)}
    >
      {children}
    </motion.div>
  );
}

export { AnimatePresence };

/* ── AnimatedNumber ──────────────────────────────────────────── */
export function AnimatedNumber({
  value,
  format = (n) => Math.round(n).toLocaleString(),
  duration = 0.9,
  className,
}: {
  value: number | null | undefined;
  format?: (n: number) => string;
  duration?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState<number>(reduce || value == null ? value ?? 0 : 0);
  const fromRef = useRef<number>(display);

  useEffect(() => {
    if (value == null) return;
    if (reduce) {
      setDisplay(value);
      return;
    }
    const from = fromRef.current;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / (duration * 1000));
      const eased = 1 - Math.pow(1 - p, 3);
      const v = from + (value - from) * eased;
      setDisplay(v);
      if (p < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration, reduce]);

  if (value == null) return <span className={className}>—</span>;
  return <span className={cx("tabular-nums", className)}>{format(display)}</span>;
}

/* ── Reveal on scroll ────────────────────────────────────────── */
export function Reveal({
  children,
  className,
  delay = 0,
  y = 16,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  y?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const reduce = useReducedMotion();
  return (
    <motion.div
      ref={ref}
      initial={reduce ? false : { opacity: 0, y }}
      animate={inView || reduce ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.5, ease: EASE_OUT, delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* ── Celebrate: a small success burst ────────────────────────── */
export function Celebrate({ show, label = "Done" }: { show: boolean; label?: string }) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence>
      {show && (
        <motion.span
          role="status"
          className="pointer-events-none relative inline-flex items-center gap-1.5 rounded-full bg-go-600 px-2.5 py-1 text-[12px] font-semibold text-white shadow-md"
          initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6, y: 6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={SPRING}
        >
          {!reduce &&
            [0, 1, 2, 3, 4, 5].map((i) => (
              <motion.span
                key={i}
                aria-hidden
                className="absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full bg-go-400"
                initial={{ x: 0, y: 0, opacity: 1 }}
                animate={{
                  x: Math.cos((i / 6) * Math.PI * 2) * 26,
                  y: Math.sin((i / 6) * Math.PI * 2) * 18,
                  opacity: 0,
                }}
                transition={{ duration: 0.6, ease: "easeOut" }}
              />
            ))}
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
            <motion.path
              d="M3 8.5l3.2 3L13 4.5"
              initial={reduce ? false : { pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.35, delay: 0.1 }}
            />
          </svg>
          {label}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

/* ── Toast (lightweight, self-contained) ─────────────────────── */
export type ToastTone = "go" | "cue" | "standby" | "ink";

export function Toast({
  message,
  tone = "ink",
  onDone,
  ms = 3200,
}: {
  message: React.ReactNode | null;
  tone?: ToastTone;
  onDone?: () => void;
  ms?: number;
}) {
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!message || !onDone) return;
    const t = setTimeout(onDone, ms);
    return () => clearTimeout(t);
  }, [message, onDone, ms]);
  const toneCls: Record<ToastTone, string> = {
    go: "bg-go-700 text-white",
    cue: "bg-cue-700 text-white",
    standby: "bg-standby-600 text-white",
    ink: "bg-ink-900 text-ink-50",
  };
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[60] flex justify-center px-4">
      <AnimatePresence>
        {message && (
          <motion.div
            role="status"
            className={cx("pointer-events-auto max-w-[520px] rounded-xl px-4 py-2.5 text-[13px] font-semibold shadow-xl", toneCls[tone])}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.97 }}
            transition={SPRING}
          >
            {message}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
