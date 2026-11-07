"use client";

import React, { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useGuideStore } from "@/stores/guideStore";
import { samePage } from "@/lib/api/guidance";

const SHOW_MS = 7000;
const FIND_TIMEOUT_MS = 5000;

/**
 * When the user arrives on the page where their next step happens, spotlight the
 * element tagged `data-guide-step="<step_id>"` with a ring and a "Do this next"
 * tooltip. Pages opt in by adding that attribute to their primary action.
 */
export function GuideCoachMark() {
  const pathname = usePathname();
  const reduce = useReducedMotion();
  const { coachFor, nextStep, clearCoach } = useGuideStore();
  const [rect, setRect] = useState<DOMRect | null>(null);

  const active = !!coachFor && !!nextStep && coachFor === nextStep.step_id && samePage(pathname, nextStep.path);

  useEffect(() => {
    if (!active || !coachFor) {
      setRect(null);
      return;
    }
    let el: HTMLElement | null = null;
    let raf = 0;
    let finder: ReturnType<typeof setInterval> | null = null;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    const started = Date.now();

    const measure = () => {
      if (el && el.isConnected) setRect(el.getBoundingClientRect());
    };
    const onMove = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    const dismiss = () => {
      setRect(null);
      clearCoach();
    };

    finder = setInterval(() => {
      const found = document.querySelector<HTMLElement>(`[data-guide-step="${CSS.escape(coachFor)}"]`);
      if (found) {
        el = found;
        if (finder) clearInterval(finder);
        el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
        setTimeout(measure, reduce ? 0 : 420);
        window.addEventListener("scroll", onMove, true);
        window.addEventListener("resize", onMove);
        document.addEventListener("pointerdown", dismiss, { once: true });
        hideTimer = setTimeout(dismiss, SHOW_MS);
      } else if (Date.now() - started > FIND_TIMEOUT_MS) {
        if (finder) clearInterval(finder);
        clearCoach(); // nothing tagged on this page — the card already explained what to do
      }
    }, 250);

    return () => {
      if (finder) clearInterval(finder);
      if (hideTimer) clearTimeout(hideTimer);
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
      document.removeEventListener("pointerdown", dismiss);
    };
  }, [active, coachFor, clearCoach, reduce]);

  const pad = 8;
  const below = rect ? rect.bottom + 70 < (typeof window !== "undefined" ? window.innerHeight : 800) : true;

  return (
    <AnimatePresence>
      {active && rect && (
        <motion.div
          key="coach"
          className="pointer-events-none fixed inset-0 z-[60]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          aria-hidden
        >
          <motion.div
            className="absolute rounded-xl ring-[3px] ring-cue-500"
            style={{
              left: rect.left - pad,
              top: rect.top - pad,
              width: rect.width + pad * 2,
              height: rect.height + pad * 2,
              boxShadow: "0 0 0 9999px rgba(16,14,12,0.28), 0 0 24px 4px rgba(214,0,60,0.45)",
            }}
            initial={reduce ? false : { scale: 1.15, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { scale: [1.08, 1, 1.03, 1], opacity: 1 }}
            transition={{ duration: 1.1, ease: "easeOut" }}
          />
          <motion.div
            className="absolute flex items-center gap-2 rounded-lg bg-ink-900 px-3 py-2 text-[12.5px] font-semibold text-ink-50 shadow-xl"
            style={{
              left: Math.max(12, Math.min(rect.left, (typeof window !== "undefined" ? window.innerWidth : 1200) - 260)),
              top: below ? rect.bottom + pad + 10 : rect.top - pad - 46,
            }}
            initial={reduce ? false : { y: below ? -6 : 6, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.15, duration: 0.25 }}
          >
            <span className="cue-light bg-cue-500 animate-cue-blink" />
            Do this next
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
