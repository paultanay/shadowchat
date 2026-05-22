"use client";

import React, { useEffect, useState, useRef } from "react";
import { useRoomStore } from "@/stores/roomStore";
import { useUIStore } from "@/stores/uiStore";
import { motion, AnimatePresence } from "motion/react";
import { 
  Shield, 
  Users, 
  Lock, 
  Unlock, 
  Send, 
  Paperclip, 
  Download, 
  Play, 
  Pause, 
  X, 
  AlertTriangle, 
  CheckCircle,
  Copy,
  ChevronRight,
  Menu,
  Activity,
  FileText,
  Clock,
  LogOut,
  Sparkles,
  QrCode
} from "lucide-react";
import { bytesToBase64 } from "@/lib/engines/crypto";
import QRCodeModal from "@/components/QRCodeModal";

interface PageProps {
  params: Promise<{ roomId: string }>;
}

export default function RoomPage({ params }: PageProps) {
  // Resolve Next 16 async params
  const resolvedParams = React.use(params);
  const roomId = resolvedParams.roomId;

  const {
    roomCode,
    roomRole,
    roomConfig,
    token,
    peerId,
    signalingState,
    peers,
    messages,
    activeTransfers,
    connectSignaling,
    disconnectRoom,
    joinRoom,
    sendChatMessage,
    lockRoom,
    unlockRoom,
    destroyRoom,
    initiateFileTransfer,
    pauseFileTransfer,
    resumeFileTransfer,
    cancelFileTransfer,
  } = useRoomStore();

  const {
    sidebarOpen,
    activeTab,
    notifications,
    toggleSidebar,
    setActiveTab,
    showToast,
    dismissToast,
  } = useUIStore();

  const [inputText, setInputText] = useState("");
  const [isCopied, setIsCopied] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isQRModalOpen, setIsQRModalOpen] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize and connect to signaling
  useEffect(() => {
    if (!roomId) return;
    
    // Check if we already have a token in local state (which means we joined/created from landing)
    // If not (e.g. direct page refresh), try loading from storage or auto-join from room code
    const initialize = async () => {
      const activeToken = token || sessionStorage.getItem(`token_${roomId}`);
      const activeRole = roomRole || (sessionStorage.getItem(`role_${roomId}`) as 'owner' | 'member');

      if (activeToken && activeRole) {
        // Cache in session storage for refresh safety
        sessionStorage.setItem(`token_${roomId}`, activeToken);
        sessionStorage.setItem(`role_${roomId}`, activeRole);

        await connectSignaling(roomId, activeToken, activeRole);
      } else {
        // No token in session storage - try to auto-join using the room code/UUID
        try {
          let targetCode = roomId;
          
          // Check if roomId is a UUID (length 36)
          if (roomId.length === 36) {
            // Get API Base dynamically
            const apiBase = typeof window !== 'undefined'
              ? (window.location.host.includes('localhost') || window.location.host.includes('127.0.0.1') || window.location.host.includes('shadowchat.local')
                ? `${window.location.protocol}//${window.location.host.includes(':3000') ? window.location.hostname + ':8080' : window.location.host}/api/v1`
                : process.env.NEXT_PUBLIC_API_URL || 'https://api.shadowchat.local/api/v1')
              : 'https://api.shadowchat.local/api/v1';

            const res = await fetch(`${apiBase}/rooms/${roomId}`);
            if (res.ok) {
              const metadata = await res.json();
              if (metadata && metadata.room_code) {
                targetCode = metadata.room_code;
              }
            }
          }

          showToast({
            type: "info",
            title: "Resolving Secure Chamber...",
            message: "Negotiating keys and establishing guest handshake...",
          });

          // Join the room using targetCode
          const realRoomId = await joinRoom(targetCode);
          
          // Get the new token/role from the store state
          const newState = useRoomStore.getState();
          const newToken = newState.token;
          const newRole = newState.roomRole;

          if (newToken && newRole) {
            sessionStorage.setItem(`token_${realRoomId}`, newToken);
            sessionStorage.setItem(`role_${realRoomId}`, newRole);

            // Update the URL to the real room ID if it is currently a room code
            if (window.location.pathname !== `/room/${realRoomId}`) {
              window.history.replaceState({}, '', `/room/${realRoomId}${window.location.hash}`);
            }

            await connectSignaling(realRoomId, newToken, newRole);
          } else {
            throw new Error("Failed to retrieve join tokens from server");
          }
        } catch (err: any) {
          showToast({
            type: "error",
            title: "Access Denied",
            message: err.message || "Failed to join chamber. Room may be locked, expired, or full.",
          });
          setTimeout(() => {
            window.location.href = "/";
          }, 3000);
        }
      }
    };

    initialize();

    return () => {
      disconnectRoom();
    };
  }, [roomId]);

  // Scroll to bottom of chat when new message arrives
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleCopyLink = () => {
    const link = `${window.location.origin}/room/${roomCode || roomId}`;
    navigator.clipboard.writeText(link);
    setIsCopied(true);
    showToast({
      type: "success",
      title: "Link Copied",
      message: "Chamber invitation URL copied to clipboard.",
    });
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    sendChatMessage(inputText);
    setInputText("");
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      await handleFileSelect(files[0]);
    }
  };

  const handleFileClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      await handleFileSelect(files[0]);
    }
  };

  const handleFileSelect = async (file: File) => {
    if (peers.size === 0) {
      showToast({
        type: "error",
        title: "No Connected Peers",
        message: "You must wait for another peer to join before transmitting files.",
      });
      return;
    }

    // Start transfers to all connected peers
    peers.forEach(async (peer) => {
      if (peer.status === 'connected') {
        try {
          showToast({
            type: "info",
            title: "Initiating Transfer",
            message: `Encrypting keys & indexing file metadata...`,
          });
          await initiateFileTransfer(peer.id, file);
        } catch (err: any) {
          showToast({
            type: "error",
            title: "Transfer Failed",
            message: err.message || "Failed to initiate file transfer.",
          });
        }
      }
    });
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const formatSpeed = (bytesPerSec: number): string => {
    if (bytesPerSec === 0) return "";
    return `${formatBytes(bytesPerSec)}/s`;
  };

  const formatETA = (seconds: number): string => {
    if (seconds <= 0 || !isFinite(seconds)) return "estimating...";
    if (seconds < 60) return `${Math.ceil(seconds)}s remaining`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.ceil(seconds % 60);
    return `${mins}m ${secs}s remaining`;
  };

  // Convert map to list for easy rendering
  const activePeerList = Array.from(peers.values());
  const activeTransferList = Array.from(activeTransfers.entries()).map(([tid, details]) => ({
    id: tid,
    ...details,
  }));

  const getInviteUrl = () => {
    if (typeof window === "undefined") return "";
    const hash = window.location.hash || "";
    return `${window.location.origin}/room/${roomCode || roomId}${hash}`;
  };

  if (!token) {
    return (
      <div className="relative min-h-screen flex items-center justify-center bg-bg-primary text-text-primary overflow-hidden">
        {/* Geometric Background Glows */}
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-accent-primary/5 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-10 right-1/4 w-[600px] h-[600px] bg-purple-500/5 rounded-full blur-[140px] pointer-events-none" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff02_1px,transparent_1px),linear-gradient(to_bottom,#ffffff02_1px,transparent_1px)] bg-[size:4rem_4rem] pointer-events-none" />

        <div className="relative z-10 sc-glass border border-border-glass p-8 rounded-3xl max-w-md w-full mx-4 text-center space-y-6">
          <div className="flex justify-center">
            <div className="relative flex items-center justify-center w-16 h-16 rounded-2xl bg-accent-primary/10 border border-accent-primary/30">
              <Shield className="w-8 h-8 text-accent-primary animate-pulse" />
              <div className="absolute inset-0 rounded-2xl border border-accent-primary/50 animate-ping opacity-25" />
            </div>
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-bold tracking-tight">Resolving Secure Chamber</h2>
            <p className="text-sm text-text-secondary leading-relaxed">
              Negotiating client-side keys and establishing end-to-end encrypted room handshake...
            </p>
          </div>
          <div className="flex justify-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-accent-primary animate-bounce [animation-delay:-0.3s]" />
            <div className="w-1.5 h-1.5 rounded-full bg-accent-primary animate-bounce [animation-delay:-0.15s]" />
            <div className="w-1.5 h-1.5 rounded-full bg-accent-primary animate-bounce" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen flex flex-col bg-bg-primary text-text-primary overflow-hidden">
      {/* ─── Geometric Background Glows ─── */}
      <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-accent-primary/5 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-10 right-1/4 w-[600px] h-[600px] bg-purple-500/5 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff02_1px,transparent_1px),linear-gradient(to_bottom,#ffffff02_1px,transparent_1px)] bg-[size:4rem_4rem] pointer-events-none" />

      {/* ─── Header Dashboard ─── */}
      <header className="relative z-10 w-full sc-glass border-b border-border-glass px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button 
            onClick={toggleSidebar} 
            className="md:hidden p-2 rounded-lg bg-bg-secondary border border-border-glass hover:bg-bg-tertiary transition-all"
          >
            <Menu className="w-5 h-5" />
          </button>
          
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="ShadowChat Logo" className="w-8 h-8 object-contain rounded-lg border border-accent-primary/30 shadow-glow" />
            <div className="flex flex-col">
              <span className="text-xs text-text-muted font-bold tracking-widest uppercase">Secure Chamber</span>
              <span className="text-sm font-mono font-bold text-text-primary flex items-center gap-1.5">
                {roomCode || roomId?.substring(0, 8)}
                <button 
                  onClick={handleCopyLink}
                  className="p-1 hover:text-accent-primary transition-colors cursor-pointer"
                  title="Copy Invite Link"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <button 
                  onClick={() => setIsQRModalOpen(true)}
                  className="p-1 hover:text-accent-primary transition-colors cursor-pointer"
                  title="Show Invite QR"
                >
                  <QrCode className="w-3.5 h-3.5" />
                </button>
              </span>
            </div>
          </div>
        </div>

        {/* Network & Session Status Indicator */}
        <div className="flex items-center gap-4">
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-bg-secondary border border-border-glass text-xs text-text-secondary">
            <Shield className="w-3.5 h-3.5 text-accent-success" />
            <span className="font-medium">End-to-End Encrypted</span>
          </div>

          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${signalingState === 'connected' ? 'bg-accent-success animate-pulse' : 'bg-accent-warning animate-pulse'}`} />
            <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider hidden xs:inline">
              {signalingState}
            </span>
          </div>

          <button 
            onClick={() => {
              disconnectRoom();
              window.location.href = "/";
            }}
            className="p-2 rounded-lg bg-red-500/10 border border-red-500/30 text-accent-danger hover:bg-red-500/20 transition-all cursor-pointer"
            title="Leave Chamber"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* ─── Main Interface ─── */}
      <div className="flex-grow flex relative z-10 overflow-hidden">
        
        {/* ─── Sidebar Panel ─── */}
        <aside className={`absolute md:relative z-20 h-full w-80 sc-glass border-r border-border-glass flex flex-col justify-between transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
          <div className="p-6 space-y-6 flex-grow overflow-y-auto">
            
            {/* Owner Room Controls */}
            {roomRole === 'owner' && (
              <div className="space-y-3">
                <h3 className="text-[10px] font-bold tracking-widest text-text-muted uppercase">Chamber Controls</h3>
                <div className="grid grid-cols-2 gap-2">
                  {roomConfig?.is_locked ? (
                    <button 
                      onClick={unlockRoom}
                      className="flex items-center justify-center gap-1.5 py-2 px-3 bg-bg-tertiary hover:bg-bg-secondary border border-border-glass rounded-lg text-xs font-semibold text-text-primary transition-all cursor-pointer"
                    >
                      <Unlock className="w-3.5 h-3.5 text-accent-warning" />
                      Unlock Chamber
                    </button>
                  ) : (
                    <button 
                      onClick={lockRoom}
                      className="flex items-center justify-center gap-1.5 py-2 px-3 bg-accent-primary/10 hover:bg-accent-primary/20 border border-accent-primary/30 rounded-lg text-xs font-semibold text-accent-primary transition-all cursor-pointer"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      Lock Chamber
                    </button>
                  )}
                  <button 
                    onClick={destroyRoom}
                    className="flex items-center justify-center gap-1.5 py-2 px-3 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-lg text-xs font-semibold text-accent-danger transition-all cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                    Destroy
                  </button>
                </div>
              </div>
            )}

            {/* Peer List */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-[10px] font-bold tracking-widest text-text-muted uppercase">Active Members ({peers.size + 1})</h3>
                <Users className="w-4 h-4 text-text-muted" />
              </div>

              <div className="space-y-2">
                {/* Local Peer card */}
                <div className="p-3 bg-accent-primary/5 border border-accent-primary/20 rounded-xl flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full bg-accent-primary animate-pulse" />
                    <div className="flex flex-col">
                      <span className="text-xs font-bold">You (Initiator)</span>
                      <span className="text-[10px] font-mono text-text-muted">{peerId?.substring(0, 8)}</span>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded bg-accent-primary/10 text-accent-primary">
                    {roomRole}
                  </span>
                </div>

                {/* Remote Peers cards */}
                {activePeerList.map((peer) => (
                  <div key={peer.id} className="p-3 bg-bg-secondary/40 border border-border-glass rounded-xl flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-2.5 h-2.5 rounded-full ${peer.status === 'connected' ? 'bg-accent-success animate-pulse' : 'bg-accent-warning animate-pulse'}`} />
                      <div className="flex flex-col">
                        <span className="text-xs font-bold">{peer.id.substring(0, 8)}</span>
                        <span className="text-[10px] font-mono text-text-muted">{peer.presence}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {peer.status === 'connected' ? (
                        <span title="E2EE Key Exchanged">
                          <CheckCircle className="w-4 h-4 text-accent-success" />
                        </span>
                      ) : (
                        <span title="Securing Connection">
                          <Activity className="w-4 h-4 text-accent-warning animate-spin" />
                        </span>
                      )}
                    </div>
                  </div>
                ))}

                {activePeerList.length === 0 && (
                  <div className="p-4 bg-bg-secondary/20 border border-dashed border-border-glass rounded-xl text-center">
                    <p className="text-xs text-text-muted">Waiting for peers to join...</p>
                    <div className="mt-2 flex items-center justify-center gap-4">
                      <button 
                        onClick={handleCopyLink}
                        className="text-xs font-bold text-accent-primary hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        Invite Peer <ChevronRight className="w-3 h-3" />
                      </button>
                      <button 
                        onClick={() => setIsQRModalOpen(true)}
                        className="text-xs font-bold text-accent-primary hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        Show QR <QrCode className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Layout Toggles */}
            <div className="space-y-2 pt-4 border-t border-border-subtle">
              <button 
                onClick={() => setActiveTab('transfers')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-semibold transition-all cursor-pointer ${activeTab === 'transfers' ? 'bg-bg-tertiary text-white shadow-glow' : 'hover:bg-bg-secondary/50 text-text-secondary'}`}
              >
                <Activity className="w-4 h-4" />
                Transfers Queue ({activeTransfers.size})
              </button>
              <button 
                onClick={() => setActiveTab('chat')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-semibold transition-all cursor-pointer ${activeTab === 'chat' ? 'bg-bg-tertiary text-white shadow-glow' : 'hover:bg-bg-secondary/50 text-text-secondary'}`}
              >
                <Send className="w-4 h-4" />
                E2EE Chat Lobby ({messages.length})
              </button>
            </div>
          </div>

          <div className="p-4 border-t border-border-subtle bg-bg-secondary/20 text-center">
            <span className="text-[10px] font-mono text-text-muted">Zero-Knowledge Sandbox v1.0.0</span>
          </div>
        </aside>

        {/* ─── Main Portal Area ─── */}
        <main className="flex-grow flex flex-col md:flex-row overflow-hidden relative">
          
          {/* Active transfers / Drag Drop Portal Panel */}
          <div className="flex-grow flex flex-col p-6 overflow-y-auto space-y-6">
            
            {/* Drag and Drop Zone */}
            <div 
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={handleFileClick}
              className={`relative flex flex-col items-center justify-center border-2 border-dashed rounded-3xl p-12 text-center cursor-pointer transition-all duration-300 group min-h-[300px] ${isDragging ? 'border-accent-primary bg-accent-primary/5' : 'border-border-glass bg-bg-secondary/20 hover:border-accent-primary/50'}`}
            >
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileChange} 
                className="hidden" 
              />
              
              <div className="absolute top-4 right-4 flex items-center gap-1.5 px-3 py-1 rounded-full bg-bg-secondary/60 border border-border-glass text-[10px] font-bold uppercase tracking-wider text-text-muted">
                <Sparkles className="w-3 h-3 text-cyan-300" />
                P2P Relay Mode
              </div>

              <div className="flex flex-col items-center gap-4">
                <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-accent-primary/10 border border-accent-primary/20 text-accent-primary group-hover:scale-105 transition-transform duration-300">
                  <Paperclip className="w-8 h-8" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-bold">Secure File Broadcast</h3>
                  <p className="text-sm text-text-secondary max-w-sm leading-relaxed">
                    Drag and drop any file here, or click to browse. Files are encrypted client-side and streamed directly to peers.
                  </p>
                </div>
              </div>
            </div>

            {/* Dynamic Queue Manager */}
            {activeTab === 'transfers' && (
              <div className="space-y-4">
                <h3 className="text-xs font-bold tracking-widest text-text-muted uppercase">Active Transfers Queue</h3>
                
                <div className="space-y-3">
                  {activeTransferList.map((transfer) => (
                    <div key={transfer.id} className="p-4 bg-bg-secondary/60 border border-border-glass rounded-2xl flex flex-col gap-3 relative overflow-hidden">
                      {/* Highlight border on completed */}
                      {transfer.status === 'completed' && (
                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-accent-success" />
                      )}
                      
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <div className={`p-2.5 rounded-xl ${transfer.direction === 'outgoing' ? 'bg-blue-500/10 text-blue-400' : 'bg-cyan-500/10 text-cyan-400'}`}>
                            <FileText className="w-5 h-5" />
                          </div>
                          <div className="flex flex-col">
                            <span className="text-sm font-bold truncate max-w-xs">{transfer.fileName}</span>
                            <span className="text-xs text-text-muted">
                              {formatBytes(transfer.sizeBytes)} • {transfer.direction}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {/* Transfer Speed Indicator */}
                          {transfer.status === 'transferring' && (
                            <span className="text-xs font-mono font-bold text-accent-primary">
                              {formatSpeed(transfer.speedBytesPerSec)}
                            </span>
                          )}

                          {/* Control action buttons */}
                          {transfer.status === 'transferring' && (
                            <button 
                              onClick={() => {
                                const pid = Array.from(peers.keys())[0]; // Simplification for 1 peer
                                pauseFileTransfer(pid, transfer.id);
                              }}
                              className="p-1.5 rounded-lg bg-bg-tertiary hover:bg-bg-secondary text-text-primary transition-all cursor-pointer"
                              title="Pause"
                            >
                              <Pause className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {transfer.status === 'paused' && (
                            <button 
                              onClick={() => {
                                const pid = Array.from(peers.keys())[0];
                                resumeFileTransfer(pid, transfer.id);
                              }}
                              className="p-1.5 rounded-lg bg-accent-primary/10 hover:bg-accent-primary/20 text-accent-primary transition-all cursor-pointer"
                              title="Resume"
                            >
                              <Play className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {(transfer.status === 'transferring' || transfer.status === 'paused' || transfer.status === 'pending') && (
                            <button 
                              onClick={() => {
                                const pid = Array.from(peers.keys())[0];
                                cancelFileTransfer(pid, transfer.id);
                              }}
                              className="p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-accent-danger transition-all cursor-pointer"
                              title="Cancel"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {transfer.status === 'completed' && (
                            <span className="inline-flex items-center gap-1 text-xs font-bold text-accent-success">
                              <CheckCircle className="w-4 h-4" />
                              Completed
                            </span>
                          )}

                          {transfer.status === 'failed' && (
                            <span className="inline-flex items-center gap-1 text-xs font-bold text-accent-danger">
                              <AlertTriangle className="w-4 h-4" />
                              Failed
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Progress Bar & Stats */}
                      {(transfer.status === 'transferring' || transfer.status === 'paused' || transfer.status === 'completed') && (
                        <div className="space-y-1.5">
                          <div className="w-full h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
                            <motion.div 
                              className="h-full bg-accent-primary" 
                              initial={{ width: 0 }}
                              animate={{ width: `${transfer.progress}%` }}
                              transition={{ duration: 0.1 }}
                            />
                          </div>
                          
                          {transfer.status === 'transferring' && (
                            <div className="flex items-center justify-between text-[10px] font-medium text-text-muted">
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {formatETA(transfer.etaSec)}
                              </span>
                              <span>{transfer.progress.toFixed(1)}%</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}

                  {activeTransferList.length === 0 && (
                    <div className="p-8 border border-dashed border-border-glass bg-bg-secondary/10 rounded-2xl text-center text-xs text-text-muted">
                      No active files in the transmission logs.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* E2EE Chat Drawer */}
            {activeTab === 'chat' && (
              <div className="flex-grow flex flex-col border border-border-glass rounded-2xl bg-bg-secondary/40 min-h-[400px] overflow-hidden">
                {/* Chat Panel Header */}
                <div className="px-4 py-3 bg-bg-secondary/60 border-b border-border-glass flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-accent-success" />
                    <span className="text-xs font-bold uppercase tracking-wider">Pairwise Secure Chat Room</span>
                  </div>
                  <span className="text-[10px] font-mono text-text-muted">OTR Mode (Off-The-Record)</span>
                </div>

                {/* Messages Body */}
                <div className="flex-grow p-4 overflow-y-auto space-y-4 max-h-[300px] sm:max-h-[400px]">
                  {messages.map((msg) => {
                    const isSelf = msg.peerId === peerId;
                    return (
                      <div 
                        key={msg.id} 
                        className={`flex flex-col max-w-[75%] ${isSelf ? 'ml-auto items-end' : 'mr-auto items-start'}`}
                      >
                        <span className="text-[10px] text-text-muted mb-1 px-1">
                          {isSelf ? 'You' : msg.senderName} • {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${isSelf ? 'bg-accent-primary text-white rounded-br-none' : 'bg-bg-tertiary border border-border-glass text-text-primary rounded-bl-none'}`}>
                          {msg.text}
                        </div>
                      </div>
                    );
                  })}
                  <div ref={chatEndRef} />

                  {messages.length === 0 && (
                    <div className="h-full flex items-center justify-center flex-col text-center p-8">
                      <div className="w-12 h-12 rounded-xl bg-bg-tertiary flex items-center justify-center border border-border-glass text-text-muted mb-3">
                        <Send className="w-5 h-5" />
                      </div>
                      <h4 className="text-sm font-bold text-text-primary">E2EE Instant Messaging</h4>
                      <p className="text-xs text-text-secondary max-w-xs mt-1 leading-relaxed">
                        Messages are encrypted locally and dispatched directly over direct connection tunnels. No logs preserved on remote clouds.
                      </p>
                    </div>
                  )}
                </div>

                {/* Chat Panel Input Form */}
                <form onSubmit={handleSendChat} className="p-3 bg-bg-secondary/60 border-t border-border-glass flex items-center gap-2">
                  <input 
                    type="text" 
                    placeholder="Type encrypted message..."
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    className="flex-grow bg-bg-secondary border border-border-glass rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-accent-primary focus:ring-1 focus:ring-accent-primary"
                  />
                  <button 
                    type="submit" 
                    disabled={!inputText.trim()}
                    className="p-2.5 bg-accent-primary hover:bg-accent-primary/95 text-white rounded-xl transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </form>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* ─── Global System Toast Notifications ─── */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        <AnimatePresence>
          {notifications.map((n) => (
            <motion.div 
              key={n.id}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.95 }}
              className="p-4 sc-glass-card rounded-2xl flex gap-3 pointer-events-auto cursor-pointer"
              onClick={() => dismissToast(n.id)}
            >
              {n.type === 'success' && <CheckCircle className="w-5 h-5 text-accent-success shrink-0" />}
              {n.type === 'error' && <AlertTriangle className="w-5 h-5 text-accent-danger shrink-0" />}
              {n.type === 'warning' && <AlertTriangle className="w-5 h-5 text-accent-warning shrink-0" />}
              {n.type === 'info' && <Shield className="w-5 h-5 text-accent-primary shrink-0" />}
              
              <div className="flex flex-col gap-1">
                <span className="text-xs font-bold text-text-primary leading-none">{n.title}</span>
                <span className="text-[11px] text-text-secondary leading-relaxed">{n.message}</span>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      {/* ─── Ephemeral Room Invite QR Code Modal ─── */}
      <QRCodeModal 
        isOpen={isQRModalOpen}
        onClose={() => setIsQRModalOpen(false)}
        url={getInviteUrl()}
        roomCode={roomCode || undefined}
      />
    </div>
  );
}
