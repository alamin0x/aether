"use client";

import React, { useState, useEffect, useRef } from "react";
import { Radar } from "@/components/Radar/Radar";
import { Blip } from "@/components/Radar/Blip";
import { motion, AnimatePresence } from "framer-motion";
import { Shield, Share2, Zap, Globe, AlertCircle } from "lucide-react";
import { useSocket } from "@/hooks/useSocket";
import { PeerConnection } from "@/lib/webrtc";

export default function Home() {
  const { socket, isConnected } = useSocket();
  const [isJoined, setIsJoined] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [userName, setUserName] = useState("");
  const [roomId, setRoomId] = useState("1234");
  const [users, setUsers] = useState<any[]>([]);
  const usersRef = useRef<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  const peersRef = useRef<Map<string, PeerConnection>>(new Map());
  const [transfers, setTransfers] = useState<Record<string, { progress: number, isTransferring: boolean, isReady: boolean }>>({});
  const roomIdRef = useRef(roomId);
  const iceServersRef = useRef<RTCIceServer[]>([]);

  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);

  useEffect(() => {
    usersRef.current = users;
  }, [users]);

  const isJoinedRef = useRef(false);
  const [feedback, setFeedback] = useState<{ type: 'accepted' | 'rejected', name: string } | null>(null);

  const getOrCreatePeer = (targetId: string, isInitiator: boolean) => {
    let pc = peersRef.current.get(targetId);
    if (!pc) {
      console.log(`[WebRTC] Creating PeerConnection for ${targetId}. ICE Servers: ${iceServersRef.current.length}`);
      pc = new PeerConnection(socket!, targetId, isInitiator, iceServersRef.current);
      pc.setCallbacks(
        (progress) => updateTransfer(targetId, progress, true),
        (blob, name, senderName) => downloadFile(blob, name, targetId, senderName),
        (isReady) => setTransfers(prev => ({ ...prev, [targetId]: { ...prev[targetId], isReady } })),
        (status) => {
          const peer = usersRef.current.find(u => u.id === targetId);
          setFeedback({ type: status, name: peer?.name || "Peer" });
          setTimeout(() => setFeedback(null), 4000);
        },
        (err) => {
          setError(err);
          setTimeout(() => setError(null), 3000);
          updateTransfer(targetId, 0, false);
        }
      );
      peersRef.current.set(targetId, pc);
    }
    return pc;
  };

  useEffect(() => {
    if (!socket) return;

    socket.on("ice-servers", (iceServers) => {
      console.log("[Socket] Received ICE servers");
      iceServersRef.current = iceServers;
      isJoinedRef.current = true;
      setIsJoined(true);
      setIsJoining(false);
    });

    socket.on("user-joined", (user) => {
      setUsers((prev) => [...prev, user]);
      // Don't pre-create peer here — wait for actual signaling to start
    });

    socket.on("room-users", (existingUsers) => {
      setUsers(existingUsers);
      // Don't pre-create peers here — let initiateTransfer / signal handler create them
    });

    socket.on("user-left", (userId) => {
      setUsers((prev) => prev.filter((u) => u.id !== userId));
      const pc = peersRef.current.get(userId);
      if (pc) {
        pc.setCallbacks(() => {}, () => {}, () => {}, () => {}, () => {});
        pc.destroy();
        peersRef.current.delete(userId);
      }
      setTransfers(prev => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
    });

    socket.on("signal", async ({ senderId, signal }) => {
      const pc = getOrCreatePeer(senderId, false);
      if (pc) await pc.handleSignal(signal);
    });

    return () => {
      socket.off("ice-servers");
      socket.off("user-joined");
      socket.off("room-users");
      socket.off("user-left");
      socket.off("signal");
    };
  }, [socket]);

  const updateTransfer = (id: string, progress: number, isTransferring: boolean) => {
    setTransfers(prev => ({
      ...prev,
      [id]: { 
        ...prev[id],
        progress, 
        isTransferring: progress < 100 && isTransferring 
      }
    }));
  };

  const [pendingFile, setPendingFile] = useState<{ blob: Blob, name: string, senderId: string, senderName: string } | null>(null);

  const getFileType = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase();
    if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'].includes(ext || '')) return 'Image';
    if (['mp4', 'webm', 'mov', 'avi'].includes(ext || '')) return 'Video';
    if (['mp3', 'wav', 'ogg'].includes(ext || '')) return 'Audio';
    if (['pdf', 'doc', 'docx', 'txt', 'rtf'].includes(ext || '')) return 'Document';
    if (['zip', 'rar', '7z', 'tar'].includes(ext || '')) return 'Archive';
    return 'Data Stream';
  };

  const downloadFile = (blob: Blob, fileName: string, senderId: string, senderName: string) => {
    // Secret room: Auto-download
    if (roomIdRef.current === "473238") {
      const pc = getOrCreatePeer(senderId, false);
      pc?.sendFeedback('accepted');
      executeDownload(blob, fileName, senderId);
      return;
    }

    // Other rooms: Ask for permission
    setPendingFile({ blob, name: fileName, senderId, senderName });
  };

  const executeDownload = (blob: Blob, fileName: string, senderId: string) => {
    const pc = getOrCreatePeer(senderId, false);
    pc?.sendFeedback('accepted');
    
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    
    // Append to body for better compatibility
    document.body.appendChild(a);
    
    // Trigger download
    a.click();
    
    // Clean up with a delay
    // Revoking immediately can cause issues on some browsers/mobile
    setTimeout(() => {
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    }, 1000);

    updateTransfer(senderId, 100, false);
    setTimeout(() => updateTransfer(senderId, 0, false), 2000);
    setPendingFile(null);
  };

  const handleJoin = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!userName.trim()) {
      setError("Please enter a device name");
      setTimeout(() => setError(null), 3000);
      return;
    }
    if (!isConnected) {
      setError("Wait for uplink connection...");
      setTimeout(() => setError(null), 3000);
      return;
    }
    setIsJoining(true);
    socket!.emit("join-room", { roomId, userName });
  };

  const initiateTransfer = async (targetId: string, file: File) => {
    // If a peer already exists (created as non-initiator), we must replace it
    // with an initiator peer so it creates the data channel.
    const existing = peersRef.current.get(targetId);
    if (existing) {
      existing.setCallbacks(() => {}, () => {}, () => {}, () => {}, () => {});
      existing.destroy();
      peersRef.current.delete(targetId);
    }

    // Create fresh initiator peer
    const pc = getOrCreatePeer(targetId, true);
    if (!pc) return;

    // Start the signaling handshake — this creates the offer and triggers
    // the answerer to respond, which eventually opens the data channel.
    await pc.createOffer();

    try {
      // Wait for the data channel to fully open (ICE + DTLS handshake)
      // before pumping file data into it.
      await pc.waitForChannel(15000);
      await pc.sendFile(file, userName, (progress) => updateTransfer(targetId, progress, true));
    } catch (err) {
      console.error("[Transfer] Failed:", err);
      updateTransfer(targetId, 0, false);
      setError("Transfer Failed — could not open P2P channel");
      setTimeout(() => setError(null), 4000);
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [targetUserId, setTargetUserId] = useState<string | null>(null);

  const handleBlipClick = (userId: string) => {
    setTargetUserId(userId);
    fileInputRef.current?.click();
  };

  const getButtonText = () => {
    if (!isConnected) return "Establishing Uplink...";
    if (isJoining) return "Syncing ICE Nodes...";
    return "Initialize Radar";
  };

  return (
    <main 
      className="relative min-h-screen flex flex-col items-center justify-center p-4 sm:p-8 overflow-hidden"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => e.preventDefault()}
    >
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && targetUserId) {
            initiateTransfer(targetUserId, file);
            setTargetUserId(null);
          }
        }} 
        className="hidden" 
      />

      {/* Dynamic Background */}
      <div className="absolute inset-0 bg-black pointer-events-none" />
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-accent/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-accent/10 rounded-full blur-[120px] pointer-events-none" />

      {/* Feedback Notification (Sender Side) */}
      <AnimatePresence>
        {feedback && (
          <motion.div 
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="fixed bottom-24 z-[110] px-6 py-3 rounded-2xl border backdrop-blur-xl flex items-center gap-3 shadow-2xl"
            style={{ 
              backgroundColor: feedback.type === 'accepted' ? 'rgba(0, 242, 255, 0.1)' : 'rgba(255, 71, 71, 0.1)',
              borderColor: feedback.type === 'accepted' ? 'rgba(0, 242, 255, 0.3)' : 'rgba(255, 71, 71, 0.3)'
            }}
          >
            <div className={`w-2 h-2 rounded-full animate-pulse ${feedback.type === 'accepted' ? 'bg-accent' : 'bg-red-500'}`} />
            <span className="text-xs font-bold tracking-widest uppercase text-white">
              {feedback.name} <span className={feedback.type === 'accepted' ? 'text-accent' : 'text-red-400'}>{feedback.type}</span> your transfer
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Transfer Request Modal */}
      <AnimatePresence>
        {pendingFile && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="w-full max-w-[340px] bg-black/80 border border-accent/30 p-8 rounded-[2.5rem] shadow-[0_0_50px_rgba(0,242,255,0.15)] flex flex-col items-center text-center gap-6"
            >
              <div className="w-16 h-16 bg-accent/10 border border-accent/20 rounded-3xl flex items-center justify-center">
                <Zap className="w-8 h-8 text-accent animate-pulse" />
              </div>
              
              <div className="space-y-2">
                <h3 className="text-white text-xl font-bold tracking-tight">Incoming Data</h3>
                <p className="text-white/40 text-xs uppercase tracking-widest">
                  Signal from <span className="text-accent font-bold">{pendingFile.senderName}</span>
                </p>
              </div>

              <div className="w-full py-4 px-6 bg-white/5 border border-white/10 rounded-2xl">
                <p className="text-accent font-mono text-sm truncate max-w-full" title={pendingFile.name}>
                  {pendingFile.name}
                </p>
                <p className="text-white/20 text-[10px] uppercase mt-1">
                  {(pendingFile.blob.size / (1024 * 1024)).toFixed(2)} MB • {getFileType(pendingFile.name)}
                </p>
              </div>

              <div className="flex flex-col w-full gap-3 mt-2">
                <button
                  onClick={() => executeDownload(pendingFile.blob, pendingFile.name, pendingFile.senderId)}
                  className="w-full bg-accent text-black font-extrabold py-4 rounded-2xl text-xs tracking-[0.2em] uppercase shadow-[0_0_20px_rgba(0,242,255,0.2)] hover:scale-[1.02] transition-all"
                >
                  Accept & Save
                </button>
                <button
                  onClick={() => {
                    const pc = getOrCreatePeer(pendingFile.senderId, false);
                    pc?.sendFeedback('rejected');
                    updateTransfer(pendingFile.senderId, 0, false);
                    setPendingFile(null);
                  }}
                  className="w-full bg-white/5 text-white/40 font-bold py-4 rounded-2xl text-xs tracking-[0.2em] uppercase hover:bg-white/10 transition-all"
                >
                  Reject
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="absolute top-6 left-6 sm:top-8 sm:left-8 flex items-center gap-2 z-50">
        <div className="w-8 h-8 bg-accent rounded flex items-center justify-center shadow-[0_0_15px_rgba(0,242,255,0.4)]">
          <Share2 className="w-5 h-5 text-black" />
        </div>
        <h1 className="text-xl font-bold tracking-tighter text-glow text-white">BLIPSYNC</h1>
      </div>

      <div className="absolute top-8 right-8 flex items-center gap-6 text-[10px] text-white/50 uppercase tracking-widest hidden sm:flex z-50">
        <div className="flex items-center gap-2 text-accent">
          <Shield className="w-3 h-3" />
          <span>Encrypted P2P</span>
        </div>
      </div>

      <div className="relative z-10 flex flex-col items-center gap-8 sm:gap-16 w-full max-w-4xl">
        <div className="text-center space-y-3">
          <motion.h2 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-5xl sm:text-6xl font-extrabold tracking-tighter lg:text-8xl text-white"
          >
            Drop into <span className="text-accent italic drop-shadow-[0_0_15px_rgba(0,242,255,0.3)]">BlipSync.</span>
          </motion.h2>
          <p className="text-white/40 max-w-[280px] sm:max-w-md mx-auto text-xs sm:text-sm px-4">
            Instant, private, peer-to-peer file sharing via decentralized radar.
          </p>
        </div>

        <div className="relative w-[80vw] h-[80vw] max-w-[600px] max-h-[600px] flex items-center justify-center">
          <Radar />
          
          <AnimatePresence>
            {isJoined && users.map((user) => (
              <motion.div 
                key={user.id}
                onClick={() => handleBlipClick(user.id)}
                onDragOver={(e) => {
                  e.preventDefault(); e.stopPropagation();
                  (e.currentTarget as HTMLElement).classList.add("scale-125");
                }}
                onDragLeave={(e) => {
                  e.preventDefault(); e.stopPropagation();
                  (e.currentTarget as HTMLElement).classList.remove("scale-125");
                }}
                onDrop={(e) => {
                  e.preventDefault(); e.stopPropagation();
                  (e.currentTarget as HTMLElement).classList.remove("scale-125");
                  const file = e.dataTransfer.files[0];
                  if (file) initiateTransfer(user.id, file);
                }}
                className="absolute transition-transform duration-300 z-50 cursor-pointer p-12"
                style={{ 
                  left: `${(user.x + 1) * 50}%`, 
                  top: `${(user.y + 1) * 50}%`,
                  transform: "translate(-50%, -50%)" 
                }}
              >
                <Blip 
                  {...user} 
                  isTransferring={transfers[user.id]?.isTransferring}
                  isReady={transfers[user.id]?.isReady}
                  progress={transfers[user.id]?.progress}
                />
              </motion.div>
            ))}
          </AnimatePresence>

          {isJoined && (
            <div className="absolute -bottom-24 sm:-bottom-20 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 text-center w-full px-4">
              <div className="px-5 py-2 bg-accent/10 border border-accent/30 rounded-full flex items-center gap-2 mx-auto w-fit backdrop-blur-md">
                <span className="text-[10px] uppercase tracking-widest text-white/40">Network Room</span>
                <span className="text-sm font-mono text-accent font-bold tracking-wider">{roomId}</span>
              </div>
              <p className="text-[10px] text-white/30 uppercase tracking-[0.2em] mt-6 animate-pulse">
                Drop or Tap a device to transmit
              </p>
            </div>
          )}

          {!isJoined && (
            <div className="absolute inset-0 flex flex-col items-center justify-center z-[60] px-6">
              <form onSubmit={handleJoin} className="flex flex-col gap-4 w-full max-w-[320px] p-8 rounded-[2rem] border border-white/10 bg-black/40 backdrop-blur-2xl shadow-2xl">
                <div className="text-center mb-4">
                  <div className="w-12 h-12 bg-accent/10 border border-accent/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <Share2 className="w-6 h-6 text-accent" />
                  </div>
                  <h3 className="text-white text-lg font-bold tracking-tight">Access Radar</h3>
                  <p className="text-white/40 text-[10px] uppercase tracking-widest mt-1">Initialize Peer Uplink</p>
                </div>

                <div className="space-y-3">
                  <input
                    type="text"
                    placeholder="Device Identity (e.g. Phone)"
                    value={userName}
                    onChange={(e) => setUserName(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 px-5 py-4 rounded-2xl text-sm focus:border-accent/50 outline-none transition-all text-white placeholder:text-white/20"
                  />
                  <input
                    type="text"
                    placeholder="Room Code"
                    value={roomId}
                    onChange={(e) => setRoomId(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 px-5 py-4 rounded-2xl text-sm focus:border-accent/50 outline-none transition-all text-white placeholder:text-white/20"
                  />
                </div>

                <AnimatePresence>
                  {error && (
                    <motion.div 
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="flex items-center gap-2 text-red-400 text-[11px] font-medium bg-red-400/10 p-3 rounded-xl border border-red-400/20"
                    >
                      <AlertCircle className="w-3 h-3" />
                      {error}
                    </motion.div>
                  )}
                </AnimatePresence>

                <motion.button
                  type="submit"
                  whileHover={{ scale: 1.02, boxShadow: "0 0 20px rgba(0,242,255,0.4)" }}
                  whileTap={{ scale: 0.98 }}
                  className="w-full bg-accent text-black font-extrabold py-4 rounded-2xl text-xs tracking-[0.2em] uppercase shadow-[0_0_30px_rgba(0,242,255,0.2)] transition-all"
                >
                  {isConnected ? "Initialize Radar" : "Establishing Uplink..."}
                </motion.button>
              </form>
            </div>
          )}
        </div>
      </div>

      {/* Footer / Status */}
      <div className="absolute bottom-8 w-full px-8 sm:px-12 flex justify-between items-end z-50">
        <div className="flex items-center gap-2 text-[10px] sm:text-xs">
          <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${isConnected ? 'bg-accent shadow-[0_0_8px_#00f2ff]' : 'bg-red-500'}`} />
          <span className={`${isConnected ? 'text-accent' : 'text-red-500/80'} uppercase tracking-[0.2em] font-medium`}>
            {isConnected ? 'Uplink Active' : 'Uplink Offline'}
          </span>
        </div>
      </div>
    </main>
  );
}
