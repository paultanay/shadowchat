"use client";

import { motion, AnimatePresence } from "motion/react";
import { CheckCircle, AlertTriangle, Shield, X } from "lucide-react";
import { useUIStore } from "@/stores/uiStore";

const iconMap = {
  success: <CheckCircle className="w-5 h-5 text-accent-success shrink-0" />,
  error: <AlertTriangle className="w-5 h-5 text-accent-danger shrink-0" />,
  warning: <AlertTriangle className="w-5 h-5 text-accent-warning shrink-0" />,
  info: <Shield className="w-5 h-5 text-accent-primary shrink-0" />,
} as const;

const borderColorMap = {
  success: "border-accent-success/30",
  error: "border-accent-danger/30",
  warning: "border-accent-warning/30",
  info: "border-accent-primary/30",
} as const;

export default function ToastContainer() {
  const { notifications, dismissToast } = useUIStore();

  return (
    <div className="fixed bottom-6 right-6 z-[200] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      <AnimatePresence>
        {notifications.map((n) => (
          <motion.div
            key={n.id}
            initial={{ opacity: 0, y: 20, x: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
            className={`p-4 sc-glass-card rounded-2xl flex items-start gap-3 pointer-events-auto cursor-pointer border ${borderColorMap[n.type]}`}
            onClick={() => dismissToast(n.id)}
          >
            {iconMap[n.type]}
            <div className="flex-grow flex flex-col gap-0.5 min-w-0">
              <span className="text-xs font-bold text-text-primary leading-none">
                {n.title}
              </span>
              <span className="text-[11px] text-text-secondary leading-relaxed">
                {n.message}
              </span>
            </div>
            <button
              className="shrink-0 p-1 rounded-md hover:bg-bg-tertiary transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                dismissToast(n.id);
              }}
            >
              <X className="w-3.5 h-3.5 text-text-muted" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
