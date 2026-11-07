/**
 * EVENTRA "Run Sheet" design-system primitives.
 *
 * Small, composable building blocks used by every page so the product reads as
 * one system. Prefer these (and the .btn-* / .chip / .eyebrow / .surface
 * classes in globals.css) over ad-hoc Tailwind card markup.
 */
import React from "react";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/* ── Page header ───────────────────────────────────────────── */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}
        <h2
          className="font-display text-[24px] font-extrabold leading-[1.05] tracking-[-0.025em] text-ink-900 sm:text-[28px]"
          style={{ fontStretch: "88%" }}
        >
          {title}
        </h2>
        {description && <p className="mt-1.5 max-w-[68ch] text-[14px] leading-relaxed text-ink-600">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ── Panel (the standard card) ─────────────────────────────── */
export function Panel({
  eyebrow,
  title,
  actions,
  children,
  className,
  bodyClassName,
  tone = "paper",
  as: Tag = "section",
}: {
  eyebrow?: React.ReactNode;
  title?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  tone?: "paper" | "ink" | "sunk";
  as?: "section" | "div" | "article" | "aside";
}) {
  const toneCls =
    tone === "ink"
      ? "surface-ink"
      : tone === "sunk"
      ? "surface-sunk"
      : "surface";
  const hasHead = eyebrow || title || actions;
  return (
    <Tag className={cx(toneCls, "overflow-hidden", className)}>
      {hasHead && (
        <header
          className={cx(
            "flex items-start justify-between gap-3 px-5 pt-4",
            tone === "ink" ? "text-ink-50" : ""
          )}
        >
          <div className="min-w-0">
            {eyebrow && <div className={cx("eyebrow", tone === "ink" && "text-ink-400")}>{eyebrow}</div>}
            {title && (
              <h3 className={cx("mt-1 text-[15px] font-semibold tracking-[-0.01em]", tone === "ink" ? "text-ink-50" : "text-ink-900")}>
                {title}
              </h3>
            )}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={cx(hasHead ? "px-5 pb-5 pt-3" : "p-5", bodyClassName)}>{children}</div>
    </Tag>
  );
}

/* ── Stat / readout ────────────────────────────────────────── */
export function Stat({
  label,
  value,
  sub,
  tone = "default",
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "default" | "go" | "standby" | "cue" | "agent" | "engine";
  className?: string;
}) {
  const bar: Record<string, string> = {
    default: "bg-ink-300",
    go: "bg-go-500",
    standby: "bg-standby-500",
    cue: "bg-cue-600",
    agent: "bg-agent-500",
    engine: "bg-engine-500",
  };
  return (
    <div className={cx("surface relative overflow-hidden px-4 pb-3.5 pt-3", className)}>
      <span className={cx("absolute left-0 top-3 h-5 w-[3px] rounded-r-full", bar[tone])} aria-hidden />
      <div className="eyebrow">{label}</div>
      <div
        className="mt-1.5 font-display text-[28px] font-bold leading-none tracking-[-0.02em] text-ink-900 tabular-nums"
        style={{ fontStretch: "90%" }}
      >
        {value}
      </div>
      {sub && <div className="mt-1.5 text-[12px] text-ink-500">{sub}</div>}
    </div>
  );
}

/* ── Status chip with cue light ────────────────────────────── */
export type CueTone = "go" | "standby" | "cue" | "agent" | "engine" | "info" | "idle";

const CHIP_TONES: Record<CueTone, { chip: string; dot: string }> = {
  go: { chip: "border-go-200 bg-go-50 text-go-700", dot: "bg-go-500" },
  standby: { chip: "border-standby-200 bg-standby-50 text-standby-800", dot: "bg-standby-500" },
  cue: { chip: "border-cue-200 bg-cue-50 text-cue-700", dot: "bg-cue-600" },
  agent: { chip: "border-agent-200 bg-agent-50 text-agent-700", dot: "bg-agent-500" },
  engine: { chip: "border-engine-200 bg-engine-50 text-engine-700", dot: "bg-engine-500" },
  info: { chip: "border-info-200 bg-info-50 text-info-700", dot: "bg-info-500" },
  idle: { chip: "border-ink-200 bg-ink-100/70 text-ink-600", dot: "bg-ink-400" },
};

export function CueChip({
  tone = "idle",
  pulse,
  children,
  className,
}: {
  tone?: CueTone;
  pulse?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const t = CHIP_TONES[tone];
  return (
    <span className={cx("chip", t.chip, className)}>
      <span className={cx("cue-light", t.dot, pulse && "animate-cue-blink")} />
      {children}
    </span>
  );
}

/* ── Empty / error state ───────────────────────────────────── */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-ink-300 bg-[#FDFCFA]/60 px-6 py-12 text-center",
        className
      )}
    >
      {icon && (
        <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl border border-ink-200 bg-[#FDFCFA] text-ink-500 shadow-sm">
          {icon}
        </div>
      )}
      <div className="text-[15px] font-semibold text-ink-900">{title}</div>
      {description && <p className="mt-1.5 max-w-[46ch] text-[13px] leading-relaxed text-ink-500">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* ── Key/value row list (run-sheet style) ──────────────────── */
export function KeyValue({
  rows,
  className,
}: {
  rows: Array<{ label: React.ReactNode; value: React.ReactNode; muted?: boolean }>;
  className?: string;
}) {
  return (
    <dl className={cx("ruled", className)}>
      {rows.map((r, i) => (
        <div key={i} className="flex items-baseline justify-between gap-4 py-2">
          <dt className="text-[12.5px] text-ink-500">{r.label}</dt>
          <dd className={cx("text-right text-[13px] font-semibold tabular-nums", r.muted ? "text-ink-400" : "text-ink-900")}>
            {r.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ── Meter (budget, readiness, progress) ───────────────────── */
export function Meter({
  value,
  max = 100,
  tone = "go",
  className,
  label,
}: {
  value: number;
  max?: number;
  tone?: "go" | "standby" | "cue" | "agent" | "engine" | "ink";
  className?: string;
  label?: string;
}) {
  const pct = Math.max(0, Math.min(100, max ? (value / max) * 100 : 0));
  const fill: Record<string, string> = {
    go: "bg-go-500",
    standby: "bg-standby-500",
    cue: "bg-cue-600",
    agent: "bg-agent-500",
    engine: "bg-engine-500",
    ink: "bg-ink-900",
  };
  return (
    <div
      className={cx("h-1.5 w-full overflow-hidden rounded-full bg-ink-200/70", className)}
      role="meter"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
    >
      <div className={cx("h-full rounded-full transition-[width] duration-700 ease-out", fill[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}

/* ── Segmented tabs ────────────────────────────────────────── */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: React.ReactNode; count?: number }>;
  className?: string;
}) {
  return (
    <div role="tablist" className={cx("inline-flex rounded-lg border border-ink-200 bg-ink-100/70 p-0.5", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cx(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition",
              active ? "bg-[#FDFCFA] text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-800"
            )}
          >
            {o.label}
            {typeof o.count === "number" && (
              <span className={cx("font-mono text-[10.5px]", active ? "text-cue-600" : "text-ink-400")}>{o.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
