"use client";

import { useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";

const getSocketUrl = () => {
  // Use environment variable if available (for production/hosting)
  // Fallback to local IP for development
  return process.env.NEXT_PUBLIC_SIGNALING_SERVER || "http://192.168.0.71:3001";
};

export const useSocket = () => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const newSocket = io(getSocketUrl());
    setSocket(newSocket);

    newSocket.on("connect", () => {
      setIsConnected(true);
      console.log("Connected to signaling server");
    });

    newSocket.on("connect_error", (err) => {
      console.error("Socket connection error:", err.message);
      setIsConnected(false);
    });

    newSocket.on("disconnect", (reason) => {
      console.log("Disconnected:", reason);
      setIsConnected(false);
    });

    return () => {
      newSocket.disconnect();
    };
  }, []);

  return {
    socket,
    isConnected,
  };
};
