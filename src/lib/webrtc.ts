"use client";

import { Socket } from "socket.io-client";

export class PeerConnection {
  private pc: RTCPeerConnection;
  private dataChannel: RTCDataChannel | null = null;
  private socket: Socket;
  private targetId: string;
  private onProgress?: (progress: number) => void;
  private onFileReceived?: (file: Blob, fileName: string, senderName: string) => void;
  private onReady?: (isReady: boolean) => void;
  private onFeedback?: (type: 'accepted' | 'rejected') => void;
  private onError?: (err: string) => void;
  
  private receivedChunks: ArrayBuffer[] = [];
  private currentFileName: string = "";
  private currentSenderName: string = "";
  private currentFileSize: number = 0;
  private bytesReceived: number = 0;

  constructor(socket: Socket, targetId: string, isInitiator: boolean) {
    console.log(`[WebRTC] Initializing PC for ${targetId}, isInitiator: ${isInitiator}`);
    this.socket = socket;
    this.targetId = targetId;
    this.pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(`[WebRTC] Sending ICE candidate to ${this.targetId}`);
        this.socket.emit("signal", {
          targetId: this.targetId,
          signal: { type: "candidate", candidate: event.candidate }
        });
      }
    };

    this.pc.onconnectionstatechange = () => {
      console.log(`[WebRTC] Connection state with ${this.targetId}: ${this.pc.connectionState}`);
      if (this.pc.connectionState === 'failed' || this.pc.connectionState === 'disconnected') {
        this.onError?.("Link Interrupted");
      }
    };

    if (isInitiator) {
      this.dataChannel = this.pc.createDataChannel("fileTransfer", {
        ordered: true
      });
      this.setupDataChannel();
    } else {
      this.pc.ondatachannel = (event) => {
        console.log("[WebRTC] Data channel received from initiator");
        this.dataChannel = event.channel;
        this.setupDataChannel();
      };
    }
  }

  private setupDataChannel() {
    if (!this.dataChannel) return;

    this.dataChannel.binaryType = "arraybuffer";
    
    this.dataChannel.onopen = () => {
      console.log(`[WebRTC] Data channel to ${this.targetId} is now OPEN`);
      this.onReady?.(true);
    };

    this.dataChannel.onclose = () => {
      console.log(`[WebRTC] Data channel to ${this.targetId} CLOSED`);
      this.onReady?.(false);
      if (this.bytesReceived > 0 && this.bytesReceived < this.currentFileSize) {
        this.onError?.("Transfer Incomplete");
      }
    };

    this.dataChannel.onerror = (err) => {
      console.error("[WebRTC] DataChannel error", err);
      this.onError?.("Channel Error");
    };

    this.dataChannel.onmessage = (event) => {
      if (typeof event.data === "string") {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "metadata") {
            console.log(`[WebRTC] Incoming file: ${msg.name} (${msg.size} bytes) from ${msg.senderName}`);
            this.currentFileName = msg.name;
            this.currentSenderName = msg.senderName || "Unknown Peer";
            this.currentFileSize = msg.size;
            this.receivedChunks = [];
            this.bytesReceived = 0;
            this.onProgress?.(0);
          } else if (msg.type === "feedback") {
            this.onFeedback?.(msg.status);
          }
        } catch (e) {
          console.error("[WebRTC] Error parsing message:", e);
        }
      } else {
        const chunk = event.data as ArrayBuffer;
        this.receivedChunks.push(chunk);
        this.bytesReceived += chunk.byteLength;
        
        const progress = Math.min((this.bytesReceived / this.currentFileSize) * 100, 100);
        this.onProgress?.(progress);

        if (this.bytesReceived >= this.currentFileSize && this.currentFileSize > 0) {
          console.log(`[WebRTC] Received all ${this.bytesReceived} bytes of ${this.currentFileName}`);
          const blob = new Blob(this.receivedChunks);
          this.onFileReceived?.(blob, this.currentFileName, this.currentSenderName);
          
          // Reset state for next transfer
          this.receivedChunks = [];
          this.bytesReceived = 0;
          this.currentFileSize = 0;
        }
      }
    };
  }

  public sendFeedback(status: 'accepted' | 'rejected') {
    if (this.dataChannel?.readyState === "open") {
      this.dataChannel.send(JSON.stringify({ type: "feedback", status }));
    }
  }

  public async createOffer() {
    if (!this.dataChannel) {
      console.log(`[WebRTC] Creating data channel for ${this.targetId} before offer`);
      this.dataChannel = this.pc.createDataChannel("fileTransfer", {
        ordered: true
      });
      this.setupDataChannel();
    }
    
    console.log(`[WebRTC] Creating offer for ${this.targetId}`);
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.socket.emit("signal", { targetId: this.targetId, signal: offer });
  }

  public async handleSignal(signal: any) {
    console.log(`[WebRTC] Handling signal type: ${signal.type || 'candidate'}`);
    if (signal.type === "offer") {
      await this.pc.setRemoteDescription(new RTCSessionDescription(signal));
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      this.socket.emit("signal", { targetId: this.targetId, signal: answer });
    } else if (signal.type === "answer") {
      await this.pc.setRemoteDescription(new RTCSessionDescription(signal));
    } else if (signal.candidate || (signal.type === "candidate")) {
      try {
        const candidate = signal.candidate || signal;
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.warn("[WebRTC] Error adding ICE candidate", e);
      }
    }
  }

  public async sendFile(file: File, senderName: string, onProgress: (p: number) => void) {
    if (!this.dataChannel) {
      console.error("[WebRTC] Data channel not initialized");
      return;
    }

    if (this.dataChannel.readyState !== "open") {
      console.log("[WebRTC] Waiting for data channel to open...");
      try {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject("Data channel timeout"), 5000);
          this.dataChannel!.onopen = () => {
            clearTimeout(timeout);
            resolve();
          };
        });
      } catch (err) {
        console.error(err);
        this.onError?.("Channel Timeout");
        return;
      }
    }

    console.log(`[WebRTC] Starting send: ${file.name} from ${senderName}`);
    this.onProgress = onProgress;
    
    try {
      this.dataChannel.send(JSON.stringify({
        type: "metadata",
        name: file.name,
        size: file.size,
        senderName: senderName
      }));

      const CHUNK_SIZE = 16384;
      let offset = 0;

      while (offset < file.size) {
        // Handle backpressure: Wait if buffer is too full
        while (this.dataChannel.bufferedAmount > 1024 * 1024) {
          await new Promise(resolve => setTimeout(resolve, 50));
          if (this.dataChannel.readyState !== "open") {
            throw new Error("Connection closed during transfer");
          }
        }

        const slice = file.slice(offset, offset + CHUNK_SIZE);
        const chunk = await slice.arrayBuffer();
        
        this.dataChannel.send(chunk);
        offset += chunk.byteLength;
        onProgress((offset / file.size) * 100);
      }
      
      console.log("[WebRTC] Send complete");
    } catch (err) {
      console.error("[WebRTC] Transfer error:", err);
      this.onError?.("Transfer Failed");
      onProgress(0); // Reset progress on error
    }
  }

  public setCallbacks(
    onProgress: (p: number) => void, 
    onFileReceived: (f: Blob, n: string, sn: string) => void,
    onReady?: (r: boolean) => void,
    onFeedback?: (t: 'accepted' | 'rejected') => void,
    onError?: (e: string) => void
  ) {
    this.onProgress = onProgress;
    this.onFileReceived = onFileReceived;
    this.onReady = onReady;
    this.onFeedback = onFeedback;
    this.onError = onError;
  }
}
