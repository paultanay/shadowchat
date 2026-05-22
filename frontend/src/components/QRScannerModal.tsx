"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Camera, AlertTriangle, ShieldAlert } from "lucide-react";
import jsQR from "jsqr";

interface QRScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanSuccess: (roomCode: string, roomKey?: string) => void;
}

export default function QRScannerModal({ isOpen, onClose, onScanSuccess }: QRScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    setCameraError(null);
    setIsScanning(true);

    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" }
        });
        streamRef.current = stream;
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.setAttribute("playsinline", "true"); // required for iOS
          videoRef.current.play();
          
          // Start the scanning loop once video is loaded
          videoRef.current.onloadedmetadata = () => {
            startScanLoop();
          };
        }
      } catch (err: any) {
        console.error("Camera access failed:", err);
        setCameraError(
          err.name === "NotAllowedError" 
            ? "Camera permission denied. Please enable camera access in your browser settings to scan QR codes."
            : "Could not access camera. Please check your camera connection and try again."
        );
        setIsScanning(false);
      }
    };

    startCamera();

    return () => {
      stopCamera();
    };
  }, [isOpen]);

  const stopCamera = () => {
    setIsScanning(false);
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const startScanLoop = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    const scan = () => {
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        // Match canvas dimensions to video
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: "dontInvert",
        });

        if (code) {
          // Successfully read QR code!
          const resultUrl = code.data;
          console.log("QR Code read successfully:", resultUrl);
          
          try {
            // Expected URL format: https://shadowchat.local/room/ROOM_CODE#key=KEY
            // Or relative /room/ROOM_CODE#key=KEY
            const parsedUrl = new URL(resultUrl, window.location.origin);
            const pathParts = parsedUrl.pathname.split("/");
            const roomCode = pathParts[pathParts.length - 1];
            
            const hash = parsedUrl.hash;
            let roomKey = undefined;
            if (hash && hash.startsWith("#key=")) {
              roomKey = hash.substring(5);
            }
            
            if (roomCode) {
              stopCamera();
              onScanSuccess(roomCode, roomKey);
              onClose();
              return;
            }
          } catch (e) {
            // If QR code is not a URL, try treating the whole text as the room code
            if (resultUrl && resultUrl.length >= 6 && resultUrl.length <= 40) {
              stopCamera();
              onScanSuccess(resultUrl.trim());
              onClose();
              return;
            }
          }
        }
      }
      
      if (isScanning) {
        animationFrameRef.current = requestAnimationFrame(scan);
      }
    };

    animationFrameRef.current = requestAnimationFrame(scan);
  };

  const handleClose = () => {
    stopCamera();
    onClose();
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
            className="absolute inset-0 bg-black/80 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
          />

          {/* Modal Container */}
          <motion.div
            className="relative sc-glass rounded-3xl p-6 sm:p-8 max-w-md w-full space-y-6 overflow-hidden border border-border-glass"
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
          >
            {/* Ambient neon decorative backglow */}
            <div className="absolute -top-12 -left-12 w-32 h-32 bg-accent-primary/10 rounded-full blur-2xl pointer-events-none" />

            {/* Header */}
            <div className="flex items-center justify-between pb-2">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-accent-primary/10 border border-accent-primary/30">
                  <Camera className="w-5 h-5 text-accent-primary" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-text-primary">Room Scan</h3>
                  <p className="text-[10px] font-bold tracking-widest text-text-muted uppercase">
                    Scan invite QR code
                  </p>
                </div>
              </div>
              <button
                onClick={handleClose}
                className="p-2 rounded-xl bg-bg-secondary hover:bg-bg-tertiary border border-border-glass transition-all cursor-pointer"
              >
                <X className="w-4 h-4 text-text-muted" />
              </button>
            </div>

            {/* Scanner Viewer */}
            <div className="relative aspect-square w-full rounded-2xl overflow-hidden bg-bg-secondary/40 border border-border-glass flex flex-col items-center justify-center">
              {cameraError ? (
                <div className="p-6 text-center space-y-4 max-w-xs">
                  <div className="inline-flex p-3 rounded-full bg-red-500/10 border border-red-500/20 text-accent-danger">
                    <ShieldAlert className="w-8 h-8" />
                  </div>
                  <h4 className="font-bold text-sm text-text-primary">Camera Connection Failed</h4>
                  <p className="text-xs text-text-secondary leading-relaxed">{cameraError}</p>
                </div>
              ) : (
                <>
                  {/* Video Element */}
                  <video
                    ref={videoRef}
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                  
                  {/* Hidden Canvas for Frame Processing */}
                  <canvas ref={canvasRef} className="hidden" />

                  {/* Cyber/Neon Target Framing Overlay */}
                  <div className="absolute inset-0 pointer-events-none border-[24px] border-black/40 flex items-center justify-center">
                    <div className="relative w-48 h-48 border border-white/20 rounded-xl">
                      {/* L-Shape Corner brackets */}
                      <div className="absolute -top-1.5 -left-1.5 w-6 h-6 border-t-4 border-l-4 border-accent-primary rounded-tl-lg" />
                      <div className="absolute -top-1.5 -right-1.5 w-6 h-6 border-t-4 border-r-4 border-accent-primary rounded-tr-lg" />
                      <div className="absolute -bottom-1.5 -left-1.5 w-6 h-6 border-b-4 border-l-4 border-accent-primary rounded-bl-lg" />
                      <div className="absolute -bottom-1.5 -right-1.5 w-6 h-6 border-b-4 border-r-4 border-accent-primary rounded-br-lg" />

                      {/* Moving laser scanner line */}
                      {isScanning && (
                        <motion.div
                          className="absolute left-0 right-0 h-0.5 bg-accent-primary shadow-[0_0_8px_var(--color-accent-primary)]"
                          animate={{ top: ["4%", "96%", "4%"] }}
                          transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
                        />
                      )}
                    </div>
                  </div>

                  {/* Scanning instructions overlay */}
                  <div className="absolute bottom-4 left-0 right-0 text-center pointer-events-none">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 text-[10px] font-bold tracking-wider uppercase rounded-full bg-black/60 backdrop-blur-sm border border-white/10 text-white shadow-lg">
                      <span className="w-1.5 h-1.5 rounded-full bg-accent-primary animate-pulse" />
                      Align QR inside grid
                    </span>
                  </div>
                </>
              )}
            </div>
            
            <div className="text-center text-xs text-text-muted leading-relaxed">
              Camera access is terminated instantly when you close this window. Your biometric data never exits your browser.
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
