import {useEffect, useRef} from 'react';
import {getSocket} from './socket';

/**
 * Request/subscribe helpers over Socket.IO.
 *
 * The backend's realtime protocol is fire-and-forget: you emit one event and a
 * matching result event comes back later. Every page reimplemented that by
 * hand — emit, register a listener, remember to unregister, and hope no other
 * component was listening for the same event. This centralizes the pattern so
 * a caller gets a promise or a self-cleaning subscription instead.
 */

export interface SocketRequestOptions {
  /** Event carrying the successful result. */
  resolveOn: string;
  /** Event carrying a failure, if the protocol has one. */
  rejectOn?: string;
  /** Give up after this long so a lost reply cannot hang a caller forever. */
  timeoutMs?: number;
}

/**
 * Emit an event and resolve with the matching reply.
 *
 * Listeners are always torn down — on success, failure, and timeout — because
 * a leaked one-shot listener fires again on the next unrelated reply and
 * resolves a promise nobody is waiting for.
 */
export function socketRequest<T = unknown>(
  emitEvent: string,
  payload?: unknown,
  {resolveOn, rejectOn, timeoutMs = 15000}: SocketRequestOptions = {resolveOn: ''},
): Promise<T> {
  const socket = getSocket();

  return new Promise<T>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      socket.off(resolveOn, onResolve);
      if (rejectOn) socket.off(rejectOn, onReject);
    };

    const onResolve = (data: T) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(data);
    };

    const onReject = (data: {message?: string}) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(data?.message ?? `${emitEvent} failed`));
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Timed out waiting for ${resolveOn}`));
    }, timeoutMs);

    socket.on(resolveOn, onResolve);
    if (rejectOn) socket.on(rejectOn, onReject);
    socket.emit(emitEvent, payload);
  });
}

/**
 * Subscribe to a server event for the lifetime of a component.
 *
 * The handler is held in a ref so that passing an inline arrow function does
 * not re-subscribe on every render — the mistake that produces duplicate
 * listeners and handlers firing N times.
 */
export function useSocketEvent<T = unknown>(event: string, handler: (data: T) => void, enabled = true): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;
    const socket = getSocket();
    const listener = (data: T) => handlerRef.current(data);

    socket.on(event, listener);
    return () => {
      socket.off(event, listener);
    };
  }, [event, enabled]);
}

/** Fire-and-forget emit, for actions with no reply worth awaiting. */
export function socketSend(event: string, payload?: unknown): void {
  getSocket().emit(event, payload);
}
