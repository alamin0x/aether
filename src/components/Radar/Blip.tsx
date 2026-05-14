"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { User } from "lucide-react";

interface BlipProps {
  id: string;
  name: string;
  isTransferring?: boolean;
  isReady?: boolean;
  progress?: number;
}

export const Blip = ({ name, isTransferring, isReady, progress = 0 }: BlipProps) => {
  return (
    <div className="relative group">
      {/* Drop Zone Highlight */}
      <div className={`absolute -inset-8 rounded-full border transition-all duration-300 ${isReady ? 'border-accent/40 bg-accent/5' : 'border-accent/0 group-hover:border-accent/20'}`} />
      
      {/* The Blip Dot */}
      <div className="relative">
        <div className={`w-3 h-3 rounded-full shadow-[0_0_8px_#00f2ff] transition-colors ${isReady ? 'bg-accent' : 'bg-white/20'}`} />
        {isReady && <div className="absolute inset-0 w-3 h-3 bg-accent rounded-full animate-ping opacity-50" />}
        
        {/* Progress Ring (visible during transfer) */}
        {isTransferring && (
          <svg className="absolute -inset-2 w-7 h-7 -rotate-90">
            <circle
              cx="14"
              cy="14"
              r="10"
              fill="none"
              stroke="rgba(0, 242, 255, 0.2)"
              strokeWidth="2"
            />
            <motion.circle
              cx="14"
              cy="14"
              r="10"
              fill="none"
              stroke="#00f2ff"
              strokeWidth="2"
              strokeDasharray="62.8"
              initial={{ strokeDashoffset: 62.8 }}
              animate={{ strokeDashoffset: 62.8 - (62.8 * progress) / 100 }}
              transition={{ duration: 0.3 }}
            />
          </svg>
        )}
      </div>

      {/* Label (Permanently Visible) */}
      <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 transition-all duration-200 pointer-events-none">
        <div className="bg-black/40 backdrop-blur-md border border-accent/20 px-2 py-0.5 rounded text-[9px] whitespace-nowrap text-accent/90 font-mono tracking-wider uppercase shadow-[0_0_10px_rgba(0,242,255,0.1)]">
          {name}
        </div>
      </div>
    </div>
  );
};
