import {io, type Socket} from 'socket.io-client';
import {getToken} from './auth-token';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io({
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnectionDelay: 1000,
      reconnectionAttempts: Infinity,
      /*
       * The socket carries the same privileges as the REST API, so it presents
       * the same token. Read lazily on each (re)connection attempt rather than
       * captured once, so pairing takes effect without a page reload.
       */
      auth: (cb) => cb({token: getToken()}),
    });
  }
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}

export {type Socket};
