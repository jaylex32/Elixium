import {io, type Socket} from 'socket.io-client';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io({
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnectionDelay: 1000,
      reconnectionAttempts: Infinity,
    });
  }
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}

export {type Socket};
