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

  // ─── ICE candidate queue ────────────────────────────────────────────────────
  // Candidates that arrive before setRemoteDescription() is called are buffered
  // here and flushed once the remote description is set. This is the PRIMARY fix
  // for production (cross-network) failures where internet latency means
  // candidates arrive before the offer/answer handshake completes.
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private remoteDescriptionSet = false;

  // ─── Channel ready promise ───────────────────────────────────────────────────
  // Resolves exactly once when the data channel transitions to "open".
  // We expose waitForChannel() so sendFile() can await it safely.
  private channelReadyPromise: Promise<void>;
  private channelReadyResolve!: () => void;

  constructor(
    socket: Socket,
    targetId: string,
    isInitiator: boolean,
    iceServers?: RTCIceServer[]
  ) {
    console.log(`[WebRTC] Initializing PC for ${targetId}, isInitiator: ${isInitiator}`);
    this.socket = socket;
    this.targetId = targetId;

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

    // ── ICE candidate → signal ──────────────────────────────────────────────
    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(`[WebRTC] Sending ICE candidate to ${this.targetId}`);
        this.socket.emit("signal", {
          targetId: this.targetId,
          signal: { type: "candidate", candidate: event.candidate },
        });
      }
    };

    // ── Connection state logging ────────────────────────────────────────────
    this.pc.onconnectionstatechange = () => {
      console.log(`[WebRTC] Connection state → ${this.pc.connectionState} (peer: ${this.targetId})`);
      if (this.pc.connectionState === "failed") {
        this.onError?.("Link Failed — no route found (TURN may be needed)");
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      console.log(`[WebRTC] ICE state → ${this.pc.iceConnectionState} (peer: ${this.targetId})`);
      if (this.pc.iceConnectionState === "failed") {
        console.error("[WebRTC] ICE failed — check TURN server credentials on Render");
      }
    };

    this.pc.onicegatheringstatechange = () => {
      console.log(`[WebRTC] ICE gathering → ${this.pc.iceGatheringState}`);
    };

    // ── Data channel setup ──────────────────────────────────────────────────
    if (isInitiator) {
      this.dataChannel = this.pc.createDataChannel("fileTransfer", { ordered: true });
      this.setupDataChannel();
    } else {
      this.pc.ondatachannel = (event) => {
        console.log("[WebRTC] Data channel received from initiator");
        this.dataChannel = event.channel;
        this.setupDataChannel();
      };
    }
  }

  // ─── Private: wire up data channel events ──────────────────────────────────
  private setupDataChannel() {
    if (!this.dataChannel) return;

    this.dataChannel.binaryType = "arraybuffer";

    // ── Speed optimisation: event-based back-pressure ──────────────────────
    // When bufferedAmount drops below this threshold the 'bufferedamountlow'
    // event fires, allowing us to resume sending immediately instead of
    // polling with setTimeout(50ms) — reduces idle wait to near zero.
    const BUFFER_LOW_THRESHOLD = 256 * 1024; // 256 KB
    this.dataChannel.bufferedAmountLowThreshold = BUFFER_LOW_THRESHOLD;

    this.dataChannel.onopen = () => {
      console.log(`[WebRTC] ✅ Data channel OPEN (peer: ${this.targetId})`);
      this.channelReadyResolve();
      this.onReady?.(true);
    };

    this.dataChannel.onclose = () => {
      console.log(`[WebRTC] Data channel CLOSED (peer: ${this.targetId})`);
      this.onReady?.(false);
      if (this.bytesReceived > 0 && this.bytesReceived < this.currentFileSize) {
        this.onError?.("Transfer Incomplete — connection dropped");
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
          console.log(`[WebRTC] ✅ Received all ${this.bytesReceived} bytes of ${this.currentFileName}`);
          const blob = new Blob(this.receivedChunks);
          this.onFileReceived?.(blob, this.currentFileName, this.currentSenderName);
          this.receivedChunks = [];
          this.bytesReceived = 0;
          this.currentFileSize = 0;
        }
      }
    };
  }

  // ─── Private: event-based buffer drain ─────────────────────────────────────
  // Returns a Promise that resolves the moment the send buffer has drained
  // below bufferedAmountLowThreshold. This is called instead of sleeping 50ms
  // in a polling loop, giving us maximum throughput with zero wasted time.
  private waitForBufferDrain(): Promise<void> {
    if (!this.dataChannel || this.dataChannel.bufferedAmount <= this.dataChannel.bufferedAmountLowThreshold) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const onLow = () => {
        this.dataChannel!.removeEventListener('bufferedamountlow', onLow);
        resolve();
      };
      const onClose = () => {
        this.dataChannel!.removeEventListener('bufferedamountlow', onLow);
        this.dataChannel!.removeEventListener('close', onClose);
        reject(new Error('Connection closed during transfer'));
      };
      this.dataChannel!.addEventListener('bufferedamountlow', onLow);
      this.dataChannel!.addEventListener('close', onClose);
    });
  }

  // ─── Private: flush buffered ICE candidates after remote desc is set ────────
  private async flushPendingCandidates() {
    console.log(`[WebRTC] Flushing ${this.pendingCandidates.length} queued ICE candidate(s)`);
    for (const candidate of this.pendingCandidates) {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.warn("[WebRTC] Error adding queued ICE candidate:", e);
      }
    }
    this.pendingCandidates = [];
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  public sendFeedback(status: "accepted" | "rejected") {
    if (this.dataChannel?.readyState === "open") {
      this.dataChannel.send(JSON.stringify({ type: "feedback", status }));
    }
  }

  /**
   * Creates an SDP offer and sends it via the signaling server.
   * Call ONLY on the initiator side.
   */
  public async createOffer() {
    if (this.pc.signalingState !== "stable") {
      console.warn(`[WebRTC] createOffer skipped — bad signaling state: ${this.pc.signalingState}`);
      return;
    }
    console.log(`[WebRTC] Creating offer for ${this.targetId}`);
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.socket.emit("signal", { targetId: this.targetId, signal: offer });
  }

  /**
   * Waits for the data channel to open, with a timeout.
   * Call this before sendFile() to ensure the P2P path is ready.
   */
  public waitForChannel(timeoutMs = 20000): Promise<void> {
    return Promise.race([
      this.channelReadyPromise,
      new Promise<void>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Data channel timeout after ${timeoutMs}ms — ICE may have failed. Check TURN server credentials.`)),
          timeoutMs
        )
      ),
    ]);
  }

  /**
   * Handles an incoming signal (offer / answer / ICE candidate).
   *
   * KEY FIX: ICE candidates that arrive before setRemoteDescription() is called
   * are queued and applied after. Without this, production (cross-network) transfers
   * always fail because internet latency means candidates race ahead of the handshake.
   */
  public async handleSignal(signal: any) {
    console.log(`[WebRTC] handleSignal type="${signal.type || "candidate"}" state="${this.pc.signalingState}"`);
    try {
      if (signal.type === "offer") {
        await this.pc.setRemoteDescription(new RTCSessionDescription(signal));
        this.remoteDescriptionSet = true;

        // Flush any ICE candidates that arrived before the offer
        await this.flushPendingCandidates();

        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        this.socket.emit("signal", { targetId: this.targetId, signal: answer });

      } else if (signal.type === "answer") {
        if (this.pc.signalingState === "have-local-offer") {
          await this.pc.setRemoteDescription(new RTCSessionDescription(signal));
          this.remoteDescriptionSet = true;

          // Flush any ICE candidates that arrived before the answer
          await this.flushPendingCandidates();
        } else {
          console.warn(`[WebRTC] Ignoring answer — unexpected state: ${this.pc.signalingState}`);
        }

      } else if (signal.candidate || signal.type === "candidate") {
        const candidate: RTCIceCandidateInit = signal.candidate ?? signal;

        if (!this.remoteDescriptionSet) {
          // ← THE FIX: queue instead of blindly calling addIceCandidate
          console.log("[WebRTC] Remote description not set yet — queuing ICE candidate");
          this.pendingCandidates.push(candidate);
        } else {
          await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
      }
    } catch (e) {
      console.warn("[WebRTC] handleSignal error:", e);
    }
  }

  public async sendFile(
    file: File,
    senderName: string,
    onProgress: (p: number) => void
  ) {
    if (!this.dataChannel) {
      this.onError?.("No data channel — peer was not created as initiator");
      console.error("[WebRTC] sendFile: no data channel");
      return;
    }

    if (this.dataChannel.readyState !== "open") {
      console.log("[WebRTC] Waiting for data channel to open...");
      try {
        await this.waitForChannel(20000);
      } catch (err) {
        console.error("[WebRTC]", err);
        this.onError?.("Channel Timeout — P2P path could not be established");
        return;
      }
    }

    console.log(`[WebRTC] Starting send: ${file.name} (${file.size} bytes) from "${senderName}"`);

    try {
      this.dataChannel.send(
        JSON.stringify({ type: "metadata", name: file.name, size: file.size, senderName })
      );

      // ── Chunk size: 256 KB for Chrome/Edge, 64 KB for Firefox ────────────
      // Larger chunks = fewer messages = less overhead = much faster transfers.
      // Chrome's SCTP layer handles up to 256 KB per send(); Firefox caps at 64 KB.
      const isFirefox = typeof navigator !== 'undefined' && navigator.userAgent.includes('Firefox');
      const CHUNK_SIZE = isFirefox ? 65536 : 262144; // 64 KB or 256 KB

      // ── High-water mark: pause sending when buffer exceeds this ──────────
      // Tuned to be large enough to keep the pipe full but small enough to
      // avoid excessive memory use. Must be > bufferedAmountLowThreshold.
      const HIGH_WATER_MARK = 1 * 1024 * 1024; // 1 MB

      console.log(`[WebRTC] Chunk size: ${CHUNK_SIZE / 1024}KB, HWM: ${HIGH_WATER_MARK / 1024}KB`);

      let offset = 0;

      // Pre-read the first chunk before the loop to pipeline disk reads
      let nextChunk: ArrayBuffer | null = await file.slice(0, CHUNK_SIZE).arrayBuffer();
      let nextChunkPromise: Promise<ArrayBuffer> | null = null;

      while (offset < file.size) {
        if (this.dataChannel.readyState !== "open") {
          throw new Error("Connection closed mid-transfer");
        }

        // Back-pressure: wait for buffer to drain using event (not setTimeout!)
        if (this.dataChannel.bufferedAmount > HIGH_WATER_MARK) {
          await this.waitForBufferDrain();
        }

        const chunk = nextChunk!;
        offset += chunk.byteLength;

        // Pre-read the NEXT chunk from disk while this one is being sent
        // (overlaps I/O with network sending for maximum throughput)
        if (offset < file.size) {
          nextChunkPromise = file.slice(offset, offset + CHUNK_SIZE).arrayBuffer();
        } else {
          nextChunkPromise = null;
        }

        this.dataChannel.send(chunk);
        onProgress((offset / file.size) * 100);

        // Await the pre-read so it's ready for the next iteration
        if (nextChunkPromise !== null) {
          nextChunk = await nextChunkPromise;
        } else {
          nextChunk = null;
        }
      }

      console.log(`[WebRTC] ✅ Send complete — ${(file.size / 1024 / 1024).toFixed(2)} MB`);
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
    onFeedback?: (t: "accepted" | "rejected") => void,
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
