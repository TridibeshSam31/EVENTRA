"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Shield,
  ShieldAlert,
  ArrowRight,
  Mail,
  Lock,
  Zap,
  Radio,
  CheckCircle2,
  Users,
  Compass,
  KeyRound,
  Eye,
  EyeOff,
} from "lucide-react";

interface AuthViewProps {
  initialMode?: "login" | "register";
}

type OperationalRole = "commander" | "ops_lead" | "field_lead";

interface RoleProfile {
  id: OperationalRole;
  title: string;
  badge: string;
  scope: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  accentColor: string;
}

const ROLES: RoleProfile[] = [
  {
    id: "commander",
    title: "Event Commander",
    badge: "TIER 1 • FULL GOVERNANCE",
    scope: "Owner / Director",
    description: "Full operational authority, emergency overrides, and budget escalation sign-offs.",
    icon: Shield,
    accentColor: "#D6003C",
  },
  {
    id: "ops_lead",
    title: "Operations Lead",
    badge: "TIER 2 • TACTICAL CONTROL",
    scope: "Day-of Operations",
    description: "Live telemetry monitoring, schedule adjustments, vendor dispatch, and incident response.",
    icon: Radio,
    accentColor: "#3B82F6",
  },
  {
    id: "field_lead",
    title: "Field Coordinator",
    badge: "TIER 3 • ON-SITE EXECUTION",
    scope: "Floor & Logistics",
    description: "Task execution, delivery intake verification, and localized incident reporting.",
    icon: Compass,
    accentColor: "#10B981",
  },
];

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

  const activeRoleData = ROLES.find((r) => r.id === selectedRole) || ROLES[0];

  const handleRoleSelect = (roleId: OperationalRole) => {
    setSelectedRole(roleId);
    if (roleId === "commander") {
      setEmail("commander@eventra.ops");
    } else if (roleId === "ops_lead") {
      setEmail("ops.lead@eventra.ops");
    } else {
      setEmail("field.lead@eventra.ops");
    }
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
    <div className="min-h-screen w-full bg-[#090D14] text-slate-100 flex flex-col justify-between relative overflow-hidden font-sans selection:bg-[#D6003C] selection:text-white">
      {/* Subtle Background Grid & Glow Overlay */}
      <div
        className="absolute inset-0 z-0 pointer-events-none opacity-[0.035]"
        style={{
          backgroundImage: `
            linear-gradient(to right, #ffffff 1px, transparent 1px),
            linear-gradient(to bottom, #ffffff 1px, transparent 1px)
          `,
          backgroundSize: "32px 32px",
        }}
      />
      <div
        className="absolute top-[-10%] right-[-5%] w-[500px] h-[500px] rounded-full pointer-events-none z-0"
        style={{
          background: "radial-gradient(circle, rgba(214,0,60,0.12) 0%, rgba(214,0,60,0) 70%)",
        }}
      />
      <div
        className="absolute bottom-[-10%] left-[-5%] w-[500px] h-[500px] rounded-full pointer-events-none z-0"
        style={{
          background: "radial-gradient(circle, rgba(59,130,246,0.08) 0%, rgba(59,130,246,0) 70%)",
        }}
      />

      {/* Top Telemetry Header */}
      <header className="relative z-10 w-full border-b border-white/10 bg-[#0B0F17]/80 backdrop-blur-md px-6 py-3.5 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="w-8 h-8 rounded-md bg-[#D6003C] flex items-center justify-center shadow-[0_0_15px_rgba(214,0,60,0.4)] group-hover:scale-105 transition-transform">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="square"
              strokeLinejoin="miter"
            >
              <polygon points="12 2 2 7 2 17 12 22 22 17 22 7"></polygon>
              <circle cx="12" cy="12" r="3" fill="white"></circle>
            </svg>
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-sm tracking-wider uppercase text-white font-mono">
              EVENTRA
            </span>
            <span className="text-[10px] text-slate-400 font-mono tracking-widest uppercase">
              OPERATIONS GATEWAY
            </span>
          </div>
        </Link>

        {/* System Telemetry Pill */}
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[11px] font-mono font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>NODE ACTIVE • v2.4</span>
          </div>
          <Link
            href="/"
            className="text-xs text-slate-400 hover:text-white transition-colors font-mono tracking-wider"
          >
            &larr; BACK TO OVERVIEW
          </Link>
        </div>
      </header>

      {/* Main Authentication Workspace */}
      <main className="relative z-10 flex-1 flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          {/* Left Column: Role & Clearance Information */}
          <div className="lg:col-span-5 space-y-6">
            <div>
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded border border-[#D6003C]/30 bg-[#D6003C]/10 text-[#D6003C] text-[10px] font-mono font-bold tracking-widest uppercase mb-3">
                <Shield className="w-3.5 h-3.5" />
                Access Control Protocol
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
                Operator Clearance
              </h1>
              <p className="text-sm text-slate-400 mt-2 leading-relaxed">
                Select your designated role clearance to authenticate into the live event command network.
              </p>
            </div>

            {/* Role Selectors */}
            <div className="space-y-2.5">
              {ROLES.map((role) => {
                const Icon = role.icon;
                const isSelected = selectedRole === role.id;
                return (
                  <button
                    key={role.id}
                    type="button"
                    onClick={() => handleRoleSelect(role.id)}
                    className={`w-full text-left p-3.5 rounded-lg border transition-all flex items-start gap-3.5 ${
                      isSelected
                        ? "bg-[#141A24] border-[#D6003C]/60 shadow-[0_0_20px_rgba(214,0,60,0.15)] ring-1 ring-[#D6003C]/30"
                        : "bg-[#0E131C] border-white/5 hover:border-white/15 hover:bg-[#121822]"
                    }`}
                  >
                    <div
                      className={`p-2 rounded-md mt-0.5 ${
                        isSelected
                          ? "bg-[#D6003C]/20 text-[#D6003C]"
                          : "bg-white/5 text-slate-400"
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-white tracking-wide">
                          {role.title}
                        </span>
                        <span className="text-[9px] font-mono font-bold tracking-wider text-slate-400 uppercase">
                          {role.scope}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1 line-clamp-2">
                        {role.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Fast Demo Bypass Card */}
            <div className="p-4 rounded-lg bg-[#0F141F] border border-amber-500/20 flex flex-col gap-2.5">
              <div className="flex items-center gap-2 text-amber-400 text-xs font-mono font-bold">
                <Zap className="w-4 h-4 text-amber-400" />
                <span>EVALUATOR FAST-PASS</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-normal">
                Bypass authentication with pre-seeded demo state to immediately test live telemetry and agent recovery.
              </p>
              <button
                type="button"
                onClick={handleInstantDemoPass}
                disabled={fastPassLoading}
                className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-mono font-semibold tracking-wider transition-all"
              >
                {fastPassLoading ? (
                  <div className="w-3.5 h-3.5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <span>LAUNCH DEMO COMMAND CENTER</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Right Column: Authenticated Credential Terminal */}
          <div className="lg:col-span-7">
            <div className="bg-[#0F1420]/95 backdrop-blur-xl border border-white/10 rounded-xl p-6 sm:p-8 shadow-2xl relative overflow-hidden">
              {/* Corner Ambient Accent */}
              <div
                className="absolute top-0 right-0 w-32 h-32 pointer-events-none opacity-20"
                style={{
                  background:
                    "radial-gradient(circle at top right, #D6003C 0%, transparent 70%)",
                }}
              />

              {/* Mode Toggle Tabs */}
              <div className="flex items-center justify-between border-b border-white/10 pb-4 mb-6">
                <div>
                  <h2 className="text-lg font-bold text-white tracking-wide">
                    {mode === "login" ? "Verify Credentials" : "Register Organization"}
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5 font-mono">
                    CLEARANCE: {activeRoleData.badge}
                  </p>
                </div>
                <div className="flex items-center gap-1 p-1 rounded-lg bg-black/40 border border-white/10 text-xs font-mono">
                  <button
                    type="button"
                    onClick={() => setMode("login")}
                    className={`px-3 py-1 rounded transition-colors ${
                      mode === "login"
                        ? "bg-[#D6003C] text-white font-bold"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    SIGN IN
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("register")}
                    className={`px-3 py-1 rounded transition-colors ${
                      mode === "register"
                        ? "bg-[#D6003C] text-white font-bold"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    REGISTER
                  </button>
                </div>
              </div>

              {/* Authentication Form */}
              <form onSubmit={handleSubmit} className="space-y-4">
                <AnimatePresence mode="popLayout">
                  {mode === "register" && (
                    <motion.div
                      key="register-fields"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="space-y-4 overflow-hidden"
                    >
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-mono uppercase tracking-wider text-slate-400 flex items-center justify-between">
                          <span>Organization / Host Name</span>
                          <span className="text-[9px] text-slate-500 font-mono">REQUIRED</span>
                        </label>
                        <div className="relative">
                          <Users className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                          <input
                            type="text"
                            required={mode === "register"}
                            value={orgName}
                            onChange={(e) => setOrgName(e.target.value)}
                            placeholder="Apex Event Operations Inc."
                            className="w-full bg-black/40 border border-white/10 rounded-lg py-2.5 pl-10 pr-4 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-[#D6003C] focus:ring-1 focus:ring-[#D6003C] transition-all"
                          />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[11px] font-mono uppercase tracking-wider text-slate-400 flex items-center justify-between">
                          <span>Lead Operative Full Name</span>
                          <span className="text-[9px] text-slate-500 font-mono">REQUIRED</span>
                        </label>
                        <div className="relative">
                          <Shield className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                          <input
                            type="text"
                            required={mode === "register"}
                            value={fullName}
                            onChange={(e) => setFullName(e.target.value)}
                            placeholder="Alex Thorne"
                            className="w-full bg-black/40 border border-white/10 rounded-lg py-2.5 pl-10 pr-4 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-[#D6003C] focus:ring-1 focus:ring-[#D6003C] transition-all"
                          />
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Email Designation */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-mono uppercase tracking-wider text-slate-400 flex items-center justify-between">
                    <span>Authorized Work Email</span>
                    <span className="text-[9px] text-slate-500 font-mono">ENCRYPTED</span>
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="commander@eventra.ops"
                      className="w-full bg-black/40 border border-white/10 rounded-lg py-2.5 pl-10 pr-4 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-[#D6003C] focus:ring-1 focus:ring-[#D6003C] transition-all"
                    />
                  </div>
                </div>

                {/* Passkey / Secret */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
                      Operator Access Key
                    </label>
                    {mode === "login" && (
                      <span className="text-[10px] text-slate-500 hover:text-slate-300 cursor-pointer font-mono">
                        Forgot Key?
                      </span>
                    )}
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      type={showPassword ? "text" : "password"}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••••••"
                      className="w-full bg-black/40 border border-white/10 rounded-lg py-2.5 pl-10 pr-10 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-[#D6003C] focus:ring-1 focus:ring-[#D6003C] transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Remember & Invariant Checkbox */}
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="remember"
                    defaultChecked
                    className="w-4 h-4 rounded border-white/20 bg-black/40 text-[#D6003C] focus:ring-[#D6003C] accent-[#D6003C]"
                  />
                  <label htmlFor="remember" className="text-xs text-slate-400 select-none">
                    Retain session key on this secure operational terminal
                  </label>
                </div>

                {/* Submit Action */}
                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full py-3 px-4 rounded-lg bg-[#D6003C] hover:bg-[#BF0035] active:scale-[0.99] text-white font-mono font-bold text-xs uppercase tracking-widest shadow-[0_0_20px_rgba(214,0,60,0.3)] transition-all flex items-center justify-center gap-2"
                  >
                    {isLoading ? (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <>
                        <Shield className="w-4 h-4" />
                        <span>
                          {mode === "login"
                            ? "AUTHENTICATE & ENTER COMMAND CENTER"
                            : "CONFIRM REGISTRATION & INITIALIZE"}
                        </span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </div>
              </form>

              {/* Bottom Security Assurance */}
              <div className="mt-6 pt-4 border-t border-white/5 flex items-center justify-between text-[10px] text-slate-500 font-mono">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  TLS 1.3 • AES-256 SESSION ENCRYPTION
                </span>
                <span>EVENTRA IDENTITY v2.4</span>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 w-full border-t border-white/5 bg-[#080B11]/60 px-6 py-3 flex flex-col sm:flex-row items-center justify-between text-[11px] text-slate-500 font-mono gap-2">
        <div>
          EVENTRA ADAPTIVE OPERATIONS PLATFORM • MISSION-CRITICAL ARCHITECTURE
        </div>
        <div className="flex items-center gap-4">
          <span>LATENCY: 14ms</span>
          <span>•</span>
          <span>DISPATCH READY</span>
        </div>
      </footer>
    </div>
  );
}
