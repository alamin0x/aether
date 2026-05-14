# 📡 BlipSync

**Instant, Private, Peer-to-Peer File Sharing via Decentralized Radar.**

[![Vercel](https://img.shields.io/badge/Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://blipsync.vercel.app)
[![Next.js](https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![Socket.io](https://img.shields.io/badge/Socket.io-010101?style=for-the-badge&logo=socketdotio&logoColor=white)](https://socket.io/)
[![WebRTC](https://img.shields.io/badge/WebRTC-333333?style=for-the-badge&logo=webrtc&logoColor=white)](https://webrtc.org/)

BlipSync is a high-performance web application designed for seamless, serverless file transfers. Using a radar-inspired interface, users can discover nearby devices in a virtual room and transmit files directly via encrypted WebRTC data channels.

---

## ✨ Features

- 🛰️ **Visual Radar UI:** Discover peers in real-time on a dynamic, interactive radar map.
- 🔒 **True P2P Privacy:** Files are never stored on a server. Data moves directly from one browser to another.
- 🚀 **High-Speed Transfers:** Built on WebRTC for the fastest possible transmission speeds allowed by your network.
- 🛡️ **Encrypted & Secure:** End-to-end encryption for every file blip.
- 📱 **Cross-Platform:** Works on desktop, tablet, and mobile browsers with zero installation.

---

## 🛠️ Technology Stack

- **Frontend:** [Next.js](https://nextjs.org/) (App Router), TypeScript, Tailwind CSS
- **Animations:** [Framer Motion](https://www.framer.com/motion/)
- **Signaling:** [Socket.io](https://socket.io/) (Node.js/Express)
- **Data Transfer:** [WebRTC](https://webrtc.org/) (Data Channels)
- **Icons:** [Lucide React](https://lucide.dev/)

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18 or higher)
- npm or yarn

### Local Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/alamin0x/aether.git
   cd aether
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Run the development servers:**
   ```bash
   # Starts both the Next.js frontend and the Signaling server
   npm run dev:all
   ```

4. **Open the app:**
   Go to `http://localhost:3000` in your browser.

---

## 🌐 Hosting Guide

### 1. Signaling Server (Render/Railway)
The signaling server requires a persistent connection. We recommend **Render.com**:
- **Build Command:** `npm install`
- **Start Command:** `node src/server/index.mjs`

### 2. Frontend (Vercel)
Connect your GitHub repo to **Vercel**:
- Add Environment Variable: `NEXT_PUBLIC_SIGNALING_SERVER`
- Value: Your hosted Signaling Server URL (e.g., `https://your-server.onrender.com`)

---

## 🛡️ Privacy & Security
BlipSync is built with privacy at its core. 
- **Signaling Only:** Our servers only facilitate the initial handshake between peers. 
- **No File Storage:** Once the handshake is complete, files are streamed directly between devices.
- **Auto-Cleanup:** Connection metadata is cleared immediately after a peer disconnects.

---

## 📄 License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

Developed with ❤️ for the decentralized web.
