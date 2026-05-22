import { Variants } from "motion/react";

// ─── Page Transitions ───
export const pageTransition = {
  initial: { opacity: 0, y: 20, filter: "blur(8px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, y: -10, filter: "blur(4px)" },
  transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] },
};

// ─── Staggered Container ───
export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.1,
    },
  },
};

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 16, scale: 0.96 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring", stiffness: 300, damping: 24 },
  },
};

// ─── Glass Panel Entrance ───
export const glassReveal: Variants = {
  initial: { opacity: 0, backdropFilter: "blur(0px)", scale: 0.95 },
  animate: {
    opacity: 1,
    backdropFilter: "blur(16px)",
    scale: 1,
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
  },
};

// ─── Transfer Progress ───
export const progressBar = {
  initial: { width: "0%", opacity: 0 },
  animate: (progress: number) => ({
    width: `${progress}%`,
    opacity: 1,
    transition: { duration: 0.3, ease: "easeOut" },
  }),
};

// ─── Pulse Glow (connection indicator) ───
export const pulseGlow = {
  animate: {
    boxShadow: [
      "0 0 0 0 rgba(59, 130, 246, 0.4)",
      "0 0 0 12px rgba(59, 130, 246, 0)",
    ],
    transition: { duration: 1.5, repeat: Infinity },
  },
};

// ─── Drop Zone ───
export const dropZone = {
  idle: { scale: 1, borderColor: "rgba(255, 255, 255, 0.1)" },
  active: {
    scale: 1.02,
    borderColor: "rgba(59, 130, 246, 0.6)",
    backgroundColor: "rgba(59, 130, 246, 0.08)",
    transition: { type: "spring", stiffness: 400, damping: 25 },
  },
};

// ─── Notification Toast ───
export const toast: Variants = {
  initial: { opacity: 0, y: -16, x: 20, scale: 0.9 },
  animate: { 
    opacity: 1, 
    y: 0, 
    x: 0, 
    scale: 1,
    transition: { type: "spring", stiffness: 500, damping: 30 }
  },
  exit: { 
    opacity: 0, 
    x: 40, 
    scale: 0.95,
    transition: { type: "spring", stiffness: 500, damping: 30 }
  },
};

// ─── Micro-interactions ───
export const buttonTap = { whileTap: { scale: 0.97 } };
export const buttonHover = { whileHover: { scale: 1.02, y: -1 } };
export const cardHover = {
  whileHover: {
    y: -4,
    boxShadow: "0 0 40px rgba(59, 130, 246, 0.15)",
    transition: { type: "spring", stiffness: 300, damping: 20 },
  },
};
