"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Copy, CheckCircle, QrCode } from "lucide-react";
import QRCode from "qrcode";

interface QRCodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  url: string;
  roomCode?: string;
}

export default function QRCodeModal({ isOpen, onClose, url, roomCode }: QRCodeModalProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);

  useEffect(() => {
    if (!isOpen || !url) return;

    QRCode.toDataURL(url, {
      width: 280,
      margin: 2,
      color: {
        dark: "#F5F2EB", // Bone modules
        light: "#1A1715", // Deep Card Background
      },
      errorCorrectionLevel: "M",
    })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [isOpen, url]);

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(url).catch(() => {});
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/75 backdrop-blur-xs"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            className="relative sc-glass rounded-3xl p-8 max-w-sm w-full space-y-6 border border-border-glass shadow-elegant"
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
          >
            {/* Close Button */}
            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-1.5 rounded-lg bg-bg-tertiary hover:bg-bg-secondary border border-border-glass transition-all cursor-pointer"
            >
              <X className="w-4 h-4 text-text-muted hover:text-text-primary" />
            </button>

            {/* Header */}
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-bg-tertiary border border-border-glass">
                <QrCode className="w-5 h-5 text-accent-primary" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-text-primary uppercase tracking-wider font-mono">Room Invite</h3>
                <p className="text-[9px] font-mono font-bold tracking-widest text-text-muted uppercase">
                  Scan to connect
                </p>
              </div>
            </div>

            {/* QR Code container */}
            <div className="flex items-center justify-center">
              {qrDataUrl ? (
                <div className="p-3.5 bg-bg-tertiary rounded-2xl border border-border-glass shadow-elegant">
                  <img
                    src={qrDataUrl}
                    alt="Room QR Code"
                    className="w-[240px] h-[240px] rounded-xl"
                  />
                </div>
              ) : (
                <div className="w-[240px] h-[240px] flex items-center justify-center bg-bg-tertiary rounded-2xl border border-border-glass shadow-elegant">
                  <div className="w-6 h-6 border-2 border-accent-primary/30 border-t-accent-primary rounded-full animate-spin" />
                </div>
              )}
            </div>

            {/* Room Code */}
            {roomCode && (
              <div className="text-center space-y-1">
                <span className="text-[9px] font-mono font-bold tracking-widest text-text-muted uppercase block">
                  Room Code
                </span>
                <span className="text-lg font-mono font-bold text-accent-primary tracking-widest">
                  {roomCode}
                </span>
              </div>
            )}

            {/* URL + Copy */}
            <div className="flex items-center gap-2">
              <div className="flex-grow px-3 py-2.5 bg-bg-secondary/40 border border-border-glass rounded-xl text-xs font-mono text-text-secondary truncate">
                {url}
              </div>
              <button
                onClick={handleCopyUrl}
                className="shrink-0 p-2.5 bg-bg-tertiary hover:bg-bg-secondary border border-border-glass rounded-xl transition-all cursor-pointer text-text-muted hover:text-text-primary"
                title="Copy URL"
              >
                {isCopied ? (
                  <CheckCircle className="w-4 h-4 text-accent-success" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
