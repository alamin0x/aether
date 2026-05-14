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

  // Resolves when the data channel is fully open and ready
  private channelReadyPromise: Promise<void>;
  private channelReadyResolve!: () => void;

  constructor(socket: Socket, targetId: string, isInitiator: boolean, iceServers?: RTCIceServer[]) {
    console.log(`[WebRTC] Initializing PC for ${targetId}, isInitiator: ${isInitiator}`);
    this.socket = socket;
    this.targetId = targetId;

    // Build the ready promise ONCE — resolves when channel opens
    this.channelReadyPromise = new Promise<void>((resolve) => {
      this.channelReadyResolve = resolve;
    });

    const defaultIceServers: RTCIceServer[] = [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
      { urls: "stun:stun3.l.google.com:19302" },
      { urls: "stun:stun4.l.google.com:19302" },
    ];

    this.pc = new RTCPeerConnection({
      iceServers: iceServers && iceServers.length > 0 ? iceServers : defaultIceServers,
      iceCandidatePoolSize: 10,
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
      if (this.pc.connectionState === 'failed') {
        this.onError?.("Link Failed");
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      console.log(`[WebRTC] ICE state with ${this.targetId}: ${this.pc.iceConnectionState}`);
    };

    if (isInitiator) {
      // Initiator creates the data channel immediately
      this.dataChannel = this.pc.createDataChannel("fileTransfer", { ordered: true });
      this.setupDataChannel();
    } else {
      // Responder waits for the channel to arrive via ondatachannel
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
      this.channelReadyResolve(); // Signal that channel is ready
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

  /**
   * Creates an offer and sends it via the signaling server.
   * Only call this on the INITIATOR side.
   */
  public async createOffer() {
    if (this.pc.signalingState !== 'stable') {
      console.warn(`[WebRTC] createOffer called in bad state: ${this.pc.signalingState} — skipping`);
      return;
    }
    console.log(`[WebRTC] Creating offer for ${this.targetId}`);
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.socket.emit("signal", { targetId: this.targetId, signal: offer });
  }

  /**
   * Waits for the data channel to be open with a timeout.
   * Use this before calling sendFile().
   */
  public waitForChannel(timeoutMs = 15000): Promise<void> {
    return Promise.race([
      this.channelReadyPromise,
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error("Data channel timeout after " + timeoutMs + "ms")), timeoutMs)
      )
    ]);
  }

  public async handleSignal(signal: any) {
    console.log(`[WebRTC] Handling signal type: ${signal.type || 'candidate'}, state: ${this.pc.signalingState}`);
    try {
      if (signal.type === "offer") {
        await this.pc.setRemoteDescription(new RTCSessionDescription(signal));
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        this.socket.emit("signal", { targetId: this.targetId, signal: answer });
      } else if (signal.type === "answer") {
        if (this.pc.signalingState === 'have-local-offer') {
          await this.pc.setRemoteDescription(new RTCSessionDescription(signal));
        } else {
          console.warn(`[WebRTC] Ignoring answer in state: ${this.pc.signalingState}`);
        }
      } else if (signal.candidate || signal.type === "candidate") {
        const candidate = signal.candidate ?? signal;
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
    } catch (e) {
      console.warn("[WebRTC] handleSignal error:", e);
    }
  }

  public async sendFile(file: File, senderName: string, onProgress: (p: number) => void) {
    if (!this.dataChannel) {
      this.onError?.("No data channel");
      console.error("[WebRTC] sendFile called but no data channel exists");
      return;
    }

    // Wait for channel to be ready (uses the shared promise — never overwrites onopen)
    if (this.dataChannel.readyState !== "open") {
      console.log("[WebRTC] Channel not open yet, waiting...");
      try {
        await this.waitForChannel(15000);
      } catch (err) {
        console.error("[WebRTC]", err);
        this.onError?.("Channel Timeout");
        return;
      }
    }

    console.log(`[WebRTC] Starting send: ${file.name} (${file.size} bytes) from ${senderName}`);

    try {
      // Send metadata first
      this.dataChannel.send(JSON.stringify({
        type: "metadata",
        name: file.name,
        size: file.size,
        senderName: senderName
      }));

      const CHUNK_SIZE = 16384; // 16 KB
      let offset = 0;

      while (offset < file.size) {
        // Back-pressure: pause if buffer is getting full
        while (this.dataChannel.bufferedAmount > 512 * 1024) {
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
      onProgress(0);
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

  public destroy() {
    this.dataChannel?.close();
    this.pc.close();
  }
}
