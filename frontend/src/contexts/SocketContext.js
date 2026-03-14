import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const SocketContext = createContext(null);

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || window.location.origin.replace(':3000', ':5000');

export function SocketProvider({ children, partyId }) {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const token = sessionStorage.getItem('authToken');
    const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'], auth: { token } });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      if (partyId) {
        socket.emit('join:party', partyId);
      }
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    return () => {
      if (partyId) {
        socket.emit('leave:party', partyId);
      }
      socket.disconnect();
    };
  }, [partyId]);

  return (
    <SocketContext.Provider value={{ socket: socketRef.current, connected }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}
