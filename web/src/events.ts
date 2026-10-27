import { useEffect } from 'react';
import { create } from 'zustand';
import type { ServerEvent } from '@shared/types';

type Handler = (event: ServerEvent) => void;

const handlers = new Set<Handler>();
let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;
let started = false;
let pingTimer: number | null = null;
let attempts = 0;

interface EventConnectionState {
  status: 'connecting' | 'online' | 'offline';
  lastEventAt: number;
  setStatus: (status: 'connecting' | 'online' | 'offline') => void;
  touch: () => void;
}

export const useEventConnection = create<EventConnectionState>((set) => ({
  status: 'connecting',
  lastEventAt: 0,
  setStatus: (status) => set({ status }),
  touch: () => set({ lastEventAt: Date.now() })
}));

function dispatch(event: ServerEvent) {
  useEventConnection.getState().touch();
  for (const handler of handlers) {
    try {
      handler(event);
    } catch (error) {
      console.error('[events] handler failed', error);
    }
  }
}

function openSocket() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.host}/ws/events`;
  useEventConnection.getState().setStatus('connecting');
  try {
    socket = new WebSocket(url);
  } catch {
    scheduleReconnect();
    return;
  }
  socket.onopen = () => {
    attempts = 0;
    useEventConnection.getState().setStatus('online');
    if (pingTimer) window.clearInterval(pingTimer);
    pingTimer = window.setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }));
    }, 25_000);
  };
  socket.onmessage = (event) => {
    try {
      dispatch(JSON.parse(String(event.data)) as ServerEvent);
    } catch {
      // ignore malformed events
    }
  };
  socket.onclose = () => {
    useEventConnection.getState().setStatus('offline');
    if (pingTimer) window.clearInterval(pingTimer);
    socket = null;
    scheduleReconnect();
  };
  socket.onerror = () => {
    socket?.close();
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  attempts += 1;
  const delay = Math.min(15_000, 750 * Math.pow(1.6, attempts));
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    openSocket();
  }, delay);
}

/** Start the app-wide server event stream. Safe to call twice. */
export function startEventStream() {
  if (started) return;
  started = true;
  openSocket();
}

export function stopEventStream() {
  started = false;
  if (reconnectTimer) window.clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (pingTimer) window.clearInterval(pingTimer);
  socket?.close();
  socket = null;
}

/** Subscribe to typed server events for the lifetime of a component. */
export function useServerEvent(handler: Handler) {
  useEffect(() => {
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
    };
  }, [handler]);
}

export function onServerEvent(handler: Handler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}
