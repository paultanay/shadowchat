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
  Mic,
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
import VoiceRecorder from "@/components/VoiceRecorder";
import VoiceNote from "@/components/VoiceNote";

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
    notifications,
    toggleSidebar,
    showToast,
    dismissToast,
  } = useUIStore();

  const [inputText, setInputText] = useState("");
  const [isCopied, setIsCopied] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isQRModalOpen, setIsQRModalOpen] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Warn before leaving/reloading the room
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // Initialize and connect to signaling
  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    
    const initialize = async () => {
      const activeToken = token || sessionStorage.getItem(`token_${roomId}`);
      const activeRole = roomRole || (sessionStorage.getItem(`role_${roomId}`) as 'owner' | 'member');

      if (activeToken && activeRole) {
        sessionStorage.setItem(`token_${roomId}`, activeToken);
        sessionStorage.setItem(`role_${roomId}`, activeRole);

        await connectSignaling(roomId, activeToken, activeRole);
        if (cancelled) return;
      } else {
        try {
          let targetCode = roomId;
          
          if (roomId.length === 36) {
            const apiBase = typeof window !== 'undefined'
              ? (window.location.host.includes('localhost') || window.location.host.includes('127.0.0.1') || window.location.host.includes('shadowchat.local')
                ? `${window.location.protocol}//${(window.location.host.includes(':3000') || window.location.host.includes(':3001')) ? window.location.hostname + ':8080' : window.location.host}/api/v1`
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
            title: "Resolving Secure Room...",
            message: "Negotiating keys and establishing guest handshake...",
          });

          const realRoomId = await joinRoom(targetCode);
          if (cancelled) return;
          
          const newState = useRoomStore.getState();
          const newToken = newState.token;
          const newRole = newState.roomRole;

          if (newToken && newRole) {
            sessionStorage.setItem(`token_${realRoomId}`, newToken);
            sessionStorage.setItem(`role_${realRoomId}`, newRole);

            if (window.location.pathname !== `/room/${realRoomId}`) {
              window.history.replaceState({}, '', `/room/${realRoomId}${window.location.hash}`);
            }

            await connectSignaling(realRoomId, newToken, newRole);
          } else {
            throw new Error("Failed to retrieve join tokens from server");
          }
        } catch (err: any) {
          if (cancelled) return;
          showToast({
            type: "error",
            title: "Access Denied",
            message: err.message || "Failed to join room. Room may be locked, expired, or full.",
          });
          setTimeout(() => {
            if (!cancelled) window.location.href = "/";
          }, 3000);
        }
      }
    };

    initialize();

    return () => {
      cancelled = true;
      disconnectRoom();
    };
  }, [roomId]);

  // Scroll to bottom of chat when new message arrives
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleCopyLink = () => {
    const link = `${window.location.origin}/room/${roomCode || roomId}${window.location.hash || ""}`;
    navigator.clipboard.writeText(link);
    setIsCopied(true);
    showToast({
      type: "success",
      title: "Link Copied",
      message: "Room invitation URL copied to clipboard.",
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
    
    const items = e.dataTransfer.items;
    if (items && items.length > 0) {
      const filePromises: Promise<File>[] = [];
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry();
        if (entry) {
          const files = await traverseDirectory(entry);
          for (const f of files) {
            filePromises.push(Promise.resolve(f));
          }
        }
      }
      const allFiles = await Promise.all(filePromises);
      if (allFiles.length > 10) {
        showToast({
          type: "info",
          title: "Bulk Transfer",
          message: `Queueing ${allFiles.length} files...`,
        });
      }
      for (const file of allFiles) {
        await handleFileSelect(file);
      }
    } else {
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        for (let i = 0; i < files.length; i++) {
          await handleFileSelect(files[i]);
        }
      }
    }
  };

  const traverseDirectory = async (
    entry: FileSystemEntry,
    files: File[] = []
  ): Promise<File[]> => {
    if (entry.isFile) {
      const fileEntry = entry as FileSystemFileEntry;
      const file = await new Promise<File>((resolve, reject) => {
        fileEntry.file(resolve, reject);
      });
      files.push(file);
    } else if (entry.isDirectory) {
      const dirEntry = entry as FileSystemDirectoryEntry;
      const reader = dirEntry.createReader();
      const entries = await new Promise<FileSystemEntry[]>((resolve, reject) => {
        reader.readEntries(resolve, reject);
      });
      for (const child of entries) {
        await traverseDirectory(child, files);
      }
    }
    return files;
  };

  const handleFileClick = () => {
    fileInputRef.current?.click();
  };

  const handleFolderClick = () => {
    folderInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        await handleFileSelect(files[i]);
      }
    }
    e.target.value = '';
  };

  const handleFolderChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      showToast({
        type: "info",
        title: "Uploading Folder",
        message: `Queueing ${files.length} file(s) from folder...`,
      });
      for (let i = 0; i < files.length; i++) {
        await handleFileSelect(files[i]);
      }
    }
    e.target.value = '';
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

  // Show loading only if token is missing from BOTH Zustand and sessionStorage
  const hasToken = token || (typeof window !== 'undefined' && sessionStorage.getItem(`token_${roomId}`));
  if (!hasToken) {
    return (
      <div className="relative min-h-screen flex items-center justify-center bg-bg-primary text-text-primary overflow-hidden">
        <div className="absolute -left-40 top-20 h-[500px] w-[500px] rounded-full bg-accent-glow opacity-25 blur-3xl spin-slow pointer-events-none" />
        <div className="absolute -right-20 bottom-20 h-[450px] w-[450px] rounded-full bg-accent-warning/5 opacity-15 blur-3xl pointer-events-none" />

        <div className="relative z-10 sc-glass border border-border-glass p-8 rounded-3xl max-w-sm w-full mx-4 text-center space-y-6">
          <div className="flex justify-center">
            <div className="relative flex items-center justify-center w-14 h-14 rounded-2xl bg-bg-tertiary border border-border-glass shadow-elegant">
              <Shield className="w-6 h-6 text-accent-primary animate-pulse" />
            </div>
          </div>
          <div className="space-y-2">
            <h2 className="text-lg font-bold tracking-tight">Resolving Room</h2>
            <p className="text-xs text-text-secondary leading-relaxed font-sans">
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
      {/* ─── Ambient Glows ─── */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-40 top-20 h-[500px] w-[500px] rounded-full bg-accent-glow opacity-20 blur-3xl spin-slow" />
        <div className="absolute -right-20 bottom-20 h-[450px] w-[450px] rounded-full bg-accent-warning/5 opacity-10 blur-3xl" />
      </div>

      {/* ─── Header ─── */}
      <header className="relative z-10 w-full sc-glass border-b border-border-glass px-6 py-4 flex items-center justify-between shadow-elegant">
        <div className="flex items-center gap-4">
          <button 
            onClick={toggleSidebar} 
            className="md:hidden p-2 rounded-lg bg-bg-tertiary border border-border-glass hover:bg-bg-secondary transition-all cursor-pointer"
          >
            <Menu className="w-4 h-4" />
          </button>
          
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-bg-tertiary border border-border-glass flex items-center justify-center">
              <Shield className="w-4.5 h-4.5 text-accent-primary" />
            </div>
            <div className="flex flex-col">
              <span className="text-[9px] text-text-muted font-mono font-bold tracking-widest uppercase">Secure Room</span>
              <span className="text-sm font-mono font-bold text-text-primary flex items-center gap-1.5">
                {roomCode || roomId?.substring(0, 8)}
                <button 
                  onClick={handleCopyLink}
                  className="p-1 hover:text-accent-primary transition-colors cursor-pointer"
                  title="Copy Invite Link"
                >
                  <Copy className="w-3 h-3 text-text-muted hover:text-accent-primary" />
                </button>
                <button 
                  onClick={() => setIsQRModalOpen(true)}
                  className="p-1 hover:text-accent-primary transition-colors cursor-pointer"
                  title="Show Invite QR"
                >
                  <QrCode className="w-3 h-3 text-text-muted hover:text-accent-primary" />
                </button>
              </span>
            </div>
          </div>
        </div>

        {/* Network & Session Status */}
        <div className="flex items-center gap-4">
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-bg-secondary/60 border border-border-glass text-[10px] font-mono uppercase tracking-wider text-text-secondary">
            <Shield className="w-3.5 h-3.5 text-accent-success" />
            <span>Encrypted Tunnel</span>
          </div>

          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider">
            <span className={`w-2 h-2 rounded-full ${signalingState === 'connected' ? 'bg-accent-success animate-pulse' : 'bg-accent-warning animate-pulse'}`} />
            <span className="text-text-secondary hidden xs:inline">
              {signalingState}
            </span>
          </div>

          <button 
            onClick={() => {
              disconnectRoom();
              window.location.href = "/";
            }}
            className="p-2 rounded-lg bg-bg-tertiary border border-border-glass text-accent-danger hover:bg-red-500/10 hover:border-red-500/30 transition-all cursor-pointer"
            title="Leave Room"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* ─── Main Interface ─── */}
      <div className="flex-grow flex relative z-10 overflow-hidden">
        
        {/* ─── Mobile Sidebar Backdrop Overlay ─── */}
        <AnimatePresence>
          {sidebarOpen && (
            <motion.div 
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs md:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={toggleSidebar}
            />
          )}
        </AnimatePresence>

        {/* ─── Sidebar Panel ─── */}
        <aside className={`fixed md:relative z-50 h-full w-80 bg-bg-tertiary md:bg-bg-glass/80 backdrop-blur-lg border-r border-border-glass flex flex-col justify-between transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
          <div className="p-6 space-y-6 flex-grow overflow-y-auto">
            {/* Mobile Sidebar Close Header */}
            <div className="flex items-center justify-between md:hidden pb-4 border-b border-border-glass">
              <div className="flex items-center gap-2">
                <Shield className="w-4.5 h-4.5 text-accent-primary" />
                <span className="font-mono text-xs uppercase tracking-wider text-text-primary">Room Menu</span>
              </div>
              <button 
                onClick={toggleSidebar}
                className="p-1.5 rounded-lg bg-bg-secondary border border-border-glass text-text-secondary hover:text-text-primary transition-all cursor-pointer"
                title="Close Menu"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            {/* Owner Room Controls */}
            {roomRole === 'owner' && (
              <div className="space-y-3">
                <h3 className="text-[9px] font-mono font-bold tracking-widest text-text-muted uppercase">Room Controls</h3>
                <div className="grid grid-cols-2 gap-2 font-mono text-xs">
                  {roomConfig?.is_locked ? (
                    <button 
                      onClick={unlockRoom}
                      className="flex items-center justify-center gap-1.5 py-2 px-3 bg-bg-secondary hover:bg-bg-primary border border-border-glass rounded-lg text-text-primary transition-all cursor-pointer"
                    >
                      <Unlock className="w-3.5 h-3.5 text-accent-warning" />
                      Unlock
                    </button>
                  ) : (
                    <button 
                      onClick={lockRoom}
                      className="flex items-center justify-center gap-1.5 py-2 px-3 bg-bg-secondary hover:bg-bg-primary border border-border-glass rounded-lg text-text-primary transition-all cursor-pointer"
                    >
                      <Lock className="w-3.5 h-3.5 text-accent-primary" />
                      Lock
                    </button>
                  )}
                  <button 
                    onClick={destroyRoom}
                    className="flex items-center justify-center gap-1.5 py-2 px-3 bg-red-500/5 hover:bg-red-500/10 border border-red-500/20 rounded-lg text-accent-danger transition-all cursor-pointer"
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
                <h3 className="text-[9px] font-mono font-bold tracking-widest text-text-muted uppercase">Active Members ({peers.size + 1})</h3>
                <Users className="w-3.5 h-3.5 text-text-muted" />
              </div>

              <div className="space-y-2">
                {/* Local Peer card */}
                <div className="p-3 bg-bg-secondary/40 border border-border-glass rounded-xl flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-accent-primary animate-pulse" />
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-text-primary">You {roomRole === 'owner' ? '(Initiator)' : '(Guest)'}</span>
                      <span className="text-[9px] font-mono text-text-muted">{peerId?.substring(0, 8)}</span>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 text-[8px] font-mono font-bold uppercase tracking-wider rounded bg-accent-primary/10 text-accent-primary border border-accent-primary/20">
                    {roomRole}
                  </span>
                </div>

                {/* Remote Peers cards */}
                {activePeerList.map((peer) => (
                  <div key={peer.id} className="p-3 bg-bg-secondary/20 border border-border-glass rounded-xl flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${peer.status === 'connected' ? 'bg-accent-success animate-pulse' : 'bg-accent-warning animate-pulse'}`} />
                      <div className="flex flex-col">
                        <span className="text-xs font-bold text-text-primary">{peer.id.substring(0, 8)}</span>
                        <span className="text-[9px] font-mono text-text-muted">{peer.presence}</span>
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
                  <div className="p-4 bg-bg-secondary/10 border border-dashed border-border-glass rounded-xl text-center">
                    <p className="text-xs text-text-muted">Waiting for peers to join...</p>
                    <div className="mt-3 flex items-center justify-center gap-4">
                      <button 
                        onClick={handleCopyLink}
                        className="text-xs font-mono font-bold text-accent-primary hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        Invite <ChevronRight className="w-3 h-3" />
                      </button>
                      <button 
                        onClick={() => setIsQRModalOpen(true)}
                        className="text-xs font-mono font-bold text-accent-primary hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        Show QR <QrCode className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

          </div>

          <div className="p-4 border-t border-border-subtle bg-bg-secondary/10 text-center shrink-0">
            <span className="text-[9px] font-mono text-text-muted">Zero-Knowledge Sandbox v1.0.0</span>
          </div>
        </aside>

        {/* ─── Main Portal Area ─── */}
        <main 
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className="flex-grow flex flex-col overflow-hidden relative z-10"
        >
          <div className="flex-grow flex flex-col p-4 sm:p-6 overflow-hidden h-full relative">
            
            {/* Drag and Drop Hover Overlay */}
            <AnimatePresence>
              {isDragging && (
                <motion.div
                  className="absolute inset-4 sm:inset-6 z-40 bg-bg-primary/95 backdrop-blur-md flex flex-col items-center justify-center border-2 border-dashed border-accent-primary rounded-2xl pointer-events-none"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <div className="flex flex-col items-center gap-4 text-center p-6">
                    <div className="w-16 h-16 rounded-2xl bg-accent-primary/10 border border-accent-primary/20 flex items-center justify-center text-accent-primary animate-pulse shadow-elegant">
                      <Paperclip className="w-8 h-8" />
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-xl font-bold tracking-tight text-text-primary">Send Files Securely P2P</h3>
                      <p className="text-xs text-text-secondary max-w-xs leading-relaxed font-sans">
                        Drop files anywhere in this room to instantly encrypt and stream them directly to your peers.
                      </p>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* E2EE Chat & File Lobby Drawer */}
            <div className="flex-grow flex flex-col border border-border-glass rounded-2xl bg-bg-secondary/10 overflow-hidden shadow-elegant h-full">
              {/* Chat Panel Header */}
              <div className="px-4 py-3 bg-bg-secondary/40 border-b border-border-glass flex items-center justify-between font-mono text-[9px] uppercase tracking-wider text-text-muted shrink-0">
                <div className="flex items-center gap-2">
                  <Shield className="w-3.5 h-3.5 text-accent-success" />
                  <span>E2EE Chat & File Lobby</span>
                </div>
                <div className="flex items-center gap-4">
                  <div className="hidden xs:flex items-center gap-1.5">
                    <Sparkles className="w-3 h-3 text-accent-primary" />
                    <span className="text-accent-primary">P2P DIRECT RELAY</span>
                  </div>
                  <span>OTR Mode</span>
                </div>
              </div>

              {/* Messages Body */}
              <div className="flex-grow p-4 overflow-y-auto space-y-4 min-h-0">
                {messages.map((msg) => {
                  const isSelf = msg.peerId === peerId;
                  
                  if (msg.type === 'file') {
                    // Look up transfer details reactively
                    const transfer = activeTransfers.get(msg.transferId || '');
                    const fileName = transfer?.fileName || msg.fileName || 'Shared File';
                    const fileSize = transfer?.sizeBytes || msg.fileSize || 0;
                    const status = transfer?.status || 'failed';
                    const progress = transfer?.progress || 0;
                    const speed = transfer?.speedBytesPerSec || 0;
                    const eta = transfer?.etaSec || 0;
                    const direction = transfer?.direction || (isSelf ? 'outgoing' : 'incoming');
                    const blob = transfer?.blob;
                    const fileType = transfer?.fileType || msg.fileType || '';

                    // Voice notes render with waveform player
                    if (status === 'completed' && blob && fileType.startsWith('audio/')) {
                      return (
                        <div
                          key={msg.id}
                          className={`flex flex-col w-full max-w-[85%] sm:max-w-[70%] ${isSelf ? 'ml-auto items-end' : 'mr-auto items-start'}`}
                        >
                          <span className="text-[9px] font-mono text-text-muted mb-1 px-1">
                            {isSelf ? 'You' : msg.senderName} • {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <div className={`p-3 rounded-2xl text-xs leading-relaxed font-sans w-full border border-border-glass shadow-elegant ${isSelf ? 'bg-bg-tertiary text-text-primary rounded-tr-none' : 'bg-bg-tertiary/60 text-text-primary rounded-tl-none'}`}>
                            <VoiceNote blob={blob} isSelf={isSelf} />
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div 
                        key={msg.id} 
                        className={`flex flex-col w-full max-w-[85%] sm:max-w-[70%] ${isSelf ? 'ml-auto items-end' : 'mr-auto items-start'}`}
                      >
                        <span className="text-[9px] font-mono text-text-muted mb-1 px-1">
                          {isSelf ? 'You' : msg.senderName} • {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        
                        <div className={`p-4 rounded-2xl text-xs leading-relaxed font-sans w-full max-w-sm border border-border-glass relative overflow-hidden shadow-elegant ${isSelf ? 'bg-bg-tertiary text-text-primary rounded-tr-none' : 'bg-bg-tertiary/60 text-text-primary rounded-tl-none'}`}>
                          {status === 'completed' && (
                            <div className="absolute left-0 top-0 bottom-0 w-1 bg-accent-success" />
                          )}
                          
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className={`p-2.5 rounded-xl shrink-0 ${direction === 'outgoing' ? 'bg-bg-secondary text-accent-primary' : 'bg-bg-secondary text-accent-warning'}`}>
                                <FileText className="w-5 h-5" />
                              </div>
                              <div className="flex flex-col min-w-0">
                                <span className="text-xs font-bold truncate pr-2" title={fileName}>{fileName}</span>
                                <span className="text-[10px] text-text-muted font-mono">
                                  {formatBytes(fileSize)} • {direction}
                                </span>
                              </div>
                            </div>

                            <div className="shrink-0 flex items-center gap-1.5 font-mono text-[10px]">
                              {status === 'transferring' && (
                                <span className="font-bold text-accent-primary mr-1">
                                  {formatSpeed(speed)}
                                </span>
                              )}

                              {status === 'transferring' && (
                                <button 
                                  onClick={() => {
                                    pauseFileTransfer(transfer!.peerId, msg.transferId!);
                                  }}
                                  className="p-1.5 rounded-lg bg-bg-secondary hover:bg-bg-primary text-text-primary border border-border-glass transition-all cursor-pointer flex items-center justify-center"
                                  title="Pause"
                                >
                                  <Pause className="w-3 h-3" />
                                </button>
                              )}

                              {status === 'paused' && (
                                <button 
                                  onClick={() => {
                                    resumeFileTransfer(transfer!.peerId, msg.transferId!);
                                  }}
                                  className="p-1.5 rounded-lg bg-accent-primary/10 hover:bg-accent-primary/20 text-accent-primary border border-accent-primary/20 transition-all cursor-pointer flex items-center justify-center"
                                  title="Resume"
                                >
                                  <Play className="w-3 h-3" />
                                </button>
                              )}

                              {(status === 'transferring' || status === 'paused' || status === 'pending') && (
                                <button 
                                  onClick={() => {
                                    cancelFileTransfer(transfer!.peerId, msg.transferId!);
                                  }}
                                  className="p-1.5 rounded-lg bg-red-500/5 hover:bg-red-500/10 text-accent-danger border border-red-500/20 transition-all cursor-pointer flex items-center justify-center"
                                  title="Cancel"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              )}

                              {status === 'completed' && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-accent-success font-sans">
                                  <CheckCircle className="w-3.5 h-3.5" />
                                  Ready
                                </span>
                              )}

                              {status === 'failed' && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-text-muted font-sans" title="WebRTC session closed or file offline">
                                  <AlertTriangle className="w-3.5 h-3.5" />
                                  Offline
                                </span>
                              )}
                            </div>
                          </div>

                          {(status === 'transferring' || status === 'paused' || status === 'completed') && (
                            <div className="mt-3 space-y-1.5">
                              <div className="w-full h-1 bg-bg-secondary rounded-full overflow-hidden border border-border-glass">
                                <motion.div 
                                  className="h-full bg-accent-primary" 
                                  initial={{ width: 0 }}
                                  animate={{ width: `${progress}%` }}
                                  transition={{ duration: 0.1 }}
                                />
                              </div>
                              
                              {status === 'transferring' && (
                                <div className="flex items-center justify-between text-[9px] font-mono text-text-muted">
                                  <span className="flex items-center gap-1">
                                    <Clock className="w-2.5 h-2.5" />
                                    {formatETA(eta)}
                                  </span>
                                  <span>{progress.toFixed(1)}%</span>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Save completed download file option */}
                          {status === 'completed' && direction === 'incoming' && blob && (
                            <div className="mt-3 pt-2.5 border-t border-border-glass">
                              <button
                                onClick={() => {
                                  const url = URL.createObjectURL(blob);
                                  const a = document.createElement('a');
                                  a.href = url;
                                  a.download = fileName;
                                  a.click();
                                  URL.revokeObjectURL(url);
                                }}
                                className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-text-primary hover:bg-accent-primary text-bg-primary hover:text-bg-primary rounded-xl text-[10px] font-mono font-bold tracking-wide transition-all cursor-pointer shadow-elegant"
                              >
                                <Download className="w-3.5 h-3.5" />
                                Save to device
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div 
                      key={msg.id} 
                      className={`flex flex-col max-w-[80%] ${isSelf ? 'ml-auto items-end' : 'mr-auto items-start'}`}
                    >
                      <span className="text-[9px] font-mono text-text-muted mb-1 px-1">
                        {isSelf ? 'You' : msg.senderName} • {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <div className={`px-4 py-2.5 rounded-2xl text-xs leading-relaxed font-sans ${isSelf ? 'bg-text-primary text-bg-primary rounded-tr-none font-medium' : 'bg-bg-tertiary/60 border border-border-glass text-text-primary rounded-tl-none'}`}>
                        {msg.text}
                      </div>
                    </div>
                  );
                })}
                <div ref={chatEndRef} />

                {messages.length === 0 && (
                  <div className="h-full flex items-center justify-center flex-col text-center p-8">
                    <div className="w-12 h-12 rounded-xl bg-bg-tertiary flex items-center justify-center border border-border-glass text-text-muted mb-3 shadow-elegant">
                      <Send className="w-4 h-4 text-text-muted" />
                    </div>
                    <h4 className="text-xs font-bold text-text-primary uppercase tracking-wider">Secure OTR Lobby</h4>
                    <p className="text-[11px] text-text-secondary max-w-xs mt-2 leading-relaxed font-sans">
                      Messages and files are encrypted client-side and dispatched directly over direct connection tunnels. No logs preserved on remote clouds.
                      <br />
                      <span className="text-[10px] text-accent-primary mt-3 block font-mono">
                        Drag-and-drop files here or click the attachment button below to stream them!
                      </span>
                    </p>
                  </div>
                )}
              </div>

              {/* Chat Panel Input Form */}
              <form onSubmit={handleSendChat} className="p-3 bg-bg-secondary/30 border-t border-border-glass flex items-center gap-2 shrink-0">
                {/* Hidden File Inputs & Attach Buttons */}
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileChange} 
                  className="hidden" 
                  multiple
                />
                <input 
                  type="file" 
                  ref={folderInputRef} 
                  onChange={handleFolderChange} 
                  className="hidden" 
                  // @ts-expect-error - webkitdirectory is a non-standard attribute
                  webkitdirectory=""
                  directory=""
                />
                <button 
                  type="button" 
                  onClick={handleFileClick}
                  className="p-2.5 bg-bg-tertiary hover:bg-bg-secondary border border-border-glass text-accent-primary hover:text-accent-primary/80 rounded-xl transition-all cursor-pointer flex items-center justify-center shrink-0 shadow-elegant"
                  title="Attach Files"
                >
                  <Paperclip className="w-4 h-4" />
                </button>
                <button 
                  type="button" 
                  onClick={handleFolderClick}
                  className="p-2.5 bg-bg-tertiary hover:bg-bg-secondary border border-border-glass text-accent-primary hover:text-accent-primary/80 rounded-xl transition-all cursor-pointer flex items-center justify-center shrink-0 shadow-elegant"
                  title="Upload Folder"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                  </svg>
                </button>
                <VoiceRecorder onSendFile={handleFileSelect} />

                <input 
                  type="text" 
                  placeholder="Type encrypted message..."
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  className="flex-grow bg-bg-secondary/40 border border-border-glass rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:border-accent-primary focus:ring-1 focus:ring-accent-primary"
                />
                <button 
                  type="submit" 
                  disabled={!inputText.trim()}
                  className="p-2.5 bg-text-primary hover:bg-accent-primary text-bg-primary hover:text-bg-primary rounded-xl transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-elegant shrink-0 animate-fade-in"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </form>
            </div>
          </div>
        </main>
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
