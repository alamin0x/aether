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

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('join-room', ({ roomId, userName }) => {
    socket.join(roomId);
    
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
