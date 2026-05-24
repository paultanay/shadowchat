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

  // Customized room creation states with pre-filled defaults
  const [roomName, setRoomName] = useState(() => `Room-${Math.random().toString(36).substring(2, 6).toUpperCase()}`);
  const [maxMembers, setMaxMembers] = useState(5);
  const [lifetimeHours, setLifetimeHours] = useState(24);
  const [isTemporary, setIsTemporary] = useState(true);

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

    } catch (err: unknown) {
      showToast({
        type: "error",
        title: "Access Denied",
        message: err instanceof Error ? err.message : "Invalid room code or room is full.",
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
      const activeRoomName = roomName.trim() || `Room-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      const encName = await encryptText(roomKey, activeRoomName);
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
        maxMembers: Number(maxMembers),
        isTemporary: isTemporary,
        lifetimeHours: Number(lifetimeHours),
      });

      // 4. Export key bytes to Base64 to append to URL hash fragment (Z-K boundary)
      const rawKey = await window.crypto.subtle.exportKey('raw', roomKey);
      const base64Key = bytesToBase64(rawKey);

      showToast({
        type: "success",
        title: "Secure Room Created",
        message: `Key derived. Redirecting to room ${generatedCode}...`,
      });

      const { roomId } = useRoomStore.getState();
      
      // Cache token in sessionStorage for Refresh support
      sessionStorage.setItem(`token_${roomId}`, useRoomStore.getState().token || "");
      sessionStorage.setItem(`role_${roomId}`, "owner");

      // Redirect with key in hash fragment so the server NEVER sees it
      setTimeout(() => {
        window.location.href = `/room/${roomId}#key=${base64Key}`;
      }, 1000);

    } catch (err: unknown) {
      showToast({
        type: "error",
        title: "Creation Failed",
        message: err instanceof Error ? err.message : "Failed to establish secure room on signaling cluster.",
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

    } catch (err: unknown) {
      showToast({
        type: "error",
        title: "Access Denied",
        message: err instanceof Error ? err.message : "Invalid room code or room is full.",
      });
      setIsJoining(false);
    }
  };

  return (
    <main className="relative min-h-screen flex flex-col justify-between overflow-hidden bg-bg-primary py-12 px-6 sm:px-8 lg:px-16 animate-fade-up">
      {/* ─── Ambient Mesh Glows ─── */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-40 top-20 h-[500px] w-[500px] rounded-full bg-accent-glow opacity-25 blur-3xl spin-slow" />
        <div className="absolute -right-20 bottom-20 h-[450px] w-[450px] rounded-full bg-accent-warning/5 opacity-15 blur-3xl" />
      </div>

      {/* ─── Header ─── */}
      <header className="relative z-10 w-full max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-bg-tertiary border border-border-glass flex items-center justify-center shadow-elegant">
            <Shield className="w-5 h-5 text-accent-primary" />
          </div>
          <span className="font-mono text-xs uppercase tracking-[0.25em] text-text-primary">ShadowChat</span>
        </div>
        <div className="flex items-center gap-6 font-mono text-[10px] uppercase tracking-wider text-text-muted">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-success opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-accent-success" />
            </span>
            <span className="text-text-secondary">EST. 2026 · SECURE CLUSTER</span>
          </div>
        </div>
      </header>

      {/* ─── Hero Section ─── */}
      <section className="relative z-10 w-full max-w-7xl mx-auto my-auto grid grid-cols-1 lg:grid-cols-12 gap-16 items-center pt-8 pb-12">
        {/* Left Column (Editorial Headline) */}
        <motion.div 
          className="lg:col-span-7 space-y-8"
          initial="initial"
          animate="animate"
          variants={pageTransition}
        >
          {/* Eyebrow */}
          <div className="flex items-center gap-3 font-mono text-xs uppercase tracking-[0.25em] text-text-muted">
            <span className="h-px w-8 bg-accent-primary" />
            Zero-Knowledge Cryptographic Transfer
          </div>
          
          <h1 className="text-display text-5xl sm:text-7xl lg:text-8xl font-light tracking-tight text-text-primary font-serif">
            Encrypted. <span className="italic text-accent-primary font-serif">Peer-to-Peer.</span>
            <br />
            Ephemeral.
          </h1>
          
          <p className="text-base sm:text-lg text-text-secondary max-w-xl leading-relaxed font-sans">
            Create completely secure channels to stream data directly between browsers. Fully client-side encrypted with absolute zero server-side storage. Your files never touch a cloud database.
          </p>

          {/* Minimalist Specs Checklist */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 font-mono text-xs uppercase tracking-wider text-text-muted">
            {[
              "End-to-End Cryptography (AES-GCM)",
              "Direct WebRTC Data Channels",
              "Zero-Knowledge Server Infrastructure",
              "Ephemeral Room Expiration (24h)",
            ].map((feature, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="w-1.5 h-1.5 rounded-full bg-accent-primary" />
                <span className="text-text-secondary">{feature}</span>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Right Action Portal */}
        <motion.div 
          className="lg:col-span-5 w-full max-w-md mx-auto"
          initial="initial"
          animate="animate"
          variants={glassReveal}
        >
          <div className="sc-glass p-8 rounded-3xl space-y-6 relative border border-border-glass shadow-elegant">
            <div className="absolute top-0 right-8 -translate-y-1/2 px-4 py-1.5 text-[9px] font-bold tracking-widest text-accent-primary bg-bg-secondary border border-border-glass rounded-full uppercase font-mono">
              WebRTC PORTAL
            </div>

            <div className="space-y-1">
              <h2 className="text-xl font-bold tracking-tight text-text-primary">Establish Connection</h2>
              <p className="text-xs text-text-muted">Initialize an ephemeral transfer room.</p>
            </div>

            {/* Create Room Form */}
            <form onSubmit={handleCreateRoom} className="space-y-4">
              {/* Room Customization Options - Fully visible by default */}
              <div className="space-y-3.5 text-left pt-2 border-t border-border-subtle">
                {/* Room Name */}
                <div className="space-y-1.5">
                  <label htmlFor="room-name-input" className="block text-[9px] font-mono font-bold tracking-widest text-text-muted uppercase">
                    Custom Room Name / Wording
                  </label>
                  <input
                    type="text"
                    id="room-name-input"
                    placeholder="e.g. Secret Operations"
                    value={roomName}
                    onChange={(e) => setRoomName(e.target.value)}
                    disabled={isCreating}
                    className="w-full px-3 py-2.5 bg-bg-secondary/40 border border-border-glass rounded-xl text-text-primary text-xs font-mono focus:outline-none focus:border-accent-primary focus:ring-1 focus:ring-accent-primary"
                  />
                </div>

                {/* Max Members and Lifetime Hours side-by-side */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label htmlFor="max-members-input" className="block text-[9px] font-mono font-bold tracking-widest text-text-muted uppercase">
                      Max Members
                    </label>
                    <select
                      id="max-members-input"
                      value={maxMembers}
                      onChange={(e) => setMaxMembers(Number(e.target.value))}
                      disabled={isCreating}
                      className="w-full px-3 py-2.5 bg-bg-tertiary border border-border-glass rounded-xl text-text-primary text-xs font-mono focus:outline-none focus:border-accent-primary focus:ring-1 focus:ring-accent-primary cursor-pointer"
                    >
                      <option value="2">2 Members (1v1)</option>
                      <option value="5">5 Members</option>
                      <option value="10">10 Members</option>
                      <option value="20">20 Members</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="lifetime-input" className="block text-[9px] font-mono font-bold tracking-widest text-text-muted uppercase">
                      Lifetime Expiry
                    </label>
                    <select
                      id="lifetime-input"
                      value={lifetimeHours}
                      onChange={(e) => setLifetimeHours(Number(e.target.value))}
                      disabled={isCreating}
                      className="w-full px-3 py-2.5 bg-bg-tertiary border border-border-glass rounded-xl text-text-primary text-xs font-mono focus:outline-none focus:border-accent-primary focus:ring-1 focus:ring-accent-primary cursor-pointer"
                    >
                      <option value="1">1 Hour</option>
                      <option value="12">12 Hours</option>
                      <option value="24">24 Hours</option>
                      <option value="72">72 Hours</option>
                      <option value="168">7 Days</option>
                    </select>
                  </div>
                </div>

                {/* Temporary Toggle */}
                <div className="flex items-center justify-between p-2.5 bg-bg-secondary/20 border border-border-glass rounded-xl text-xs">
                  <div className="flex flex-col">
                    <span className="font-mono text-[9px] font-bold tracking-wider text-text-primary uppercase">Ephemeral Storage</span>
                    <span className="text-[9px] text-text-muted">Delete metadata on expiry</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={isTemporary}
                    onChange={(e) => setIsTemporary(e.target.checked)}
                    disabled={isCreating}
                    className="w-4 h-4 accent-accent-primary rounded cursor-pointer"
                  />
                </div>
              </div>

              <motion.button
                type="submit"
                disabled={isCreating || isJoining}
                className="sc-btn-glow w-full flex items-center justify-center gap-2.5 py-4 px-4 text-sm font-semibold cursor-pointer select-none disabled:opacity-50 disabled:cursor-not-allowed animate-fade-in mt-2"
                {...buttonHover}
                {...buttonTap}
              >
                {isCreating ? (
                  <>
                    <div className="w-4 h-4 border-2 border-bg-primary/30 border-t-bg-primary rounded-full animate-spin" />
                    Generating Key Exchange...
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4" />
                    Create Secure Room
                    <ArrowRight className="w-4 h-4 ml-1" />
                  </>
                )}
              </motion.button>
            </form>

            <div className="relative flex py-2 items-center">
              <div className="flex-grow border-t border-border-subtle"></div>
              <span className="flex-shrink mx-4 text-[9px] font-mono font-bold tracking-widest text-text-muted uppercase">or Join Room</span>
              <div className="flex-grow border-t border-border-subtle"></div>
            </div>

            {/* Join Room Form */}
            <form onSubmit={handleJoinRoom} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="room-code" className="block text-[9px] font-mono font-bold tracking-widest text-text-muted uppercase">
                  Room Invitation Code
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
                    className="w-full pl-4 pr-16 py-3.5 bg-bg-secondary/40 border border-border-glass rounded-xl text-text-primary placeholder:text-text-muted text-sm font-mono tracking-widest focus:outline-none focus:border-accent-primary focus:ring-1 focus:ring-accent-primary transition-all disabled:opacity-50"
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
                className="w-full flex items-center justify-center gap-2 py-3.5 px-4 bg-bg-tertiary border border-border-glass rounded-xl text-xs font-semibold text-text-primary cursor-pointer transition-all hover:bg-bg-secondary select-none disabled:opacity-50 disabled:cursor-not-allowed font-mono tracking-wide"
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
                    Join Active Room
                  </>
                )}
              </motion.button>
            </form>
          </div>
        </motion.div>
      </section>

      {/* ─── Features grid ─── */}
      <section className="relative z-10 w-full max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8 pt-8">
        {/* Card 1 */}
        <motion.div 
          className="sc-glass p-6 rounded-2xl space-y-4 border border-border-glass"
          whileHover={{ y: -3, transition: { duration: 0.3 } }}
        >
          <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-accent-warning/10 text-accent-warning border border-accent-warning/20">
            <Lock className="w-5 h-5" />
          </div>
          <h3 className="text-base font-bold text-text-primary tracking-tight">Zero-Knowledge Sandbox</h3>
          <p className="text-xs text-text-secondary leading-relaxed font-sans">
            The signaling system routes initial metadata packets blindly. We never store or inspect your session files, metadata, names, or encryption configurations.
          </p>
        </motion.div>

        {/* Card 2 */}
        <motion.div 
          className="sc-glass p-6 rounded-2xl space-y-4 border border-border-glass"
          whileHover={{ y: -3, transition: { duration: 0.3 } }}
        >
          <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-accent-primary/10 text-accent-primary border border-accent-primary/20">
            <Zap className="w-5 h-5" />
          </div>
          <h3 className="text-base font-bold text-text-primary tracking-tight">Peer-to-Peer Relay</h3>
          <p className="text-xs text-text-secondary leading-relaxed font-sans">
            By utilizing direct browser data channels, files stream directly between clients. No cloud storage buffering, no bandwidth caps, no intermediates.
          </p>
        </motion.div>

        {/* Card 3 */}
        <motion.div 
          className="sc-glass p-6 rounded-2xl space-y-4 border border-border-glass"
          whileHover={{ y: -3, transition: { duration: 0.3 } }}
        >
          <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-accent-success/10 text-accent-success border border-accent-success/20">
            <Layers className="w-5 h-5" />
          </div>
          <h3 className="text-base font-bold text-text-primary tracking-tight">Cryptographic Verification</h3>
          <p className="text-xs text-text-secondary leading-relaxed font-sans">
            Automatic multi-threaded Web Worker hashing verifies the absolute mathematical integrity of every file block transmitted across the peer connections.
          </p>
        </motion.div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="relative z-10 w-full max-w-7xl mx-auto pt-12 flex flex-col sm:flex-row items-center justify-between border-t border-border-subtle gap-4 text-[10px] font-mono uppercase tracking-wider text-text-muted">
        <div>
          © 2026 ShadowChat. Built with absolute peer-to-peer integrity.
        </div>
        <div className="flex items-center gap-6">
          <a href="#" className="hover:text-text-primary transition-all">Documentation</a>
          <a href="#" className="hover:text-text-primary transition-all">Protocol Specification</a>
          <a href="#" className="hover:text-text-primary transition-all font-semibold">GitHub</a>
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
