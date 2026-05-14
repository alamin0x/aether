import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  allowEIO3: true // Support older socket.io clients if necessary
});

const PORT = process.env.PORT || 3001;

// Log all connection attempts
io.engine.on("connection_error", (err) => {
  console.log("Server connection error:", err.message);
});

// Store room state
const rooms = new Map();

// Cloudflare TURN configuration
const CF_TURN_TOKEN_ID = process.env.CF_TURN_TOKEN_ID || "7817a31c565e3bed6913cf93e363202e";
const CF_API_TOKEN = process.env.CF_API_TOKEN || "5456c4b1ce742b2783c98ae58251a97859ddfa450df4d58f13ffef5a298e9a0f";

async function getIceServers() {
  const iceServers = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { 
      urls: "turn:free.expressturn.com:3478", 
      username: "000000002094082578", 
      credential: "gu+C23JGVUcbRZnDUEhPGBxFLS0=" 
    }
  ];

  try {
    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${CF_TURN_TOKEN_ID}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${CF_API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ttl: 86400 })
      }
    );
    const data = await response.json();
    if (data.iceServers) {
      // Add Cloudflare servers to our list
      iceServers.push(...data.iceServers);
    }
  } catch (err) {
    console.error("Failed to fetch Cloudflare ICE servers, using ExpressTURN fallback:", err);
  }
  
  return iceServers;
}

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('join-room', async ({ roomId, userName }) => {
    socket.join(roomId);
    
    // Fetch dynamic ICE servers
    const iceServers = await getIceServers();
    socket.emit('ice-servers', iceServers);
    
    // Track user in room
    if (!rooms.has(roomId)) {
      rooms.set(roomId, []);
    }
    
    // Random position constrained to a circle (radar boundary)
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * 0.85; // Keep away from the absolute edge (max 1)
    const userData = {
      id: socket.id,
      name: userName,
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance
    };
    
    rooms.get(roomId).push(userData);
    
    // Notify others in the room
    socket.to(roomId).emit('user-joined', userData);
    
    // Send existing users back to the new user
    const existingUsers = rooms.get(roomId).filter(u => u.id !== socket.id);
    socket.emit('room-users', existingUsers);
    
    console.log(`User ${userName} joined room: ${roomId}`);
  });

  // WebRTC Signaling
  socket.on('signal', ({ targetId, signal }) => {
    io.to(targetId).emit('signal', {
      senderId: socket.id,
      signal
    });
  });

  socket.on('disconnecting', () => {
    for (const roomId of socket.rooms) {
      if (rooms.has(roomId)) {
        rooms.set(roomId, rooms.get(roomId).filter(u => u.id !== socket.id));
        socket.to(roomId).emit('user-left', socket.id);
      }
    }
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
  });
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Signaling server running on port ${PORT} (Accessible on network)`);
});
