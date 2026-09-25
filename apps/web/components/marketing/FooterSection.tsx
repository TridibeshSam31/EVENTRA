"use client";

import React from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

export default function FooterSection() {
  return (
    <footer className="w-full min-h-screen bg-[#FBFBFA] text-[#111] flex flex-col justify-between px-6 md:px-12 py-10 relative z-20 font-sans">
      {/* Top Bar */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center w-full mb-16 md:mb-0 gap-8 md:gap-0">
        <div className="font-bold tracking-widest uppercase text-sm">
          EVENTRA
        </div>
      </div>

      {/* Huge Typography Section */}
      <div className="w-full flex-1 flex flex-col justify-center my-16 md:my-0">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-start w-full leading-[0.85] tracking-tighter uppercase font-black">
          <div className="text-[16vw] md:text-[9.5vw] m-0">
            ADAPTIVE
          </div>
          <div className="text-[16vw] md:text-[9.5vw] m-0 md:text-right mt-2 md:mt-0">
            EVENTS
          </div>
        </div>
        <div className="text-[16vw] md:text-[9.5vw] font-black leading-[0.85] tracking-tighter uppercase m-0">
          OPERATIONS
        </div>
      </div>

      {/* Divider */}
      <div className="w-full h-[1px] bg-black/10 my-16 md:my-20" />

      {/* Links & Information Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-12 w-full mb-16 md:mb-24 text-[13px] md:text-[15px] font-medium">
        
        {/* Socials */}
        <div>
          <p className="text-black/40 mb-6 font-medium">S:</p>
          <ul className="flex flex-col gap-3">
            <li>
              <Link href="#" className="underline underline-offset-4 decoration-black/20 hover:decoration-black transition-colors flex items-center gap-1 w-fit">
                Instagram <ArrowUpRight className="w-3 h-3 opacity-50" />
              </Link>
            </li>
            <li>
              <Link href="#" className="underline underline-offset-4 decoration-black/20 hover:decoration-black transition-colors flex items-center gap-1 w-fit">
                X (Twitter) <ArrowUpRight className="w-3 h-3 opacity-50" />
              </Link>
            </li>
            <li>
              <Link href="#" className="underline underline-offset-4 decoration-black/20 hover:decoration-black transition-colors flex items-center gap-1 w-fit">
                LinkedIn <ArrowUpRight className="w-3 h-3 opacity-50" />
              </Link>
            </li>
          </ul>
        </div>

        {/* Location & Email */}
        <div>
          <p className="text-black/40 mb-6 font-medium">L:</p>
          <ul className="flex flex-col gap-1 mb-8 opacity-80">
            <li>100 Avenue of the Americas</li>
            <li>New York, NY 10013</li>
            <li>United States</li>
          </ul>

          <p className="text-black/40 mb-4 font-medium">E:</p>
          <Link href="mailto:hello@eventra.com" className="underline underline-offset-4 decoration-black/20 hover:decoration-black transition-colors">
            hello@eventra.com
          </Link>
        </div>

        {/* Menu (Offset for spacing in desktop) */}
        <div className="md:col-start-4">
          <p className="text-black/40 mb-6 font-medium">M:</p>
          <ul className="flex flex-col gap-3">
            <li>
              <Link href="#" className="underline underline-offset-4 decoration-black/20 hover:decoration-black transition-colors">
                Home
              </Link>
            </li>
            <li>
              <Link href="#" className="underline underline-offset-4 decoration-black/20 hover:decoration-black transition-colors">
                Services
              </Link>
            </li>
            <li>
              <Link href="#" className="underline underline-offset-4 decoration-black/20 hover:decoration-black transition-colors">
                Our Work
              </Link>
            </li>
            <li>
              <Link href="#" className="underline underline-offset-4 decoration-black/20 hover:decoration-black transition-colors">
                About Us
              </Link>
            </li>
            <li>
              <Link href="#" className="underline underline-offset-4 decoration-black/20 hover:decoration-black transition-colors">
                Insights
              </Link>
            </li>
            <li>
              <Link href="#" className="underline underline-offset-4 decoration-black/20 hover:decoration-black transition-colors">
                Contact
              </Link>
            </li>
          </ul>
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="flex flex-col md:flex-row justify-between items-center w-full text-[13px] font-medium text-black/50 gap-6 md:gap-0 pt-6">
        <div className="font-bold tracking-widest uppercase text-black text-lg">
          Eventra
        </div>
        <div className="flex gap-2 items-center">
          © Eventra 2026. 
          <Link href="#" className="underline hover:text-black transition-colors ml-2">
            Legal terms
          </Link>
        </div>
        <div>
          Website architecture by <span className="text-black">Aniket</span>
        </div>
      </div>
    </footer>
  );
}
