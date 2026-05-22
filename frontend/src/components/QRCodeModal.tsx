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
        dark: "#F8FAFC",
        light: "#0A0E1A",
      },
      errorCorrectionLevel: "M",
    })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [isOpen, url]);

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(url);
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
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            className="relative sc-glass rounded-2xl p-8 max-w-sm w-full space-y-6"
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
          >
            {/* Close Button */}
            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-1.5 rounded-lg bg-bg-secondary hover:bg-bg-tertiary border border-border-glass transition-all cursor-pointer"
            >
              <X className="w-4 h-4 text-text-muted" />
            </button>

            {/* Header */}
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-accent-primary/10 border border-accent-primary/30">
                <QrCode className="w-5 h-5 text-accent-primary" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-text-primary">Chamber Invite</h3>
                <p className="text-[10px] font-bold tracking-widest text-text-muted uppercase">
                  Scan to join
                </p>
              </div>
            </div>

            {/* QR Code */}
            <div className="flex items-center justify-center">
              {qrDataUrl ? (
                <div className="p-3 bg-bg-secondary rounded-xl border border-border-glass">
                  <img
                    src={qrDataUrl}
                    alt="Room QR Code"
                    className="w-[240px] h-[240px] rounded-lg"
                  />
                </div>
              ) : (
                <div className="w-[240px] h-[240px] flex items-center justify-center bg-bg-secondary rounded-xl border border-border-glass">
                  <div className="w-8 h-8 border-2 border-accent-primary/30 border-t-accent-primary rounded-full animate-spin" />
                </div>
              )}
            </div>

            {/* Room Code */}
            {roomCode && (
              <div className="text-center">
                <span className="text-[10px] font-bold tracking-widest text-text-muted uppercase block mb-1">
                  Chamber Code
                </span>
                <span className="text-lg font-mono font-bold text-accent-primary tracking-widest">
                  {roomCode}
                </span>
              </div>
            )}

            {/* URL + Copy */}
            <div className="flex items-center gap-2">
              <div className="flex-grow px-3 py-2 bg-bg-secondary/50 border border-border-glass rounded-lg text-xs font-mono text-text-secondary truncate">
                {url}
              </div>
              <button
                onClick={handleCopyUrl}
                className="shrink-0 p-2.5 bg-bg-tertiary hover:bg-bg-secondary border border-border-glass rounded-lg transition-all cursor-pointer"
                title="Copy URL"
              >
                {isCopied ? (
                  <CheckCircle className="w-4 h-4 text-accent-success" />
                ) : (
                  <Copy className="w-4 h-4 text-text-muted" />
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
