"use client";

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { ArrowRight, User, Shield, KeyRound, Mail, Lock, Zap } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { BackgroundBeams } from '@/components/ui/background-beams';

export default function AuthPage() {
  const [role, setRole] = useState<'organizer' | 'visitor' | null>(null);
  const [isLogin, setIsLogin] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleBypass = () => {
    setIsLoading(true);
    setTimeout(() => {
      router.push('/dashboard');
    }, 800);
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setTimeout(() => {
      router.push('/dashboard');
    }, 1500);
  };

  return (
    <div className="min-h-screen w-full bg-[#070b12] text-white flex items-center justify-center relative overflow-hidden selection:bg-[#D6003C] selection:text-white">
      
      {/* Background Effects */}
      <BackgroundBeams className="absolute inset-0 z-0 opacity-40 pointer-events-none" />
      
      <div 
        className="absolute inset-0 z-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage: `
            linear-gradient(to right, #ffffff 1px, transparent 1px),
            linear-gradient(to bottom, #ffffff 1px, transparent 1px)
          `,
          backgroundSize: '40px 40px'
        }}
      />

      <div className="w-full max-w-5xl z-10 p-6 md:p-12 relative flex flex-col items-center">
        
        {/* Logo */}
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="flex items-center gap-3 mb-12"
        >
          <div className="w-12 h-12 rounded-full bg-[#D6003C] flex items-center justify-center shadow-[0_0_30px_rgba(214,0,60,0.4)]">
             <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="square" strokeLinejoin="miter">
               <polygon points="12 2 2 7 2 17 12 22 22 17 22 7"></polygon>
               <circle cx="12" cy="12" r="3" fill="white"></circle>
             </svg>
          </div>
          <span className="text-3xl font-bold tracking-tight text-white">Eventra</span>
        </motion.div>

        <div className="w-full relative">
          <AnimatePresence mode="wait">
            
            {!role ? (
              <motion.div
                key="role-selection"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95, y: -20 }}
                transition={{ duration: 0.4 }}
                className="max-w-2xl mx-auto flex flex-col items-center"
              >
                <h1 className="text-3xl md:text-5xl font-light tracking-tight text-center mb-4">
                  Select your <span className="font-bold">Protocol</span>
                </h1>
                <p className="text-gray-400 text-center mb-12 text-sm md:text-base max-w-md">
                  Authentication gateway. Please identify your operational clearance level to proceed.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
                  
                  {/* Organizer Option */}
                  <div 
                    onClick={() => setRole('organizer')}
                    className="group relative bg-[#111115]/80 backdrop-blur-xl border border-white/10 hover:border-[#D6003C]/50 rounded-[32px] p-8 cursor-pointer overflow-hidden transition-all duration-500 hover:shadow-[0_0_40px_rgba(214,0,60,0.15)] hover:-translate-y-2"
                  >
                    <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
                      <Shield className="w-32 h-32 text-white group-hover:text-[#D6003C] transition-colors" />
                    </div>
                    <div className="relative z-10 flex flex-col h-full">
                      <div className="w-14 h-14 rounded-full bg-white/5 border border-white/10 group-hover:bg-[#D6003C]/10 group-hover:border-[#D6003C]/30 flex items-center justify-center mb-6 transition-colors">
                        <Shield className="w-6 h-6 text-gray-400 group-hover:text-[#D6003C] transition-colors" />
                      </div>
                      <h2 className="text-2xl font-bold mb-2">Organizer</h2>
                      <p className="text-sm text-gray-400 mb-8 flex-1">
                        Full command center access. Manage operations, telemetry, and live deployments.
                      </p>
                      <div className="flex items-center text-[10px] font-bold uppercase tracking-widest text-[#D6003C]">
                        Initialize Command <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-2 transition-transform" />
                      </div>
                    </div>
                  </div>

                  {/* Visitor Option */}
                  <div 
                    onClick={() => setRole('visitor')}
                    className="group relative bg-[#111115]/80 backdrop-blur-xl border border-white/10 hover:border-blue-500/50 rounded-[32px] p-8 cursor-pointer overflow-hidden transition-all duration-500 hover:shadow-[0_0_40px_rgba(59,130,246,0.15)] hover:-translate-y-2"
                  >
                    <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
                      <User className="w-32 h-32 text-white group-hover:text-blue-500 transition-colors" />
                    </div>
                    <div className="relative z-10 flex flex-col h-full">
                      <div className="w-14 h-14 rounded-full bg-white/5 border border-white/10 group-hover:bg-blue-500/10 group-hover:border-blue-500/30 flex items-center justify-center mb-6 transition-colors">
                        <User className="w-6 h-6 text-gray-400 group-hover:text-blue-500 transition-colors" />
                      </div>
                      <h2 className="text-2xl font-bold mb-2">Visitor / Guest</h2>
                      <p className="text-sm text-gray-400 mb-8 flex-1">
                        Access event schedules, maps, and ticketing information. Restricted view.
                      </p>
                      <div className="flex items-center text-[10px] font-bold uppercase tracking-widest text-blue-500">
                        Enter Gateway <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-2 transition-transform" />
                      </div>
                    </div>
                  </div>

                </div>

                {/* Developer Bypass */}
                <div className="mt-16 pt-8 border-t border-white/10 w-full max-w-md flex flex-col items-center gap-3">
                  <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-2 font-bold">Development Mode</p>
                  <button 
                    onClick={handleBypass}
                    disabled={isLoading}
                    className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold transition-all hover:scale-[1.02]"
                  >
                    {isLoading ? (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <>
                        <Zap className="w-4 h-4 text-yellow-500" />
                        Bypass to Existing Event
                      </>
                    )}
                  </button>
                  <button 
                    onClick={() => {
                      setIsLoading(true);
                      setTimeout(() => router.push('/events/new'), 800);
                    }}
                    disabled={isLoading}
                    className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-full bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-500/20 text-yellow-500 text-xs font-bold transition-all hover:scale-[1.02]"
                  >
                    {isLoading ? (
                      <div className="w-4 h-4 border-2 border-yellow-500 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <>
                        <Zap className="w-4 h-4" />
                        Bypass to New Event Flow
                      </>
                    )}
                  </button>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="login-form"
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.4 }}
                className="max-w-md mx-auto w-full"
              >
                <div className={`bg-[#111115]/90 backdrop-blur-2xl border ${role === 'organizer' ? 'border-[#D6003C]/30 shadow-[0_0_50px_rgba(214,0,60,0.1)]' : 'border-blue-500/30 shadow-[0_0_50px_rgba(59,130,246,0.1)]'} rounded-[32px] p-8 md:p-10 relative overflow-hidden`}>
                  
                  {/* Back button */}
                  <button 
                    onClick={() => setRole(null)}
                    className="absolute top-6 left-6 text-gray-400 hover:text-white transition-colors text-xs font-bold uppercase tracking-widest flex items-center gap-1"
                  >
                    &larr; Back
                  </button>
                  
                  <div className="mt-8 mb-8 text-center">
                    <div className={`w-16 h-16 mx-auto rounded-full flex items-center justify-center mb-4 ${role === 'organizer' ? 'bg-[#D6003C]/10 border border-[#D6003C]/20' : 'bg-blue-500/10 border border-blue-500/20'}`}>
                      {role === 'organizer' ? <Shield className="w-8 h-8 text-[#D6003C]" /> : <User className="w-8 h-8 text-blue-500" />}
                    </div>
                    <h2 className="text-2xl font-bold mb-1">
                      {role === 'organizer' 
                        ? (isLogin ? 'Command Login' : 'Establish Command') 
                        : (isLogin ? 'Visitor Access' : 'Visitor Registration')}
                    </h2>
                    <p className="text-sm text-gray-400">
                      Enter your credentials to proceed
                    </p>
                  </div>

                  <form onSubmit={handleLogin} className="space-y-4">
                    <AnimatePresence>
                      {!isLogin && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="space-y-1 overflow-hidden"
                        >
                          <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 ml-4">Full Name</label>
                          <div className="relative">
                            <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                            <input 
                              type="text" 
                              required
                              className="w-full bg-black/50 border border-white/10 rounded-full py-3.5 pl-12 pr-4 text-sm focus:outline-none focus:border-white/30 focus:bg-black transition-all"
                              placeholder="Operative Name"
                            />
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 ml-4">Email Designation</label>
                      <div className="relative">
                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                        <input 
                          type="email" 
                          required
                          className="w-full bg-black/50 border border-white/10 rounded-full py-3.5 pl-12 pr-4 text-sm focus:outline-none focus:border-white/30 focus:bg-black transition-all"
                          placeholder="agent@eventra.io"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 ml-4">Access Key</label>
                      <div className="relative">
                        <KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                        <input 
                          type="password" 
                          required
                          className="w-full bg-black/50 border border-white/10 rounded-full py-3.5 pl-12 pr-4 text-sm focus:outline-none focus:border-white/30 focus:bg-black transition-all"
                          placeholder="••••••••••••"
                        />
                      </div>
                    </div>

                    <div className="pt-4">
                      <button 
                        type="submit"
                        disabled={isLoading}
                        className={`w-full flex items-center justify-center gap-2 py-3.5 rounded-full text-sm font-bold uppercase tracking-widest transition-all ${
                          role === 'organizer' 
                            ? 'bg-[#D6003C] hover:bg-[#D6003C]/90 text-white shadow-[0_0_20px_rgba(214,0,60,0.3)]' 
                            : 'bg-blue-600 hover:bg-blue-700 text-white shadow-[0_0_20px_rgba(59,130,246,0.3)]'
                        } ${isLoading ? 'opacity-80 cursor-not-allowed' : 'hover:scale-[1.02]'}`}
                      >
                        {isLoading ? (
                          <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <>
                            <Lock className="w-4 h-4" /> {isLogin ? 'Authorize' : 'Register'}
                          </>
                        )}
                      </button>
                    </div>

                    <div className="pt-4 text-center">
                      <p className="text-xs text-gray-400">
                        {isLogin ? (role === 'organizer' ? "New commander?" : "Don't have clearance yet?") : (role === 'organizer' ? "Already established?" : "Already hold clearance?")}{' '}
                        <button 
                          type="button"
                          onClick={() => setIsLogin(!isLogin)}
                          className={`font-bold hover:underline transition-colors ${role === 'organizer' ? 'text-[#D6003C]' : 'text-blue-500'}`}
                        >
                          {isLogin ? (role === 'organizer' ? 'Register Command' : 'Request Access') : 'Sign In'}
                        </button>
                      </p>
                    </div>
                  </form>

                </div>

                {/* Developer Bypass */}
                <div className="mt-8 flex flex-col items-center gap-2">
                  <button 
                    onClick={handleBypass}
                    disabled={isLoading}
                    className="w-full flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-[10px] font-bold tracking-widest uppercase transition-all"
                  >
                    <Zap className="w-3 h-3 text-yellow-500" />
                    Bypass Auth &rarr; Existing Event
                  </button>
                  <button 
                    onClick={() => {
                      setIsLoading(true);
                      setTimeout(() => router.push('/events/new'), 800);
                    }}
                    disabled={isLoading}
                    className="w-full flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-500/20 text-yellow-500 text-[10px] font-bold tracking-widest uppercase transition-all"
                  >
                    <Zap className="w-3 h-3" />
                    Bypass Auth &rarr; New Event
                  </button>
                </div>
              </motion.div>
            )}
            
          </AnimatePresence>
        </div>

      </div>
    </div>
  );
}
