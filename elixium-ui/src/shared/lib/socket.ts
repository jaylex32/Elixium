import {io, type Socket as RawSocket} from 'socket.io-client';
import {getToken} from './auth-token';
import type {ServerToClientEvents, ClientToServerEvents} from '@shared/socket-events';

/**
 * Typed socket: event names are checked against the shared contract, so
 * listening for something the server never emits is a build error rather than
 * a feature that silently does nothing.
 */
export type Socket = RawSocket<ServerToClientEvents, ClientToServerEvents>;

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


