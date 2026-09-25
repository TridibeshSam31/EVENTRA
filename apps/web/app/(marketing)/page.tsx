"use client";

import React from 'react';
import Link from 'next/link';
import { motion, AnimatePresence, useScroll, useTransform } from 'framer-motion';
import { ArrowRight, ArrowDown } from 'lucide-react';
import { EncryptedText } from '../../components/ui/encrypted-text';
import BlueprintSection from '../../components/marketing/BlueprintSection';
import FeaturesScrollSection from '../../components/marketing/FeaturesScrollSection';
import ServicesSection from '../../components/marketing/ServicesSection';
import FooterSection from '../../components/marketing/FooterSection';

const WORDS = ["DETECT", "RECOVER", "ADAPT", "ORCHESTRATE", "ANTICIPATE"];

export default function LandingPage() {
  const [currentWordIndex, setCurrentWordIndex] = React.useState(0);
  const { scrollY } = useScroll();

  const navWidth = useTransform(scrollY, [0, 150], ["95%", "70%"]);
  const navMaxWidth = useTransform(scrollY, [0, 150], ["1200px", "850px"]);
  const navPadding = useTransform(scrollY, [0, 150], ["16px 24px", "8px 20px"]);
  const navTop = useTransform(scrollY, [0, 150], ["24px", "16px"]);

  React.useEffect(() => {
    const interval = setInterval(() => {
      setCurrentWordIndex((prev) => (prev + 1) % WORDS.length);
    }, 4000); // Change word every 4 seconds
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-[#0E0E10] text-[#F7F7F5] selection:bg-[#D6003C] selection:text-white relative font-sans">
      
      {/* Background radial glow */}
      <div 
        className="absolute top-[30%] left-[10%] w-[400px] h-[400px] rounded-full pointer-events-none z-0"
        style={{
          background: 'radial-gradient(circle, rgba(214,0,60,0.1) 0%, rgba(214,0,60,0) 70%)'
        }}
      />

      {/* Floating Navbar */}
      <motion.header 
        style={{ top: navTop }}
        className="fixed left-0 w-full z-50 flex justify-center px-6 transition-all"
      >
        <motion.div 
          style={{ width: navWidth, maxWidth: navMaxWidth, padding: navPadding }}
          className="flex items-center justify-between gap-10 rounded-full bg-black/30 backdrop-blur-md border border-white/10 shadow-[4px_4px_0px_rgba(255,255,255,0.05)] text-white"
        >
          <div className="flex items-center gap-3 font-bold tracking-widest uppercase text-sm pl-2 flex-shrink-0 group cursor-pointer">
             <div className="w-8 h-8 rounded-full bg-[#D6003C] flex items-center justify-center border border-transparent shadow-[0_0_15px_rgba(214,0,60,0.5)] group-hover:scale-105 transition-transform">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="square" strokeLinejoin="miter">
                  <polygon points="12 2 2 7 2 17 12 22 22 17 22 7"></polygon>
                  <circle cx="12" cy="12" r="3" fill="white"></circle>
                </svg>
             </div>
             <span className="group-hover:text-white transition-colors">Eventra</span>
          </div>
          <nav className="hidden md:flex items-center justify-center gap-8 text-[11px] font-bold uppercase tracking-widest text-gray-500 flex-1 whitespace-nowrap overflow-hidden">
            <Link href="#" className="hover:text-white transition-colors">Home</Link>
            <Link href="#" className="hover:text-white transition-colors">Projects</Link>
            <Link href="#" className="hover:text-white transition-colors">About</Link>
            <Link href="#" className="hover:text-white transition-colors">Services</Link>
            <Link href="#" className="hover:text-white transition-colors">FAQs</Link>
            <Link href="#" className="hover:text-white transition-colors">Careers</Link>
          </nav>
          <Link href="/auth" className="hidden sm:inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest rounded-full bg-[#D6003C] text-white px-6 py-3 transition-colors border border-transparent hover:border-white hover:bg-white hover:text-black flex-shrink-0">
            Initialize event <ArrowRight className="w-4 h-4" />
          </Link>
        </motion.div>
      </motion.header>

      <main className="relative z-10 flex flex-col items-center pt-[22vh] px-6 sm:px-12 max-w-6xl mx-auto min-h-screen">
        
        {/* Top Status Bar */}
        <div className="w-full flex justify-between items-center text-[10px] font-bold tracking-[0.15em] text-[#6F6A72] uppercase mb-12">
          <div className="flex items-center gap-3">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#22C55E] opacity-75"></span>
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#22C55E] shadow-[0_0_8px_#22C55E]"></span>
            </span>
            <span>Available for new events</span>
          </div>
          <div className="hidden md:block text-[#D6003C]">
            ● SOFTWARE, AI & DESIGN
          </div>
          <div>
            2026 EDITION
          </div>
        </div>

        {/* Huge Animated Text */}
        <div className="flex-1 flex items-center justify-center min-h-[300px] w-full mb-16 relative">
           <AnimatePresence mode="wait">
             <motion.div
               key={WORDS[currentWordIndex]}
               initial={{ opacity: 0 }}
               animate={{ opacity: 1 }}
               exit={{ opacity: 0 }}
               transition={{ duration: 0.5 }}
               className="text-center flex justify-center items-center w-full"
             >
                <EncryptedText
                  text={WORDS[currentWordIndex]}
                  revealDelayMs={70}
                  flipDelayMs={30}
                  className="font-bold font-[family-name:var(--font-merriweather)] text-[clamp(50px,10vw,150px)] tracking-tighter leading-none"
                  encryptedClassName="text-[#D6003C] opacity-70 drop-shadow-[0_0_15px_rgba(214,0,60,0.5)]"
                  revealedClassName="text-white drop-shadow-[0_0_20px_rgba(255,255,255,0.2)]"
                  style={{
                    WebkitMaskImage: 'radial-gradient(circle, black 35%, transparent 40%)',
                    WebkitMaskSize: '6px 6px',
                    maskImage: 'radial-gradient(circle, black 35%, transparent 40%)',
                    maskSize: '6px 6px',
                  }}
                />
             </motion.div>
           </AnimatePresence>
        </div>

        {/* Bottom Content Grid */}
        <div className="w-full grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-12 lg:gap-20 items-end pb-12">
          <div className="max-w-[48ch]">
            <h1 className="text-[32px] sm:text-[36px] font-extrabold leading-[1.05] tracking-tight text-white m-0 mb-6">
              Plan, run, and adapt<br/>event operations.
            </h1>
            
            <p className="text-[#C9C4CB] text-[16px] sm:text-[18px] font-medium leading-[1.5] mb-8 max-w-[42ch]">
              We help event organizers scale with strong flows, conversion-ready dashboards, and integrated tech, AI, design, and automation solutions.
            </p>
            
            <div className="flex flex-wrap items-center gap-4">
              <Link 
                href="/dashboard"
                className="inline-flex items-center gap-2 text-[14px] font-bold rounded-full text-white transition-all duration-300 hover:scale-105 hover:shadow-[0_12px_28px_rgba(214,0,60,0.4)]"
                style={{
                  background: '#D6003C',
                  padding: '12px 24px',
                }}
              >
                <span>Initialize Event</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
              
              <Link 
                href="#features"
                className="inline-flex items-center gap-2 text-[14px] font-bold rounded-full text-[#F7F7F5] transition-colors hover:bg-white/5"
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(247,247,245,0.18)',
                  padding: '12px 20px'
                }}
              >
                <span>Our Work</span>
                <ArrowDown className="w-4 h-4 text-[#F7F7F5]" />
              </Link>
            </div>
          </div>

          <div className="hidden lg:flex flex-col items-end gap-3 pb-2">
            <span className="text-[9.5px] font-bold uppercase tracking-[0.18em] text-[#5A555C]">
              Move to push · Click to detonate
            </span>
            <div className="flex flex-col items-end gap-2 mt-2">
              <span className="text-[9.5px] font-bold uppercase tracking-[0.18em] text-[#6F6A72]">
                Behaviour
              </span>
              <div className="flex gap-[3px] rounded-full p-[3px] bg-white/[0.05] border border-white/10">
                <button className="rounded-full px-[15px] py-2 text-[10.5px] font-bold uppercase tracking-[0.1em] bg-[#D6003C] text-white transition-all">
                  Form
                </button>
                <button className="rounded-full px-[15px] py-2 text-[10.5px] font-bold uppercase tracking-[0.1em] bg-transparent text-[#9C96A0] hover:text-white transition-all">
                  Drift
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>

      <BlueprintSection />
      <FeaturesScrollSection />
      <ServicesSection />
      <FooterSection />
    </div>
  );
}
