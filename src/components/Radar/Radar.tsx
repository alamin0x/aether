"use client";

import React from "react";
import { motion } from "framer-motion";

export const Radar = () => {
  return (
    <div className="relative flex items-center justify-center w-[80vw] h-[80vw] max-w-[600px] max-h-[600px] aspect-square">
      {/* Concentric Rings */}
      {[0.2, 0.4, 0.6, 0.8, 1].map((scale, i) => (
        <div
          key={i}
          className="absolute rounded-full border border-accent/20"
          style={{
            width: `${scale * 100}%`,
            height: `${scale * 100}%`,
          }}
        />
      ))}

      {/* Crosshairs */}
      <div className="absolute w-full h-[1px] bg-accent/10" />
      <div className="absolute h-full w-[1px] bg-accent/10" />

      {/* Rotating Scanner */}
      <motion.div
        className="absolute w-1/2 h-1/2 origin-bottom-right z-10 pointer-events-none"
        style={{
          top: 0,
          left: 0,
          background: "conic-gradient(from 180deg at 100% 100%, transparent 0deg, rgba(0, 242, 255, 0.15) 90deg, transparent 100deg)",
          willChange: "transform",
        }}
        animate={{ rotate: 360 }}
        transition={{
          duration: 4,
          repeat: Infinity,
          ease: "linear",
        }}
      />
      
      {/* Scanning Pulse */}
      <div className="absolute inset-0 rounded-full border border-accent/10 animate-pulse pointer-events-none" />

      {/* Center Point */}
      <div className="absolute w-2 h-2 bg-accent rounded-full shadow-[0_0_10px_#00f2ff]" />
      <div className="absolute w-4 h-4 border border-accent rounded-full animate-ping" />
    </div>
  );
};
