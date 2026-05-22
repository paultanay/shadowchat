"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { 
  Shield, 
  Zap, 
  Key, 
  Lock, 
  ArrowRight, 
  Layers,
  QrCode
} from "lucide-react";
import { 
  pageTransition, 
  glassReveal, 
  buttonHover, 
  buttonTap 
} from "@/animations/variants";
import { useRoomStore } from "@/stores/roomStore";
import { useUIStore } from "@/stores/uiStore";
import { generateFileKey, encryptText, bytesToBase64 } from "@/lib/engines/crypto";
import QRScannerModal from "@/components/QRScannerModal";

export default function Home() {
  const { createRoom, joinRoom } = useRoomStore();
  const { showToast } = useUIStore();
  
  const [roomCode, setRoomCode] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);

  const handleScanSuccess = async (scannedRoomCode: string, scannedRoomKey?: string) => {
    setRoomCode(scannedRoomCode);
    setIsJoining(true);

    try {
      // 1. Join room (requests guest token)
      const roomId = await joinRoom(scannedRoomCode);

      showToast({
        type: "success",
        title: "Access Granted",
        message: "Synchronizing security tokens. Joining lobby...",
      });

      // Cache token and role in sessionStorage
      sessionStorage.setItem(`token_${roomId}`, useRoomStore.getState().token || "");
      sessionStorage.setItem(`role_${roomId}`, "member");

      if (scannedRoomKey) {
        sessionStorage.setItem(`key_${roomId}`, scannedRoomKey);
      }

      setTimeout(() => {
        const hashPart = scannedRoomKey ? `#key=${scannedRoomKey}` : "";
        window.location.href = `/room/${roomId}${hashPart}`;
      }, 1000);

    } catch (err: any) {
      showToast({
        type: "error",
        title: "Access Denied",
        message: err.message || "Invalid room code or room is full.",
      });
      setIsJoining(false);
    }
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);

    try {
      // 1. Generate local AES-256 room key for metadata envelope encryption
      const roomKey = await generateFileKey();
      
      // 2. Encrypt room name and config client-side
      const chamberName = `Chamber-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      const encName = await encryptText(roomKey, chamberName);
      const encConfig = await encryptText(roomKey, JSON.stringify({
        allowChat: true,
        allowP2P: true,
      }));

      // Convert Base64 strings to Uint8Array for API payload
      const nameBytes = new Uint8Array(
        window.atob(encName.ciphertext).split("").map((c) => c.charCodeAt(0))
      );
      const configBytes = new Uint8Array(
        window.atob(encConfig.ciphertext).split("").map((c) => c.charCodeAt(0))
      );

      // 3. Register room on the server (generates JWT session token)
      const generatedCode = await createRoom({
        encryptedName: nameBytes,
        encryptedConfig: configBytes,
        maxMembers: 5,
        isTemporary: true,
        lifetimeHours: 24,
      });

      // 4. Export key bytes to Base64 to append to URL hash fragment (Z-K boundary)
      const rawKey = await window.crypto.subtle.exportKey('raw', roomKey);
      const base64Key = bytesToBase64(rawKey);

      showToast({
        type: "success",
        title: "Secure Chamber Created",
        message: `Key derived. Redirecting to chamber ${generatedCode}...`,
      });

      const { roomId } = useRoomStore.getState();
      
      // Cache token in sessionStorage for Refresh support
      sessionStorage.setItem(`token_${roomId}`, useRoomStore.getState().token || "");
      sessionStorage.setItem(`role_${roomId}`, "owner");

      // Redirect with key in hash fragment so the server NEVER sees it
      setTimeout(() => {
        window.location.href = `/room/${roomId}#key=${base64Key}`;
      }, 1000);

    } catch (err: any) {
      showToast({
        type: "error",
        title: "Creation Failed",
        message: err.message || "Failed to establish secure room on signaling cluster.",
      });
      setIsCreating(false);
    }
  };

  const handleJoinRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomCode.trim()) return;
    setIsJoining(true);

    try {
      // 1. Join room (requests guest token)
      const roomId = await joinRoom(roomCode);

      showToast({
        type: "success",
        title: "Access Granted",
        message: "Synchronizing security tokens. Joining lobby...",
      });

      // Cache token in sessionStorage
      sessionStorage.setItem(`token_${roomId}`, useRoomStore.getState().token || "");
      sessionStorage.setItem(`role_${roomId}`, "member");

      setTimeout(() => {
        window.location.href = `/room/${roomId}`;
      }, 1000);

    } catch (err: any) {
      showToast({
        type: "error",
        title: "Access Denied",
        message: err.message || "Invalid room code or room is full.",
      });
      setIsJoining(false);
    }
  };

  return (
    <main className="relative min-h-screen flex flex-col justify-between overflow-hidden bg-bg-primary py-12 px-4 sm:px-6 lg:px-8">
      {/* ─── Geometric Background Glows ─── */}
      <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-accent-primary/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-10 right-1/4 w-[600px] h-[600px] bg-purple-500/10 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-transparent via-transparent to-bg-primary pointer-events-none" />

      {/* ─── Grid Overlay ─── */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff03_1px,transparent_1px),linear-gradient(to_bottom,#ffffff03_1px,transparent_1px)] bg-[size:4rem_4rem] pointer-events-none" />

      {/* ─── Header ─── */}
      <header className="relative z-10 w-full max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="ShadowChat Logo" className="w-10 h-10 object-contain rounded-xl border border-accent-primary/30 shadow-glow" />
          <span className="text-lg font-bold tracking-wider text-text-primary uppercase">ShadowChat</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full bg-accent-success/15 text-accent-success border border-accent-success/30">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-success animate-pulse" />
            Network Secure
          </span>
        </div>
      </header>

      {/* ─── Hero Section ─── */}
      <section className="relative z-10 w-full max-w-7xl mx-auto my-auto grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">
        {/* Left Text Column */}
        <motion.div 
          className="lg:col-span-7 space-y-6"
          initial="initial"
          animate="animate"
          variants={pageTransition}
        >
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent-primary/10 border border-accent-primary/20 text-xs font-semibold text-accent-primary">
            <Shield className="w-3.5 h-3.5" />
            Zero-Knowledge Cryptographic Protocol
          </div>
          <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight leading-none animate-pulse-subtle">
            Encrypted. <span className="sc-heading-hero">Peer-to-Peer.</span>
            <br />
            Ephemeral.
          </h1>
          <p className="text-lg text-text-secondary max-w-xl leading-relaxed">
            Create completely secure rooms to share files of any size directly between browsers. Fully client-side encrypted with zero server tracking. Your files never touch a cloud database.
          </p>

          {/* Features Checklist */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            {[
              "End-to-End Encrypted (AES-GCM)",
              "Direct Peer-to-Peer Transfer (WebRTC)",
              "Zero-Knowledge Server Logs",
              "No Accounts Required",
            ].map((feature, i) => (
              <div key={i} className="flex items-center gap-2 text-sm text-text-secondary">
                <div className="flex items-center justify-center w-5 h-5 rounded-full bg-accent-success/10 text-accent-success border border-accent-success/20">
                  ✓
                </div>
                <span>{feature}</span>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Right Dashboard / Portal Action Column */}
        <motion.div 
          className="lg:col-span-5 w-full max-w-md mx-auto"
          initial="initial"
          animate="animate"
          variants={glassReveal}
        >
          <div className="sc-glass p-8 space-y-6 relative">
            <div className="absolute top-0 right-8 -translate-y-1/2 px-4 py-1 text-[10px] font-bold tracking-widest text-accent-primary bg-bg-secondary border border-border-glass rounded-full uppercase">
              WebRTC portal
            </div>

            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-text-primary">Establish Connection</h2>
              <p className="text-xs text-text-muted">Initialize an ephemeral transfer chamber.</p>
            </div>

            {/* Create Room Form */}
            <form onSubmit={handleCreateRoom} className="space-y-4">
              <motion.button
                type="submit"
                disabled={isCreating || isJoining}
                className="sc-btn-glow w-full flex items-center justify-center gap-2 py-4 px-4 rounded-xl text-sm font-semibold text-white cursor-pointer select-none shadow-glow disabled:opacity-50 disabled:cursor-not-allowed"
                {...buttonHover}
                {...buttonTap}
              >
                {isCreating ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Generating Key Exchange...
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4 text-cyan-300" />
                    Create Secure Chamber
                    <ArrowRight className="w-4 h-4 ml-1" />
                  </>
                )}
              </motion.button>
            </form>

            <div className="relative flex py-2 items-center">
              <div className="flex-grow border-t border-border-subtle"></div>
              <span className="flex-shrink mx-4 text-[10px] font-bold tracking-wider text-text-muted uppercase">or Join Chamber</span>
              <div className="flex-grow border-t border-border-subtle"></div>
            </div>

            {/* Join Room Form */}
            <form onSubmit={handleJoinRoom} className="space-y-4">
              <div>
                <label htmlFor="room-code" className="block text-[10px] font-bold tracking-wider text-text-muted uppercase mb-2">
                  Chamber Code
                </label>
                <div className="relative">
                  <input
                    type="text"
                    id="room-code"
                    maxLength={16}
                    placeholder="e.g. SHADOW-7X9K"
                    value={roomCode}
                    onChange={(e) => setRoomCode(e.target.value)}
                    disabled={isCreating || isJoining}
                    className="w-full pl-4 pr-16 py-3 bg-bg-secondary/50 border border-border-glass rounded-xl text-text-primary placeholder:text-text-muted text-sm font-mono tracking-widest focus:outline-none focus:border-accent-primary focus:ring-1 focus:ring-accent-primary transition-all disabled:opacity-50"
                  />
                  <div className="absolute inset-y-0 right-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setIsScannerOpen(true)}
                      disabled={isCreating || isJoining}
                      className="p-1.5 hover:bg-bg-tertiary rounded-lg border border-transparent hover:border-border-glass text-accent-primary transition-all cursor-pointer flex items-center justify-center"
                      title="Scan QR Code"
                    >
                      <QrCode className="w-4 h-4" />
                    </button>
                    <Key className="w-4 h-4 text-text-muted" />
                  </div>
                </div>
              </div>

              <motion.button
                type="submit"
                disabled={!roomCode.trim() || isCreating || isJoining}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-bg-tertiary border border-border-glass rounded-xl text-sm font-semibold text-text-primary cursor-pointer transition-all hover:bg-bg-secondary select-none disabled:opacity-50 disabled:cursor-not-allowed"
                {...buttonHover}
                {...buttonTap}
              >
                {isJoining ? (
                  <>
                    <div className="w-4 h-4 border-2 border-text-primary/30 border-t-text-primary rounded-full animate-spin" />
                    Synchronizing Session...
                  </>
                ) : (
                  <>
                    Join Active Chamber
                  </>
                )}
              </motion.button>
            </form>
          </div>
        </motion.div>
      </section>

      {/* ─── Grid Section ─── */}
      <section className="relative z-10 w-full max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6 pt-16 lg:pt-24">
        {/* Card 1: Zero Knowledge */}
        <motion.div 
          className="sc-glass p-6 space-y-4"
          whileHover={{ y: -4, transition: { duration: 0.2 } }}
        >
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
            <Lock className="w-5 h-5" />
          </div>
          <h3 className="text-lg font-bold text-text-primary">Zero Knowledge</h3>
          <p className="text-sm text-text-secondary leading-relaxed">
            The signaling server acts solely as a broker for SDP metadata. We never look at, nor store, your filenames, hashes, or transfer payloads.
          </p>
        </motion.div>

        {/* Card 2: High Performance */}
        <motion.div 
          className="sc-glass p-6 space-y-4"
          whileHover={{ y: -4, transition: { duration: 0.2 } }}
        >
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <Zap className="w-5 h-5" />
          </div>
          <h3 className="text-lg font-bold text-text-primary">Direct P2P Speeds</h3>
          <p className="text-sm text-text-secondary leading-relaxed">
            By utilizing direct WebRTC DataChannels, data flows directly from disk to disk. No cloud storage uploads, no arbitrary bandwidth throttling.
          </p>
        </motion.div>

        {/* Card 3: Cryptographic Integrity */}
        <motion.div 
          className="sc-glass p-6 space-y-4"
          whileHover={{ y: -4, transition: { duration: 0.2 } }}
        >
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
            <Layers className="w-5 h-5" />
          </div>
          <h3 className="text-lg font-bold text-text-primary">E2E Integrity Check</h3>
          <p className="text-sm text-text-secondary leading-relaxed">
            Automatic Web Worker-based SHA-256 block verification ensures that not a single bit of your files changes during transfer.
          </p>
        </motion.div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="relative z-10 w-full max-w-7xl mx-auto pt-16 flex flex-col sm:flex-row items-center justify-between border-t border-border-subtle gap-4 text-xs text-text-muted">
        <div>
          © 2026 ShadowChat. Built with peer-to-peer integrity.
        </div>
        <div className="flex items-center gap-6">
          <a href="#" className="hover:text-text-secondary transition-all">Documentation</a>
          <a href="#" className="hover:text-text-secondary transition-all">Protocol Specification</a>
          <a href="#" className="hover:text-text-secondary transition-all">GitHub</a>
        </div>
      </footer>
      
      <QRScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScanSuccess={handleScanSuccess}
      />
    </main>
  );
}
