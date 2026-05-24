"use client";

import { motion, AnimatePresence } from "motion/react";
import { AlertTriangle, Shield, X } from "lucide-react";

interface ConfirmDialogProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'default';
}

const variantStyles = {
  danger: {
    icon: <AlertTriangle className="w-5 h-5 text-accent-danger" />,
    confirmButton: 'bg-red-500/10 hover:bg-red-500/20 text-accent-danger border border-red-500/20 hover:border-red-500/30',
    iconBorder: 'border-accent-danger/20',
  },
  default: {
    icon: <Shield className="w-5 h-5 text-accent-primary" />,
    confirmButton: 'bg-text-primary hover:bg-accent-primary text-bg-primary border-0',
    iconBorder: 'border-accent-primary/20',
  },
};

export default function ConfirmDialog({
  isOpen,
  onConfirm,
  onCancel,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
}: ConfirmDialogProps) {
  const styles = variantStyles[variant];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[150] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
        >
          <motion.div
            className="absolute inset-0 bg-black/75 backdrop-blur-xs"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onCancel}
          />

          <motion.div
            className="relative sc-glass rounded-3xl p-6 max-w-sm w-full space-y-5 border border-border-glass shadow-elegant"
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
          >
            <button
              onClick={onCancel}
              className="absolute top-4 right-4 p-1.5 rounded-lg bg-bg-tertiary hover:bg-bg-secondary border border-border-glass transition-all cursor-pointer"
            >
              <X className="w-4 h-4 text-text-muted hover:text-text-primary" />
            </button>

            <div className="flex items-center gap-3">
              <div className={`flex items-center justify-center w-10 h-10 rounded-xl bg-bg-tertiary border ${styles.iconBorder}`}>
                {styles.icon}
              </div>
              <h3 id="confirm-dialog-title" className="text-sm font-bold text-text-primary uppercase tracking-wider font-mono">
                {title}
              </h3>
            </div>

            <p className="text-xs text-text-secondary leading-relaxed font-sans">
              {message}
            </p>

            <div className="flex items-center gap-3">
              <button
                onClick={onCancel}
                className="flex-1 py-2.5 px-4 bg-bg-tertiary hover:bg-bg-secondary border border-border-glass rounded-xl text-xs font-mono font-bold text-text-primary transition-all cursor-pointer"
              >
                {cancelLabel}
              </button>
              <button
                onClick={onConfirm}
                className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-mono font-bold transition-all cursor-pointer ${styles.confirmButton}`}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
