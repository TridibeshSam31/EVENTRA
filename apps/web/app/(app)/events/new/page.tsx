"use client";

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings, Zap, ArrowRight, Calendar, Users, MapPin, AlignLeft, ShieldCheck, DollarSign, Mic, StopCircle, RadioTower } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function NewEventPage() {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [isDeploying, setIsDeploying] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (isListening) {
      setTranscript('');
      // In a real app, this is where we would initialize the Web Speech API
      // or start recording audio chunks for a backend transcription service.
    }
  }, [isListening]);

  const handleDeploy = (e: React.FormEvent) => {
    e.preventDefault();
    setIsDeploying(true);
    // Simulate deployment process
    setTimeout(() => {
      router.push('/dashboard');
    }, 2000);
  };

  return (
    <div className="w-full h-full relative overflow-hidden text-white font-sans flex items-center justify-center min-h-[70vh]">
      
      {/* Background Blur Overlay for Empty Dashboard Feel */}
      {!isFormOpen && (
        <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm pointer-events-none" />
      )}

      <AnimatePresence mode="wait">
        {!isFormOpen ? (
          <motion.div 
            key="start-modal"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="relative z-50 bg-[#111115] border border-white/10 p-8 rounded-3xl shadow-2xl max-w-md w-full text-center"
          >
            <div className="w-16 h-16 mx-auto rounded-full bg-[#D6003C]/10 border border-[#D6003C]/20 flex items-center justify-center mb-6 shadow-[0_0_30px_rgba(214,0,60,0.2)]">
              <Zap className="w-8 h-8 text-[#D6003C]" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight mb-2">Initialize New Protocol</h2>
            <p className="text-sm text-gray-400 mb-8">
              System ready. Deploy a new event operational matrix.
            </p>
            <button 
              onClick={() => setIsFormOpen(true)}
              className="w-full bg-[#D6003C] hover:bg-[#D6003C]/90 text-white font-bold uppercase tracking-widest text-xs py-4 rounded-full flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(214,0,60,0.3)] transition-all hover:scale-[1.02]"
            >
              Start Initialization <ArrowRight className="w-4 h-4" />
            </button>
          </motion.div>
        ) : (
          <motion.div 
            key="wizard-form"
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative z-50 w-full max-w-3xl bg-[#111115]/95 backdrop-blur-xl border border-white/10 rounded-[32px] p-6 md:p-10 shadow-2xl overflow-y-auto max-h-[85vh] no-scrollbar"
          >
            {!isVoiceMode ? (
              <>
                <div className="flex items-center justify-between mb-8 border-b border-white/10 pb-4">
                  <div>
                    <h2 className="text-2xl font-bold tracking-tight">Deployment Wizard</h2>
                    <p className="text-xs text-gray-400 font-mono mt-1">Step {step} of 3 • {step === 1 ? 'Core Details' : step === 2 ? 'Logistics & Capacity' : 'Financials & Security'}</p>
                  </div>
                  <div className="w-10 h-10 rounded-full border border-white/10 flex items-center justify-center font-bold text-[#D6003C]">
                    {step}/3
                  </div>
                </div>

                <form onSubmit={step === 3 ? handleDeploy : (e) => { e.preventDefault(); setStep(s => s + 1); }} className="space-y-6">
                  
                  {/* STEP 1: Core Details */}
                  {step === 1 && (
                    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="space-y-5">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Operation Name</label>
                        <div className="relative">
                          <Settings className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                          <input required type="text" className="w-full bg-black/50 border border-white/10 rounded-xl py-3 pl-12 pr-4 text-sm focus:outline-none focus:border-[#D6003C]/50 transition-all" placeholder="e.g. Operation: Neon Summit 2026" />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Event Description</label>
                        <div className="relative">
                          <AlignLeft className="absolute left-4 top-4 w-4 h-4 text-gray-500" />
                          <textarea required rows={3} className="w-full bg-black/50 border border-white/10 rounded-xl py-3 pl-12 pr-4 text-sm focus:outline-none focus:border-[#D6003C]/50 transition-all resize-none" placeholder="Primary objective and scope..." />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Start Date</label>
                          <div className="relative">
                            <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                            <input required type="date" className="w-full bg-black/50 border border-white/10 rounded-xl py-3 pl-12 pr-4 text-sm focus:outline-none focus:border-[#D6003C]/50 transition-all text-gray-300" />
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">End Date</label>
                          <div className="relative">
                            <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                            <input required type="date" className="w-full bg-black/50 border border-white/10 rounded-xl py-3 pl-12 pr-4 text-sm focus:outline-none focus:border-[#D6003C]/50 transition-all text-gray-300" />
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {/* STEP 2: Logistics & Capacity */}
                  {step === 2 && (
                    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-5">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Primary Location Coordinates (Venue)</label>
                        <div className="relative">
                          <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                          <input required type="text" className="w-full bg-black/50 border border-white/10 rounded-xl py-3 pl-12 pr-4 text-sm focus:outline-none focus:border-[#D6003C]/50 transition-all" placeholder="Enter venue name or address..." />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Expected Capacity</label>
                          <div className="relative">
                            <Users className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                            <input required type="number" className="w-full bg-black/50 border border-white/10 rounded-xl py-3 pl-12 pr-4 text-sm focus:outline-none focus:border-[#D6003C]/50 transition-all" placeholder="e.g. 5000" />
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Event Classification</label>
                          <select required className="w-full bg-black/50 border border-white/10 rounded-xl py-3 px-4 text-sm focus:outline-none focus:border-[#D6003C]/50 transition-all text-gray-300 appearance-none">
                            <option value="conference">Conference / Summit</option>
                            <option value="festival">Music Festival</option>
                            <option value="corporate">Corporate Retreat</option>
                            <option value="exhibition">Trade Exhibition</option>
                          </select>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {/* STEP 3: Financials & Security */}
                  {step === 3 && (
                    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-5">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Total Allocated Budget ($)</label>
                        <div className="relative">
                          <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                          <input required type="number" className="w-full bg-black/50 border border-white/10 rounded-xl py-3 pl-12 pr-4 text-sm focus:outline-none focus:border-[#D6003C]/50 transition-all" placeholder="e.g. 150000" />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Security Clearance Level</label>
                        <div className="relative">
                          <ShieldCheck className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                          <select required className="w-full bg-black/50 border border-white/10 rounded-xl py-3 pl-12 pr-4 text-sm focus:outline-none focus:border-[#D6003C]/50 transition-all text-gray-300 appearance-none">
                            <option value="standard">Standard (Public Access)</option>
                            <option value="elevated">Elevated (Ticketed / ID Required)</option>
                            <option value="maximum">Maximum (VIP / Government)</option>
                          </select>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  <div className="pt-6 border-t border-white/10 flex flex-col md:flex-row items-center justify-between gap-4">
                    <div className="flex items-center gap-3 w-full md:w-auto">
                      {step > 1 ? (
                        <button type="button" onClick={() => setStep(s => s - 1)} className="px-6 py-2.5 rounded-full bg-white/5 hover:bg-white/10 text-xs font-bold uppercase tracking-widest transition-all">
                          Back
                        </button>
                      ) : <div className="hidden md:block" />}
                      
                      {step === 1 && (
                        <button 
                          type="button" 
                          onClick={() => { setIsVoiceMode(true); setIsListening(true); }} 
                          className="px-6 py-2.5 rounded-full bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 text-purple-400 text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 transition-all group"
                        >
                          <Mic className="w-3.5 h-3.5 group-hover:scale-110 transition-transform" />
                          Speak to Explain
                        </button>
                      )}
                    </div>
                    
                    <button type="submit" disabled={isDeploying} className="w-full md:w-auto px-8 py-3 rounded-full bg-[#D6003C] hover:bg-[#D6003C]/90 text-white text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(214,0,60,0.3)] transition-all hover:scale-[1.02]">
                      {isDeploying ? (
                         <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : step === 3 ? (
                         <>Deploy Protocol <Zap className="w-4 h-4" /></>
                      ) : (
                         <>Proceed <ArrowRight className="w-4 h-4" /></>
                      )}
                    </button>
                  </div>

                </form>
              </>
            ) : (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }} 
                animate={{ opacity: 1, scale: 1 }} 
                className="flex flex-col items-center justify-center min-h-[400px] text-center relative"
              >
                {/* Voice Mode Border Pulse */}
                <div className={`absolute inset-0 border-2 rounded-[32px] pointer-events-none transition-colors duration-500 ${isListening ? 'border-purple-500/50 shadow-[0_0_50px_rgba(168,85,247,0.15)] animate-pulse' : 'border-white/10'}`} />
                
                <div className="absolute top-6 right-6">
                   <div className="flex items-center gap-2 text-[10px] font-mono text-purple-400">
                     <RadioTower className={`w-4 h-4 ${isListening ? 'animate-bounce' : ''}`} />
                     {isListening ? 'LISTENING_MODE: ACTIVE' : 'PROCESSING_AUDIO'}
                   </div>
                </div>

                <div className="relative mb-8 mt-10">
                  {isListening && (
                    <>
                      <div className="absolute inset-0 bg-purple-500 rounded-full animate-ping opacity-20" />
                      <div className="absolute inset-[-20px] bg-purple-500 rounded-full animate-ping opacity-10" style={{ animationDelay: '0.2s' }} />
                    </>
                  )}
                  <div className={`w-24 h-24 rounded-full flex items-center justify-center relative z-10 transition-colors duration-500 ${isListening ? 'bg-purple-500 shadow-[0_0_40px_rgba(168,85,247,0.5)]' : 'bg-gray-800'}`}>
                    <Mic className="w-10 h-10 text-white" />
                  </div>
                </div>

                <h2 className="text-2xl font-bold mb-4">
                  {isListening ? 'Explain your event...' : 'Generating parameters...'}
                </h2>
                
                <div className="w-full max-w-lg bg-black/40 border border-white/5 rounded-xl p-6 min-h-[120px] mb-10 text-left font-mono text-sm text-gray-300 leading-relaxed shadow-inner">
                  {transcript || (isListening ? <span className="animate-pulse text-gray-500">Awaiting audio input...</span> : '')}
                </div>

                <div className="flex items-center gap-4">
                  {isListening ? (
                    <button 
                      onClick={() => setIsListening(false)}
                      className="px-8 py-3 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs font-bold uppercase tracking-widest flex items-center gap-2 transition-all"
                    >
                      <StopCircle className="w-4 h-4" /> Stop Recording
                    </button>
                  ) : (
                    <button 
                      onClick={() => { setIsVoiceMode(false); setStep(3); }}
                      className="px-8 py-3 rounded-full bg-purple-500 hover:bg-purple-600 text-white text-xs font-bold uppercase tracking-widest flex items-center gap-2 shadow-[0_0_20px_rgba(168,85,247,0.4)] transition-all"
                    >
                      Apply Parameters <ArrowRight className="w-4 h-4" />
                    </button>
                  )}
                  
                  <button 
                    onClick={() => { setIsVoiceMode(false); setIsListening(false); }}
                    className="px-4 py-3 rounded-full text-gray-500 hover:text-white text-xs font-bold uppercase tracking-widest transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
