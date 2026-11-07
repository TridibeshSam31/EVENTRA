"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowLeft, Mail, Lock, Eye, EyeOff, Loader2, Building2, User, Check } from "lucide-react";
import { BrandMark } from "@/components/shell/BrandMark";

interface AuthViewProps {
  initialMode?: "login" | "register";
}

type OperationalRole = "commander" | "ops_lead" | "field_lead";

interface RoleProfile {
  id: OperationalRole;
  title: string;
  scope: string;
  description: string;
  email: string;
}

const ROLES: RoleProfile[] = [
  {
    id: "commander",
    title: "Event owner",
    scope: "Owner / director",
    description: "Full authority: approvals, budget sign-off and emergency overrides.",
    email: "commander@eventra.ops",
  },
  {
    id: "ops_lead",
    title: "Operations lead",
    scope: "Day-of operations",
    description: "Runs the schedule, dispatches vendors and responds to incidents.",
    email: "ops.lead@eventra.ops",
  },
  {
    id: "field_lead",
    title: "Field coordinator",
    scope: "Floor & logistics",
    description: "Executes tasks on site, verifies deliveries and reports problems.",
    email: "field.lead@eventra.ops",
  },
];

// The left panel walks through what EVENTRA actually does — one line per stage.
const LOOP = [
  { n: "01", stage: "Define", text: "Describe the event in your own words." },
  { n: "02", stage: "Discover", text: "Real venues and vendors, qualified against your brief." },
  { n: "03", stage: "Engage", text: "Calls and WhatsApp for quotes, with every reply on record." },
  { n: "04", stage: "Run", text: "One live view of tasks, providers, schedule and budget." },
  { n: "05", stage: "Recover", text: "When something breaks, impact traced and backups lined up." },
];

const inputCls =
  "w-full rounded-lg border border-ink-200 bg-[#FDFCFA] py-2.5 pl-10 pr-3 text-[14px] text-ink-900 shadow-inner placeholder:text-ink-400 transition focus:border-ink-900 focus:outline-none focus:ring-4 focus:ring-ink-900/5";

export function AuthView({ initialMode = "login" }: AuthViewProps) {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">(initialMode);
  const [selectedRole, setSelectedRole] = useState<OperationalRole>("commander");
  const [email, setEmail] = useState("commander@eventra.ops");
  const [password, setPassword] = useState("••••••••••••");
  const [showPassword, setShowPassword] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [fullName, setFullName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [fastPassLoading, setFastPassLoading] = useState(false);

  const handleRoleSelect = (roleId: OperationalRole) => {
    setSelectedRole(roleId);
    const role = ROLES.find((r) => r.id === roleId);
    if (role) setEmail(role.email);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setTimeout(() => {
      router.push("/dashboard");
    }, 900);
  };

  const handleInstantDemoPass = () => {
    setFastPassLoading(true);
    setTimeout(() => {
      router.push("/dashboard");
    }, 600);
  };

  return (
    <div className="grid min-h-[100dvh] w-full bg-paper font-sans text-ink-900 selection:bg-cue-600 selection:text-white lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      {/* ── Left: the product, on the ink frame ───────────────── */}
      <aside className="relative hidden overflow-hidden bg-ink-950 text-ink-100 lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="pointer-events-none absolute inset-0 bg-dots-dark opacity-70" aria-hidden />
        <div
          className="pointer-events-none absolute -left-40 top-1/3 h-[520px] w-[520px] rounded-full"
          style={{ background: "radial-gradient(circle, rgba(214,0,60,0.22), transparent 65%)" }}
          aria-hidden
        />

        <Link href="/" className="relative flex w-fit items-center gap-2.5">
          <BrandMark className="h-8 w-8" />
          <span className="font-display text-[15px] font-extrabold tracking-[0.1em] text-white" style={{ fontStretch: "88%" }}>
            EVENTRA
          </span>
        </Link>

        <div className="relative max-w-[460px]">
          <h1
            className="font-display text-[52px] font-black leading-[0.92] tracking-[-0.035em] text-white xl:text-[60px]"
            style={{ fontStretch: "82%" }}
          >
            Plan it. Run it.
            <br />
            <span className="text-cue-500">Recover it.</span>
          </h1>
          <ol className="mt-10 space-y-0 border-l border-white/10">
            {LOOP.map((s, i) => (
              <motion.li
                key={s.n}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.15 + i * 0.08, duration: 0.4, ease: [0.2, 0.7, 0.2, 1] }}
                className="relative py-2.5 pl-6"
              >
                <span className="absolute -left-[4px] top-[17px] h-[7px] w-[7px] rounded-full bg-ink-700 ring-4 ring-ink-950" />
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-[10.5px] text-ink-500">{s.n}</span>
                  <span className="font-display text-[13px] font-bold uppercase tracking-[0.06em] text-ink-100">{s.stage}</span>
                </div>
                <p className="mt-0.5 pl-[34px] text-[13.5px] leading-snug text-ink-400">{s.text}</p>
              </motion.li>
            ))}
          </ol>
        </div>

        <div className="relative flex items-center justify-between font-mono text-[10.5px] uppercase tracking-label text-ink-500">
          <span>Adaptive event operations</span>
          <span className="flex items-center gap-2">
            <span className="cue-light bg-go-500" /> Demo workspace
          </span>
        </div>
      </aside>

      {/* ── Right: the form, on paper ─────────────────────────── */}
      <main className="relative flex flex-col px-5 py-6 sm:px-10 lg:px-16">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 lg:hidden">
            <BrandMark className="h-7 w-7" glow={false} />
            <span className="font-display text-[14px] font-extrabold tracking-[0.1em]" style={{ fontStretch: "88%" }}>
              EVENTRA
            </span>
          </Link>
          <Link href="/" className="ml-auto inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-500 transition hover:text-ink-900">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to site
          </Link>
        </div>

        <div className="mx-auto flex w-full max-w-[440px] flex-1 flex-col justify-center py-10">
          <div className="mb-7">
            <div className="eyebrow mb-2">{mode === "login" ? "Welcome back" : "New workspace"}</div>
            <h2
              className="font-display text-[34px] font-extrabold leading-[1] tracking-[-0.03em]"
              style={{ fontStretch: "86%" }}
            >
              {mode === "login" ? "Sign in to EVENTRA" : "Create your workspace"}
            </h2>
          </div>

          {/* Mode switch */}
          <div role="tablist" className="mb-6 grid grid-cols-2 rounded-lg border border-ink-200 bg-ink-100/70 p-0.5">
            {(["login", "register"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={`rounded-md py-2 text-[13px] font-semibold transition ${
                  mode === m ? "bg-[#FDFCFA] text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-800"
                }`}
              >
                {m === "login" ? "Sign in" : "Register"}
              </button>
            ))}
          </div>

          {/* Role */}
          <fieldset className="mb-5">
            <legend className="mb-2 text-[12.5px] font-semibold text-ink-700">Your role on the event</legend>
            <div className="grid gap-2">
              {ROLES.map((role) => {
                const selected = selectedRole === role.id;
                return (
                  <button
                    key={role.id}
                    type="button"
                    onClick={() => handleRoleSelect(role.id)}
                    aria-pressed={selected}
                    className={`group flex items-start gap-3 rounded-xl border p-3 text-left transition ${
                      selected
                        ? "border-ink-900 bg-[#FDFCFA] shadow-md"
                        : "border-ink-200 bg-[#FDFCFA]/60 hover:border-ink-300 hover:bg-[#FDFCFA]"
                    }`}
                  >
                    <span
                      className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border transition ${
                        selected ? "border-cue-600 bg-cue-600 text-white" : "border-ink-300"
                      }`}
                    >
                      {selected && <Check className="h-2.5 w-2.5" strokeWidth={3.5} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-[13.5px] font-semibold text-ink-900">{role.title}</span>
                        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-400">{role.scope}</span>
                      </span>
                      <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-500">{role.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <form onSubmit={handleSubmit} className="space-y-4">
            <AnimatePresence initial={false}>
              {mode === "register" && (
                <motion.div
                  key="register-fields"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="grid gap-4 overflow-hidden sm:grid-cols-2"
                >
                  <label className="block">
                    <span className="mb-1.5 block text-[12.5px] font-semibold text-ink-700">Your name</span>
                    <span className="relative block">
                      <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                      <input
                        type="text"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="Priya Sharma"
                        required={mode === "register"}
                        className={inputCls}
                      />
                    </span>
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[12.5px] font-semibold text-ink-700">Organization</span>
                    <span className="relative block">
                      <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                      <input
                        type="text"
                        value={orgName}
                        onChange={(e) => setOrgName(e.target.value)}
                        placeholder="Your company"
                        required={mode === "register"}
                        className={inputCls}
                      />
                    </span>
                  </label>
                </motion.div>
              )}
            </AnimatePresence>

            <label className="block">
              <span className="mb-1.5 block text-[12.5px] font-semibold text-ink-700">Work email</span>
              <span className="relative block">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  className={inputCls}
                />
              </span>
            </label>

            <label className="block">
              <span className="mb-1.5 flex items-center justify-between text-[12.5px] font-semibold text-ink-700">
                Password
                {mode === "login" && (
                  <span className="text-[12px] font-medium text-ink-400">Forgot it? Ask your event owner.</span>
                )}
              </span>
              <span className="relative block">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  className={`${inputCls} pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </span>
            </label>

            <button type="submit" disabled={isLoading} className="btn-primary h-11 w-full text-[14px]">
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> {mode === "login" ? "Signing in…" : "Creating workspace…"}
                </>
              ) : (
                <>
                  {mode === "login" ? "Sign in" : "Create workspace"} <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>

          <div className="my-6 flex items-center gap-3 text-[11px] font-mono uppercase tracking-label text-ink-400">
            <span className="h-px flex-1 bg-ink-200" /> or <span className="h-px flex-1 bg-ink-200" />
          </div>

          {/* Demo access */}
          <button
            type="button"
            onClick={handleInstantDemoPass}
            disabled={fastPassLoading}
            className="group flex w-full items-center gap-3 rounded-xl border border-dashed border-ink-300 bg-[#FDFCFA]/60 p-3.5 text-left transition hover:border-cue-300 hover:bg-cue-50/40"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-ink-900 text-ink-50">
              {fastPassLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <span className="cue-light bg-cue-500 animate-cue-blink" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-semibold text-ink-900">Explore the demo workspace</span>
              <span className="block text-[12.5px] text-ink-500">Skip sign-in and open the sample events.</span>
            </span>
            <ArrowRight className="h-4 w-4 text-ink-400 transition group-hover:translate-x-0.5 group-hover:text-cue-600" />
          </button>
        </div>

      </main>
    </div>
  );
}
